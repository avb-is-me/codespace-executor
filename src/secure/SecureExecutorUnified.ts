/**
 * SecureExecutorUnified - Unified interface for all execution modes
 *
 * This wrapper ensures ALL execution modes return the same format:
 * - spawn-based execution
 * - Docker execution (basic)
 * - Docker + Proxy execution
 * - Docker + Proxy + Policy execution
 *
 * All return: { success, data: { stdout, stderr, code, executionTime, networkLog?, ... } }
 */

import SecureExecutor from './SecureExecutor';
import DockerExecutorWithProxy from './DockerExecutorWithProxy';
import SecureExecutorWithPolicy from './SecureExecutorWithPolicy';
import { ExecutionPayload, ExecutionResult } from '../types';

export interface UnifiedExecutorOptions {
    // Execution mode
    mode?: 'spawn' | 'docker' | 'docker-proxy' | 'docker-policy';

    // SecureExecutor options
    timeout?: number;
    tempDir?: string;

    // Docker options
    dockerImage?: string;
    memoryLimit?: number;
    cpuLimit?: number;

    // Proxy options
    proxyPort?: number;
    logTraffic?: boolean;
    filterSensitiveHeaders?: boolean;

    // Policy options
    policy?: any;
    jwt?: string;
}

export default class SecureExecutorUnified {
    private executor: SecureExecutor | DockerExecutorWithProxy | SecureExecutorWithPolicy;
    private mode: string;

    constructor(options: UnifiedExecutorOptions = {}) {
        // Auto-detect mode from environment variables
        const dockerEnabled = process.env.DOCKER_EXECUTOR === 'true';
        const proxyEnabled = process.env.ENABLE_HTTP_PROXY === 'true';
        const policyEnabled = process.env.ENABLE_POLICY === 'true';

        // Override with explicit mode
        this.mode = options.mode || this.detectMode(dockerEnabled, proxyEnabled, policyEnabled);

        console.log(`[SecureExecutorUnified] Using mode: ${this.mode}`);

        // Create appropriate executor
        switch (this.mode) {
            case 'docker-policy':
                this.executor = new SecureExecutorWithPolicy({
                    image: options.dockerImage || process.env.DOCKER_IMAGE || 'gcr.io/distroless/nodejs20-debian12',
                    memoryLimit: options.memoryLimit,
                    cpuLimit: options.cpuLimit,
                    timeout: options.timeout || 30000,
                    proxyPort: options.proxyPort || parseInt(process.env.PROXY_PORT || '8888'),
                    logTraffic: options.logTraffic !== false,
                    filterSensitiveHeaders: options.filterSensitiveHeaders !== false,
                    policy: options.policy,
                    jwt: options.jwt
                });
                break;

            case 'docker-proxy':
                this.executor = new DockerExecutorWithProxy({
                    image: options.dockerImage || process.env.DOCKER_IMAGE || 'gcr.io/distroless/nodejs20-debian12',
                    memoryLimit: options.memoryLimit,
                    cpuLimit: options.cpuLimit,
                    timeout: options.timeout || 30000,
                    proxyPort: options.proxyPort || parseInt(process.env.PROXY_PORT || '8888'),
                    logTraffic: options.logTraffic !== false,
                    filterSensitiveHeaders: options.filterSensitiveHeaders !== false
                });
                break;

            case 'docker':
            case 'spawn':
            default:
                // SecureExecutor handles both spawn and basic Docker
                this.executor = new SecureExecutor({
                    timeout: options.timeout || 30000,
                    tempDir: options.tempDir
                });
                break;
        }
    }

    private detectMode(docker: boolean, proxy: boolean, policy: boolean): string {
        if (docker && policy) return 'docker-policy';
        if (docker && proxy) return 'docker-proxy';
        if (docker) return 'docker';
        return 'spawn';
    }

    /**
     * Execute code with unified output format
     * Always returns: { success, data: { stdout, stderr, code, executionTime, networkLog?, ... } }
     */
    async executeCode(
        payload: ExecutionPayload,
        headerEnvVars: Record<string, string> = {}
    ): Promise<ExecutionResult> {
        try {
            if (this.mode === 'docker-proxy' || this.mode === 'docker-policy') {
                // DockerExecutorWithProxy and SecureExecutorWithPolicy use different signature
                const code = payload.code || '';
                const result = await (this.executor as DockerExecutorWithProxy).executeCode(code, headerEnvVars);

                // Transform to unified format
                return this.normalizeProxyResult(result);
            } else {
                // SecureExecutor already returns correct format
                return await (this.executor as SecureExecutor).executeCode(payload, headerEnvVars);
            }
        } catch (error: any) {
            return {
                success: false,
                error: {
                    message: error.message || 'Execution failed',
                    type: error.name || 'Error',
                    code: error.code
                }
            };
        }
    }

    /**
     * Transform DockerExecutorWithProxy result to unified ExecutionResult format
     */
    private normalizeProxyResult(proxyResult: any): ExecutionResult {
        return {
            success: proxyResult.success,
            data: {
                stdout: proxyResult.output || '',       // output → stdout
                stderr: proxyResult.error || '',        // error → stderr
                code: proxyResult.exitCode,             // exitCode → code
                executionTime: proxyResult.executionTime,
                executionMode: this.mode,

                // Add network log if available
                ...(proxyResult.networkLog && proxyResult.networkLog.length > 0 && {
                    networkLog: proxyResult.networkLog
                }),

                // Add container info if available
                ...(proxyResult.containerInfo && {
                    dockerInfo: {
                        containerInfo: proxyResult.containerInfo,
                        networkIsolation: true
                    }
                })
            }
        };
    }

    /**
     * Get current execution mode
     */
    getMode(): string {
        return this.mode;
    }
}
