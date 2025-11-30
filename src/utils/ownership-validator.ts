import { jwtVerify, createRemoteJWKSet } from 'jose';
import fs from 'fs';

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
  userId?: string;
  orgId?: string;
}

/**
 * Get the current pod's user ownership information from environment variables
 * These are set by the orchestrator when creating the sandbox
 */
function getCurrentPodOwnership(): { userId: string; orgId?: string } | null {
  const userId = process.env.USER_ID;
  const orgId = process.env.ORG_ID; // optional
  
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
    // Verify JWT token with Keyboard auth
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: ISSUER_URL,
    });

    const decoded = payload as unknown as KeyboardJWTPayload;

    // Validate required fields from Keyboard JWT
    // Primary validation: user_id and sub should match and exist
    if (!decoded.user_id || !decoded.sub) {
      return {
        isValid: false,
        error: 'Invalid token payload: missing user_id or sub'
      };
    }

    // Ensure user_id and sub are consistent
    if (decoded.user_id !== decoded.sub) {
      return {
        isValid: false,
        error: 'Invalid token payload: user_id and sub do not match'
      };
    }

    // Get current pod ownership info
    const podOwnership = getCurrentPodOwnership();
    if (!podOwnership) {
      return {
        isValid: false,
        error: 'Unable to determine pod ownership'
      };
    }

    // Primary validation: Check if the authenticated user owns this sandbox
    // Use sub as the primary identifier (fallback to user_id if needed)
    const tokenUserId = decoded.sub || decoded.user_id;
    
    if (tokenUserId !== podOwnership.userId) {
      console.error(`❌ Ownership validation failed: user ${tokenUserId} does not own sandbox owned by ${podOwnership.userId}`);
      return {
        isValid: false,
        error: 'Unauthorized: You do not own this sandbox'
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
      orgId: decoded.org_id
    };

  } catch (error: any) {
    let errorMessage = 'JWT verification failed';

    if (error.code === 'ERR_JWT_EXPIRED') {
      errorMessage = 'Token expired';
    } else if (error.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
      errorMessage = 'Invalid issuer or claims';
    } else if (error.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') {
      errorMessage = 'Invalid signature';
    } else {
      errorMessage = error.message || 'JWT verification failed';
    }

    console.error('❌ Keyboard JWT verification error:', errorMessage);
    
    return {
      isValid: false,
      error: errorMessage
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