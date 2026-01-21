/**
 * Complete Integration Example
 *
 * This demonstrates integrating all three execution modes:
 * 1. Standard spawn (fast, no isolation)
 * 2. Docker with network isolation (secure, no visibility)
 * 3. Docker with HTTP proxy (secure + full visibility)
 *
 * Choose the mode based on your needs:
 * - Development: spawn (fastest)
 * - Production (untrusted code): Docker no network (most secure)
 * - Production (monitoring): Docker + proxy (secure + visible)
 */

import DockerExecutor from '../src/secure/DockerExecutor';
import DockerExecutorWithProxy from '../src/secure/DockerExecutorWithProxy';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';

interface ExecutionOptions {
    mode: 'spawn' | 'docker' | 'docker-proxy';
    code: string;
    env?: Record<string, string>;
    inspectNetwork?: boolean;
    onRequest?: any;
    onResponse?: any;
}

interface ExecutionResult {
    success: boolean;
    output: string;
    error: string;
    executionTime: number;
    networkLog?: any[];
    mode: string;
}

class UnifiedExecutor {
    private dockerExecutor: DockerExecutor;
    private dockerProxyExecutor: DockerExecutorWithProxy;
    private tempDir: string;

    constructor() {
        // Initialize Docker executor (no network)
        this.dockerExecutor = new DockerExecutor({
            networkMode: 'none',
            timeout: 30000
        });

        // Initialize Docker + Proxy executor (network + inspection)
        this.dockerProxyExecutor = new DockerExecutorWithProxy({
            proxyPort: 8888,
            timeout: 30000,
            logTraffic: true,
            captureResponses: true
        });

        this.tempDir = path.join(process.cwd(), 'temp');
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
    }

    /**
     * Execute code using the specified mode
     */
    async execute(options: ExecutionOptions): Promise<ExecutionResult> {
        const startTime = Date.now();

        try {
            switch (options.mode) {
                case 'spawn':
                    return await this.executeWithSpawn(options, startTime);

                case 'docker':
                    return await this.executeWithDocker(options, startTime);

                case 'docker-proxy':
                    return await this.executeWithDockerProxy(options, startTime);

                default:
                    throw new Error(`Unknown mode: ${options.mode}`);
            }
        } catch (error: any) {
            return {
                success: false,
                output: '',
                error: error.message,
                executionTime: Date.now() - startTime,
                mode: options.mode
            };
        }
    }

    /**
     * Mode 1: Standard spawn (fast, no isolation)
     */
    private async executeWithSpawn(
        options: ExecutionOptions,
        startTime: number
    ): Promise<ExecutionResult> {
        return new Promise((resolve) => {
            const tempFile = path.join(
                this.tempDir,
                `code_${randomBytes(8).toString('hex')}.js`
            );

            fs.writeFileSync(tempFile, options.code);

            const child = spawn('node', [tempFile], {
                env: options.env || {}
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            child.on('close', (code) => {
                fs.unlinkSync(tempFile);

                resolve({
                    success: code === 0,
                    output: stdout,
                    error: stderr,
                    executionTime: Date.now() - startTime,
                    mode: 'spawn'
                });
            });
        });
    }

    /**
     * Mode 2: Docker with network isolation (secure, no visibility)
     */
    private async executeWithDocker(
        options: ExecutionOptions,
        startTime: number
    ): Promise<ExecutionResult> {
        const result = await this.dockerExecutor.executeCode(
            options.code,
            options.env || {}
        );

        return {
            success: result.success,
            output: result.output,
            error: result.error,
            executionTime: Date.now() - startTime,
            mode: 'docker'
        };
    }

    /**
     * Mode 3: Docker with HTTP proxy (secure + visibility)
     */
    private async executeWithDockerProxy(
        options: ExecutionOptions,
        startTime: number
    ): Promise<ExecutionResult> {
        // Create new executor with custom hooks if provided
        const executor = options.onRequest || options.onResponse
            ? new DockerExecutorWithProxy({
                proxyPort: 8888 + Math.floor(Math.random() * 1000),
                logTraffic: true,
                captureResponses: true,
                onRequest: options.onRequest,
                onResponse: options.onResponse
            })
            : this.dockerProxyExecutor;

        const result = await executor.executeCode(
            options.code,
            options.env || {}
        );

        return {
            success: result.success,
            output: result.output,
            error: result.error,
            executionTime: Date.now() - startTime,
            networkLog: result.networkLog,
            mode: 'docker-proxy'
        };
    }
}

// ============================================================================
// Demo: All Three Modes
// ============================================================================

async function runDemo() {
    console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
    console.log('║                                                                        ║');
    console.log('║          Complete Integration Example - All Execution Modes           ║');
    console.log('║                                                                        ║');
    console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

    const executor = new UnifiedExecutor();

    const testCode = `
        console.log('[CODE] Starting execution...');
        console.log('[CODE] Node version:', process.version);
        console.log('[CODE] Has env var:', !!process.env.TEST_VAR);

        const https = require('https');
        console.log('[CODE] Attempting HTTPS request...');

        https.get('https://api.github.com', (res) => {
            console.log('[CODE] ✅ Request succeeded:', res.statusCode);
        }).on('error', (err) => {
            console.log('[CODE] ❌ Request failed:', err.code || err.message);
        });

        setTimeout(() => {}, 2000);
    `;

    // Test 1: Spawn mode
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Test 1: Spawn Mode (Fast, No Isolation)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const result1 = await executor.execute({
        mode: 'spawn',
        code: testCode,
        env: { TEST_VAR: 'value1' }
    });

    console.log('Output:');
    console.log(result1.output);
    console.log('Mode:', result1.mode);
    console.log('Time:', result1.executionTime + 'ms');
    console.log('Success:', result1.success);
    console.log('');

    // Test 2: Docker mode (network blocked)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Test 2: Docker Mode (Secure, Network Blocked)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const result2 = await executor.execute({
        mode: 'docker',
        code: testCode,
        env: { TEST_VAR: 'value2' }
    });

