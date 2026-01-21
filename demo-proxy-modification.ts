/**
 * Demo: HTTP Proxy with Request/Response Modification
 *
 * This demonstrates advanced proxy features:
 * - Modify request headers
 * - Modify response headers and bodies
 * - Block requests with custom logic
 * - Return mock responses without hitting real APIs
 *
 * Usage: npx ts-node demo-proxy-modification.ts
 */

import DockerExecutorWithProxy from './src/secure/DockerExecutorWithProxy';

console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
console.log('║                                                                        ║');
console.log('║          HTTP Proxy - Request/Response Modification Demo              ║');
console.log('║                                                                        ║');
console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

async function runDemo() {
    // Test 1: Modify response headers
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Test 1: Modify Response Headers');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const executor1 = new DockerExecutorWithProxy({
        proxyPort: 9001,
        logTraffic: true,
        onResponse: (res) => {
            console.log(`[HOOK] Modifying response headers for ${res.hostname}`);
            return {
                headers: {
                    ...res.headers,
                    'x-custom-header': 'Modified by proxy!',
                    'x-original-status': String(res.statusCode),
                    'x-proxy-timestamp': new Date().toISOString()
                }
            };
        }
    });

    const result1 = await executor1.executeCode(`
        const http = require('http');

        http.get('http://example.com', (res) => {
            console.log('[CODE] Response headers:');
            console.log('  x-custom-header:', res.headers['x-custom-header']);
            console.log('  x-original-status:', res.headers['x-original-status']);
            console.log('  x-proxy-timestamp:', res.headers['x-proxy-timestamp']);

            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                console.log('[CODE] Got response, length:', data.length);
            });
        });

        setTimeout(() => {}, 2000);
    `);

    console.log('Output:');
    console.log(result1.output);
    console.log('');

    // Test 2: Modify response body
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Test 2: Modify Response Body (Inject Data)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const executor2 = new DockerExecutorWithProxy({
        proxyPort: 9002,
        logTraffic: true,
        captureResponses: true,
        onResponse: (res) => {
            // Modify JSON responses to add extra data
            if (res.headers['content-type']?.includes('application/json')) {
                try {
                    const originalBody = JSON.parse(res.body.toString());
                    const modifiedBody = {
                        ...originalBody,
                        _proxy_metadata: {
                            modified: true,
                            timestamp: new Date().toISOString(),
                            original_status: res.statusCode
                        }
                    };

                    console.log(`[HOOK] Injected metadata into JSON response`);

                    return {
                        body: JSON.stringify(modifiedBody),
                        headers: {
                            ...res.headers,
                            'content-length': undefined  // Let it recalculate
                        }
                    };
                } catch (e) {
                    // Not valid JSON, skip modification
                }
            }
            return null;
        }
    });

    const result2 = await executor2.executeCode(`
        const https = require('https');

        https.get('https://api.github.com', (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                const json = JSON.parse(data);
                console.log('[CODE] Response has _proxy_metadata:', !!json._proxy_metadata);
                if (json._proxy_metadata) {
                    console.log('[CODE] Proxy metadata:', JSON.stringify(json._proxy_metadata, null, 2));
                }
            });
        }).on('error', err => {
            console.log('[CODE] Request failed:', err.message);
        });

        setTimeout(() => {}, 2000);
    `);

    console.log('Output:');
    console.log(result2.output);
    console.log('');

    // Test 3: Mock response (don't hit real API)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Test 3: Mock Response (Fake Stripe API)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const executor3 = new DockerExecutorWithProxy({
        proxyPort: 9003,
        logTraffic: true,
        onRequest: (req) => {
            // Mock Stripe API responses
            if (req.hostname.includes('stripe.com')) {
                console.log(`[HOOK] Returning mock Stripe response`);

                // Return fake customer object
                const mockCustomer = {
                    id: 'cus_mock_12345',
                    object: 'customer',
                    email: 'test@example.com',
                    created: Math.floor(Date.now() / 1000),
                    _mock: true,
                    _message: 'This is a MOCK response from proxy, no real API call made'
                };

                return {
                    mockResponse: {
                        statusCode: 200,
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Mock-Response': 'true'
                        },
                        body: JSON.stringify(mockCustomer)
                    }
                };
            }
            return null;
        }
    });

    const result3 = await executor3.executeCode(`
        const https = require('https');

        console.log('[CODE] Calling Stripe API to create customer...');

        const req = https.request({
            hostname: 'api.stripe.com',
            path: '/v1/customers',
            method: 'POST',
            headers: {
                'Authorization': 'Bearer sk_test_fake',
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }, (res) => {
            console.log('[CODE] Response status:', res.statusCode);
            console.log('[CODE] Is mock?:', res.headers['x-mock-response']);

            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                const customer = JSON.parse(data);
                console.log('[CODE] Customer ID:', customer.id);
                console.log('[CODE] Customer email:', customer.email);
                console.log('[CODE] Is mock?:', customer._mock);
                console.log('[CODE] Message:', customer._message);
            });
        });

        req.on('error', err => {
            console.log('[CODE] Request failed:', err.message);
        });

        req.write('email=test@example.com');
        req.end();

        setTimeout(() => {}, 2000);
    `);

    console.log('Output:');
    console.log(result3.output);
    console.log('\nNetwork Log:');
    result3.networkLog.forEach(log => {
        console.log(`  ${log.method} ${log.url || log.hostname}`);
        console.log(`    Response: ${log.responseBody?.substring(0, 100)}...`);
    });
    console.log('');

    // Test 4: Modify request headers
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Test 4: Modify Request Headers (Add Auth)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const executor4 = new DockerExecutorWithProxy({
        proxyPort: 9004,
        logTraffic: true,
        onRequest: (req) => {
            // Automatically inject auth headers
            if (req.hostname.includes('api.example.com')) {
                console.log(`[HOOK] Injecting authorization header`);
                return {
                    modifiedHeaders: {
                        'Authorization': 'Bearer injected_by_proxy_token_12345',
                        'X-Proxy-Injected': 'true',
                        'X-Original-Host': req.hostname
                    }
                };
            }
            return null;
        }
    });

    const result4 = await executor4.executeCode(`
        const http = require('http');

        console.log('[CODE] Making request WITHOUT auth header...');

        http.request({
            hostname: 'api.example.com',
            path: '/data',
            method: 'GET',
            headers: {
                'User-Agent': 'Node.js Test'
            }
        }, (res) => {
            console.log('[CODE] Response:', res.statusCode);
        }).on('error', err => {
            console.log('[CODE] Request completed (may fail due to fake host)');
        }).end();

        setTimeout(() => {}, 2000);
    `);

    console.log('Output:');
    console.log(result4.output);
    console.log('\nNetwork Log:');
    result4.networkLog.forEach(log => {
        console.log(`  ${log.method} ${log.hostname}`);
        console.log(`  Request Headers:`, log.requestHeaders);
    });
    console.log('');

    // Test 5: Block requests with custom logic
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Test 5: Custom Blocking Logic (Block POST requests)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const executor5 = new DockerExecutorWithProxy({
        proxyPort: 9005,
        logTraffic: true,
        onRequest: (req) => {
            // Block all POST/PUT/DELETE requests
            if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
                console.log(`[HOOK] Blocking ${req.method} request to ${req.hostname}`);
                return { block: true };
            }
            return null;
        }
    });

    const result5 = await executor5.executeCode(`
        const https = require('https');

        console.log('[CODE] Test 1: GET request (should work)');
        https.get('https://api.github.com', (res) => {
            console.log('[CODE] ✅ GET succeeded:', res.statusCode);
        }).on('error', err => {
            console.log('[CODE] ❌ GET failed:', err.message);
        });

        setTimeout(() => {
            console.log('[CODE] Test 2: POST request (should be blocked)');
            https.request({
                hostname: 'api.github.com',
                path: '/data',
                method: 'POST'
            }, (res) => {
                console.log('[CODE] ❌ POST succeeded (should be blocked!)');
            }).on('error', err => {
                console.log('[CODE] ✅ POST blocked:', err.message);
            }).end();
        }, 1000);

        setTimeout(() => {}, 3000);
    `);

    console.log('Output:');
    console.log(result5.output);
    console.log('\nNetwork Log:');
    result5.networkLog.forEach(log => {
        console.log(`  ${log.method} ${log.url || log.hostname}`);
        console.log(`    Blocked: ${log.blocked ? '❌ Yes' : '✅ No'}`);
    });
    console.log('');

    // Test 6: Modify status code
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Test 6: Modify Status Code (Turn Errors into Success)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const executor6 = new DockerExecutorWithProxy({
        proxyPort: 9006,
        logTraffic: true,
        onResponse: (res) => {
            // Convert 4xx/5xx errors to 200 OK
            if (res.statusCode >= 400) {
                console.log(`[HOOK] Converting ${res.statusCode} error to 200 OK`);
                return {
                    statusCode: 200,
                    headers: {
                        ...res.headers,
                        'X-Original-Status': String(res.statusCode),
                        'X-Status-Modified': 'true'
                    },
                    body: JSON.stringify({
                        success: true,
                        message: 'Error response converted to success by proxy',
                        original_status: res.statusCode
                    })
                };
            }
            return null;
        }
    });

    const result6 = await executor6.executeCode(`
        const http = require('http');

        http.get('http://httpbin.org/status/404', (res) => {
            console.log('[CODE] Response status:', res.statusCode);
            console.log('[CODE] Original status:', res.headers['x-original-status']);
            console.log('[CODE] Was modified?:', res.headers['x-status-modified']);

            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                console.log('[CODE] Response body:', data);
            });
        }).on('error', err => {
            console.log('[CODE] Request failed:', err.message);
        });

        setTimeout(() => {}, 2000);
    `);

    console.log('Output:');
    console.log(result6.output);
    console.log('');

    // Summary
    console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
    console.log('║                              SUMMARY                                   ║');
    console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

    console.log('✅ Request Modification Capabilities:');
    console.log('   • Modify request headers (inject auth, tokens, etc.)');
    console.log('   • Block requests based on custom logic (method, domain, etc.)');
    console.log('   • Return mock responses without hitting real APIs\n');

    console.log('✅ Response Modification Capabilities:');
    console.log('   • Modify response headers (add custom headers, metadata)');
    console.log('   • Modify response bodies (inject data, transform JSON)');
    console.log('   • Change status codes (convert errors to success)\n');

    console.log('💡 Use Cases:');
    console.log('   • Testing: Mock external APIs without real calls');
    console.log('   • Security: Inject auth headers, block dangerous requests');
    console.log('   • Debugging: Add metadata to responses for tracking');
    console.log('   • Rate limiting: Block requests based on custom rules');
    console.log('   • Data transformation: Modify API responses on the fly');
    console.log('   • Error handling: Convert errors to success for testing\n');

    console.log('🔧 Implementation:');
    console.log('   onRequest: (req) => {');
    console.log('     return {');
    console.log('       block: true,  // Block the request');
    console.log('       mockResponse: { statusCode: 200, body: "..." },  // Mock');
    console.log('       modifiedHeaders: { "Authorization": "..." }  // Modify');
    console.log('     };');
    console.log('   }\n');

    console.log('   onResponse: (res) => {');
    console.log('     return {');
    console.log('       statusCode: 200,  // Change status');
    console.log('       headers: { ... },  // Change headers');
    console.log('       body: "..."  // Change body');
    console.log('     };');
    console.log('   }\n');
}

runDemo().catch(error => {
    console.error('\n❌ Error:', error.message);
    console.error('\nStack trace:', error.stack);
    process.exit(1);
});
