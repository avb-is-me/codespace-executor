import { jwtVerify, createRemoteJWKSet } from 'jose';
import { validateSandboxOwnership } from './ownership-validator.js';

const ISSUER_URL = "https://login.keyboard.dev"
const JWKS = createRemoteJWKSet(new URL(`${ISSUER_URL}/oauth2/jwks`));

interface VerificationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Verify a bearer token using jose JWT verification
 * @param token - The bearer token to verify
 * @returns Promise<boolean> - true if token is valid, false otherwise
 */
export async function verifyBearerToken(token: string): Promise<boolean> {
  if (!token || token.trim() === '') {
    console.error('❌ Token verification failed: Empty token');
    return false;
  }

  try {
    await jwtVerify(token, JWKS, {
      issuer: ISSUER_URL,
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
 * Verify bearer token AND validate sandbox ownership
 * This is the primary auth function that should be used for securing sandbox endpoints
 * @param authHeader - The Authorization header value
 * @returns Promise<boolean> - true if token is valid AND user owns the sandbox
 */
export async function verifyBearerTokenWithOwnership(authHeader: string | undefined): Promise<boolean> {
  try {
    const result = await validateSandboxOwnership(authHeader);
    return result.isValid;
  } catch (error) {
    console.error('❌ Auth with ownership validation failed:', error);
    return false;
  }
}

/**
 * Verify bearer token AND validate sandbox ownership with detailed result
 * @param authHeader - The Authorization header value
 * @returns Promise<VerificationResult> - detailed result with ownership validation
 */
export async function verifyBearerTokenWithOwnershipDetailed(authHeader: string | undefined): Promise<VerificationResult & { userId?: string; orgId?: string }> {
  try {
    const result = await validateSandboxOwnership(authHeader);
    return {
      isValid: result.isValid,
      error: result.error,
      userId: result.userId,
      orgId: result.orgId
    };
  } catch (error: any) {
    console.error('❌ Auth with ownership validation failed:', error);
    return {
      isValid: false,
      error: error.message || 'Authentication failed'
    };
  }
}
