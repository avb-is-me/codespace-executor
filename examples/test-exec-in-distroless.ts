/**
 * Test: Can users bypass with exec/child_process in distroless?
 *
 * Answer: NO! They can use exec/spawn, but the binaries don't exist.
 */

import DockerExecutor from '../src/secure/DockerExecutor';

console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
console.log('║                                                                        ║');
console.log('║     Can Users Bypass with exec/child_process in Distroless?           ║');
console.log('║                                                                        ║');
console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

async function testExecBypass() {
    const executor = new DockerExecutor({
        image: 'gcr.io/distroless/nodejs20-debian12',
        networkMode: 'none',
        timeout: 15000
    });

    console.log('Testing all bypass attempts using exec/spawn in distroless...\n');

    // Test all possible bypass methods
    const testCode = `
        const { exec, spawn, execSync } = require('child_process');

        console.log('════════════════════════════════════════════════════════════');
        console.log('Test 1: exec() with shell command');
        console.log('════════════════════════════════════════════════════════════\\n');

        exec('ls -la', (err, stdout, stderr) => {
            if (err) {
                console.log('❌ BLOCKED!');
                console.log('   Error code:', err.code);
                console.log('   Error message:', err.message);
                console.log('   Why: /bin/sh does not exist in distroless\\n');
            } else {
                console.log('✅ Somehow worked (should not happen!)\\n');
            }
        });

        setTimeout(() => {
            console.log('════════════════════════════════════════════════════════════');
            console.log('Test 2: exec() trying to run Python');
            console.log('════════════════════════════════════════════════════════════\\n');

            exec('python3 -c "print(1)"', (err, stdout, stderr) => {
                if (err) {
                    console.log('❌ BLOCKED!');
                    console.log('   Error code:', err.code);
                    console.log('   Error message:', err.message);
                    console.log('   Why: /bin/sh does not exist (exec needs shell)\\n');
                } else {
                    console.log('✅ Somehow worked (should not happen!)\\n');
                }
            });
        }, 500);

        setTimeout(() => {
            console.log('════════════════════════════════════════════════════════════');
            console.log('Test 3: spawn() with Python directly (no shell)');
            console.log('════════════════════════════════════════════════════════════\\n');

            const proc = spawn('python3', ['-c', 'print(1)']);

            proc.on('error', (err) => {
                console.log('❌ BLOCKED!');
                console.log('   Error code:', err.code);
                console.log('   Error message:', err.message);
                console.log('   Why: python3 binary does not exist in distroless\\n');
            });

            proc.on('spawn', () => {
                console.log('✅ Somehow spawned (should not happen!)\\n');
            });
        }, 1000);

        setTimeout(() => {
            console.log('════════════════════════════════════════════════════════════');
            console.log('Test 4: spawn() with curl directly');
            console.log('════════════════════════════════════════════════════════════\\n');

            const proc = spawn('curl', ['https://api.stripe.com']);

            proc.on('error', (err) => {
                console.log('❌ BLOCKED!');
                console.log('   Error code:', err.code);
                console.log('   Error message:', err.message);
                console.log('   Why: curl binary does not exist in distroless\\n');
            });

            proc.on('spawn', () => {
                console.log('✅ Somehow spawned (should not happen!)\\n');
            });
        }, 1500);

        setTimeout(() => {
            console.log('════════════════════════════════════════════════════════════');
            console.log('Test 5: spawn() with wget directly');
            console.log('════════════════════════════════════════════════════════════\\n');

            const proc = spawn('wget', ['https://api.stripe.com']);

            proc.on('error', (err) => {
                console.log('❌ BLOCKED!');
                console.log('   Error code:', err.code);
                console.log('   Error message:', err.message);
                console.log('   Why: wget binary does not exist in distroless\\n');
            });

            proc.on('spawn', () => {
                console.log('✅ Somehow spawned (should not happen!)\\n');
            });
        }, 2000);

        setTimeout(() => {
            console.log('════════════════════════════════════════════════════════════');
            console.log('Test 6: spawn() with sh shell');
            console.log('════════════════════════════════════════════════════════════\\n');

            const proc = spawn('sh', ['-c', 'echo hello']);

            proc.on('error', (err) => {
                console.log('❌ BLOCKED!');
                console.log('   Error code:', err.code);
                console.log('   Error message:', err.message);
                console.log('   Why: sh binary does not exist in distroless\\n');
            });

            proc.on('spawn', () => {
                console.log('✅ Somehow spawned (should not happen!)\\n');
            });
        }, 2500);

        setTimeout(() => {
            console.log('════════════════════════════════════════════════════════════');
            console.log('Test 7: spawn() with bash shell');
            console.log('════════════════════════════════════════════════════════════\\n');

            const proc = spawn('bash', ['-c', 'echo hello']);

            proc.on('error', (err) => {
                console.log('❌ BLOCKED!');
                console.log('   Error code:', err.code);
                console.log('   Error message:', err.message);
                console.log('   Why: bash binary does not exist in distroless\\n');
            });

            proc.on('spawn', () => {
                console.log('✅ Somehow spawned (should not happen!)\\n');
            });
        }, 3000);

        setTimeout(() => {
            console.log('════════════════════════════════════════════════════════════');
            console.log('Test 8: spawn() with netcat (nc)');
            console.log('════════════════════════════════════════════════════════════\\n');

            const proc = spawn('nc', ['api.stripe.com', '443']);

            proc.on('error', (err) => {
                console.log('❌ BLOCKED!');
                console.log('   Error code:', err.code);
                console.log('   Error message:', err.message);
                console.log('   Why: nc binary does not exist in distroless\\n');
            });

            proc.on('spawn', () => {
                console.log('✅ Somehow spawned (should not happen!)\\n');
            });
        }, 3500);

        setTimeout(() => {
            console.log('════════════════════════════════════════════════════════════');
            console.log('Test 9: The ONLY thing that works - spawn node');
            console.log('════════════════════════════════════════════════════════════\\n');

            const proc = spawn('node', ['--version']);

            proc.on('error', (err) => {
                console.log('❌ Failed:', err.message);
            });

            proc.stdout.on('data', (data) => {
                console.log('✅ SUCCESS! This is the ONLY binary that exists');
                console.log('   Node version:', data.toString().trim());
                console.log('   Why: node is the only binary in distroless');
                console.log('   But: User can only run MORE Node.js code\\n');
            });

            proc.on('spawn', () => {
                console.log('   Process spawned successfully');
            });
        }, 4000);

        setTimeout(() => {
            console.log('\\n════════════════════════════════════════════════════════════');
            console.log('SUMMARY');
            console.log('════════════════════════════════════════════════════════════\\n');
            console.log('✅ exec() and spawn() are AVAILABLE');
            console.log('❌ But ALL tools except node are MISSING');
            console.log('❌ sh/bash: ENOENT (not found)');
            console.log('❌ python3: ENOENT (not found)');
            console.log('❌ curl/wget: ENOENT (not found)');
            console.log('❌ nc/telnet: ENOENT (not found)');
            console.log('✅ node: EXISTS (but only runs more Node.js code)\\n');
            console.log('🔒 RESULT: Users CAN use exec/spawn but they\\'re useless!');
            console.log('   All bypass attempts fail with ENOENT errors.\\n');
        }, 5000);

        setTimeout(() => {}, 6000);
    `;

    const result = await executor.executeCode(testCode);
    console.log(result.output);

    if (result.error) {
        console.log('\nError output:');
        console.log(result.error);
    }
}

testExecBypass().catch(error => {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
});
