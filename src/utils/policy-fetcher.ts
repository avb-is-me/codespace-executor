/**
 * Policy Fetcher - Retrieves user security policies from Keyboard API
 */

import https from 'https';
import http from 'http';
import { SecurityPolicy } from '../config/security-policy';

export interface PolicyFetchResult {
    success: boolean;
    policy?: SecurityPolicy;
    error?: string;
}

export interface PolicyAPIResponse {
    success: boolean;
    policy?: {
        id: string;
        name: string;
        tier: string;
        allowedDomains: string[];
        apiPathRules: Record<string, Array<{
            path: string;
            allow: boolean;
            method: string;
        }>>;
        allowedPackages: string[];
        allowedBinaries: string[];
        created_by: string;
        user_id: string;
        org_policy: boolean;
        org: string | null;
        team: string | null;
        createdAt: number;
        updatedAt: number;
    };
    error?: string;
}

export class PolicyFetcher {
    private apiUrl: string;
    private timeout: number;
    private cache: Map<string, { policy: SecurityPolicy; timestamp: number }> = new Map();
    private cacheTTL: number;

    constructor(options: {
        apiUrl?: string;
        timeout?: number;
        cacheTTL?: number;
    } = {}) {
        this.apiUrl = options.apiUrl || process.env.POLICY_API_URL || 'https://api.keyboard.dev/api/user/policies';
        this.timeout = options.timeout || 5000; // 5 second timeout
        this.cacheTTL = options.cacheTTL || 60000; // 1 minute cache by default
    }

    /**
     * Fetch policy for user from JWT
     */
    async fetchPolicy(jwt: string): Promise<PolicyFetchResult> {
        if (!jwt) {
            return {
                success: false,
                error: 'No JWT provided'
            };
        }

        // Check cache first
        const cached = this.cache.get(jwt);
        if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
            console.log('[PolicyFetcher] Using cached policy');
            return {
                success: true,
                policy: cached.policy
            };
        }

        try {
            const apiResponse = await this.makeRequest(jwt);

            if (!apiResponse.success || !apiResponse.policy) {
                return {
                    success: false,
                    error: apiResponse.error || 'Failed to fetch policy'
                };
            }

            // Transform API response to SecurityPolicy format
            const policy = this.transformToSecurityPolicy(apiResponse.policy);

            // Cache the policy
            this.cache.set(jwt, {
                policy,
                timestamp: Date.now()
            });

            console.log('[PolicyFetcher] Successfully fetched policy:', {
                name: apiResponse.policy.name,
                tier: apiResponse.policy.tier,
                allowedDomains: apiResponse.policy.allowedDomains.length,
                allowedPackages: apiResponse.policy.allowedPackages.length
            });

            return {
                success: true,
                policy
            };

        } catch (error: any) {
            console.error('[PolicyFetcher] Error fetching policy:', error.message);
            return {
                success: false,
                error: error.message || 'Unknown error fetching policy'
            };
        }
    }

    /**
     * Make HTTP request to policy API
     */
    private makeRequest(jwt: string): Promise<PolicyAPIResponse> {
        return new Promise((resolve, reject) => {
            const url = new URL(this.apiUrl);
            const isHttps = url.protocol === 'https:';
            const client = isHttps ? https : http;

            const options = {
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname + url.search,
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${jwt}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'CodespaceExecutor/1.0'
                },
                timeout: this.timeout
            };

            const req = client.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        resolve(parsed);
                    } catch (parseError: any) {
                        reject(new Error(`Failed to parse API response: ${parseError.message}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(new Error(`Request failed: ${error.message}`));
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error(`Request timeout after ${this.timeout}ms`));
            });

            req.end();
        });
    }

    /**
     * Transform API response format to SecurityPolicy format
     */
    private transformToSecurityPolicy(apiPolicy: any): SecurityPolicy {
        return {
            allowedDomains: apiPolicy.allowedDomains || [],
            blockedDomains: [],  // API doesn't provide blocked domains yet
            apiPathRules: this.transformPathRules(apiPolicy.apiPathRules || {}),
            allowedPackages: apiPolicy.allowedPackages || [],
            allowedBinaries: apiPolicy.allowedBinaries || []
        };
    }

    /**
     * Transform API path rules format to internal PathRule format
     */
    private transformPathRules(apiRules: Record<string, any[]>): Record<string, any[]> {
        const transformed: Record<string, any[]> = {};

        for (const [domain, rules] of Object.entries(apiRules)) {
            transformed[domain] = rules.map(rule => ({
                method: rule.method || '*',
                path: rule.path || '/*',
                allow: rule.allow !== false  // Default to true if not specified
            }));
        }

        return transformed;
    }

    /**
     * Clear cache (useful for testing or when policies change)
     */
    clearCache(jwt?: string): void {
        if (jwt) {
            this.cache.delete(jwt);
            console.log('[PolicyFetcher] Cleared cache for specific JWT');
        } else {
            this.cache.clear();
            console.log('[PolicyFetcher] Cleared entire policy cache');
        }
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): { size: number; entries: number } {
        return {
            size: this.cache.size,
            entries: Array.from(this.cache.entries()).length
        };
    }
}

// Singleton instance
let policyFetcherInstance: PolicyFetcher | null = null;

export function getPolicyFetcher(): PolicyFetcher {
    if (!policyFetcherInstance) {
        policyFetcherInstance = new PolicyFetcher();
    }
    return policyFetcherInstance;
}
