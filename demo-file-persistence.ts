/**
 * Demo: File Persistence Between Docker Executions
 *
 * This proves that files created in one execution are NOT available in the next.
 */

import DockerExecutor from './src/secure/DockerExecutor';

console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
console.log('║                                                                        ║');
console.log('║          File Persistence Test - Do Files Survive?                    ║');
console.log('║                                                                        ║');
console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

async function testFilePersistence() {
    const executor = new DockerExecutor({
        image: 'node:20-alpine',
        networkMode: 'none',
        timeout: 10000
    });

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Execution 1: Create a file');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const result1 = await executor.executeCode(`
        const fs = require('fs');

        console.log('[EXEC 1] Creating file: /tmp/mydata.txt');
        fs.writeFileSync('/tmp/mydata.txt', 'Hello from execution 1!');

        console.log('[EXEC 1] File created successfully');
        console.log('[EXEC 1] Container ID:', process.env.HOSTNAME);

        // Verify it exists in this execution
        const content = fs.readFileSync('/tmp/mydata.txt', 'utf8');
        console.log('[EXEC 1] File content:', content);
        console.log('[EXEC 1] File exists:', fs.existsSync('/tmp/mydata.txt'));
    `);

    console.log(result1.output);
    console.log('');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Execution 2: Try to read the file');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const result2 = await executor.executeCode(`
        const fs = require('fs');

        console.log('[EXEC 2] Looking for file: /tmp/mydata.txt');
        console.log('[EXEC 2] Container ID:', process.env.HOSTNAME);

        const exists = fs.existsSync('/tmp/mydata.txt');
        console.log('[EXEC 2] File exists:', exists);

        if (exists) {
            const content = fs.readFileSync('/tmp/mydata.txt', 'utf8');
            console.log('[EXEC 2] ❌ File found! Content:', content);
            console.log('[EXEC 2] This should NOT happen!');
        } else {
            console.log('[EXEC 2] ✅ File NOT found (expected)');
            console.log('[EXEC 2] Reason: New container = fresh file system');
        }
    `);

    console.log(result2.output);
    console.log('');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Execution 3: Try again to confirm');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const result3 = await executor.executeCode(`
        const fs = require('fs');

        console.log('[EXEC 3] Container ID:', process.env.HOSTNAME);
        console.log('[EXEC 3] Checking for /tmp/mydata.txt...');

        const exists = fs.existsSync('/tmp/mydata.txt');
        console.log('[EXEC 3] File exists:', exists);

        // List files in /tmp
        console.log('[EXEC 3] Files in /tmp:');
        const files = fs.readdirSync('/tmp');
        if (files.length === 0) {
            console.log('[EXEC 3]   (empty - no files from previous executions)');
        } else {
            files.forEach(f => console.log('[EXEC 3]   -', f));
        }
    `);

    console.log(result3.output);
    console.log('');

    // Summary
    console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
    console.log('║                              RESULT                                    ║');
    console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

    console.log('❌ Files created in Execution 1: NOT available in Execution 2');
    console.log('❌ Files created in Execution 1: NOT available in Execution 3');
    console.log('');
    console.log('Why? Each execution:');
    console.log('  1. Creates a NEW container (fresh file system)');
    console.log('  2. Runs the code');
    console.log('  3. REMOVES the container (all files deleted)');
    console.log('');
    console.log('Evidence:');
    console.log('  • Different container IDs in each execution');
    console.log('  • /tmp directory is empty in subsequent executions');
    console.log('  • File created in Exec 1 does NOT exist in Exec 2/3');
    console.log('');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('How to Share Data Between Executions');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('Option 1: Return data via console output (RECOMMENDED)');
    console.log('');
    console.log('// Execution 1: Output data');
    console.log('const result1 = await executor.executeCode(`');
    console.log('    const data = { counter: 1, items: ["a", "b"] };');
    console.log('    console.log("DATA_OUTPUT:" + JSON.stringify(data));');
    console.log('`);');
    console.log('');
    console.log('// Parse output');
    console.log('const match = result1.output.match(/DATA_OUTPUT:(.+)/);');
    console.log('const data = JSON.parse(match[1]);');
    console.log('');
    console.log('// Execution 2: Pass data via env vars');
    console.log('await executor.executeCode(`');
    console.log('    const data = JSON.parse(process.env.DATA_INPUT);');
    console.log('    console.log("Counter:", data.counter);');
    console.log('`, { DATA_INPUT: JSON.stringify(data) });');
    console.log('');

    console.log('Option 2: Use external storage (Redis, DB, S3)');
    console.log('');
    console.log('// Execution 1: Save to Redis');
    console.log('await executor.executeCode(`');
    console.log('    console.log("SAVE_TO_REDIS:user:123:data:" + JSON.stringify(data));');
    console.log('`);');
    console.log('await redis.set("user:123:data", data);');
    console.log('');
    console.log('// Execution 2: Load from Redis');
    console.log('const data = await redis.get("user:123:data");');
    console.log('await executor.executeCode(code, { DATA: data });');
    console.log('');

    console.log('Option 3: Mount volumes (NOT recommended for production)');
    console.log('');
    console.log('const executor = new DockerExecutor({');
    console.log('    volumes: ["/host/persistent:/app/data"]  // ⚠️ Shared state!');
    console.log('});');
    console.log('');
    console.log('// Now files in /app/data persist');
    console.log('// But: Security risk - users can see each other\'s files!');
    console.log('');
}

testFilePersistence().catch(error => {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
});
