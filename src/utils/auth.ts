import { jwtVerify, createRemoteJWKSet } from 'jose';
import http from 'http';
import { webcrypto } from 'node:crypto';
import dotenv from 'dotenv';
import { verifyJWTSync } from './jwt-sync.js';

dotenv.config();

// Polyfill crypto for jose library
if (!globalThis.crypto) {
  globalThis.crypto = webcrypto as any;
}

const ISSUER_URL = "https://login.keyboard.dev"
const JWKS = createRemoteJWKSet(new URL(`${ISSUER_URL}/oauth2/jwks`));

/**
 * JWKS cache for synchronous JWT verification
 */
class JWKSCache {
  private jwksData: any = null; // Store complete JWKS response
  private refreshInterval: NodeJS.Timeout | null = null;
  private lastRefresh: number = 0;
  private isReady: boolean = false;
  private readonly REFRESH_INTERVAL = 10 * 60 * 1000; // 10 minutes
  private readonly JWKS_URI: string;

  constructor(jwksUri: string) {
    this.JWKS_URI = jwksUri;
  }

  // Pre-fetch keys at startup with retry logic
  async initialize(): Promise<void> {
    const maxRetries = 3;
    const retryDelays = [1000, 2000, 4000]; // Exponential backoff: 1s, 2s, 4s

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await this.refreshKeys();
        this.isReady = true;

        // Refresh keys every 10 minutes
        this.refreshInterval = setInterval(() => {
          this.refreshKeys().catch((error) => {
            console.error('❌ Scheduled JWKS refresh failed:', error.message);
            // Start background retry if scheduled refresh fails
            this.startBackgroundRetry();
          });
        }, this.REFRESH_INTERVAL);

        console.log('✅ JWKS cache initialized and ready');
        return;
      } catch (error: any) {
        const isLastAttempt = attempt === maxRetries - 1;
        console.error(`❌ JWKS cache init attempt ${attempt + 1}/${maxRetries} failed:`, error.message);

        if (isLastAttempt) {
          // On final failure, don't throw - make it non-fatal
          this.isReady = false;
          console.error('⚠️  JWKS cache initialization failed after all retries - WebSocket auth will not work until cache is ready');
          console.error('⚠️  Starting background retry loop...');
          this.startBackgroundRetry();
          return; // Don't throw, allow server to start
        } else {
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, retryDelays[attempt]));
        }
      }
    }
  }

  // Background retry for JWKS cache initialization
  private startBackgroundRetry(): void {
    if (this.isReady || this.refreshInterval) return; // Already ready or retrying

    console.log('🔄 Starting background JWKS retry (every 10 seconds)...');
    this.refreshInterval = setInterval(async () => {
      try {
        await this.refreshKeys();
        this.isReady = true;
        console.log('✅ JWKS cache recovered and ready!');

        // Stop retry loop and start normal refresh interval
        if (this.refreshInterval) {
          clearInterval(this.refreshInterval);
          this.refreshInterval = null;
        }

        this.refreshInterval = setInterval(() => {
          this.refreshKeys().catch((error) => {
            console.error('❌ Scheduled JWKS refresh failed:', error.message);
          });
        }, this.REFRESH_INTERVAL);
      } catch (error: any) {
        console.error('❌ Background JWKS retry failed:', error.message);
        // Continue retrying
      }
    }, 10000); // Retry every 10 seconds
  }

  private async refreshKeys(): Promise<void> {
    try {
      console.log('🔄 Refreshing JWKS keys...');

      // Add 10 second timeout to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch(this.JWKS_URI, {
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`JWKS fetch failed: ${response.status} ${response.statusText}`);
        }

        this.jwksData = await response.json();
        this.lastRefresh = Date.now();

        console.log(`✅ Loaded ${this.jwksData.keys?.length || 0} signing keys`);
      } catch (error: any) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
          throw new Error('JWKS fetch timeout after 10 seconds');
        }
        throw error;
      }

    } catch (error: any) {
      console.error('❌ Failed to refresh JWKS keys:', error.message);
      throw error;
    }
  }

  // Check if cache is ready
  isCacheReady(): boolean {
    return this.isReady && this.jwksData && this.jwksData.keys && this.jwksData.keys.length > 0;
  }

  // Get complete JWKS for synchronous verification
  getJWKS(): any {
    return this.jwksData;
  }

  getStats(): { keyCount: number; lastRefresh: number; age: number; isReady: boolean } {
    return {
      keyCount: this.jwksData?.keys?.length || 0,
      lastRefresh: this.lastRefresh,
      age: Date.now() - this.lastRefresh,
      isReady: this.isReady
    };
  }

  cleanup(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    this.jwksData = null;
    this.isReady = false;
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
 * Non-fatal: Will start background retry if initialization fails
 */
export async function initializeJWKSCache(): Promise<void> {
  await jwksCache.initialize();
  // Note: initialize() no longer throws, it handles failures internally
}

/**
 * Verify a bearer token synchronously using cached JWKS keys with FULL signature validation
 * @param token - The bearer token to verify 
 * @returns boolean - true if token is valid, false otherwise
 */
export function verifyBearerTokenSync(token: string): boolean {
  if (!token || token.trim() === '') {
    console.error('❌ JWT verification failed: Empty or whitespace token');
    return false;
  }

  // CRITICAL: Check if cache is ready first
  if (!jwksCache.isCacheReady()) {
    const cacheStats = jwksCache.getStats();
    console.error('❌ JWT verification failed: JWKS cache not ready', {
      keyCount: cacheStats.keyCount,
      isReady: cacheStats.isReady,
      lastRefresh: cacheStats.lastRefresh,
      age: cacheStats.age
    });
    return false;
  }

  try {
    const jwks = jwksCache.getJWKS();

    // Log token details for debugging (first/last few chars only)
    const tokenPreview = token.length > 20
      ? `${token.substring(0, 10)}...${token.substring(token.length - 10)}`
      : token;
    console.log(`🔍 Verifying JWT token: ${tokenPreview}`);

    // Use our synchronous JWT verification
    const result = verifyJWTSync(token, jwks, {
      issuer: ISSUER_URL,
      clockTolerance: 60 // 1 minute tolerance
    });

    if (result.valid) {
      console.log('✅ JWT verification successful with cached JWKS');
      return true;
    } else {
      console.error(`❌ JWT verification failed: ${result.error}`, {
        tokenPreview,
        issuer: ISSUER_URL,
        keyCount: jwks?.keys?.length || 0
      });
      return false;
    }

  } catch (error: any) {
    console.error('❌ JWT verification error:', error.message, {
      tokenLength: token.length,
      errorType: error.constructor.name
    });
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
 * Check if JWKS cache is ready for verification
 */
export function isJWKSCacheReady(): boolean {
  return jwksCache.isCacheReady();
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

export async function verifyBearerTokenForUser(req: http.IncomingMessage, res: http.ServerResponse) {
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

export async function verifyHTTPBearerTokenForUser(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
  const authHeader = req.headers['authorization'];
  const token = extractBearerToken(authHeader);

  if (!token) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Unauthorized',
      message: 'Bearer token required. Please provide Authorization header with Bearer token.'
    }));
    return false;
  }

  // Try synchronous verification first


  // Fallback to async verification if sync fails
  const isValid = await verifyBearerToken(token);
  if (!isValid) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Unauthorized',
      message: 'Invalid or expired bearer token'
    }));
    return false;
  }

  return true;
}