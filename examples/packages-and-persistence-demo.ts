/**
 * Demo: Custom Packages + Container Persistence
 *
 * This demonstrates:
 * 1. How to use pre-built images with custom packages
 * 2. That containers reset on each execution (ephemeral)
 * 3. How to manage state between executions
 */

import DockerExecutor from '../src/secure/DockerExecutor';

console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
console.log('║                                                                        ║');
console.log('║           Custom Packages + Container Persistence Demo                ║');
console.log('║                                                                        ║');
console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

async function runDemo() {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Part 1: Pre-installed Packages (Image-level Persistence)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('First, build a custom image with packages:\n');
    console.log('$ docker build -f Dockerfile.with-packages -t my-executor:v1 .\n');
    console.log('This installs: stripe, axios, lodash (one-time build)\n');

    // Using the base alpine image (no pre-installed packages)
    const executorNoPackages = new DockerExecutor({
        image: 'node:20-alpine',
        networkMode: 'none',
        timeout: 10000
    });

    console.log('Test 1: Without pre-installed packages\n');

    const result1 = await executorNoPackages.executeCode(`
        try {
            const axios = require('axios');
            console.log('[CODE] axios found!');
        } catch (err) {
            console.log('[CODE] ❌ axios not found:', err.message);
        }

        try {
            const lodash = require('lodash');
            console.log('[CODE] lodash found!');
        } catch (err) {
            console.log('[CODE] ❌ lodash not found:', err.message);
        }
    `);

    console.log(result1.output);

    console.log('\nTest 2: With custom image (packages pre-installed)\n');
    console.log('NOTE: This would work if you built my-executor:v1');
    console.log('For now, showing what the output would be:\n');

    console.log('```');
    console.log('[CODE] ✅ axios found! Version: 1.6.0');
    console.log('[CODE] ✅ lodash found! Has chunk function');
    console.log('[CODE] These packages are in EVERY execution!');
    console.log('```\n');

    console.log('✅ Key Point: Packages in the IMAGE persist across executions');
    console.log('   Each new container uses the same image with packages\n');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Part 2: Container State Does NOT Persist');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('Each executeCode() creates a NEW container!\n');

    // Execution 1: Try to write a file
    console.log('Execution 1: Write a file\n');

    const result2 = await executorNoPackages.executeCode(`
        const fs = require('fs');
        fs.writeFileSync('/tmp/mydata.txt', 'Hello from execution 1');
        console.log('[CODE] ✅ File written to /tmp/mydata.txt');
        console.log('[CODE] Container ID:', process.env.HOSTNAME);
    `);

    console.log(result2.output);

    // Execution 2: Try to read the file
    console.log('\nExecution 2: Try to read the file\n');

    const result3 = await executorNoPackages.executeCode(`
        const fs = require('fs');
        const exists = fs.existsSync('/tmp/mydata.txt');
        console.log('[CODE] File exists:', exists);
        console.log('[CODE] Container ID:', process.env.HOSTNAME);

        if (exists) {
            const content = fs.readFileSync('/tmp/mydata.txt', 'utf8');
            console.log('[CODE] File content:', content);
        } else {
            console.log('[CODE] ❌ File is GONE! New container.');
        }
    `);

    console.log(result3.output);

    console.log('\n❌ Key Point: Container state does NOT persist');
    console.log('   Each execution runs in a different container\n');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Part 3: Managing State Across Executions');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('Solution: Pass state via environment variables\n');

    // Simulate external state storage
    let externalState = { counter: 0, data: [] };

    console.log('Execution 1: Increment counter\n');

    const result4 = await executorNoPackages.executeCode(
        `
        const state = JSON.parse(process.env.STATE_JSON || '{"counter":0,"data":[]}');
        state.counter++;
        state.data.push('execution-1');

        console.log('[CODE] Counter:', state.counter);
        console.log('[CODE] Data:', state.data);
        console.log('[CODE] Outputting new state...');
        console.log('STATE_OUTPUT:' + JSON.stringify(state));
        `,
        {
            STATE_JSON: JSON.stringify(externalState)
        }
    );

    console.log(result4.output);

    // Parse output to get new state
    const stateMatch = result4.output.match(/STATE_OUTPUT:(.+)/);
    if (stateMatch) {
        externalState = JSON.parse(stateMatch[1]);
    }

    console.log('\n[EXTERNAL] Saved state:', externalState, '\n');

    console.log('Execution 2: Increment counter again\n');

    const result5 = await executorNoPackages.executeCode(
        `
        const state = JSON.parse(process.env.STATE_JSON);
        state.counter++;
        state.data.push('execution-2');

        console.log('[CODE] Counter:', state.counter);  // Should be 2!
        console.log('[CODE] Data:', state.data);
        console.log('STATE_OUTPUT:' + JSON.stringify(state));
        `,
        {
            STATE_JSON: JSON.stringify(externalState)
        }
    );

    console.log(result5.output);

    const stateMatch2 = result5.output.match(/STATE_OUTPUT:(.+)/);
    if (stateMatch2) {
        externalState = JSON.parse(stateMatch2[1]);
    }

    console.log('\n[EXTERNAL] Final state:', externalState, '\n');

    console.log('✅ Key Point: State persists when managed externally');
    console.log('   Pass state in → Get new state out → Save externally\n');

    // Summary
    console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
    console.log('║                              SUMMARY                                   ║');
    console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

    console.log('📦 Package Persistence:\n');
    console.log('   ✅ Packages in Docker IMAGE: Persist (available in all executions)');
    console.log('   ❌ Packages installed at runtime: Lost (each container is new)\n');

    console.log('💾 State Persistence:\n');
    console.log('   ❌ Files written to container: Lost (container removed after execution)');
    console.log('   ❌ Global variables: Lost (new Node.js process each time)');
    console.log('   ✅ Environment variables: Available per-execution (if passed)');
    console.log('   ✅ External storage: Persists (Redis, DB, S3)\n');

    console.log('🏗️  Architecture:\n');
    console.log('   ┌─────────────────┐');
    console.log('   │  Docker Image   │  ← Built once, packages included');
    console.log('   └────────┬────────┘');
    console.log('            │');
    console.log('            ├───→ Container 1 (execution 1) → Removed');
    console.log('            ├───→ Container 2 (execution 2) → Removed');
    console.log('            └───→ Container 3 (execution 3) → Removed\n');

    console.log('💡 Best Practices:\n');
    console.log('   1. Pre-build images with common packages');
    console.log('   2. Pass credentials via environment variables');
    console.log('   3. Store state externally (Redis/DB)');
    console.log('   4. Parse output to extract new state');
    console.log('   5. Keep containers ephemeral (default)\n');

    console.log('📋 Example Workflow:\n');
    console.log('   // Build custom image once:');
    console.log('   $ docker build -f Dockerfile.with-packages -t my-executor:v1 .\n');

    console.log('   // Use in code:');
    console.log('   const executor = new DockerExecutor({');
    console.log('       image: "my-executor:v1"  // Has stripe, axios, etc.');
    console.log('   });\n');

    console.log('   // Execute with state:');
    console.log('   const state = await redis.get(`user:${userId}`);');
    console.log('   const result = await executor.executeCode(code, {');
    console.log('       KEYBOARD_STRIPE_KEY: credentials.stripe,');
    console.log('       STATE_JSON: state');
    console.log('   });');
    console.log('   const newState = parseState(result.output);');
    console.log('   await redis.set(`user:${userId}`, newState);\n');

    console.log('✅ Result:');
    console.log('   • Fast (packages pre-installed)');
    console.log('   • Secure (ephemeral containers)');
    console.log('   • Stateful (external storage)');
    console.log('   • Scalable (stateless Docker)\n');
}

runDemo().catch(error => {
    console.error('\n❌ Error:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
});
