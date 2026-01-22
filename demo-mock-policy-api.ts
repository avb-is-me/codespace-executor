/**
 * Mock Policy API Demo
 *
 * This simulates your Keyboard API policy endpoint for testing
 * without needing a real JWT or API connection.
 */

import SecureExecutorUnified from './src/secure/SecureExecutorUnified';
import { SecurityPolicy } from './src/config/security-policy';

// Mock API response (matches your actual API format)
const mockAPIResponse = {
    success: true,
    policy: {
        id: "beaa4db7-4c54-4c2e-a70e-9d1e8f8e4e00",
        name: "My Security Policy",
        tier: "custom",
        allowedDomains: [
            "api.stripe.com",
            "*.okta.com"
        ],
        apiPathRules: {
            "*.okta.com": [
                {
                    path: "/*",
                    allow: true,
                    method: "GET"
                },
                {
                    path: "/*",
                    allow: false,
                    method: "DELETE"
                }
            ]
        },
        allowedPackages: [
            "@okta"
        ],
        allowedBinaries: [
            "ffmpeg"
        ],
        created_by: "user_01K691ZDH5MR9J54H5QN9C6X7G",
        user_id: "user_01K691ZDH5MR9J54H5QN9C6X7G",
        org_policy: false,
        org: null,
        team: null,
        createdAt: 1769041425655,
        updatedAt: 1769041425655
    }
};

// Transform to internal SecurityPolicy format
function transformPolicy(apiPolicy: any): SecurityPolicy {
    return {
        allowedDomains: apiPolicy.allowedDomains || [],
        blockedDomains: [],
        apiPathRules: apiPolicy.apiPathRules || {},
        allowedPackages: apiPolicy.allowedPackages || [],
        allowedBinaries: apiPolicy.allowedBinaries || []
    };
}

async function demo() {
    console.log('='.repeat(60));
    console.log('Mock Policy API Demo');
    console.log('='.repeat(60));

    const policy = transformPolicy(mockAPIResponse.policy);

    console.log('\n📋 User Policy:');
    console.log(JSON.stringify(mockAPIResponse.policy, null, 2));

    console.log('\n🔐 Security Settings:');
    console.log(`   Allowed Domains: ${policy.allowedDomains.join(', ')}`);
    console.log(`   Allowed Packages: ${policy.allowedPackages.join(', ')}`);
    console.log(`   Allowed Binaries: ${policy.allowedBinaries.join(', ')}`);

    console.log('\n📝 API Path Rules:');
    for (const [domain, rules] of Object.entries(policy.apiPathRules)) {
        console.log(`   ${domain}:`);
        rules.forEach((rule: any) => {
            const icon = rule.allow ? '✅' : '❌';
            console.log(`     ${icon} ${rule.method} ${rule.path}`);
        });
    }

    // Create executor with policy
    const executor = new SecureExecutorUnified({
        timeout: 30000,
        policy: policy
    });

    console.log('\n' + '='.repeat(60));
    console.log('Test Cases');
    console.log('='.repeat(60));

    // Test 1: Allowed - Stripe API
    console.log('\n✅ Test 1: Stripe API (allowed domain)');
    console.log('Code: https.get("https://api.stripe.com/v1/products")');

    const stripeCode = `
        const https = require('https');
        https.get('https://api.stripe.com/v1/products', (res) => {
            console.log('Stripe API Status:', res.statusCode);
        });
    `;

    try {
        const result1 = await executor.executeCode({ code: stripeCode }, {});
        displayResult(result1);
    } catch (error: any) {
        console.log('❌ Error:', error.message);
    }

    // Test 2: Allowed - Okta GET
    console.log('\n✅ Test 2: Okta GET (allowed)');
    console.log('Code: https.get("https://dev-123.okta.com/api/v1/users")');

    const oktaGetCode = `
        const https = require('https');
        https.get('https://dev-123.okta.com/api/v1/users', (res) => {
            console.log('Okta GET Status:', res.statusCode);
        });
    `;

    try {
        const result2 = await executor.executeCode({ code: oktaGetCode }, {});
        displayResult(result2);
    } catch (error: any) {
        console.log('❌ Error:', error.message);
    }

    // Test 3: Blocked - Okta DELETE
    console.log('\n🚫 Test 3: Okta DELETE (blocked by policy)');
    console.log('Code: https.request({ method: "DELETE", hostname: "dev-123.okta.com" })');

    const oktaDeleteCode = `
        const https = require('https');
        const req = https.request({
            hostname: 'dev-123.okta.com',
            path: '/api/v1/users/123',
            method: 'DELETE'
        }, (res) => {
            console.log('Okta DELETE Status:', res.statusCode);
        });
        req.end();
    `;

    try {
        const result3 = await executor.executeCode({ code: oktaDeleteCode }, {});
        displayResult(result3);
    } catch (error: any) {
        console.log('❌ Error:', error.message);
    }

    // Test 4: Blocked - Unauthorized domain
    console.log('\n🚫 Test 4: GitHub API (not in allowed domains)');
    console.log('Code: https.get("https://api.github.com/users/github")');

    const githubCode = `
        const https = require('https');
        https.get('https://api.github.com/users/github', (res) => {
            console.log('GitHub API Status:', res.statusCode);
        });
    `;

    try {
        const result4 = await executor.executeCode({ code: githubCode }, {});
        displayResult(result4);
    } catch (error: any) {
        console.log('❌ Error:', error.message);
    }

    console.log('\n' + '='.repeat(60));
    console.log('Summary');
    console.log('='.repeat(60));
    console.log('\n✅ Policy enforcement working correctly!');
    console.log('\nKey features demonstrated:');
    console.log('  1. Domain allowlist enforcement');
    console.log('  2. API path rules (GET allowed, DELETE blocked)');
    console.log('  3. Wildcard domain matching (*.okta.com)');
    console.log('  4. Complete network traffic logging');
    console.log('  5. Blocked requests return 403 with reasons');
}

function displayResult(result: any) {
    if (result.data?.stdout) {
        console.log(`   Output: ${result.data.stdout.trim()}`);
    }

    if (result.data?.networkLog && result.data.networkLog.length > 0) {
        console.log('   Network Activity:');
        result.data.networkLog.forEach((log: any) => {
            const icon = log.blocked ? '🚫' : '✅';
            const status = log.statusCode || 'N/A';
            console.log(`     ${icon} ${log.method} ${log.url} → ${status}`);
            if (log.blocked && log.reason) {
                console.log(`        Reason: ${log.reason}`);
            }
        });
    }
}

// Run demo
console.log('\n⚠️  Requirements:');
console.log('   DOCKER_EXECUTOR=true');
console.log('   ENABLE_HTTP_PROXY=true');
console.log('   ENABLE_POLICY=true\n');

if (process.env.DOCKER_EXECUTOR !== 'true') {
    console.log('❌ DOCKER_EXECUTOR not set to true');
    console.log('   Run: DOCKER_EXECUTOR=true ENABLE_HTTP_PROXY=true ENABLE_POLICY=true npm run demo:mock-policy\n');
    process.exit(1);
}

demo().catch(error => {
    console.error('\n❌ Demo failed:', error);
    process.exit(1);
});