    console.log('Output:');
    console.log(result2.output);
    console.log('Mode:', result2.mode);
    console.log('Time:', result2.executionTime + 'ms');
    console.log('Success:', result2.success);
    console.log('');

    // Test 3: Docker + Proxy mode (network visible)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Test 3: Docker + Proxy Mode (Secure + Visible)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const result3 = await executor.execute({
        mode: 'docker-proxy',
        code: testCode,
        env: { TEST_VAR: 'value3' }
    });

    console.log('Output:');
    console.log(result3.output);
    console.log('Mode:', result3.mode);
    console.log('Time:', result3.executionTime + 'ms');
    console.log('Network Log:', result3.networkLog?.length, 'requests');
    if (result3.networkLog) {
        result3.networkLog.forEach(log => {
            console.log(`  - ${log.method} ${log.hostname} (blocked: ${log.blocked})`);
        });
    }
    console.log('');

    // Test 4: Docker + Proxy with modifications
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Test 4: Docker + Proxy with Custom Modifications');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const result4 = await executor.execute({
        mode: 'docker-proxy',
        code: `
            const https = require('https');

            https.get('https://api.github.com', (res) => {
                console.log('[CODE] Status:', res.statusCode);
                console.log('[CODE] Custom header:', res.headers['x-proxy-modified']);
            }).on('error', err => {
                console.log('[CODE] Error:', err.message);
            });

            setTimeout(() => {}, 2000);
        `,
        env: { TEST_VAR: 'value4' },
        onRequest: (req: any) => {
            console.log(`[HOOK] Request to ${req.hostname}`);
            return {
                modifiedHeaders: {
                    'User-Agent': 'Custom-Proxy-Agent'
                }
            };
        },
        onResponse: (res: any) => {
            console.log(`[HOOK] Response from ${res.hostname}: ${res.statusCode}`);
            return {
                headers: {
                    ...res.headers,
                    'x-proxy-modified': 'true'
                }
            };
        }
    });

    console.log('Output:');
    console.log(result4.output);
    console.log('');

    // Performance comparison
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Performance Comparison');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log(`Spawn:         ${result1.executionTime}ms`);
    console.log(`Docker:        ${result2.executionTime}ms`);
    console.log(`Docker+Proxy:  ${result3.executionTime}ms\n`);

    // Summary
    console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
    console.log('║                              SUMMARY                                   ║');
    console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

    console.log('Mode Comparison:\n');

    console.log('┌────────────────┬──────────┬───────────┬────────────────┐');
    console.log('│ Mode           │ Speed    │ Security  │ Visibility     │');
    console.log('├────────────────┼──────────┼───────────┼────────────────┤');
    console.log('│ Spawn          │ ⚡ Fast   │ ❌ None    │ ❌ None         │');
    console.log('│ Docker         │ 🐢 Slow   │ ✅ Full    │ ❌ None         │');
    console.log('│ Docker+Proxy   │ 🐢 Slow   │ ✅ Full    │ ✅ Full         │');
    console.log('└────────────────┴──────────┴───────────┴────────────────┘\n');

    console.log('When to use each mode:\n');

    console.log('✅ Spawn:');
    console.log('   • Development and testing');
    console.log('   • Trusted code only');
    console.log('   • Need maximum performance\n');

    console.log('✅ Docker (no network):');
    console.log('   • Production with untrusted code');
    console.log('   • Need maximum security');
    console.log('   • Don\'t need to monitor network activity\n');

    console.log('✅ Docker + Proxy:');
    console.log('   • Production with monitoring');
    console.log('   • Need to inspect/modify HTTP traffic');
    console.log('   • Audit trail required');
    console.log('   • Testing API integrations');
    console.log('   • Debugging network issues\n');

    console.log('💡 Environment variable control:\n');
    console.log('   DOCKER_EXECUTOR=false         → Use spawn');
    console.log('   DOCKER_EXECUTOR=true          → Use Docker (no network)');
    console.log('   DOCKER_PROXY_EXECUTOR=true    → Use Docker + Proxy\n');
}

runDemo().catch(error => {
    console.error('\n❌ Error:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
});
