/**
 * Secure Executor Configuration - MVP Version
 *
 * This file contains hardcoded security policies that will eventually
 * be fetched from user JWT/database.
 *
 * Security Layers:
 * 1. Domain/URL Control - Which domains can be accessed
 * 2. Language Control - Which runtimes are available (Node.js only)
 * 3. API Path Control - Which specific API endpoints can be called
 * 4. Package Control - Which npm packages and binaries are available
 */

export interface SecurityPolicy {
    // Layer 1: Domain Control
    allowedDomains: string[];
    blockedDomains: string[];

    // Layer 3: API Path Control (per domain)
    apiPathRules: Record<string, PathRule[]>;

    // Layer 4: Package Control (defined in Docker image)
    // Note: This is baked into the Docker image, not runtime config
    allowedPackages: string[];  // For documentation
    allowedBinaries: string[];  // For documentation
}

export interface PathRule {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | '*';
    path: string;  // Can use wildcards: /v1/products/*
    allow: boolean;
}

// ============================================================================
// MVP: Hardcoded Policies
// ============================================================================

/**
 * Default policy for all users (MVP)
 * TODO: Replace with JWT-based user-specific policies
 */
export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
    // Layer 1: Domain Control
    allowedDomains: [
        'api.stripe.com',
        'api.openai.com',
        'api.github.com'
    ],
    blockedDomains: [],

    // Layer 3: API Path Control
    apiPathRules: {
        'api.stripe.com': [
            // Allow: Product management
            { method: 'GET', path: '/v1/products', allow: true },
            { method: 'GET', path: '/v1/products/*', allow: true },
            { method: 'POST', path: '/v1/products', allow: true },
            { method: 'POST', path: '/v1/products/*', allow: true },

            // Allow: Customer management (read-only)
            { method: 'GET', path: '/v1/customers', allow: true },
            { method: 'GET', path: '/v1/customers/*', allow: true },

            // Block: Charges (can't create charges)
            { method: 'POST', path: '/v1/charges', allow: false },
            { method: 'POST', path: '/v1/payment_intents', allow: false },

            // Block: Payouts (can't withdraw money)
            { method: '*', path: '/v1/payouts/*', allow: false }
        ],

        'api.openai.com': [
            // Allow: Chat completions only
            { method: 'POST', path: '/v1/chat/completions', allow: true },

            // Block: Everything else (fine-tuning, etc.)
            { method: '*', path: '/v1/fine-tunes/*', allow: false },
            { method: '*', path: '/v1/models/*', allow: false }
        ],

        'api.github.com': [
            // Allow: Read-only access
            { method: 'GET', path: '/*', allow: true },

            // Block: Write operations
            { method: 'POST', path: '/*', allow: false },
            { method: 'PUT', path: '/*', allow: false },
            { method: 'DELETE', path: '/*', allow: false }
        ]
    },

    // Layer 4: Package Control (for documentation)
    allowedPackages: [
        'stripe',
        'axios',
        'lodash',
        'moment',
        'openai'
    ],

    allowedBinaries: [
        'ffmpeg',
        'ffprobe',
        'convert',
        'identify'
    ]
};

// ============================================================================
// Example: User-Specific Policies (Future)
// ============================================================================

/**
 * Example of different policies for different user tiers
 * TODO: Load from JWT or database
 */
export const EXAMPLE_USER_POLICIES = {
    // Free tier: Very restricted
    free: {
        allowedDomains: ['api.github.com'],
        blockedDomains: [],
        apiPathRules: {
            'api.github.com': [
                { method: 'GET', path: '/users/*', allow: true }
            ]
        },
        allowedPackages: ['axios', 'lodash'],
        allowedBinaries: []
    },

    // Pro tier: Can use Stripe products API
    pro: {
        allowedDomains: ['api.stripe.com', 'api.github.com'],
        blockedDomains: [],
        apiPathRules: {
            'api.stripe.com': [
                { method: 'GET', path: '/v1/products/*', allow: true },
                { method: 'POST', path: '/v1/products', allow: true }
            ]
        },
        allowedPackages: ['stripe', 'axios', 'lodash'],
        allowedBinaries: []
    },

    // Enterprise tier: Full access to approved domains
    enterprise: {
        allowedDomains: [
            'api.stripe.com',
            'api.openai.com',
            'api.github.com',
            's3.amazonaws.com'
        ],
        blockedDomains: [],
        apiPathRules: {
            'api.stripe.com': [
                { method: '*', path: '/v1/products/*', allow: true },
                { method: '*', path: '/v1/customers/*', allow: true }
            ],
            'api.openai.com': [
                { method: 'POST', path: '/v1/chat/completions', allow: true }
            ]
        },
        allowedPackages: ['stripe', 'axios', 'lodash', 'openai', 'aws-sdk'],
        allowedBinaries: ['ffmpeg', 'ffprobe', 'convert']
    }
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a request matches a path rule
 */
export function matchesPathRule(rule: PathRule, method: string, path: string): boolean {
    // Check method
    if (rule.method !== '*' && rule.method !== method) {
        return false;
    }

    // Check path (support wildcards)
    const rulePattern = rule.path.replace(/\*/g, '.*');
    const regex = new RegExp(`^${rulePattern}$`);
    return regex.test(path);
}

/**
 * Check if a request is allowed by the policy
 */
export function isRequestAllowed(
    policy: SecurityPolicy,
    hostname: string,
    method: string,
    path: string
): { allowed: boolean; reason: string } {
    // Check domain allowlist
    if (policy.allowedDomains.length > 0) {
        if (!policy.allowedDomains.includes(hostname)) {
            return {
                allowed: false,
                reason: `Domain ${hostname} not in allowlist`
            };
        }
    }

    // Check domain blocklist
    if (policy.blockedDomains.includes(hostname)) {
        return {
            allowed: false,
            reason: `Domain ${hostname} is blocked`
        };
    }

    // Check path rules
    const pathRules = policy.apiPathRules[hostname];
    if (pathRules && pathRules.length > 0) {
        for (const rule of pathRules) {
            if (matchesPathRule(rule, method, path)) {
                if (!rule.allow) {
                    return {
                        allowed: false,
                        reason: `API path ${method} ${path} is blocked by policy`
                    };
                }
                return {
                    allowed: true,
                    reason: 'Allowed by path rule'
                };
            }
        }

        // No matching rule = default deny
        return {
            allowed: false,
            reason: `No matching path rule for ${method} ${path}`
        };
    }

    // No path rules = allow (domain-level control only)
    return {
        allowed: true,
        reason: 'Allowed by domain policy'
    };
}

// ============================================================================
// Future: Load from JWT
// ============================================================================

/**
 * Future implementation: Load policy from JWT
 */
export async function loadPolicyFromJWT(jwt: string): Promise<SecurityPolicy> {
    // TODO: Decode JWT and extract user ID
    // const payload = decodeJWT(jwt);
    // const userId = payload.sub;

    // TODO: Fetch user's policy from database
    // const policy = await db.getUserPolicy(userId);
    // return policy;

    // MVP: Return default policy
    return DEFAULT_SECURITY_POLICY;
}

/**
 * Future implementation: Load policy from database
 */
export async function loadPolicyFromDB(userId: string): Promise<SecurityPolicy> {
    // TODO: Fetch from database
    // const policy = await db.query('SELECT * FROM user_policies WHERE user_id = ?', [userId]);
    // return policy;

    // MVP: Return default policy
    return DEFAULT_SECURITY_POLICY;
}
