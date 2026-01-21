/**
 * Example: HTTP/HTTPS Proxy with Request/Response Control
 * Works in Codespaces and Kubernetes
 */

const http = require('http');
const https = require('https');
const url = require('url');

class NetworkControlProxy {
  constructor(config = {}) {
    this.port = config.port || 8888;
    this.blockedDomains = config.blockedDomains || ['api.stripe.com', 'checkout.stripe.com'];
    this.allowedDomains = config.allowedDomains || null; // null = allow all except blocked
    this.logRequests = config.logRequests !== false;
    this.mockResponses = config.mockResponses || {};
    this.modifyResponses = config.modifyResponses || {};
  }

  start() {
    const server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });

    server.on('connect', (req, clientSocket, head) => {
      this.handleConnect(req, clientSocket, head);
    });

    server.listen(this.port, () => {
      console.log(`[PROXY] Listening on port ${this.port}`);
      console.log(`[PROXY] Set these environment variables in your code execution:`);
      console.log(`  HTTP_PROXY=http://localhost:${this.port}`);
      console.log(`  HTTPS_PROXY=http://localhost:${this.port}`);
    });

    return server;
  }

  handleRequest(clientReq, clientRes) {
    const targetUrl = url.parse(clientReq.url);
    const hostname = targetUrl.hostname;

    // Log the request
    if (this.logRequests) {
      console.log(`[PROXY] HTTP ${clientReq.method} ${clientReq.url}`);
    }

    // Check if domain is blocked
    if (this.isBlocked(hostname)) {
      console.log(`[PROXY] ❌ BLOCKED: ${hostname}`);
      clientRes.writeHead(403, { 'Content-Type': 'application/json' });
      clientRes.end(JSON.stringify({
        error: 'Network request blocked by policy',
        domain: hostname,
        reason: 'Domain is in blocklist'
      }));
      return;
    }

    // Check for mock responses
    if (this.mockResponses[hostname]) {
      console.log(`[PROXY] 🎭 MOCKED: ${hostname}`);
      const mockData = this.mockResponses[hostname];
      clientRes.writeHead(200, { 'Content-Type': 'application/json' });
      clientRes.end(JSON.stringify(mockData));
      return;
    }

    // Proxy the request
    const options = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || 80,
      path: targetUrl.path,
      method: clientReq.method,
      headers: clientReq.headers
    };

    const proxyReq = http.request(options, (proxyRes) => {
      let body = [];

      proxyRes.on('data', (chunk) => {
        body.push(chunk);
      });

      proxyRes.on('end', () => {
        body = Buffer.concat(body);

        // Control/modify the response
        const modifiedResponse = this.modifyResponse(
          hostname,
          proxyRes,
          body
        );

        clientRes.writeHead(modifiedResponse.statusCode, modifiedResponse.headers);
        clientRes.end(modifiedResponse.body);
      });
    });

    proxyReq.on('error', (err) => {
      console.error(`[PROXY] Error: ${err.message}`);
      clientRes.writeHead(502);
      clientRes.end('Proxy error');
    });

    clientReq.pipe(proxyReq);
  }

  handleConnect(req, clientSocket, head) {
    // HTTPS CONNECT method for SSL/TLS
    const { hostname, port } = url.parse(`https://${req.url}`);

    // Log the request
    if (this.logRequests) {
      console.log(`[PROXY] HTTPS CONNECT ${hostname}:${port}`);
    }

    // Check if domain is blocked
    if (this.isBlocked(hostname)) {
      console.log(`[PROXY] ❌ BLOCKED: ${hostname}`);
      clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      clientSocket.end();
      return;
    }

    // For HTTPS, we can't easily modify content without MITM,
    // but we can block/allow and log
    const serverSocket = require('net').connect(port || 443, hostname, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      serverSocket.write(head);
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });

    serverSocket.on('error', (err) => {
      console.error(`[PROXY] Error: ${err.message}`);
      clientSocket.end();
    });
  }

  isBlocked(hostname) {
    if (!hostname) return false;

    // Check allowlist first (if configured)
    if (this.allowedDomains) {
      return !this.allowedDomains.some(domain =>
        hostname === domain || hostname.endsWith(`.${domain}`)
      );
    }

    // Check blocklist
    return this.blockedDomains.some(domain =>
      hostname === domain || hostname.endsWith(`.${domain}`)
    );
  }

  modifyResponse(hostname, proxyRes, body) {
    let modifiedBody = body;
    let modifiedHeaders = { ...proxyRes.headers };

    // Check if we have a modifier for this domain
    const modifier = this.modifyResponses[hostname];
    if (modifier) {
      console.log(`[PROXY] 🔧 MODIFYING response from ${hostname}`);

      try {
        const bodyString = body.toString('utf-8');
        const bodyJson = JSON.parse(bodyString);

        // Apply modifications
        const modifiedJson = modifier(bodyJson, proxyRes.headers);
        modifiedBody = Buffer.from(JSON.stringify(modifiedJson));

        // Update Content-Length
        modifiedHeaders['content-length'] = modifiedBody.length;
      } catch (e) {
        // If not JSON or modification fails, return original
        console.warn(`[PROXY] Could not modify response: ${e.message}`);
      }
    }

    return {
      statusCode: proxyRes.statusCode,
      headers: modifiedHeaders,
      body: modifiedBody
    };
  }
}

// Example usage
if (require.main === module) {
  const proxy = new NetworkControlProxy({
    port: 8888,
    blockedDomains: [
      'api.stripe.com',
      'checkout.stripe.com',
      'js.stripe.com'
    ],
    logRequests: true,

    // Mock responses for specific domains
    mockResponses: {
      'api.stripe.com': {
        error: 'Stripe API calls are not allowed in this environment',
        mock: true
      }
    },

    // Modify responses from specific domains
    modifyResponses: {
      'api.example.com': (body, headers) => {
        // Redact sensitive fields
        if (body.creditCard) {
          body.creditCard = '****-****-****-' + body.creditCard.slice(-4);
        }

        // Add watermark
        body._proxy_modified = true;
        body._timestamp = new Date().toISOString();

        return body;
      }
    }
  });

  proxy.start();
}

module.exports = NetworkControlProxy;
