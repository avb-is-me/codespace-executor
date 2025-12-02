import { jwtVerify, createRemoteJWKSet } from 'jose';
import fs from 'fs';
import { Buffer } from 'buffer';

const ISSUER_URL = "https://login.keyboard.dev";
const JWKS = createRemoteJWKSet(new URL(`${ISSUER_URL}/oauth2/jwks`));

interface KeyboardJWTPayload {
  user_id: string;
  org_id?: string; // optional
  roles?: string[];
  sub: string; // same as user_id - this is what we primarily validate
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string;
}

interface OwnershipValidationResult {
  isValid: boolean;
  error?: string;
  errorCode?: string;
  userId?: string;
  orgId?: string;
  debug?: {
    tokenUserId?: string;
    podUserId?: string;
    tokenSource?: 'user_id' | 'sub';
    hasEnvironment?: boolean;
    tokenFields?: string[];
    envVars?: {
      USER_ID?: string;
      ORG_ID?: string;
    };
  };
}

/**
 * Get the current pod's user ownership information from environment variables
 * These are set by the orchestrator when creating the sandbox
 */
function getCurrentPodOwnership(): { userId: string; orgId?: string } | null {
  const userId = process.env.USER_ID;
  const orgId = process.env.ORG_ID; // optional
  
  console.log('🔍 Environment variables:', { 
    USER_ID: userId ? `[${userId.length} chars]` : 'MISSING',
    ORG_ID: orgId ? `[${orgId.length} chars]` : 'MISSING',
    SESSION_ID: process.env.SESSION_ID ? `[${process.env.SESSION_ID.length} chars]` : 'MISSING'
  });
  
  if (!userId) {
    console.error('❌ Pod ownership info missing: USER_ID environment variable not found');
    return null;
  }
  
  return { userId, orgId };
}

/**
 * Extract and validate JWT token, then check if user owns this sandbox
 * @param authHeader - The Authorization header value
 * @returns Promise<OwnershipValidationResult>
 */
