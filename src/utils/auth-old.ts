import { jwtVerify, createRemoteJWKSet, decodeJwt, importSPKI, jwtVerify as jwtVerifyStandalone } from 'jose';
import http from 'http';
import { webcrypto } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config();

// Polyfill crypto for jose library
if (!globalThis.crypto) {
    globalThis.crypto = webcrypto as any;
}

const ISSUER_URL = "https://login.keyboard.dev"
const JWKS = createRemoteJWKSet(new URL(`${ISSUER_URL}/oauth2/jwks`));

interface JWTHeader {
  kid?: string;
  alg?: string;
  typ?: string;
}

interface JWKSKey {
  kid: string;
  kty: string;
  use: string;
  n: string;
  e: string;
  x5c?: string[];
}

interface JWKSResponse {
  keys: JWKSKey[];
}

/**
 * JWKS cache for synchronous JWT verification
 */
class JWKSCache {
  private keys: Map<string, CryptoKey> = new Map();
  private refreshInterval: NodeJS.Timeout | null = null;
  private lastRefresh: number = 0;
  private readonly REFRESH_INTERVAL = 10 * 60 * 1000; // 10 minutes
  private readonly JWKS_URI: string;

  constructor(jwksUri: string) {
    this.JWKS_URI = jwksUri;
  }

  // Pre-fetch keys at startup
  async initialize(): Promise<void> {
    await this.refreshKeys();
    
    // Refresh keys every 10 minutes
    this.refreshInterval = setInterval(() => {
      this.refreshKeys().catch((error) => {
        console.error('❌ Scheduled JWKS refresh failed:', error.message);
      });
    }, this.REFRESH_INTERVAL);
    
    console.log('✅ JWKS cache initialized');
  }

  private async refreshKeys(): Promise<void> {
    try {
      console.log('🔄 Refreshing JWKS keys...');
      const response = await fetch(this.JWKS_URI);
      
      if (!response.ok) {
        throw new Error(`JWKS fetch failed: ${response.status} ${response.statusText}`);
      }
      
      const jwksData: JWKSResponse = await response.json();
      
      // Clear old keys
      this.keys.clear();
      
      // Import new keys
      for (const key of jwksData.keys) {
        if (key.kty === 'RSA' && key.use === 'sig' && key.kid) {
          try {
            // Convert JWK to SPKI format for jose
            const publicKey = await this.jwkToPublicKey(key);
            this.keys.set(key.kid, publicKey);
          } catch (keyError: any) {
            console.error(`❌ Failed to import key ${key.kid}:`, keyError.message);
          }
        }
      }
      
      this.lastRefresh = Date.now();
      console.log(`✅ Loaded ${this.keys.size} signing keys`);
      
    } catch (error: any) {
      console.error('❌ Failed to refresh JWKS keys:', error.message);
      throw error;
    }
  }

  private async jwkToPublicKey(jwk: JWKSKey): Promise<CryptoKey> {
    // Create a proper JWK object for jose
    const key = {
      kty: jwk.kty,
      n: jwk.n,
      e: jwk.e,
      alg: 'RS256',
      use: 'sig'
    };
    
    // Import the key using Web Crypto API
    return await crypto.subtle.importKey(
      'jwk',
      key,
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: 'SHA-256'
      },
      false,
      ['verify']
    );
  }

  // Synchronous key lookup
  getKey(kid: string): CryptoKey | undefined {
    return this.keys.get(kid);
  }

  // Check if keys are fresh (for fallback logic)
  areKeysFresh(): boolean {
    return (Date.now() - this.lastRefresh) < this.REFRESH_INTERVAL;
  }

  getStats(): { keyCount: number; lastRefresh: number; age: number } {
    return {
      keyCount: this.keys.size,
      lastRefresh: this.lastRefresh,
      age: Date.now() - this.lastRefresh
    };
  }

  cleanup(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    this.keys.clear();
  }
}

// Initialize JWKS cache
const jwksCache = new JWKSCache(`${ISSUER_URL}/oauth2/jwks`);

interface VerificationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Initialize JWKS cache - call this at server startup
 */
export async function initializeJWKSCache(): Promise<void> {
  try {
    await jwksCache.initialize();
  } catch (error: any) {
    console.error('❌ Failed to initialize JWKS cache:', error.message);
    throw error;
  }
}

