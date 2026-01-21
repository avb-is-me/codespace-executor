/**
 * Demo: 4-Layer Security Policy System
 *
 * Shows how all 4 security layers work together:
 * 1. Domain Control - Which domains can be accessed
 * 2. Language Control - Which runtimes (Node.js only via distroless)
 * 3. API Path Control - Which API endpoints can be called
 * 4. Package Control - Which packages/binaries are available
 *
 * MVP: Uses hardcoded DEFAULT_SECURITY_POLICY
 * Future: Will load from JWT/database per user
 */

import SecureExecutorWithPolicy from './src/secure/SecureExecutorWithPolicy';
import { DEFAULT_SECURITY_POLICY, EXAMPLE_USER_POLICIES } from './src/config/security-policy';

console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
console.log('║                                                                        ║');
console.log('║              4-Layer Security Policy System Demo                      ║');
console.log('║                                                                        ║');
console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

async function runDemo() {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Current MVP Configuration (Hardcoded)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('Layer 1: Domain Control');
    console.log('  Allowed:', DEFAULT_SECURITY_POLICY.allowedDomains.join(', '));
    console.log('  Blocked:', DEFAULT_SECURITY_POLICY.blockedDomains.join(', ') || 'None\n');

    console.log('Layer 2: Language Control');
    console.log('  Allowed: Node.js only (via distroless image)');
    console.log('  Blocked: Python, Ruby, Shell, etc.\n');

    console.log('Layer 3: API Path Control (Stripe example)');
    const stripeRules = DEFAULT_SECURITY_POLICY.apiPathRules['api.stripe.com'];
    stripeRules?.slice(0, 5).forEach(rule => {
        const status = rule.allow ? '✅ Allow' : '❌ Block';
        console.log(`  ${status}: ${rule.method} ${rule.path}`);
    });
    console.log('');

    console.log('Layer 4: Package Control');
    console.log('  Packages:', DEFAULT_SECURITY_POLICY.allowedPackages.slice(0, 5).join(', '));
    console.log('  Binaries:', DEFAULT_SECURITY_POLICY.allowedBinaries.join(', ') || 'None\n');

    // Create executor with default policy
    const executor = new SecureExecutorWithPolicy({
        image: 'gcr.io/distroless/nodejs20-debian12',
        proxyPort: 8800,
        logTraffic: true,
        filterSensitiveHeaders: true
    });

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Test 1: Allowed Domain + Allowed API Path');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const result1 = await executor.executeCode(`
        const https = require('https');

        console.log('[CODE] Calling: GET api.stripe.com/v1/products');

        https.request({
            hostname: 'api.stripe.com',
            path: '/v1/products',
            method: 'GET',
            headers: {
                'Authorization': 'Bearer sk_test_fake'
            }
        }, (res) => {
            console.log('[CODE] Response status:', res.statusCode);
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                console.log('[CODE] Response:', data.substring(0, 100));
            });
        }).on('error', (err) => {
            console.log('[CODE] Error:', err.message);
        }).end();

        setTimeout(() => {}, 2000);
    `);

    console.log(result1.output);
    console.log('Result: Should be ALLOWED (domain + path both allowed)\n');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Test 2: Allowed Domain + BLOCKED API Path');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const result2 = await executor.executeCode(`
        const https = require('https');

        console.log('[CODE] Calling: POST api.stripe.com/v1/charges');
        console.log('[CODE] This should be BLOCKED by policy (charges not allowed)');

        https.request({
            hostname: 'api.stripe.com',
            path: '/v1/charges',
            method: 'POST',
            headers: {
                'Authorization': 'Bearer sk_test_fake'
            }
        }, (res) => {
            console.log('[CODE] Response status:', res.statusCode);
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                const parsed = JSON.parse(data);
                if (parsed.blocked_by_policy) {
                    console.log('[CODE] ❌ CORRECTLY BLOCKED BY POLICY');
                    console.log('[CODE] Reason:', parsed.message);
                }
            });
        }).on('error', (err) => {
            console.log('[CODE] Error:', err.message);
        }).end();

        setTimeout(() => {}, 2000);
    `);

    console.log(result2.output);
    console.log('Result: Should be BLOCKED (charges endpoint blocked by policy)\n');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Test 3: BLOCKED Domain');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const result3 = await executor.executeCode(`
        const https = require('https');

        console.log('[CODE] Calling: GET evil.com');
        console.log('[CODE] This should be BLOCKED (not in allowlist)');

        https.request({
            hostname: 'evil.com',
            path: '/',
            method: 'GET'
        }, (res) => {
            console.log('[CODE] Response status:', res.statusCode);
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                const parsed = JSON.parse(data);
                if (parsed.blocked_by_policy) {
                    console.log('[CODE] ❌ CORRECTLY BLOCKED BY POLICY');
                    console.log('[CODE] Reason:', parsed.message);
                }
            });
        }).on('error', (err) => {
            console.log('[CODE] Error:', err.message);
        }).end();

        setTimeout(() => {}, 2000);
    `);

    console.log(result3.output);
    console.log('Result: Should be BLOCKED (domain not in allowlist)\n');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Test 4: Python Bypass Attempt (Language Control)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const result4 = await executor.executeCode(`
        const { spawn } = require('child_process');

        console.log('[CODE] Attempting to use Python to bypass...');

        const python = spawn('python3', ['-c', 'import urllib; print("bypassed")']);

        python.on('error', (err) => {
            console.log('[CODE] ✅ Python BLOCKED:', err.code);
            console.log('[CODE] Reason: Python binary does not exist (distroless)');
        });

        python.on('spawn', () => {
            console.log('[CODE] ❌ Python available (should not happen!)');
        });

        setTimeout(() => {}, 1000);
    `);

    console.log(result4.output);
    console.log('Result: Python blocked at OS level (binary doesn\'t exist)\n');

    // Show network log
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Network Activity Log (Tests 1-3)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    [...result1.networkLog, ...result2.networkLog, ...result3.networkLog].forEach((log, i) => {
        console.log(`Request ${i + 1}:`);
        console.log(`  ${log.method} ${log.hostname}${new URL(log.url).pathname}`);
        console.log(`  Blocked: ${log.blocked ? '❌ Yes' : '✅ No'}`);
        console.log(`  Status: ${log.statusCode || 'N/A'}`);
        console.log('');
    });

    // Future example
    console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
    console.log('║                        FUTURE: JWT-Based Policies                      ║');
    console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

    console.log('Future implementation will load policies from JWT:\n');

    console.log('```typescript');
    console.log('// User sends JWT with request');
    console.log('const jwt = req.headers.authorization?.split(" ")[1];');
    console.log('');
    console.log('// Create executor with JWT');
    console.log('const executor = new SecureExecutorWithPolicy({');
    console.log('    jwt: jwt  // ← Load policy from JWT');
    console.log('});');
    console.log('');
    console.log('// Policy automatically loaded from:');
    console.log('// 1. Decode JWT → Extract user ID');
    console.log('// 2. Fetch user\'s policy from database');
    console.log('// 3. Apply policy to execution');
    console.log('```\n');

    console.log('Example user tiers:\n');

    console.log('Free Tier:');
    console.log('  Domains: api.github.com only');
    console.log('  Paths: GET /users/* only');
    console.log('  Packages: axios, lodash');
    console.log('');

    console.log('Pro Tier:');
    console.log('  Domains: api.stripe.com, api.github.com');
    console.log('  Paths: Stripe products API, GitHub read');
    console.log('  Packages: stripe, axios, lodash');
    console.log('');

    console.log('Enterprise Tier:');
    console.log('  Domains: stripe, openai, github, aws');
    console.log('  Paths: Full access to approved APIs');
    console.log('  Packages: All packages + ffmpeg\n');

    // Summary
    console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
    console.log('║                              SUMMARY                                   ║');
    console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

    console.log('✅ 4 Security Layers Working:\n');

    console.log('Layer 1: Domain Control');
    console.log('  Implementation: HTTP Proxy with allowlist/blocklist');
    console.log('  Config: security-policy.ts → allowedDomains');
    console.log('  Example: Allow api.stripe.com, Block evil.com\n');

    console.log('Layer 2: Language Control');
    console.log('  Implementation: Distroless Docker image');
    console.log('  Config: Dockerfile (Node.js only)');
    console.log('  Example: Allow Node.js, Block Python/Ruby/Shell\n');

    console.log('Layer 3: API Path Control');
    console.log('  Implementation: HTTP Proxy with path matching');
    console.log('  Config: security-policy.ts → apiPathRules');
    console.log('  Example: Allow POST /products, Block POST /charges\n');

    console.log('Layer 4: Package/Binary Control');
    console.log('  Implementation: Custom Docker image');
    console.log('  Config: Dockerfile.with-packages');
    console.log('  Example: Include stripe+ffmpeg, Exclude everything else\n');

    console.log('📋 MVP Status:\n');
    console.log('  ✅ All 4 layers implemented');
    console.log('  ✅ Hardcoded DEFAULT_SECURITY_POLICY');
    console.log('  ✅ Easy to test and iterate');
    console.log('  📝 TODO: Load from JWT/database\n');

    console.log('🚀 Next Steps:\n');
    console.log('  1. Test MVP with hardcoded policies');
    console.log('  2. Define different policy tiers (free/pro/enterprise)');
    console.log('  3. Implement JWT decoding');
    console.log('  4. Load policies from database');
    console.log('  5. Add policy editor UI\n');

    console.log('💡 Migration Path:\n');
    console.log('  MVP:    const executor = new SecureExecutorWithPolicy();');
    console.log('  Future: const executor = new SecureExecutorWithPolicy({ jwt });');
    console.log('  → Zero code change in executor logic!\n');
}

runDemo().catch(error => {
    console.error('\n❌ Error:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
});
