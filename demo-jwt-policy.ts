/**
 * Demo: JWT-Based Policy Fetching and Enforcement
 *
 * This demo shows how user-specific security policies are:
 * 1. Fetched from JWT API
 * 2. Applied to code execution
 * 3. Enforced at runtime
 */

import { getPolicyFetcher } from './src/utils/policy-fetcher';
import SecureExecutorUnified from './src/secure/SecureExecutorUnified';
import { DEFAULT_SECURITY_POLICY } from './src/config/security-policy';

async function demo() {
    console.log('='.repeat(60));
    console.log('JWT-Based Policy Demo');
    console.log('='.repeat(60));

    // Mock JWT (replace with real JWT from your system)
    const mockJWT = process.env.TEST_JWT || 'your-jwt-token-here';

    console.log('\n1. Fetching user policy from API...');
    console.log(`   JWT: ${mockJWT.substring(0, 30)}...`);

    const policyFetcher = getPolicyFetcher();
    const policyResult = await policyFetcher.fetchPolicy(mockJWT);

    if (!policyResult.success) {
        console.log('\n❌ Failed to fetch policy:', policyResult.error);
        console.log('   Falling back to DEFAULT_SECURITY_POLICY');
        console.log('\nDefault policy allows:');
        console.log(`   - Domains: ${DEFAULT_SECURITY_POLICY.allowedDomains.join(', ')}`);
        console.log(`   - Packages: ${DEFAULT_SECURITY_POLICY.allowedPackages.join(', ')}`);

        // Still demo with default policy
        await demoWithPolicy(DEFAULT_SECURITY_POLICY, 'Default Policy');
        return;
    }

    const policy = policyResult.policy!;
    console.log('\n✅ Successfully fetched user policy!');
    console.log('\nUser policy allows:');
    console.log(`   - Domains: ${policy.allowedDomains.join(', ')}`);
    console.log(`   - Packages: ${policy.allowedPackages.join(', ')}`);
    console.log(`   - Binaries: ${policy.allowedBinaries.join(', ')}`);

    if (Object.keys(policy.apiPathRules).length > 0) {
        console.log('\n   API Path Rules:');
        for (const [domain, rules] of Object.entries(policy.apiPathRules)) {
            console.log(`     ${domain}:`);
            rules.forEach((rule: any) => {
                const icon = rule.allow ? '✅' : '❌';
                console.log(`       ${icon} ${rule.method} ${rule.path}`);
            });
        }
    }

    await demoWithPolicy(policy, 'User-Specific Policy');

    // Show cache stats
    console.log('\n📊 Cache Statistics:');
    const stats = policyFetcher.getCacheStats();
    console.log(`   Cached policies: ${stats.size}`);
}

async function demoWithPolicy(policy: any, policyName: string) {
    console.log('\n' + '='.repeat(60));
    console.log(`Testing with ${policyName}`);
    console.log('='.repeat(60));

    // Create executor with user's policy
    const executor = new SecureExecutorUnified({
        timeout: 30000,
        policy: policy
    });

    // Test 1: Code that should work (if api.stripe.com is allowed)
    console.log('\n📝 Test 1: Allowed request to api.stripe.com');
    const allowedCode = `
        const https = require('https');
        console.log('Fetching Stripe products...');
        https.get('https://api.stripe.com/v1/products', (res) => {
            console.log('Status:', res.statusCode);
        });
    `;

    try {
        const result1 = await executor.executeCode({ code: allowedCode }, {});
        console.log('\n✅ Result:');
        console.log(`   stdout: ${result1.data?.stdout?.trim()}`);
        if (result1.data?.networkLog && result1.data.networkLog.length > 0) {
            result1.data.networkLog.forEach((log: any) => {
                const icon = log.blocked ? '🚫' : '✅';
                console.log(`   ${icon} ${log.method} ${log.url} - Status: ${log.statusCode}`);
                if (log.blocked) {
                    console.log(`      Reason: ${log.reason}`);
                }
            });
        }
    } catch (error: any) {
        console.log('\n❌ Error:', error.message);
    }

    // Test 2: Code that might be blocked (domain not in allowlist)
    console.log('\n📝 Test 2: Request to potentially blocked domain (api.github.com)');
    const blockedCode = `
        const https = require('https');
        console.log('Fetching GitHub user...');
        https.get('https://api.github.com/users/github', (res) => {
            console.log('Status:', res.statusCode);
        });
    `;

    try {
        const result2 = await executor.executeCode({ code: blockedCode }, {});
        console.log('\n✅ Result:');
        console.log(`   stdout: ${result2.data?.stdout?.trim()}`);
        if (result2.data?.networkLog && result2.data.networkLog.length > 0) {
            result2.data.networkLog.forEach((log: any) => {
                const icon = log.blocked ? '🚫' : '✅';
                console.log(`   ${icon} ${log.method} ${log.url} - Status: ${log.statusCode}`);
                if (log.blocked) {
                    console.log(`      Reason: ${log.reason}`);
                }
            });
        }
    } catch (error: any) {
        console.log('\n❌ Error:', error.message);
    }

    // Test 3: Blocked HTTP method (e.g., DELETE on *.okta.com)
    if (policy.allowedDomains.some((d: string) => d.includes('okta.com'))) {
        console.log('\n📝 Test 3: DELETE request to Okta (should be blocked)');
        const deleteCode = `
            const https = require('https');
            console.log('Attempting DELETE on Okta...');
            const req = https.request({
                hostname: 'dev-123.okta.com',
                path: '/api/v1/users/123',
                method: 'DELETE'
            }, (res) => {
                console.log('Status:', res.statusCode);
            });
            req.end();
        `;

        try {
            const result3 = await executor.executeCode({ code: deleteCode }, {});
            console.log('\n✅ Result:');
            console.log(`   stdout: ${result3.data?.stdout?.trim()}`);
            if (result3.data?.networkLog && result3.data.networkLog.length > 0) {
                result3.data.networkLog.forEach((log: any) => {
                    const icon = log.blocked ? '🚫' : '✅';
                    console.log(`   ${icon} ${log.method} ${log.url} - Status: ${log.statusCode}`);
                    if (log.blocked) {
                        console.log(`      Reason: ${log.reason}`);
                    }
                });
            }
        } catch (error: any) {
            console.log('\n❌ Error:', error.message);
        }
    }
}

// Run demo
console.log('⚠️  Note: Make sure to set environment variables:');
console.log('   DOCKER_EXECUTOR=true');
console.log('   ENABLE_HTTP_PROXY=true');
console.log('   ENABLE_POLICY=true');
console.log('   TEST_JWT=your-jwt-token (optional)\n');

demo().catch(error => {
    console.error('\n❌ Demo failed:', error);
    process.exit(1);
});
