import * as crypto from 'crypto';

interface JWTHeader {
  alg: string;
  kid: string;
  typ?: string;
}

interface JWTPayload {
  [key: string]: any;
  exp?: number;
  nbf?: number;
  iat?: number;
  iss?: string;
  aud?: string | string[];
}

interface JWK {
  kty: string;
  kid: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
  x?: string;
  y?: string;
  crv?: string;
  x5c?: string[];
  "x5t#S256"?: string;
}

interface JWKS {
  keys: JWK[];
}

interface VerificationOptions {
  issuer?: string;
  audience?: string | string[];
  clockTolerance?: number;
}

export function verifyJWTSync(
  token: string,
  jwks: JWKS,
  options: VerificationOptions = {}
): { valid: boolean; payload?: JWTPayload; error?: string } {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return { valid: false, error: 'Invalid JWT format' };
    }

    const [headerB64, payloadB64, signatureB64] = parts;

    const header: JWTHeader = JSON.parse(base64UrlDecode(headerB64));
    const payload: JWTPayload = JSON.parse(base64UrlDecode(payloadB64));

    const key = jwks.keys.find(k => k.kid === header.kid);
    if (!key) {
      return { valid: false, error: `Key with kid "${header.kid}" not found in JWKS` };
    }

    const signatureValid = verifySignature(
      `${headerB64}.${payloadB64}`,
      signatureB64,
      key,
      header.alg
    );

    if (!signatureValid) {
      return { valid: false, error: 'Invalid signature' };
    }

    const claimsValidation = validateClaims(payload, options);
    if (!claimsValidation.valid) {
      return { valid: false, error: claimsValidation.error };
    }

    return { valid: true, payload };
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

function verifySignature(
  data: string,
  signature: string,
  key: JWK,
  algorithm: string
): boolean {
  try {
    const signatureBuffer = base64UrlDecodeToBuffer(signature);
    
    if (algorithm.startsWith('RS')) {
      return verifyRSASignature(data, signatureBuffer, key, algorithm);
    } else if (algorithm.startsWith('ES')) {
      return verifyECDSASignature(data, signatureBuffer, key, algorithm);
    } else {
      throw new Error(`Unsupported algorithm: ${algorithm}`);
    }
  } catch (error) {
    return false;
  }
}

function verifyRSASignature(
  data: string,
  signature: Buffer,
  key: JWK,
  algorithm: string
): boolean {
  if (!key.n || !key.e) {
    throw new Error('Invalid RSA key: missing n or e');
  }

  const publicKey = jwkToRSAPublicKey(key);
  
  const hashAlgorithm = algorithm.replace('RS', 'RSA-SHA');
  
  const verifier = crypto.createVerify(hashAlgorithm);
  verifier.update(data);
  
  return verifier.verify(publicKey, signature);
}

function verifyECDSASignature(
  data: string,
  signature: Buffer,
  key: JWK,
  algorithm: string
): boolean {
  if (!key.x || !key.y || !key.crv) {
    throw new Error('Invalid EC key: missing x, y, or crv');
  }

  const publicKey = jwkToECPublicKey(key);
  
  const hashMap: { [key: string]: string } = {
    'ES256': 'sha256',
    'ES384': 'sha384',
    'ES512': 'sha512'
  };
  
  const hashAlgorithm = hashMap[algorithm];
  if (!hashAlgorithm) {
    throw new Error(`Unsupported algorithm: ${algorithm}`);
  }
  
  const verifier = crypto.createVerify(hashAlgorithm);
  verifier.update(data);
  
  const derSignature = convertRSToASN1(signature, algorithm);
  
  return verifier.verify(publicKey, derSignature);
}

function validateClaims(
  payload: JWTPayload,
  options: VerificationOptions
): { valid: boolean; error?: string } {
  const now = Math.floor(Date.now() / 1000);
  const tolerance = options.clockTolerance || 0;

  if (payload.exp !== undefined) {
    if (now > payload.exp + tolerance) {
      return { valid: false, error: 'Token has expired' };
    }
  }

  if (payload.nbf !== undefined) {
    if (now < payload.nbf - tolerance) {
      return { valid: false, error: 'Token not yet valid' };
    }
  }

  if (options.issuer && payload.iss !== options.issuer) {
    return { valid: false, error: 'Invalid issuer' };
  }

  if (options.audience) {
    const audiences = Array.isArray(options.audience) ? options.audience : [options.audience];
    const tokenAudiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    
    const hasMatchingAudience = audiences.some(aud => 
      tokenAudiences.includes(aud)
    );
    
    if (!hasMatchingAudience) {
      return { valid: false, error: 'Invalid audience' };
    }
  }

  return { valid: true };
}

function jwkToRSAPublicKey(key: JWK): string {
  const publicKey = crypto.createPublicKey({
    key: {
      kty: 'RSA',
      n: key.n,
      e: key.e
    },
    format: 'jwk'
  });

  return publicKey.export({ type: 'spki', format: 'pem' }) as string;
}

function jwkToECPublicKey(key: JWK): string {
  const publicKey = crypto.createPublicKey({
    key: {
      kty: 'EC',
      crv: key.crv,
      x: key.x,
      y: key.y
    },
    format: 'jwk'
  });

  return publicKey.export({ type: 'spki', format: 'pem' }) as string;
}

function convertRSToASN1(signature: Buffer, algorithm: string): Buffer {
  const keySize = getKeySizeForAlgorithm(algorithm);
  const partSize = keySize / 8;
  
  if (signature.length !== partSize * 2) {
    return signature;
  }
  
  const r = signature.slice(0, partSize);
  const s = signature.slice(partSize);
  
  const encodeInteger = (buf: Buffer): Buffer => {
    let i = 0;
    while (i < buf.length && buf[i] === 0) i++;
    
    const needsPadding = buf[i] >= 0x80;
    const length = buf.length - i + (needsPadding ? 1 : 0);
    const result = Buffer.alloc(2 + length);
    result[0] = 0x02;
    result[1] = length;
    
    if (needsPadding) {
      result[2] = 0x00;
      buf.copy(result, 3, i);
    } else {
      buf.copy(result, 2, i);
    }
    
    return result;
  };
  
  const rEncoded = encodeInteger(r);
  const sEncoded = encodeInteger(s);
  
  const result = Buffer.alloc(2 + rEncoded.length + sEncoded.length);
  result[0] = 0x30;
  result[1] = rEncoded.length + sEncoded.length;
  rEncoded.copy(result, 2);
  sEncoded.copy(result, 2 + rEncoded.length);
  
  return result;
}

function getKeySizeForAlgorithm(algorithm: string): number {
  const sizes: { [key: string]: number } = {
    'ES256': 256,
    'ES384': 384,
    'ES512': 521
  };
  return sizes[algorithm] || 256;
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf-8');
}

function base64UrlDecodeToBuffer(str: string): Buffer {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64');
}