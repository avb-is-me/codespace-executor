/**
 * Demo: Header Filtering in HTTP Proxy
 *
 * This demonstrates how sensitive headers are removed from:
 * 1. Network logs (Authorization, Cookie, etc.)
 * 2. Response headers sent back to user code
 *
 * Security benefit: Even if user code is logged/monitored, sensitive
 * credentials won't appear in logs.
 */

import DockerExecutorWithProxy from './src/secure/DockerExecutorWithProxy';

console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
console.log('║                                                                        ║');
console.log('║             HTTP Proxy - Sensitive Header Filtering                   ║');
console.log('║                                                                        ║');
console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

async function runDemo() {
    // Test 1: Default filtering (enabled)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Test 1: Default Header Filtering (Enabled)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const executorWithFiltering = new DockerExecutorWithProxy({
        proxyPort: 9200,
        logTraffic: true,
        filterSensitiveHeaders: true,  // ← Default: true
        onRequest: (req) => {
            console.log('[HOOK] Request to:', req.hostname);
            console.log('[HOOK] Original has Authorization?', !!req.headers['authorization']);

            // Mock response with sensitive headers
            return {
                mockResponse: {
                    statusCode: 200,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer secret_response_token',
                        'Set-Cookie': 'session=abc123; HttpOnly',
                        'X-API-Key': 'secret_api_key_12345',
                        'X-Custom-Header': 'safe_value'
                    },
                    body: JSON.stringify({
                        message: 'Success',
                        data: { id: 123 }
                    })
                }
            };
        }
    });

    const result1 = await executorWithFiltering.executeCode(`
        const https = require('https');

        console.log('[CODE] Making request with Authorization header...');

        const options = {
            hostname: 'api.example.com',
            path: '/protected',
            method: 'GET',
            headers: {
                'Authorization': 'Bearer secret_user_token_12345',
                'X-API-Key': 'user_api_key_67890',
                'User-Agent': 'Node.js Test',
                'X-Custom-Header': 'public_value'
            }
        };

        https.request(options, (res) => {
            console.log('[CODE] Response status:', res.statusCode);
            console.log('[CODE] Response headers received:');
            console.log('  Content-Type:', res.headers['content-type']);
            console.log('  Authorization:', res.headers['authorization'] || '(removed)');
            console.log('  Set-Cookie:', res.headers['set-cookie'] || '(removed)');
            console.log('  X-API-Key:', res.headers['x-api-key'] || '(removed)');
            console.log('  X-Custom-Header:', res.headers['x-custom-header']);

            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                console.log('[CODE] Response body:', data);
            });
        }).on('error', err => {
            console.log('[CODE] Error:', err.message);
        }).end();

        setTimeout(() => {}, 2000);
    `);

    console.log('Code Output:');
    console.log(result1.output);

    console.log('\n📊 Network Log (with filtered headers):');
    result1.networkLog.forEach(log => {
        console.log(`\n  Request: ${log.method} ${log.url}`);
        console.log('  Request Headers:', JSON.stringify(log.requestHeaders, null, 4));
        console.log('  Response Headers:', JSON.stringify(log.responseHeaders, null, 4));
    });

    console.log('\n✅ Notice:');
    console.log('   - Authorization header in log: [REDACTED]');
    console.log('   - X-API-Key in log: [REDACTED]');
    console.log('   - Set-Cookie in log: [REDACTED]');
    console.log('   - Non-sensitive headers: visible');
    console.log('   - Sensitive headers removed from response to user code\n');

    // Test 2: Without filtering (disabled)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Test 2: Header Filtering Disabled (NOT RECOMMENDED)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const executorWithoutFiltering = new DockerExecutorWithProxy({
        proxyPort: 9201,
        logTraffic: true,
        filterSensitiveHeaders: false,  // ← Disabled (insecure!)
        onRequest: (req) => {
            return {
                mockResponse: {
                    statusCode: 200,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer visible_secret_token',
                        'X-API-Key': 'visible_api_key'
                    },
                    body: JSON.stringify({ message: 'Success' })
                }
            };
        }
    });

    const result2 = await executorWithoutFiltering.executeCode(`
        const https = require('https');

        https.request({
            hostname: 'api.example.com',
            path: '/data',
            headers: {
                'Authorization': 'Bearer user_secret_token',
                'X-API-Key': 'user_secret_key'
            }
        }, (res) => {
            console.log('[CODE] Response status:', res.statusCode);
        }).on('error', () => {}).end();

        setTimeout(() => {}, 1000);
    `);

    console.log('Code Output:');
    console.log(result2.output);

    console.log('\n📊 Network Log (NO filtering):');
    result2.networkLog.forEach(log => {
        console.log(`\n  Request: ${log.method} ${log.url}`);
        console.log('  Request Headers:', JSON.stringify(log.requestHeaders, null, 4));
    });

    console.log('\n⚠️  Notice:');
    console.log('   - Authorization header VISIBLE in log (security risk!)');
    console.log('   - X-API-Key VISIBLE in log (security risk!)');
    console.log('   - Anyone with access to logs can see secrets\n');

    // Test 3: Custom sensitive headers
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Test 3: Custom Sensitive Headers List');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const executorCustomHeaders = new DockerExecutorWithProxy({
        proxyPort: 9202,
        logTraffic: true,
        filterSensitiveHeaders: true,
        sensitiveHeaders: [
            'authorization',
            'x-stripe-key',
            'x-aws-key',
            'x-openai-key'
        ],
        onRequest: (req) => {
            return {
                mockResponse: {
                    statusCode: 200,
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Stripe-Key': 'sk_live_secret',
                        'X-AWS-Key': 'aws_secret',
                        'X-Custom-Header': 'visible'
                    },
                    body: '{}'
                }
            };
        }
    });

    const result3 = await executorCustomHeaders.executeCode(`
        const https = require('https');

        https.request({
            hostname: 'api.stripe.com',
            headers: {
                'Authorization': 'Bearer stripe_token',
                'X-Stripe-Key': 'sk_test_12345',
                'X-Custom-Header': 'public_value'
            }
        }, (res) => {
            console.log('[CODE] Status:', res.statusCode);
        }).on('error', () => {}).end();

        setTimeout(() => {}, 1000);
    `);

    console.log('Code Output:');
    console.log(result3.output);

    console.log('\n📊 Network Log (custom headers):');
    result3.networkLog.forEach(log => {
        console.log(`\n  Request Headers:`, JSON.stringify(log.requestHeaders, null, 4));
    });

    console.log('\n✅ Notice:');
    console.log('   - Custom headers (X-Stripe-Key, X-AWS-Key): [REDACTED]');
    console.log('   - Standard headers not in custom list: visible\n');

    // Summary
    console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
    console.log('║                              SUMMARY                                   ║');
    console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

    console.log('🔒 Default Filtered Headers (filterSensitiveHeaders: true):\n');
    console.log('   - authorization');
    console.log('   - cookie');
    console.log('   - set-cookie');
    console.log('   - x-api-key');
    console.log('   - x-auth-token');
    console.log('   - x-csrf-token');
    console.log('   - x-xsrf-token');
    console.log('   - proxy-authorization');
    console.log('   - www-authenticate');
    console.log('   - x-amz-security-token');
    console.log('   - x-goog-iam-authorization-token');
    console.log('   - x-goog-authenticated-user-email\n');

    console.log('✅ What Gets Filtered:\n');
    console.log('   1. Headers in network logs → Replaced with [REDACTED]');
    console.log('   2. Headers in response to user code → Removed completely');
    console.log('   3. Both request and response headers filtered\n');

    console.log('✅ Benefits:\n');
    console.log('   • Logs don\'t contain sensitive credentials');
    console.log('   • User code doesn\'t receive sensitive headers back');
    console.log('   • Compliance with security best practices');
    console.log('   • Prevents credential leakage in monitoring\n');

    console.log('⚙️  Configuration:\n');
    console.log('   // Default (recommended)');
    console.log('   const executor = new DockerExecutorWithProxy({');
    console.log('       filterSensitiveHeaders: true  // ← Default');
    console.log('   });\n');

    console.log('   // Custom headers');
    console.log('   const executor = new DockerExecutorWithProxy({');
    console.log('       filterSensitiveHeaders: true,');
    console.log('       sensitiveHeaders: [\'authorization\', \'x-my-secret\']');
    console.log('   });\n');

    console.log('   // Disable (NOT recommended)');
    console.log('   const executor = new DockerExecutorWithProxy({');
    console.log('       filterSensitiveHeaders: false  // ⚠️  Insecure!');
    console.log('   });\n');

    console.log('💡 Recommendation:\n');
    console.log('   Always keep filterSensitiveHeaders: true (default)');
    console.log('   This protects credentials in logs and responses!\n');
}

runDemo().catch(error => {
    console.error('\n❌ Error:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
});
