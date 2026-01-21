/**
 * DockerExecutorWithProxy - Docker execution with HTTP proxy for traffic inspection
 *
 * Use case: Examine all HTTP requests/responses while maintaining Docker isolation
 *
 * How it works:
 * 1. Start HTTP proxy server on host
 * 2. Configure Docker container to use proxy
 * 3. Container uses networkMode='bridge' (not 'none')
 * 4. All HTTP traffic goes through proxy - visible and inspectable
 * 5. Proxy logs all requests/responses
 * 6. Can allow, block, or modify traffic
 */

import Docker from 'dockerode';
import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import http from 'http';
import url from 'url';

export interface ProxyLog {
    timestamp: string;
    method: string;
    url: string;
    hostname: string;
    statusCode?: number;
    requestHeaders: Record<string, any>;
    responseHeaders?: Record<string, any>;
    requestBody?: string;
    responseBody?: string;
    blocked: boolean;
    error?: string;
}

export type RequestModifier = (req: {
    method: string;
    url: string;
    hostname: string;
    headers: Record<string, any>;
}) => {
    block?: boolean;
    mockResponse?: {
        statusCode: number;
        headers?: Record<string, any>;
        body?: string;
    };
    modifiedHeaders?: Record<string, any>;
} | null;

export type ResponseModifier = (res: {
    method: string;
    url: string;
    hostname: string;
    statusCode: number;
    headers: Record<string, any>;
    body: Buffer;
}) => {
    statusCode?: number;
    headers?: Record<string, any>;
    body?: Buffer | string;
} | null;

export interface DockerProxyExecutorOptions {
    image?: string;
    memoryLimit?: number;
    cpuLimit?: number;
    timeout?: number;
    tempDir?: string;
    proxyPort?: number;  // Port for the proxy server
    blockedDomains?: string[];
    allowedDomains?: string[];  // If set, only these domains are allowed
    logTraffic?: boolean;
    captureResponses?: boolean;  // Capture full response bodies
    onRequest?: RequestModifier;  // Modify requests before sending
    onResponse?: ResponseModifier;  // Modify responses before returning
}

export interface DockerProxyExecutionResult {
    success: boolean;
    output: string;
    error: string;
    exitCode: number;
    executionTime: number;
    containerInfo?: {
        id: string;
        networkMode: string;
    };
    networkLog: ProxyLog[];  // All network requests made
}

export default class DockerExecutorWithProxy {
    private docker: Docker;
    private options: DockerProxyExecutorOptions & {
        image: string;
        memoryLimit: number;
        cpuLimit: number;
        timeout: number;
        tempDir: string;
        proxyPort: number;
        blockedDomains: string[];
        allowedDomains: string[];
        logTraffic: boolean;
        captureResponses: boolean;
    };
    private proxyServer: http.Server | null = null;
    private networkLog: ProxyLog[] = [];

    constructor(config: DockerProxyExecutorOptions = {}) {
        this.docker = new Docker();

        this.options = {
            image: config.image || 'node:20-alpine',
            memoryLimit: config.memoryLimit || 512 * 1024 * 1024,
            cpuLimit: config.cpuLimit || 1000000000,
            timeout: config.timeout || 30000,
            tempDir: config.tempDir || path.join(process.cwd(), 'temp'),
            proxyPort: config.proxyPort || 8888,
            blockedDomains: config.blockedDomains || [],
            allowedDomains: config.allowedDomains || [],
            logTraffic: config.logTraffic !== false,
            captureResponses: config.captureResponses || false,
            onRequest: config.onRequest,
            onResponse: config.onResponse
        };

        if (!fs.existsSync(this.options.tempDir)) {
            fs.mkdirSync(this.options.tempDir, { recursive: true });
        }
    }

