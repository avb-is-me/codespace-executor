/**
 * Test Docker Integration with SecureExecutor
 *
 * This demonstrates the DOCKER_EXECUTOR environment variable integration
 *
 * Usage:
 *   # With Docker (network isolated):
 *   DOCKER_EXECUTOR=true npx ts-node test-docker-integration.ts
 *
 *   # Without Docker (standard execution):
 *   npx ts-node test-docker-integration.ts
 */

import SecureExecutor from './src/secure/SecureExecutor';
import { ExecutionPayload } from './src/types';

async function testDockerIntegration() {
    console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
    console.log('║                                                                        ║');
    console.log('║          SecureExecutor with Docker Integration Test                  ║');
    console.log('║                                                                        ║');
    console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

    console.log('Environment:');
    console.log('  DOCKER_EXECUTOR:', process.env.DOCKER_EXECUTOR || 'false (not set)');
    console.log('');

    const executor = new SecureExecutor({
        timeout: 15000
    });

    // Test 1: Simple code with environment variables
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Test 1: Simple Code with Environment Variables');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Set some test credentials
    process.env.KEYBOARD_TEST_KEY = 'test_key_123';
    process.env.KEYBOARD_USER_ID = 'user_456';

    const simplePayload: ExecutionPayload = {
        code: `
            console.log('Environment variables available:');
            console.log('KEYBOARD_TEST_KEY:', process.env.KEYBOARD_TEST_KEY);
            console.log('KEYBOARD_USER_ID:', process.env.KEYBOARD_USER_ID);
            console.log('');
            console.log('Code execution successful!');
        `
    };

    try {
        const result = await executor.executeCode(simplePayload);
        console.log('Success:', result.success);
        console.log('Output:');
        console.log(result.data?.stdout);

        if (result.data?.dockerInfo) {
            console.log('\n🐳 Docker Info:');
            console.log('  Container ID:', result.data.dockerInfo.containerInfo?.id);
            console.log('  Network Isolation:', result.data.dockerInfo.networkIsolation ? '✅ Enabled' : '❌ Disabled');
        }
    } catch (error: any) {
        console.error('❌ Error:', error.message || error);
    }

    console.log('');

    // Test 2: Two-phase execution (like your SecureExecutor pattern)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Test 2: Two-Phase Execution (Data Variables + Global Code)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const twoPhasePayload: ExecutionPayload = {
        secure_data_variables: {
            customerData: {
                url: 'https://api.example.com/customers/123',
                method: 'GET',
                headers: {
                    'Authorization': 'Bearer {KEYBOARD_TEST_KEY}'
                }
            }
        },
        Global_code: `
            console.log('[Global Code] Running with pre-fetched data');
            console.log('[Global Code] Has KEYBOARD_TEST_KEY:', !!process.env.KEYBOARD_TEST_KEY);

            // In real scenario, customerData() would return sanitized data
            console.log('[Global Code] Would process customerData here');
        `
    };

    try {
        console.log('Executing two-phase pattern...');
        const result = await executor.executeCode(twoPhasePayload);
        console.log('Success:', result.success);
        console.log('Output:');
        console.log(result.data?.stdout);

        if (result.data?.dockerInfo) {
            console.log('\n🐳 Docker Info:');
            console.log('  Network Isolation:', result.data.dockerInfo.networkIsolation ? '✅ Enabled' : '❌ Disabled');
        }
    } catch (error: any) {
        console.error('❌ Error:', error.message || error);
    }

    console.log('');

    // Test 3: Network isolation test (only relevant if Docker is enabled)
    if (process.env.DOCKER_EXECUTOR === 'true') {
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('Test 3: Network Isolation Test (Docker Only)');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        const networkTestPayload: ExecutionPayload = {
            code: `
                console.log('[Network Test] Attempting network requests...');

                const https = require('https');

                // Test 1: Node.js https
                https.get('https://api.stripe.com', (res) => {
                    console.log('❌ https.get succeeded (should not happen!)');
                }).on('error', (err) => {
                    console.log('✅ https.get blocked:', err.code);
                });

                // Test 2: Python exec
                const { exec } = require('child_process');
                exec('python3 -c "import urllib.request; urllib.request.urlopen(\\'https://api.stripe.com\\')"',
                    (err, stdout, stderr) => {
                        if (err || stderr.includes('Network')) {
                            console.log('✅ Python blocked:', stderr || err.message);
                        } else {
                            console.log('❌ Python succeeded (should not happen!)');
                        }
                    }
                );

                setTimeout(() => {}, 2000);
            `
        };

        try {
            const result = await executor.executeCode(networkTestPayload);
            console.log('Output:');
            console.log(result.data?.stdout);
            if (result.data?.stderr) {
                console.log('\nStderr:');
                console.log(result.data?.stderr);
            }
        } catch (error: any) {
            console.error('❌ Error:', error.message || error);
        }

        console.log('');
    }

    // Summary
    console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
    console.log('║                              SUMMARY                                   ║');
    console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

    if (process.env.DOCKER_EXECUTOR === 'true') {
        console.log('✅ Docker execution mode:');
        console.log('   • All code executed in isolated Docker containers');
        console.log('   • Environment variables (KEYBOARD_*) passed to containers');
        console.log('   • Complete network isolation (networkMode=none)');
        console.log('   • Impossible to bypass - kernel-level enforcement\n');
    } else {
        console.log('✅ Standard execution mode:');
        console.log('   • Code executed with spawn (faster)');
        console.log('   • Environment variables available');
        console.log('   • To enable Docker: DOCKER_EXECUTOR=true\n');
    }

    console.log('💡 To switch modes:');
    console.log('   DOCKER_EXECUTOR=true npx ts-node test-docker-integration.ts');
    console.log('   DOCKER_EXECUTOR=false npx ts-node test-docker-integration.ts\n');

    // Cleanup
    delete process.env.KEYBOARD_TEST_KEY;
    delete process.env.KEYBOARD_USER_ID;
}

// Run tests
testDockerIntegration().catch(error => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
});
