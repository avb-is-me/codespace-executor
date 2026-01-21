/**
 * Example: Using Distroless Docker Images
 *
 * Distroless images contain ONLY the runtime (Node.js) and nothing else.
 * No shell, no Python, no curl, no package managers.
 *
 * Benefits:
 * - Smallest possible attack surface
 * - Can't execute shell commands
 * - Can't install new tools
 * - Only Node.js code can run
 */

import DockerExecutor from '../src/secure/DockerExecutor';

console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
console.log('║                                                                        ║');
console.log('║             Distroless Docker - Node.js Only Execution                ║');
console.log('║                                                                        ║');
console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

async function runTests() {
    // Distroless executor - ONLY Node.js
    const distrolessExecutor = new DockerExecutor({
        image: 'gcr.io/distroless/nodejs20-debian12',
        networkMode: 'none',
        timeout: 15000
    });

    // Regular Alpine executor - has shell and tools
    const alpineExecutor = new DockerExecutor({
        image: 'node:20-alpine',
        networkMode: 'none',
        timeout: 15000
    });

    // Test 1: Normal Node.js code (works in both)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Test 1: Normal Node.js Code');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const nodeCode = `
        console.log('[CODE] Node.js version:', process.version);
        console.log('[CODE] Platform:', process.platform);
        console.log('[CODE] Math.sqrt(16):', Math.sqrt(16));
    `;

    console.log('Distroless result:');
    const result1a = await distrolessExecutor.executeCode(nodeCode);
    console.log(result1a.output);

    console.log('\nAlpine result:');
    const result1b = await alpineExecutor.executeCode(nodeCode);
    console.log(result1b.output);

    // Test 2: Try to execute shell commands
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Test 2: Shell Command Execution');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const shellCode = `
        const { exec } = require('child_process');

        console.log('[CODE] Trying to execute shell command...');

        exec('ls -la', (err, stdout, stderr) => {
            if (err) {
                console.log('[CODE] ❌ Shell command failed:', err.code || err.message);
            } else {
                console.log('[CODE] ✅ Shell command succeeded (should not happen in distroless!)');
                console.log('[CODE] Output:', stdout.substring(0, 100));
            }
        });

        setTimeout(() => {}, 2000);
    `;

    console.log('Distroless result (no shell):');
    const result2a = await distrolessExecutor.executeCode(shellCode);
    console.log(result2a.output);
    if (result2a.error) {
        console.log('Error:', result2a.error.substring(0, 200));
    }

    console.log('\nAlpine result (has shell):');
    const result2b = await alpineExecutor.executeCode(shellCode);
    console.log(result2b.output);

    // Test 3: Try Python
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Test 3: Python Execution');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const pythonCode = `
        const { exec } = require('child_process');

        console.log('[CODE] Trying to execute Python...');

        exec('python3 --version', (err, stdout, stderr) => {
            if (err) {
                console.log('[CODE] ✅ Python not available:', err.code || err.message);
            } else {
                console.log('[CODE] ❌ Python is available (security risk!)');
                console.log('[CODE] Version:', stdout.trim());
            }
        });

        setTimeout(() => {}, 2000);
    `;

    console.log('Distroless result (no Python):');
    const result3a = await distrolessExecutor.executeCode(pythonCode);
    console.log(result3a.output);

    console.log('\nAlpine result (may have Python):');
    const result3b = await alpineExecutor.executeCode(pythonCode);
    console.log(result3b.output);

    // Test 4: Try curl
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Test 4: curl Command');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const curlCode = `
        const { exec } = require('child_process');

        console.log('[CODE] Trying to execute curl...');

        exec('curl --version', (err, stdout, stderr) => {
            if (err) {
                console.log('[CODE] ✅ curl not available:', err.code || err.message);
            } else {
                console.log('[CODE] ❌ curl is available (security risk!)');
                console.log('[CODE] Version:', stdout.substring(0, 50));
            }
        });

        setTimeout(() => {}, 2000);
    `;

    console.log('Distroless result (no curl):');
    const result4a = await distrolessExecutor.executeCode(curlCode);
    console.log(result4a.output);

    console.log('\nAlpine result (may have curl):');
    const result4b = await alpineExecutor.executeCode(curlCode);
    console.log(result4b.output);

    // Summary
    console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
    console.log('║                              SUMMARY                                   ║');
    console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

    console.log('Image Comparison:\n');

    console.log('┌─────────────────────┬─────────────────┬─────────────────┐');
    console.log('│ Feature             │ Distroless      │ Alpine          │');
    console.log('├─────────────────────┼─────────────────┼─────────────────┤');
    console.log('│ Node.js runtime     │ ✅ Yes          │ ✅ Yes          │');
    console.log('│ Shell (sh/bash)     │ ❌ No           │ ✅ Yes          │');
    console.log('│ Python              │ ❌ No           │ ⚠️ Maybe        │');
    console.log('│ curl/wget           │ ❌ No           │ ⚠️ Maybe        │');
    console.log('│ Package manager     │ ❌ No           │ ✅ Yes (apk)    │');
    console.log('│ Can install tools   │ ❌ No           │ ✅ Yes          │');
    console.log('│ Image size          │ ~50-80 MB       │ ~150 MB         │');
    console.log('│ Security level      │ ✅✅✅ Highest   │ ✅✅ High        │');
    console.log('└─────────────────────┴─────────────────┴─────────────────┘\n');

    console.log('✅ Distroless Benefits:');
    console.log('   • ONLY Node.js runtime - nothing else');
    console.log('   • No shell - can\'t run bash/sh commands');
    console.log('   • No Python, curl, wget, etc.');
    console.log('   • Can\'t install new packages');
    console.log('   • Smallest attack surface possible');
    console.log('   • Smaller image size\n');

    console.log('⚠️ Distroless Limitations:');
    console.log('   • Can\'t use shell commands in exec()');
    console.log('   • Can\'t use shell pipes/redirects');
    console.log('   • Harder to debug (no shell to exec into)');
    console.log('   • Must use direct binary execution\n');

    console.log('💡 Recommendation:');
    console.log('   • Production (untrusted code): Use distroless');
    console.log('   • Production (need shell): Use Alpine + network=none');
    console.log('   • Development: Use Alpine for easier debugging\n');
}

runTests().catch(error => {
    console.error('\n❌ Error:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
});