    /**
     * Execute code in Docker with HTTP proxy for traffic inspection
     */
    async executeCode(
        code: string,
        env: Record<string, string> = {}
    ): Promise<DockerProxyExecutionResult> {
        this.networkLog = [];  // Reset log

        const executionId = `exec_${Date.now()}_${randomBytes(4).toString('hex')}`;
        const workDir = path.join(this.options.tempDir, executionId);

        try {
            // Start proxy server
            await this.startProxyServer();

            // Create work directory
            fs.mkdirSync(workDir, { recursive: true });
            fs.writeFileSync(path.join(workDir, 'code.js'), code);

            // Pull image if needed
            await this.ensureImage();

            // Execute in Docker with proxy
            const result = await this.runContainer(workDir, env, executionId);

            return {
                ...result,
                networkLog: this.networkLog
            };

        } catch (error: any) {
            return {
                success: false,
                output: '',
                error: error.message || 'Unknown error',
                exitCode: 1,
                executionTime: 0,
                networkLog: this.networkLog
            };

        } finally {
            // Stop proxy and cleanup
            await this.stopProxyServer();
            if (fs.existsSync(workDir)) {
                fs.rmSync(workDir, { recursive: true, force: true });
            }
        }
    }

    /**
     * Start HTTP proxy server on host
     */
    private async startProxyServer(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.proxyServer = http.createServer((req, res) => {
                this.handleRequest(req, res);
            });

            this.proxyServer.on('connect', (req, clientSocket, head) => {
                this.handleConnect(req, clientSocket, head);
            });

            this.proxyServer.listen(this.options.proxyPort, () => {
                console.log(`[Proxy] Listening on port ${this.options.proxyPort}`);
                resolve();
            });

            this.proxyServer.on('error', reject);
        });
    }

    /**
     * Stop proxy server
     */
    private async stopProxyServer(): Promise<void> {
        if (this.proxyServer) {
            return new Promise((resolve) => {
                this.proxyServer!.close(() => {
                    console.log('[Proxy] Stopped');
                    this.proxyServer = null;
                    resolve();
                });
            });
        }
    }

    /**
     * Handle HTTP request through proxy
     */
    private handleRequest(clientReq: http.IncomingMessage, clientRes: http.ServerResponse): void {
        const targetUrl = url.parse(clientReq.url!);
        const hostname = targetUrl.hostname!;

        const logEntry: ProxyLog = {
            timestamp: new Date().toISOString(),
            method: clientReq.method!,
            url: clientReq.url!,
            hostname,
            requestHeaders: { ...clientReq.headers },
            blocked: false
        };

        // Check if domain is blocked
        if (this.isDomainBlocked(hostname)) {
            console.log(`[Proxy] ❌ BLOCKED: ${hostname}`);
            logEntry.blocked = true;
            logEntry.error = 'Domain blocked by policy';
            this.networkLog.push(logEntry);

            clientRes.writeHead(403, { 'Content-Type': 'application/json' });
            clientRes.end(JSON.stringify({
                error: 'Domain blocked by policy',
                domain: hostname
            }));
            return;
        }

        // Call onRequest hook
        if (this.options.onRequest) {
            try {
                const modification = this.options.onRequest({
                    method: clientReq.method!,
                    url: clientReq.url!,
                    hostname,
                    headers: { ...clientReq.headers }
                });

                if (modification) {
                    // Check if request should be blocked
                    if (modification.block) {
                        console.log(`[Proxy] ❌ BLOCKED by onRequest hook: ${hostname}`);
                        logEntry.blocked = true;
                        logEntry.error = 'Request blocked by custom hook';
                        this.networkLog.push(logEntry);

                        clientRes.writeHead(403, { 'Content-Type': 'application/json' });
                        clientRes.end(JSON.stringify({
                            error: 'Request blocked by custom policy',
                            domain: hostname
                        }));
                        return;
                    }

                    // Check if we should return a mock response
                    if (modification.mockResponse) {
                        console.log(`[Proxy] 🎭 MOCK RESPONSE for: ${hostname}`);
                        logEntry.statusCode = modification.mockResponse.statusCode;
                        logEntry.responseHeaders = modification.mockResponse.headers || {};

                        if (this.options.captureResponses && modification.mockResponse.body) {
                            logEntry.responseBody = modification.mockResponse.body.substring(0, 1000);
                        }

                        this.networkLog.push(logEntry);

                        const headers = modification.mockResponse.headers || { 'Content-Type': 'application/json' };
                        clientRes.writeHead(modification.mockResponse.statusCode, headers);
                        clientRes.end(modification.mockResponse.body || '');
                        return;
                    }

                    // Modify request headers
                    if (modification.modifiedHeaders) {
                        Object.assign(clientReq.headers, modification.modifiedHeaders);
                        logEntry.requestHeaders = { ...clientReq.headers };
                    }
                }
            } catch (error: any) {
                console.error(`[Proxy] Error in onRequest hook: ${error.message}`);
            }
        }

        console.log(`[Proxy] ✅ ${clientReq.method} ${hostname}`);

        // Proxy the request
        const options = {
            hostname: targetUrl.hostname,
            port: targetUrl.port || 80,
            path: targetUrl.path,
            method: clientReq.method,
            headers: clientReq.headers
        };

        const proxyReq = http.request(options, (proxyRes) => {
            logEntry.statusCode = proxyRes.statusCode;
            logEntry.responseHeaders = { ...proxyRes.headers } as any;

            let body: Buffer[] = [];

            proxyRes.on('data', (chunk) => {
                body.push(chunk);
            });

            proxyRes.on('end', () => {
                let responseBody = Buffer.concat(body);
                let statusCode = proxyRes.statusCode!;
                let headers = { ...proxyRes.headers };

                // Call onResponse hook
                if (this.options.onResponse) {
                    try {
                        const modification = this.options.onResponse({
                            method: clientReq.method!,
                            url: clientReq.url!,
                            hostname,
                            statusCode,
                            headers: { ...headers },
                            body: responseBody
                        });

                        if (modification) {
                            // Modify status code
                            if (modification.statusCode !== undefined) {
                                statusCode = modification.statusCode;
                                console.log(`[Proxy] 🔧 Modified status code: ${proxyRes.statusCode} → ${statusCode}`);
                            }

                            // Modify headers
                            if (modification.headers) {
                                headers = modification.headers;
                                console.log(`[Proxy] 🔧 Modified response headers`);
                            }

                            // Modify body
                            if (modification.body !== undefined) {
                                responseBody = Buffer.isBuffer(modification.body)
                                    ? modification.body
                                    : Buffer.from(modification.body);
                                console.log(`[Proxy] 🔧 Modified response body`);
                            }
                        }
                    } catch (error: any) {
                        console.error(`[Proxy] Error in onResponse hook: ${error.message}`);
                    }
                }

                // Update log entry with final values
                logEntry.statusCode = statusCode;
                logEntry.responseHeaders = headers as any;

                // Log response if enabled
                if (this.options.captureResponses) {
                    try {
                        logEntry.responseBody = responseBody.toString('utf8').substring(0, 1000);
                    } catch (e) {
                        logEntry.responseBody = '[Binary data]';
                    }
                }

                this.networkLog.push(logEntry);

                // Send response to client
                clientRes.writeHead(statusCode, headers);
                clientRes.end(responseBody);
            });
        });

        proxyReq.on('error', (err) => {
            console.error(`[Proxy] Error: ${err.message}`);
            logEntry.error = err.message;
            this.networkLog.push(logEntry);

            clientRes.writeHead(502);
            clientRes.end('Proxy error');
        });

        clientReq.pipe(proxyReq);
    }

    /**
     * Handle HTTPS CONNECT requests
     */
    private handleConnect(req: http.IncomingMessage, clientSocket: any, head: Buffer): void {
        const { hostname, port } = url.parse(`https://${req.url}`);

        const logEntry: ProxyLog = {
            timestamp: new Date().toISOString(),
            method: 'CONNECT',
            url: req.url!,
            hostname: hostname!,
            requestHeaders: req.headers,
            blocked: false
        };

        // Check if blocked
        if (this.isDomainBlocked(hostname!)) {
            console.log(`[Proxy] ❌ BLOCKED HTTPS: ${hostname}`);
            logEntry.blocked = true;
            logEntry.error = 'Domain blocked by policy';
            this.networkLog.push(logEntry);

            clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            clientSocket.end();
            return;
        }

        console.log(`[Proxy] ✅ CONNECT ${hostname}`);
        this.networkLog.push(logEntry);

        // Tunnel HTTPS connection
        const serverSocket = require('net').connect(port || 443, hostname, () => {
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            serverSocket.write(head);
            serverSocket.pipe(clientSocket);
            clientSocket.pipe(serverSocket);
        });

        serverSocket.on('error', (err: Error) => {
            console.error(`[Proxy] HTTPS Error: ${err.message}`);
            clientSocket.end();
        });
    }

    /**
     * Check if domain should be blocked
     */
    private isDomainBlocked(hostname: string): boolean {
        if (!hostname) return false;

        // If allowlist is configured, only allow those domains
        if (this.options.allowedDomains.length > 0) {
            return !this.options.allowedDomains.some(domain =>
                hostname === domain || hostname.endsWith(`.${domain}`)
            );
        }

        // Check blocklist
        return this.options.blockedDomains.some(domain =>
            hostname === domain || hostname.endsWith(`.${domain}`)
        );
    }

    /**
     * Run container with proxy configuration
     */
    private async runContainer(
        workDir: string,
        env: Record<string, string>,
        executionId: string
    ): Promise<DockerProxyExecutionResult> {
        const startTime = Date.now();

        // Get host IP (for accessing proxy from container)
        const hostIP = this.getHostIP();

        // Add proxy environment variables
        const containerEnv = [
            ...Object.entries(env).map(([key, value]) => `${key}=${value}`),
            `HTTP_PROXY=http://${hostIP}:${this.options.proxyPort}`,
            `HTTPS_PROXY=http://${hostIP}:${this.options.proxyPort}`,
            `NO_PROXY=localhost,127.0.0.1`
        ];

        const container = await this.docker.createContainer({
            Image: this.options.image,
            Cmd: ['node', '/code/code.js'],
            name: `code-executor-proxy-${executionId}`,
            Env: containerEnv,
            HostConfig: {
                NetworkMode: 'bridge',  // NOT 'none' - we need network for proxy
                Memory: this.options.memoryLimit,
                NanoCpus: this.options.cpuLimit,
                AutoRemove: true,
                Binds: [`${workDir}:/code:ro`],
                CapDrop: ['ALL']
            }
        });

        try {
            await container.start();

            const timeoutHandle = setTimeout(async () => {
                try {
                    await container.kill();
                } catch (e) {
                    // Container might have already finished
                }
            }, this.options.timeout);

            const statusCode = await container.wait();
            clearTimeout(timeoutHandle);

            const logs = await container.logs({
                stdout: true,
                stderr: true,
                follow: false
            });

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
                    networkMode: 'bridge-with-proxy'
                },
                networkLog: []  // Will be added by caller
            };

        } catch (error: any) {
            try {
                await container.remove({ force: true });
            } catch (e) {
                // Ignore
            }
            throw error;
        }
    }

    /**
     * Get host IP address for proxy access from container
     */
    private getHostIP(): string {
        // On Linux/Docker for Mac: host.docker.internal
        // On Linux without Docker Desktop: 172.17.0.1 (default docker bridge)
        // We'll use host.docker.internal which works on most setups
        return 'host.docker.internal';
    }

    /**
     * Parse Docker logs
     */
    private parseLogs(buffer: Buffer): { stdout: string; stderr: string } {
        let stdout = '';
        let stderr = '';
        let offset = 0;

        while (offset < buffer.length) {
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
     * Ensure Docker image exists
     */
    private async ensureImage(): Promise<void> {
        try {
            await this.docker.getImage(this.options.image).inspect();
        } catch (error: any) {
            if (error.statusCode === 404) {
                console.log(`[Docker] Pulling image ${this.options.image}...`);
                await this.pullImage();
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
                    resolve();
                });
            });
        });
    }

    /**
     * Get network log
     */
    getNetworkLog(): ProxyLog[] {
        return this.networkLog;
    }
}