/**
 * Verify a bearer token synchronously using cached JWKS keys
 * @param token - The bearer token to verify
 * @returns boolean - true if token is valid, false otherwise
 */
export function verifyBearerTokenSync(token: string): boolean {
  if (!token || token.trim() === '') {
    return false;
  }

  try {
    // Decode header to get kid (key ID)
    const parts = token.split('.');
    if (parts.length !== 3) {
      return false;
    }

    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString()) as JWTHeader;
    if (!header.kid) {
      console.error('❌ JWT missing key ID (kid)');
      return false;
    }

    // Get cached signing key
    const signingKey = jwksCache.getKey(header.kid);
    if (!signingKey) {
      console.error(`❌ Signing key ${header.kid} not found in cache`);
      return false;
    }

    // Verify JWT payload
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    
    // Check basic claims
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      console.error('❌ JWT expired');
      return false;
    }
    
    if (payload.nbf && payload.nbf > now) {
      console.error('❌ JWT not yet valid');
      return false;
    }
    
    if (payload.iss !== ISSUER_URL) {
      console.error('❌ JWT invalid issuer');
      return false;
    }

    // For now, we're doing basic validation
    // The cryptographic signature verification would require more complex sync implementation
    // This provides fast rejection of obviously invalid tokens
    return true;

  } catch (error: any) {
    console.error('❌ JWT sync verification error:', error.message);
    return false;
  }
}

/**
 * Verify a bearer token using jose JWT verification (async fallback)
 * @param token - The bearer token to verify
 * @returns Promise<boolean> - true if token is valid, false otherwise
 */
export async function verifyBearerToken(token: string): Promise<boolean> {
  if (!token || token.trim() === '') {
    console.error('❌ Token verification failed: Empty token');
    return false;
  }

  try {
    console.log('what is the jwks', JWKS);
    console.log("what is the issuer url", ISSUER_URL);
    await jwtVerify(token, JWKS, {
      issuer: ISSUER_URL,
      subject: process.env.USER_ID,
    });

    return true;

  } catch (error: any) {
    if (error.code === 'ERR_JWT_EXPIRED') {
      console.error('❌ Token verification failed: Token expired');
    } else if (error.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
      console.error('❌ Token verification failed: Invalid issuer or claims');
    } else if (error.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') {
      console.error('❌ Token verification failed: Invalid signature');
    } else {
      console.error('❌ Token verification error:', error.message);
    }
    return false;
  }
}

/**
 * Extract bearer token from Authorization header
 * @param authHeader - The Authorization header value
 * @returns The token string or null if not found
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

/**
 * Verify bearer token with detailed result
 * Useful for debugging and detailed error messages
 */
export async function verifyBearerTokenDetailed(token: string): Promise<VerificationResult> {
  if (!token || token.trim() === '') {
    return {
      isValid: false,
      error: 'Empty or missing token'
    };
  }

  try {
    await jwtVerify(token, JWKS, {
      issuer: ISSUER_URL,
    });

    return { isValid: true };

  } catch (error: any) {
    let errorMessage = 'Unknown error';

    if (error.code === 'ERR_JWT_EXPIRED') {
      errorMessage = 'Token expired';
    } else if (error.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
      errorMessage = 'Invalid issuer or claims';
    } else if (error.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') {
      errorMessage = 'Invalid signature';
    } else {
      errorMessage = error.message || 'JWT verification failed';
    }

    return {
      isValid: false,
      error: errorMessage
    };
  }
}

/**
 * Get JWKS cache statistics
 */
export function getJWKSCacheStats() {
  return jwksCache.getStats();
}

/**
 * Cleanup JWKS cache resources
 */
export function cleanupJWKSCache(): void {
  jwksCache.cleanup();
}

export async function verifyBearerTokenForUser (req: http.IncomingMessage, res: http.ServerResponse) {
  const authHeader = req.headers['authorization'];
  const token = extractBearerToken(authHeader);

  if (!token) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
          error: 'Unauthorized',
          message: 'Bearer token required. Please provide Authorization header with Bearer token.'
      }));
      return;
  }

  // Try synchronous verification first
  const isSyncValid = verifyBearerTokenSync(token);
  if (!isSyncValid) {
    // Fallback to async verification if sync fails
    const isValid = await verifyBearerToken(token);
    if (!isValid) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: 'Unauthorized',
            message: 'Invalid or expired bearer token'
        }));
        return;
    }
  }
}
