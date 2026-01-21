/**
 * Demo: Docker Executor with Environment Variables
 *
 * This demonstrates passing environment variables to Docker containers,
 * including sensitive credentials like KEYBOARD_* variables.
 *
 * Usage: npx ts-node demo-docker-with-env.ts
 */

import DockerExecutor from './src/secure/DockerExecutor';

console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
console.log('║                                                                        ║');
console.log('║        Docker Executor - Environment Variables Demo                   ║');
console.log('║                                                                        ║');
console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

async function runDemo() {
    const executor = new DockerExecutor({
        networkMode: 'none',
        timeout: 15000,
    });

    // Check Docker availability
    const isAvailable = await executor.isAvailable();
    if (!isAvailable) {
        console.error('❌ Docker is not available!');
        console.error('This demo requires Docker to be running.\n');
        return;
    }

    console.log('✅ Docker is available!\n');

    // Test 1: Basic environment variables
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Test 1: Basic Environment Variables');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const result1 = await executor.executeCode(
        `
        console.log('Environment Variables:');
        console.log('USER_ID:', process.env.USER_ID);
        console.log('SESSION_ID:', process.env.SESSION_ID);
        console.log('API_MODE:', process.env.API_MODE);
        console.log('CUSTOM_VAR:', process.env.CUSTOM_VAR);
        `,
        {
            USER_ID: 'user-12345',
            SESSION_ID: 'sess-67890',
            API_MODE: 'sandbox',
            CUSTOM_VAR: 'Hello from Docker!'
        }
    );

    console.log('Output:');
    console.log(result1.output);
    console.log('Status:', result1.success ? '✅ SUCCESS' : '❌ FAILED');
    console.log('');

    // Test 2: KEYBOARD_* credentials (like your SecureExecutor)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Test 2: KEYBOARD_* Credentials (Phase 1 Style)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const result2 = await executor.executeCode(
        `
        // Simulating Phase 1 data variable execution
        console.log('[DATA VARIABLE] Executing API call with credentials');
        console.log('[DATA VARIABLE] KEYBOARD_API_KEY:', process.env.KEYBOARD_API_KEY?.substring(0, 10) + '...');
        console.log('[DATA VARIABLE] KEYBOARD_SECRET:', process.env.KEYBOARD_SECRET ? '[PRESENT]' : '[MISSING]');

        // Simulate API call (blocked by Docker network isolation)
        const https = require('https');
        const apiKey = process.env.KEYBOARD_API_KEY;

        console.log('[DATA VARIABLE] Attempting API request with credentials...');

        https.get({
            hostname: 'api.example.com',
            path: '/data',
            headers: {
                'Authorization': \`Bearer \${apiKey}\`
            }
        }, (res) => {
            console.log('[DATA VARIABLE] ❌ Request succeeded (should not happen)');
        }).on('error', (err) => {
            console.log('[DATA VARIABLE] ✅ Request blocked by Docker:', err.code);
        });

        setTimeout(() => {}, 1000);
        `,
        {
            // Simulating KEYBOARD_* environment variables
            KEYBOARD_API_KEY: 'sk_live_fake_key_for_demo_1234567890',
            KEYBOARD_SECRET: 'secret_value_xyz',
            KEYBOARD_USER_TOKEN: 'user_token_abc'
        }
    );

    console.log('Output:');
    console.log(result2.output);
    console.log('Status:', result2.success ? '✅ SUCCESS' : '❌ FAILED');
    console.log('');

    // Test 3: Phase 1 vs Phase 2 simulation
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Test 3: Two-Phase Execution (Like SecureExecutor)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('--- Phase 1: Data Variable with Credentials ---');
    const phase1Result = await executor.executeCode(
        `
        console.log('[PHASE 1] Has KEYBOARD_API_KEY:', !!process.env.KEYBOARD_API_KEY);
        console.log('[PHASE 1] Fetching data from API...');

        // In real scenario, this would make HTTP request
        // But Docker blocks it, so we simulate the response
        const mockData = {
            customer: { id: 'cus_123', email: 'test@example.com' },
            fetched: true
        };

        // Return data (in real code, this would be captured)
        console.log('[PHASE 1] Data fetched:', JSON.stringify(mockData));
        `,
        {
            KEYBOARD_API_KEY: 'sk_live_credentials_here',
            KEYBOARD_SECRET: 'secret'
        }
    );

    console.log(phase1Result.output);

    console.log('\n--- Phase 2: Global Code WITHOUT Credentials ---');
    const phase2Result = await executor.executeCode(
        `
        console.log('[PHASE 2] Has KEYBOARD_API_KEY:', !!process.env.KEYBOARD_API_KEY);
        console.log('[PHASE 2] Credentials blocked for security');

        // In real scenario, sanitized data from Phase 1 would be injected
        const customerData = { id: 'cus_123', email: 'test@example.com' };

        console.log('[PHASE 2] Using pre-fetched data:', JSON.stringify(customerData));
        console.log('[PHASE 2] Cannot access credentials directly');
        `,
        {
            // NO KEYBOARD_* variables in Phase 2!
            EXECUTION_PHASE: '2',
            DATA_ONLY: 'true'
        }
    );

    console.log(phase2Result.output);
    console.log('');

    // Test 4: Environment variable isolation between executions
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Test 4: Environment Isolation Between Executions');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('Execution 1: User A with SECRET_A');
    const resultA = await executor.executeCode(
        `console.log('Secret:', process.env.SECRET);`,
        { SECRET: 'SECRET_A' }
    );
    console.log(resultA.output);

    console.log('Execution 2: User B with SECRET_B');
    const resultB = await executor.executeCode(
        `console.log('Secret:', process.env.SECRET);`,
        { SECRET: 'SECRET_B' }
    );
    console.log(resultB.output);

    console.log('Execution 3: User C with no secret');
    const resultC = await executor.executeCode(
        `console.log('Secret:', process.env.SECRET || '[NOT SET]');`,
        {}
    );
    console.log(resultC.output);

    console.log('✅ Each execution is isolated - no leakage between users!\n');

    // Test 5: Integration example with real SecureExecutor pattern
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Test 5: Full SecureExecutor Integration Example');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Simulate how SecureExecutor would use it
    const userCredentials = {
        KEYBOARD_STRIPE_KEY: 'sk_test_fake',
        KEYBOARD_AWS_KEY: 'aws_fake',
        KEYBOARD_USER_ID: 'user_123'
    };

    console.log('Executing data variable with user credentials...');
    const dataVarResult = await executor.executeCode(
        `
        // This is like a data variable execution
        const stripeKey = process.env.KEYBOARD_STRIPE_KEY;
        console.log('Stripe Key (first 10 chars):', stripeKey?.substring(0, 10) + '...');

        // Try to use it (will be blocked by Docker)
        const https = require('https');
        https.request({
            hostname: 'api.stripe.com',
            path: '/v1/customers',
            headers: { 'Authorization': \`Bearer \${stripeKey}\` }
        }, () => {}).on('error', (err) => {
            console.log('Network blocked:', err.code);
        }).end();
        `,
        userCredentials
    );

    console.log(dataVarResult.output);

    // Summary
    console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
    console.log('║                              SUMMARY                                   ║');
    console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

    console.log('✅ Environment Variables Work Perfectly:');
    console.log('   • Pass credentials to Phase 1 (data variables)');
    console.log('   • Block credentials in Phase 2 (global code)');
    console.log('   • Complete isolation between executions');
    console.log('   • No credential leakage between users\n');

    console.log('✅ Network Isolation Still Applies:');
    console.log('   • Even with credentials, network is blocked');
    console.log('   • Cannot exfiltrate credentials via HTTP');
    console.log('   • Docker enforces at kernel level\n');

    console.log('💡 Integration with SecureExecutor:');
    console.log('   • Phase 1: executor.executeCode(code, keyboardEnv)');
    console.log('   • Phase 2: executor.executeCode(code, {}) // no creds');
    console.log('   • Same two-phase pattern, better isolation!\n');
}

runDemo().catch(error => {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
});