export async function validateSandboxOwnership(authHeader: string | undefined): Promise<OwnershipValidationResult> {
  // Extract bearer token
  if (!authHeader) {
    return {
      isValid: false,
      error: 'No authorization header provided'
    };
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return {
      isValid: false,
      error: 'Invalid authorization header format. Use: Bearer <token>'
    };
  }

  const token = match[1];
  
  if (!token || token.trim() === '') {
    return {
      isValid: false,
      error: 'Empty token provided'
    };
  }

  try {
    // Debug: Parse JWT header to see algorithm and key ID
    const [headerB64] = token.split('.');
    let jwtHeader: any = {};
    try {
      const headerJson = Buffer.from(headerB64, 'base64url').toString();
      jwtHeader = JSON.parse(headerJson);
      console.log('🔍 JWT Header:', {
        alg: jwtHeader.alg,
        typ: jwtHeader.typ,
        kid: jwtHeader.kid
      });
    } catch (headerError) {
      console.error('❌ Failed to parse JWT header:', headerError);
    }

    // Debug: Manually fetch JWKS to see what we get
    try {
      const jwksResponse = await fetch(`${ISSUER_URL}/oauth2/jwks`);
      const jwksData = await jwksResponse.json();
      console.log('🔍 JWKS response keys count:', jwksData.keys?.length || 0);
      if (jwksData.keys?.[0]) {
        console.log('🔍 First JWKS key:', {
          alg: jwksData.keys[0].alg,
          kty: jwksData.keys[0].kty,
          use: jwksData.keys[0].use,
          kid: jwksData.keys[0].kid
        });
      }
    } catch (jwksError) {
      console.error('❌ Failed to manually fetch JWKS:', jwksError);
    }

    // Verify JWT token with Keyboard auth
    console.log('🔍 Starting JWT verification with JOSE library...');
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: ISSUER_URL,
    });
    console.log('✅ JWT verification successful');

    const decoded = payload as unknown as KeyboardJWTPayload;

    // Log token structure for debugging (sanitized)
    const tokenFields = Object.keys(decoded).filter(key => !['iat', 'exp', 'nbf'].includes(key));
    console.log('🔍 JWT token fields:', tokenFields);
    console.log('🔍 JWT user identifiers:', {
      user_id: decoded.user_id ? `[${decoded.user_id.length} chars]` : 'MISSING',
      sub: decoded.sub ? `[${decoded.sub.length} chars]` : 'MISSING',
      org_id: decoded.org_id ? `[${decoded.org_id.length} chars]` : 'MISSING'
    });

    // Validate required fields from Keyboard JWT
    // We need at least one user identifier (user_id OR sub)
    if (!decoded.user_id && !decoded.sub) {
      return {
        isValid: false,
        error: 'Invalid token payload: missing user_id and sub fields',
        errorCode: 'JWT_MISSING_USER_ID',
        debug: {
          tokenFields,
          hasEnvironment: false
        }
      };
    }

    // If both exist, ensure they are consistent
    if (decoded.user_id && decoded.sub && decoded.user_id !== decoded.sub) {
      return {
        isValid: false,
        error: `Invalid token payload: user_id (${decoded.user_id}) and sub (${decoded.sub}) do not match`,
        errorCode: 'JWT_USER_ID_MISMATCH',
        debug: {
          tokenFields,
          hasEnvironment: false
        }
      };
    }

    // Get current pod ownership info
    const podOwnership = getCurrentPodOwnership();
    const tokenSource = decoded.sub ? 'sub' : 'user_id';
    const tokenUserId = decoded.sub || decoded.user_id;
    
    if (!podOwnership) {
      return {
        isValid: false,
        error: 'Unable to determine pod ownership: USER_ID environment variable not set',
        errorCode: 'ENV_MISSING_USER_ID',
        debug: {
          tokenUserId,
          tokenSource,
          tokenFields,
          hasEnvironment: false,
          envVars: {
            USER_ID: process.env.USER_ID || 'MISSING',
            ORG_ID: process.env.ORG_ID || 'MISSING'
          }
        }
      };
    }

    // Primary validation: Check if the authenticated user owns this sandbox
    // Use sub as the primary identifier (fallback to user_id if needed)
    
    if (tokenUserId !== podOwnership.userId) {
      console.error(`❌ Ownership validation failed: user ${tokenUserId} does not own sandbox owned by ${podOwnership.userId}`);
      return {
        isValid: false,
        error: `Ownership mismatch: token user '${tokenUserId}' does not own sandbox owned by '${podOwnership.userId}'`,
        errorCode: 'OWNERSHIP_MISMATCH',
        debug: {
          tokenUserId,
          podUserId: podOwnership.userId,
          tokenSource,
          tokenFields,
          hasEnvironment: true,
          envVars: {
            USER_ID: podOwnership.userId,
            ORG_ID: podOwnership.orgId || 'MISSING'
          }
        }
      };
    }

    // Optional: Log organization info if available (for debugging/audit purposes)
    if (decoded.org_id && podOwnership.orgId) {
      if (decoded.org_id !== podOwnership.orgId) {
        console.warn(`⚠️ Organization mismatch: user org ${decoded.org_id} vs sandbox org ${podOwnership.orgId} - allowing since user owns sandbox`);
      }
    }

    console.log(`✅ Sandbox ownership validated for user ${tokenUserId}${decoded.org_id ? ` in org ${decoded.org_id}` : ''}`);
    
    return {
      isValid: true,
      userId: decoded.user_id,
      orgId: decoded.org_id,
      debug: {
        tokenUserId,
        podUserId: podOwnership.userId,
        tokenSource,
        tokenFields,
        hasEnvironment: true,
        envVars: {
          USER_ID: podOwnership.userId,
          ORG_ID: podOwnership.orgId || 'MISSING'
        }
      }
    };

  } catch (error: any) {
    let errorMessage = 'JWT verification failed';
    let errorCode = 'JWT_VERIFICATION_FAILED';

    if (error.code === 'ERR_JWT_EXPIRED') {
      errorMessage = 'Token expired - please get a new JWT from login.keyboard.dev';
      errorCode = 'JWT_EXPIRED';
    } else if (error.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
      errorMessage = 'Invalid JWT claims - token not issued by login.keyboard.dev';
      errorCode = 'JWT_INVALID_CLAIMS';
    } else if (error.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') {
      errorMessage = 'Invalid JWT signature - token may be malformed or tampered with';
      errorCode = 'JWT_INVALID_SIGNATURE';
    } else {
      errorMessage = error.message || 'JWT verification failed';
    }

    console.error('❌ Keyboard JWT verification error:', errorMessage);
    console.error('❌ Error details:', error);
    
    return {
      isValid: false,
      error: errorMessage,
      errorCode,
      debug: {
        hasEnvironment: false,
        envVars: {
          USER_ID: process.env.USER_ID || 'MISSING',
          ORG_ID: process.env.ORG_ID || 'MISSING'
        }
      }
    };
  }
}

/**
 * Middleware function that validates sandbox ownership
 * Can be used to wrap existing authentication logic
 * @param authHeader - Authorization header
 * @returns Promise<boolean> - true if user owns sandbox
 */
export async function validateOwnership(authHeader: string | undefined): Promise<boolean> {
  const result = await validateSandboxOwnership(authHeader);
  return result.isValid;
}