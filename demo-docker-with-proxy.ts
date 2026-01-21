/**
 * Demo: Docker Executor with HTTP Proxy
 *
 * This demonstrates Docker execution with HTTP proxy for traffic inspection.
 * Use case: Examine all HTTP requests/responses while maintaining Docker isolation
 *
 * Benefits:
 * - See what HTTP requests are being made
 * - Inspect request/response headers and bodies
 * - Block specific domains
 * - Allow only whitelisted domains
 * - Modify requests/responses if needed
 *
 * Usage: npx ts-node demo-docker-with-proxy.ts
 */

import DockerExecutorWithProxy from './src/secure/DockerExecutorWithProxy';

console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
console.log('║                                                                        ║');
console.log('║     Docker Executor with HTTP Proxy - Traffic Inspection Demo         ║');
console.log('║                                                                        ║');
console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

async function runDemo() {
    // Test 1: Basic HTTP request inspection
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Test 1: Basic HTTP Request Inspection');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const executor1 = new DockerExecutorWithProxy({
        proxyPort: 8888,
        logTraffic: true,
        captureResponses: true,
        timeout: 15000
    });

    const result1 = await executor1.executeCode(`
        const http = require('http');

        console.log('[CODE] Making HTTP request to example.com...');

        http.get('http://example.com', (res) => {
            console.log('[CODE] Got response:', res.statusCode);

            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                console.log('[CODE] Response length:', data.length, 'bytes');
            });
        }).on('error', (err) => {
            console.log('[CODE] Request failed:', err.message);
        });

        setTimeout(() => {}, 2000);
    `);

    console.log('Code Output:');
    console.log(result1.output);
    console.log('\nNetwork Log:');
    result1.networkLog.forEach(log => {
        console.log(`  ${log.method} ${log.url}`);
        console.log(`    Hostname: ${log.hostname}`);
        console.log(`    Status: ${log.statusCode || 'N/A'}`);
        console.log(`    Blocked: ${log.blocked ? '❌ Yes' : '✅ No'}`);
        if (log.responseBody) {
            console.log(`    Response: ${log.responseBody.substring(0, 100)}...`);
        }
    });
    console.log('');

    // Test 2: HTTPS request inspection
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Test 2: HTTPS Request Inspection');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const executor2 = new DockerExecutorWithProxy({
        proxyPort: 8889,
        logTraffic: true
    });

    const result2 = await executor2.executeCode(`
        const https = require('https');

        console.log('[CODE] Making HTTPS request to api.github.com...');

        https.get('https://api.github.com', (res) => {
            console.log('[CODE] GitHub API responded:', res.statusCode);
        }).on('error', (err) => {
            console.log('[CODE] Request failed:', err.message);
        });

        setTimeout(() => {}, 2000);
    `);

    console.log('Code Output:');
    console.log(result2.output);
    console.log('\nNetwork Log:');
    result2.networkLog.forEach(log => {
        console.log(`  ${log.method} ${log.url || log.hostname}`);
        console.log(`    Blocked: ${log.blocked ? '❌ Yes' : '✅ No'}`);
    });
    console.log('');

    // Test 3: Domain blocking
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Test 3: Domain Blocking');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const executor3 = new DockerExecutorWithProxy({
        proxyPort: 8890,
        blockedDomains: ['api.stripe.com', 'stripe.com'],
        logTraffic: true
    });

    const result3 = await executor3.executeCode(`
        const https = require('https');

        console.log('[CODE] Attempting request to blocked domain...');

        https.get('https://api.stripe.com/v1/customers', (res) => {
            console.log('[CODE] ❌ Request succeeded - should be blocked!');
        }).on('error', (err) => {
            console.log('[CODE] ✅ Request blocked:', err.message);
        });

        setTimeout(() => {}, 2000);
    `);

    console.log('Code Output:');
    console.log(result3.output);
    console.log('\nNetwork Log:');
    result3.networkLog.forEach(log => {
        console.log(`  ${log.method} ${log.url || log.hostname}`);
        console.log(`    Blocked: ${log.blocked ? '❌ Yes' : '✅ No'}`);
        if (log.error) {
            console.log(`    Error: ${log.error}`);
        }
    });
    console.log('');

    // Test 4: Domain allowlist (only allow specific domains)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Test 4: Domain Allowlist (Whitelist)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const executor4 = new DockerExecutorWithProxy({
        proxyPort: 8891,
        allowedDomains: ['api.github.com'],  // Only GitHub allowed
        logTraffic: true
    });

    const result4 = await executor4.executeCode(`
        const https = require('https');

        console.log('[CODE] Trying allowed domain (api.github.com)...');
        https.get('https://api.github.com', (res) => {
            console.log('[CODE] ✅ GitHub request succeeded:', res.statusCode);
        }).on('error', (err) => {
            console.log('[CODE] GitHub request failed:', err.message);
        });

        setTimeout(() => {
            console.log('[CODE] Trying blocked domain (api.stripe.com)...');
            https.get('https://api.stripe.com', (res) => {
                console.log('[CODE] ❌ Stripe request succeeded - should be blocked!');
            }).on('error', (err) => {
                console.log('[CODE] ✅ Stripe request blocked:', err.message);
            });
        }, 1000);

        setTimeout(() => {}, 3000);
    `);

    console.log('Code Output:');
    console.log(result4.output);
    console.log('\nNetwork Log:');
    result4.networkLog.forEach(log => {
        console.log(`  ${log.method} ${log.url || log.hostname}`);
        console.log(`    Hostname: ${log.hostname}`);
        console.log(`    Blocked: ${log.blocked ? '❌ Yes' : '✅ No'}`);
    });
    console.log('');

    // Test 5: Stripe SDK with credentials + proxy inspection
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Test 5: Stripe SDK with Credentials + Proxy Inspection');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const executor5 = new DockerExecutorWithProxy({
        proxyPort: 8892,
        logTraffic: true,
        captureResponses: false  // Don't capture full response (might be large)
    });

    const result5 = await executor5.executeCode(
        `
        const https = require('https');

        // Simulating Stripe SDK behavior
        console.log('[CODE] Simulating Stripe SDK call with credentials...');
        console.log('[CODE] Using API key:', process.env.KEYBOARD_STRIPE_KEY?.substring(0, 10) + '...');

        const options = {
            hostname: 'api.stripe.com',
            path: '/v1/customers',
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + process.env.KEYBOARD_STRIPE_KEY,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        };

        const req = https.request(options, (res) => {
            console.log('[CODE] Stripe responded:', res.statusCode);
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                console.log('[CODE] Response received, length:', data.length);
            });
        });

        req.on('error', (err) => {
            console.log('[CODE] Request failed:', err.message);
        });

        req.write('email=test@example.com');
        req.end();

        setTimeout(() => {}, 2000);
        `,
        {
            KEYBOARD_STRIPE_KEY: 'sk_test_FAKE_KEY_FOR_DEMO_1234567890',
            KEYBOARD_USER_ID: 'user_123'
        }
    );

    console.log('Code Output:');
    console.log(result5.output);
    console.log('\nNetwork Log:');
    result5.networkLog.forEach(log => {
        console.log(`  ${log.method} https://${log.hostname}${log.url}`);
        console.log(`    Status: ${log.statusCode || 'N/A'}`);
        console.log(`    Headers:`, JSON.stringify(log.requestHeaders, null, 2).substring(0, 200));
    });
    console.log('');

    // Summary
    console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
    console.log('║                              SUMMARY                                   ║');
    console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

    console.log('✅ HTTP Proxy + Docker Integration Benefits:');
    console.log('   • Complete visibility into all HTTP/HTTPS requests');
    console.log('   • Inspect request headers, bodies, and credentials used');
    console.log('   • Log response status codes and bodies');
    console.log('   • Block specific domains (blocklist)');
    console.log('   • Allow only specific domains (allowlist)');
    console.log('   • Still maintains Docker container isolation\n');

    console.log('🔒 Security Model:');
    console.log('   • Container uses networkMode=bridge (not none)');
    console.log('   • All traffic routes through proxy on host');
    console.log('   • Proxy enforces domain policies');
    console.log('   • Can monitor/log/block any request\n');

    console.log('💡 Use Cases:');
    console.log('   • Debug what APIs user code is calling');
    console.log('   • Monitor credential usage (which keys are used)');
    console.log('   • Enforce domain policies (block certain APIs)');
    console.log('   • Audit trail of all network activity');
    console.log('   • Test API integrations safely\n');

    console.log('🚀 Integration Options:');
    console.log('   1. Standard spawn (fast, no isolation)');
    console.log('      DOCKER_EXECUTOR=false');
    console.log('   ');
    console.log('   2. Docker with network isolation (secure, no visibility)');
    console.log('      DOCKER_EXECUTOR=true + networkMode=none');
    console.log('   ');
    console.log('   3. Docker with proxy inspection (secure + visible)');
    console.log('      DOCKER_EXECUTOR=true + DockerExecutorWithProxy\n');
}

runDemo().catch(error => {
    console.error('\n❌ Error:', error.message);
    console.error('\nStack trace:', error.stack);
    process.exit(1);
});
