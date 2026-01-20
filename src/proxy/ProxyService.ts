import http, { IncomingMessage, ServerResponse } from 'http';
import https from 'https';
import net from 'net';
import { Duplex } from 'stream';
import { URL } from 'url';
import { ProxyConfig, WhitelistConfig, ProxyRequestLog, ProxyStats } from '../types';

/**
 * HTTP/HTTPS Proxy Service with URL Whitelisting
 *
 * This proxy intercepts all outbound HTTP/HTTPS traffic from executed code
 * and validates URLs against a configurable whitelist of trusted domains.
 */
export default class ProxyService {
    private server: http.Server | null = null;
    private config: ProxyConfig;
    private stats: ProxyStats;
    private recentBlockedMax = 100;

    constructor(config?: Partial<ProxyConfig>) {
        this.config = this.buildConfig(config);
        this.stats = {
            totalRequests: 0,
            allowedRequests: 0,
            blockedRequests: 0,
            startedAt: new Date().toISOString(),
            recentBlocked: []
        };
    }

    /**
     * Build configuration with defaults
     */
    private buildConfig(config?: Partial<ProxyConfig>): ProxyConfig {
        const defaultWhitelist: WhitelistConfig = {
            domains: this.getDefaultWhitelist(),
            allowLocalhost: false,
            allowPrivateNetworks: false
        };

        return {
            enabled: config?.enabled ?? (process.env.PROXY_ENABLED === 'true'),
            host: config?.host ?? process.env.PROXY_HOST ?? '127.0.0.1',
            port: config?.port ?? parseInt(process.env.PROXY_PORT ?? '8888', 10),
            whitelist: config?.whitelist ?? defaultWhitelist,
            logBlocked: config?.logBlocked ?? true,
            logAllowed: config?.logAllowed ?? false
        };
    }

    /**
     * Get default whitelist from environment or use sensible defaults
     */
    private getDefaultWhitelist(): string[] {
        const envWhitelist = process.env.PROXY_WHITELIST;
        if (envWhitelist) {
            return envWhitelist.split(',').map(d => d.trim()).filter(d => d.length > 0);
        }

        // Default trusted domains - expand as needed
        return [
            // Common API providers
            'api.github.com',
            '*.github.com',
            'api.notion.com',
            '*.notion.com',
            'api.openai.com',
            '*.anthropic.com',
            'api.stripe.com',
            '*.googleapis.com',
            '*.google.com',
            // Keyboard.dev
            '*.keyboard.dev',
            'login.keyboard.dev',
            // CDNs and common services
            '*.cloudflare.com',
            '*.amazonaws.com',
            '*.azure.com'
        ];
    }

    /**
     * Start the proxy server
     */
    async start(): Promise<void> {
        if (!this.config.enabled) {
            console.log('Proxy service is disabled');
            return;
        }

        return new Promise((resolve, reject) => {
            this.server = http.createServer((req, res) => {
                this.handleHttpRequest(req, res);
            });

            // Handle HTTPS CONNECT method for tunneling
            this.server.on('connect', (req, clientSocket, head) => {
                this.handleConnectRequest(req, clientSocket, head);
            });

            this.server.on('error', (err) => {
                console.error('Proxy server error:', err);
                reject(err);
            });

            this.server.listen(this.config.port, this.config.host, () => {
                console.log(`Proxy server started on ${this.config.host}:${this.config.port}`);
                console.log(`Whitelist domains: ${this.config.whitelist.domains.length} patterns`);
                this.stats.startedAt = new Date().toISOString();
                resolve();
            });
        });
    }

