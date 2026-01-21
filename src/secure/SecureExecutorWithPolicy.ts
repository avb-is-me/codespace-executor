/**
 * SecureExecutorWithPolicy - Docker + Proxy + Policy-based Access Control
 *
 * This is the main executor that combines:
 * 1. Docker isolation (distroless + Node.js only)
 * 2. HTTP Proxy (network visibility + control)
 * 3. Policy-based access control (4 security layers)
 * 4. Header filtering (credentials protection)
 *
 * MVP: Uses hardcoded DEFAULT_SECURITY_POLICY
 * Future: Load policy from JWT/database per user
 */

import DockerExecutorWithProxy, { DockerProxyExecutionResult } from './DockerExecutorWithProxy';
import {
    SecurityPolicy,
    DEFAULT_SECURITY_POLICY,
    isRequestAllowed,
    loadPolicyFromJWT
} from '../config/security-policy';

export interface SecureExecutorOptions {
    // Docker options
    image?: string;
    memoryLimit?: number;
    cpuLimit?: number;
    timeout?: number;

    // Proxy options
    proxyPort?: number;
    logTraffic?: boolean;
    captureResponses?: boolean;
    filterSensitiveHeaders?: boolean;

    // Policy options (MVP: optional, uses default if not provided)
    policy?: SecurityPolicy;
    jwt?: string;  // Future: Load policy from JWT
}

export default class SecureExecutorWithPolicy {
    private executor: DockerExecutorWithProxy;
    private policy: SecurityPolicy;

    constructor(options: SecureExecutorOptions = {}) {
        // Load policy (MVP: use default, Future: from JWT)
        this.policy = options.policy || DEFAULT_SECURITY_POLICY;

        // Create executor with policy-based hooks
        this.executor = new DockerExecutorWithProxy({
            image: options.image || 'gcr.io/distroless/nodejs20-debian12',
            memoryLimit: options.memoryLimit,
            cpuLimit: options.cpuLimit,
            timeout: options.timeout,
            proxyPort: options.proxyPort || 8888,
            logTraffic: options.logTraffic !== false,
            captureResponses: options.captureResponses || false,
            filterSensitiveHeaders: options.filterSensitiveHeaders !== false,

            // Layer 1 & 3: Domain + API Path Control
            onRequest: (req) => this.handleRequest(req),

            // Optional: Response modification
            onResponse: (res) => this.handleResponse(res)
        });
    }

    /**
     * Execute user code with policy enforcement
     */
    async executeCode(
        code: string,
        env: Record<string, string> = {}
    ): Promise<DockerProxyExecutionResult> {
        return await this.executor.executeCode(code, env);
    }

    /**
     * Handle request with policy enforcement
     * Implements Layer 1 (Domain Control) + Layer 3 (API Path Control)
     */
    private handleRequest(req: {
        method: string;
        url: string;
        hostname: string;
        headers: Record<string, any>;
    }) {
        // Parse URL to get path
        const urlParts = new URL(req.url);
        const path = urlParts.pathname;

        console.log(`[POLICY] Checking: ${req.method} ${req.hostname}${path}`);

        // Check policy
        const decision = isRequestAllowed(
            this.policy,
            req.hostname,
            req.method,
            path
        );

        if (!decision.allowed) {
            console.log(`[POLICY] ❌ BLOCKED: ${decision.reason}`);
            return {
                block: true,
                // Return a mock error response
                mockResponse: {
                    statusCode: 403,
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        error: 'Forbidden',
                        message: decision.reason,
                        blocked_by_policy: true
                    })
                }
            };
        }

        console.log(`[POLICY] ✅ ALLOWED: ${decision.reason}`);
        return null;  // Allow request
    }

    /**
     * Handle response (optional customization)
     */
    private handleResponse(res: {
        method: string;
        url: string;
        hostname: string;
        statusCode: number;
        headers: Record<string, any>;
        body: Buffer;
    }) {
        // Optional: Add policy metadata to responses
        return {
            headers: {
                ...res.headers,
                'x-policy-enforced': 'true',
                'x-execution-mode': 'secure'
            }
        };
    }

    /**
     * Update policy (for testing or JWT refresh)
     */
    updatePolicy(policy: SecurityPolicy) {
        this.policy = policy;
    }

    /**
     * Load policy from JWT (Future implementation)
     */
    async loadPolicyFromJWT(jwt: string) {
        this.policy = await loadPolicyFromJWT(jwt);
    }

    /**
     * Get current policy (for debugging)
     */
    getCurrentPolicy(): SecurityPolicy {
        return this.policy;
    }
}
