/**
 * DockerExecutor - Execute code in isolated Docker containers with network control
 *
 * Features:
 * - Complete network isolation (networkMode: 'none')
 * - Resource limits (CPU, memory)
 * - Security: read-only filesystem, dropped capabilities
 * - Blocks ALL bypass attempts (Python, curl, wget, etc.)
 */

import Docker from 'dockerode';
import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';

export interface DockerExecutorOptions {
    image?: string;
    networkMode?: 'none' | 'bridge' | string;
    memoryLimit?: number;  // in bytes
    cpuLimit?: number;     // in nanoseconds
    timeout?: number;      // in milliseconds
    tempDir?: string;
    readonlyRootfs?: boolean;
    autoRemove?: boolean;
}

export interface DockerExecutionResult {
    success: boolean;
    output: string;
    error: string;
    exitCode: number;
    executionTime: number;
    containerInfo?: {
        id: string;
        networkMode: string;
    };
}

export default class DockerExecutor {
    private docker: Docker;
    private options: Required<DockerExecutorOptions>;

    constructor(config: DockerExecutorOptions = {}) {
        this.docker = new Docker();

        this.options = {
            image: config.image || 'node:20-alpine',
            networkMode: config.networkMode || 'none',  // Default: NO network
            memoryLimit: config.memoryLimit || 512 * 1024 * 1024,  // 512MB
            cpuLimit: config.cpuLimit || 1000000000,  // 1 CPU
            timeout: config.timeout || 30000,  // 30 seconds
            tempDir: config.tempDir || path.join(process.cwd(), 'temp'),
            readonlyRootfs: config.readonlyRootfs !== false,
            autoRemove: config.autoRemove !== false
        };

        // Ensure temp directory exists
        if (!fs.existsSync(this.options.tempDir)) {
            fs.mkdirSync(this.options.tempDir, { recursive: true });
        }
    }

    /**
     * Execute code in an isolated Docker container
     */
    async executeCode(
        code: string,
        env: Record<string, string> = {}
    ): Promise<DockerExecutionResult> {
        const executionId = `exec_${Date.now()}_${randomBytes(4).toString('hex')}`;
        const workDir = path.join(this.options.tempDir, executionId);

        try {
            // Create isolated directory for this execution
            fs.mkdirSync(workDir, { recursive: true });
            fs.writeFileSync(path.join(workDir, 'code.js'), code);

            // Pull image if it doesn't exist
            await this.ensureImage();

            // Create and run container
            const result = await this.runContainer(workDir, env, executionId);

            return result;

        } catch (error: any) {
            return {
                success: false,
                output: '',
                error: error.message || 'Unknown error',
                exitCode: 1,
                executionTime: 0
            };

        } finally {
            // Cleanup
            if (fs.existsSync(workDir)) {
                fs.rmSync(workDir, { recursive: true, force: true });
            }
        }
    }

    /**
     * Ensure Docker image exists (pull if needed)
     */
    private async ensureImage(): Promise<void> {
        try {
            await this.docker.getImage(this.options.image).inspect();
        } catch (error: any) {
            if (error.statusCode === 404) {
                console.log(`[Docker] Pulling image ${this.options.image}...`);
                await this.pullImage();
            } else {
                throw error;
            }
        }
    }

    /**
     * Pull Docker image
     */
    private async pullImage(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.docker.pull(this.options.image, (err: any, stream: any) => {
                if (err) return reject(err);

                this.docker.modem.followProgress(stream, (err: any) => {
                    if (err) return reject(err);
                    console.log(`[Docker] Image ${this.options.image} pulled successfully`);
                    resolve();
                });
            });
        });
    }

    /**
     * Run code in Docker container
     */
    private async runContainer(
        workDir: string,
        env: Record<string, string>,
        executionId: string
    ): Promise<DockerExecutionResult> {
        const startTime = Date.now();

        // Prepare environment variables
        const containerEnv = Object.entries(env).map(([key, value]) => `${key}=${value}`);

        // Create container configuration
        const containerConfig: any = {
            Image: this.options.image,
            Cmd: ['node', '/code/code.js'],
            name: `code-executor-${executionId}`,
            Env: containerEnv,
            HostConfig: {
                // Network isolation
                NetworkMode: this.options.networkMode,

                // Resource limits
                Memory: this.options.memoryLimit,
                NanoCpus: this.options.cpuLimit,

                // Security
                ReadonlyRootfs: this.options.readonlyRootfs,
                AutoRemove: this.options.autoRemove,

                // Mount code directory (read-only)
                Binds: [`${workDir}:/code:ro`],

                // Drop all capabilities for security
                CapDrop: ['ALL']
            }
        };

        // Add tmpfs for /tmp since rootfs is read-only
        if (this.options.readonlyRootfs) {
            containerConfig.HostConfig.Tmpfs = {
                '/tmp': 'rw,noexec,nosuid,size=100m'
            };
        }

        const container = await this.docker.createContainer(containerConfig);

        try {
            // Start container
            await container.start();

            // Set timeout to kill container if it runs too long
            const timeoutHandle = setTimeout(async () => {
                try {
                    await container.kill();
                } catch (e) {
                    // Container might have already finished
                }
            }, this.options.timeout);

            // Wait for container to finish
            const statusCode = await container.wait();
            clearTimeout(timeoutHandle);

            // Get stdout and stderr
            const logs = await container.logs({
                stdout: true,
                stderr: true,
                follow: false
            });

            // Parse logs (Docker combines stdout/stderr with headers)
            const { stdout, stderr } = this.parseLogs(logs);

            const executionTime = Date.now() - startTime;

            return {
                success: (statusCode as any).StatusCode === 0,
                output: stdout,
                error: stderr,
                exitCode: (statusCode as any).StatusCode,
                executionTime,
                containerInfo: {
                    id: container.id,
                    networkMode: this.options.networkMode
                }
            };

        } catch (error: any) {
            // Try to remove container on error
            try {
                await container.remove({ force: true });
            } catch (e) {
                // Ignore cleanup errors
            }

            throw error;
        }
    }

    /**
     * Parse Docker logs (they have special headers)
     */
    private parseLogs(buffer: Buffer): { stdout: string; stderr: string } {
        let stdout = '';
        let stderr = '';
        let offset = 0;

        while (offset < buffer.length) {
            // Docker log format: [stream_type(1)][padding(3)][size(4)][payload(size)]
            const streamType = buffer[offset];
            const size = buffer.readUInt32BE(offset + 4);
            const payload = buffer.slice(offset + 8, offset + 8 + size).toString('utf8');

            if (streamType === 1) {
                stdout += payload;
            } else if (streamType === 2) {
                stderr += payload;
            }

            offset += 8 + size;
        }

        return { stdout, stderr };
    }

    /**
     * Check if Docker is available
     */
    async isAvailable(): Promise<boolean> {
        try {
            await this.docker.ping();
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Get Docker info
     */
    async getInfo(): Promise<any> {
        return this.docker.info();
    }
}