    /**
     * Stop the proxy server
     */
    async stop(): Promise<void> {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    console.log('Proxy server stopped');
                    this.server = null;
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    /**
     * Handle regular HTTP requests
     */
    private handleHttpRequest(clientReq: IncomingMessage, clientRes: ServerResponse): void {
        this.stats.totalRequests++;

        const url = clientReq.url || '';
        let targetUrl: URL;

        try {
            targetUrl = new URL(url);
        } catch (err) {
            this.sendBlockedResponse(clientRes, 'Invalid URL');
            return;
        }

        const host = targetUrl.hostname;
        const validation = this.validateHost(host);

        if (!validation.allowed) {
            this.logRequest({
                timestamp: new Date().toISOString(),
                method: clientReq.method || 'UNKNOWN',
                url: url,
                host: host,
                allowed: false,
                reason: validation.reason
            });
            this.stats.blockedRequests++;
            this.sendBlockedResponse(clientRes, validation.reason || 'Host not in whitelist');
            return;
        }

        this.stats.allowedRequests++;
        if (this.config.logAllowed) {
            this.logRequest({
                timestamp: new Date().toISOString(),
                method: clientReq.method || 'UNKNOWN',
                url: url,
                host: host,
                allowed: true
            });
        }

        // Forward the request
        this.forwardHttpRequest(clientReq, clientRes, targetUrl);
    }

    /**
     * Handle HTTPS CONNECT requests (tunneling)
     */
    private handleConnectRequest(req: IncomingMessage, clientSocket: Duplex, head: Buffer): void {
        this.stats.totalRequests++;

        const [host, portStr] = (req.url || '').split(':');
        const port = parseInt(portStr, 10) || 443;

        const validation = this.validateHost(host);

        if (!validation.allowed) {
            this.logRequest({
                timestamp: new Date().toISOString(),
                method: 'CONNECT',
                url: req.url || '',
                host: host,
                allowed: false,
                reason: validation.reason
            });
            this.stats.blockedRequests++;

            clientSocket.write('HTTP/1.1 403 Forbidden\r\n');
            clientSocket.write('Content-Type: text/plain\r\n');
            clientSocket.write('\r\n');
            clientSocket.write(`Blocked: ${validation.reason || 'Host not in whitelist'}`);
            clientSocket.end();
            return;
        }

        this.stats.allowedRequests++;
        if (this.config.logAllowed) {
            this.logRequest({
                timestamp: new Date().toISOString(),
                method: 'CONNECT',
                url: req.url || '',
                host: host,
                allowed: true
            });
        }

        // Create tunnel to target server
        const serverSocket = net.connect(port, host, () => {
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            serverSocket.write(head);
            serverSocket.pipe(clientSocket);
            clientSocket.pipe(serverSocket);
        });

        serverSocket.on('error', (err) => {
            console.error(`Proxy tunnel error to ${host}:${port}:`, err.message);
            clientSocket.end();
        });

        clientSocket.on('error', (err) => {
            console.error('Client socket error:', err.message);
            serverSocket.end();
        });
    }

    /**
     * Forward HTTP request to target
     */
    private forwardHttpRequest(clientReq: IncomingMessage, clientRes: ServerResponse, targetUrl: URL): void {
        const isHttps = targetUrl.protocol === 'https:';
        const client = isHttps ? https : http;

        const options: http.RequestOptions = {
            hostname: targetUrl.hostname,
            port: targetUrl.port || (isHttps ? 443 : 80),
            path: targetUrl.pathname + targetUrl.search,
            method: clientReq.method,
            headers: { ...clientReq.headers }
        };

        // Remove proxy-specific headers
        delete options.headers!['proxy-connection'];

        const proxyReq = client.request(options, (proxyRes) => {
            clientRes.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
            proxyRes.pipe(clientRes);
        });

        proxyReq.on('error', (err) => {
            console.error('Proxy request error:', err.message);
            clientRes.writeHead(502, { 'Content-Type': 'text/plain' });
            clientRes.end('Bad Gateway: ' + err.message);
        });

        clientReq.pipe(proxyReq);
    }

    /**
     * Validate if a host is allowed by the whitelist
     */
    validateHost(host: string): { allowed: boolean; reason?: string } {
        if (!host) {
            return { allowed: false, reason: 'Empty host' };
        }

        const normalizedHost = host.toLowerCase().trim();

        // Check localhost
        if (this.isLocalhost(normalizedHost)) {
            if (this.config.whitelist.allowLocalhost) {
                return { allowed: true };
            }
            return { allowed: false, reason: 'Localhost not allowed' };
        }

        // Check private networks
        if (this.isPrivateNetwork(normalizedHost)) {
            if (this.config.whitelist.allowPrivateNetworks) {
                return { allowed: true };
            }
            return { allowed: false, reason: 'Private network not allowed' };
        }

        // Check against whitelist patterns
        for (const pattern of this.config.whitelist.domains) {
            if (this.matchDomainPattern(normalizedHost, pattern.toLowerCase())) {
                return { allowed: true };
            }
        }

        return { allowed: false, reason: `Host '${host}' not in whitelist` };
    }

    /**
     * Check if host is localhost
     */
    private isLocalhost(host: string): boolean {
        return host === 'localhost' ||
               host === '127.0.0.1' ||
               host === '::1' ||
               host.endsWith('.localhost');
    }

    /**
     * Check if host is a private network address
     */
    private isPrivateNetwork(host: string): boolean {
        // Check common private IP ranges
        const privatePatterns = [
            /^10\./,
            /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
            /^192\.168\./,
            /^169\.254\./,
            /^fc00:/i,
            /^fd00:/i,
            /^fe80:/i
        ];

        return privatePatterns.some(pattern => pattern.test(host));
    }

    /**
     * Match host against a domain pattern
     * Supports wildcards like *.github.com
     */
    private matchDomainPattern(host: string, pattern: string): boolean {
        // Exact match
        if (host === pattern) {
            return true;
        }

        // Wildcard pattern (e.g., *.github.com)
        if (pattern.startsWith('*.')) {
            const suffix = pattern.slice(1); // .github.com
            return host.endsWith(suffix) || host === pattern.slice(2);
        }

        return false;
    }

    /**
     * Send blocked response to client
     */
    private sendBlockedResponse(res: ServerResponse, reason: string): void {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: 'Blocked by proxy',
            reason: reason,
            message: 'This URL is not in the allowed whitelist'
        }));
    }

    /**
     * Log a request
     */
    private logRequest(log: ProxyRequestLog): void {
        if (!log.allowed && this.config.logBlocked) {
            console.log(`[PROXY BLOCKED] ${log.method} ${log.host} - ${log.reason}`);

            // Keep track of recent blocked requests
            this.stats.recentBlocked.push(log);
            if (this.stats.recentBlocked.length > this.recentBlockedMax) {
                this.stats.recentBlocked.shift();
            }
        }

        if (log.allowed && this.config.logAllowed) {
            console.log(`[PROXY ALLOWED] ${log.method} ${log.host}`);
        }
    }

    /**
     * Get proxy statistics
     */
    getStats(): ProxyStats {
        return { ...this.stats };
    }

    /**
     * Get current configuration
     */
    getConfig(): ProxyConfig {
        return { ...this.config };
    }

    /**
     * Update whitelist dynamically
     */
    updateWhitelist(domains: string[]): void {
        this.config.whitelist.domains = domains;
        console.log(`Whitelist updated: ${domains.length} domains`);
    }

    /**
     * Add domains to whitelist
     */
    addToWhitelist(domains: string[]): void {
        const newDomains = domains.filter(d => !this.config.whitelist.domains.includes(d));
        this.config.whitelist.domains.push(...newDomains);
        console.log(`Added ${newDomains.length} domains to whitelist`);
    }

    /**
     * Remove domains from whitelist
     */
    removeFromWhitelist(domains: string[]): void {
        this.config.whitelist.domains = this.config.whitelist.domains.filter(
            d => !domains.includes(d)
        );
        console.log(`Removed ${domains.length} domains from whitelist`);
    }

    /**
     * Check if proxy is running
     */
    isRunning(): boolean {
        return this.server !== null && this.server.listening;
    }

    /**
     * Get proxy URL for environment variables
     */
    getProxyUrl(): string {
        return `http://${this.config.host}:${this.config.port}`;
    }

    /**
     * Get environment variables to pass to child processes
     */
    getProxyEnvVars(): Record<string, string> {
        if (!this.config.enabled || !this.isRunning()) {
            return {};
        }

        const proxyUrl = this.getProxyUrl();
        return {
            HTTP_PROXY: proxyUrl,
            HTTPS_PROXY: proxyUrl,
            http_proxy: proxyUrl,
            https_proxy: proxyUrl,
            // Don't proxy localhost by default
            NO_PROXY: 'localhost,127.0.0.1,::1',
            no_proxy: 'localhost,127.0.0.1,::1'
        };
    }
}
