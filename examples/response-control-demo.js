/**
 * Demo: Advanced Response Control with HTTP Proxy
 * Shows how to intercept, log, modify, and mock responses
 */

const NetworkControlProxy = require('./network-proxy-example');

// Example 1: Redact sensitive data from responses
const redactSensitiveDataProxy = new NetworkControlProxy({
  port: 8888,
  logRequests: true,
  modifyResponses: {
    'api.example.com': (body, headers) => {
      console.log('[MODIFIER] Redacting sensitive data...');

      // Redact credit card numbers
      if (body.payment && body.payment.card) {
        body.payment.card.number = body.payment.card.number.replace(
          /^(\d{4})\d+(\d{4})$/,
          '$1********$2'
        );
        body.payment.card.cvv = '***';
      }

      // Redact API keys
      if (body.apiKey) {
        body.apiKey = body.apiKey.substring(0, 8) + '...';
      }

      // Redact email addresses partially
      if (body.email) {
        body.email = body.email.replace(
          /^(.{2}).*(@.*)$/,
          '$1***$2'
        );
      }

      // Add modification timestamp
      body._redacted = true;
      body._redactedAt = new Date().toISOString();

      return body;
    },

    // Redact tokens from authentication responses
    'auth.example.com': (body, headers) => {
      if (body.accessToken) {
        const original = body.accessToken;
        body.accessToken = original.substring(0, 10) + '...[REDACTED]';
        console.log(`[REDACTED] Access token: ${original} -> ${body.accessToken}`);
      }

      if (body.refreshToken) {
        body.refreshToken = '[REDACTED]';
      }

      return body;
    }
  }
});

// Example 2: Inject rate limit information
const rateLimitProxy = new NetworkControlProxy({
  port: 8889,
  logRequests: true,
  modifyResponses: {
    'api.github.com': (body, headers) => {
      // Add rate limit info to every response
      body._rateLimit = {
        remaining: headers['x-ratelimit-remaining'] || 'unknown',
        limit: headers['x-ratelimit-limit'] || 'unknown',
        reset: headers['x-ratelimit-reset'] || 'unknown'
      };

      // Log rate limit warnings
      const remaining = parseInt(headers['x-ratelimit-remaining']);
      if (remaining < 10) {
        console.warn(`[RATE LIMIT] Only ${remaining} requests remaining!`);
        body._rateLimitWarning = `Only ${remaining} requests remaining`;
      }

      return body;
    }
  }
});

// Example 3: Mock external services entirely
const mockServiceProxy = new NetworkControlProxy({
  port: 8890,
  blockedDomains: [],
  mockResponses: {
    // Mock Stripe API
    'api.stripe.com': {
      object: 'customer',
      id: 'cus_mock123',
      email: 'test@example.com',
      created: Math.floor(Date.now() / 1000),
      _mock: true,
      _message: 'This is a mocked Stripe response for testing'
    },

    // Mock AWS S3
    's3.amazonaws.com': {
      url: 'https://mock-bucket.s3.amazonaws.com/mock-file.txt',
      _mock: true,
      _message: 'S3 upload mocked - no actual upload performed'
    },

    // Mock payment gateway
    'api.paymentgateway.com': (req) => {
      // Dynamic mock based on request
      return {
        status: 'success',
        transactionId: 'mock_' + Date.now(),
        amount: 100.00,
        currency: 'USD',
        _mock: true
      };
    }
  }
});

// Example 4: Response validation and sanitization
const validationProxy = new NetworkControlProxy({
  port: 8891,
  logRequests: true,
  modifyResponses: {
    '*': (body, headers) => {
      // Apply to all domains
      console.log('[VALIDATOR] Validating response...');

      // Remove any script tags from responses
      if (typeof body === 'string') {
        body = body.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
      }

      // Ensure no sensitive patterns in response
      const sensitivePatterns = [
        /sk_live_[a-zA-Z0-9]+/g,  // Stripe secret keys
        /pk_live_[a-zA-Z0-9]+/g,  // Stripe public keys
        /AKIA[0-9A-Z]{16}/g,      // AWS access keys
        /-----BEGIN PRIVATE KEY-----/g
      ];

      let bodyStr = JSON.stringify(body);
      sensitivePatterns.forEach(pattern => {
        if (pattern.test(bodyStr)) {
          console.error('[VALIDATOR] ⚠️  Sensitive data detected in response!');
          bodyStr = bodyStr.replace(pattern, '[REDACTED_SENSITIVE_DATA]');
        }
      });

      return JSON.parse(bodyStr);
    }
  }
});

// Example 5: Request/Response logging for audit
class AuditProxy extends NetworkControlProxy {
  constructor(config) {
    super(config);
    this.auditLog = [];
  }

  handleRequest(clientReq, clientRes) {
    const startTime = Date.now();
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const auditEntry = {
      requestId,
      timestamp: new Date().toISOString(),
      method: clientReq.method,
      url: clientReq.url,
      headers: { ...clientReq.headers },
      startTime
    };

    // Capture request body if present
    let requestBody = [];
    clientReq.on('data', chunk => requestBody.push(chunk));
    clientReq.on('end', () => {
      auditEntry.requestBody = Buffer.concat(requestBody).toString();
    });

    // Wrap the response to capture it
    const originalWrite = clientRes.write;
    const originalEnd = clientRes.end;
    let responseBody = [];

    clientRes.write = function(chunk, ...args) {
      responseBody.push(Buffer.from(chunk));
      return originalWrite.call(this, chunk, ...args);
    };

    clientRes.end = function(chunk, ...args) {
      if (chunk) responseBody.push(Buffer.from(chunk));

      auditEntry.responseBody = Buffer.concat(responseBody).toString();
      auditEntry.statusCode = clientRes.statusCode;
      auditEntry.duration = Date.now() - startTime;
      auditEntry.endTime = Date.now();

      this.auditLog.push(auditEntry);

      // Write to audit log file
      console.log(`[AUDIT] ${requestId} ${clientReq.method} ${clientReq.url} - ${clientRes.statusCode} (${auditEntry.duration}ms)`);

      return originalEnd.call(this, chunk, ...args);
    }.bind(this);

    // Call parent implementation
    super.handleRequest(clientReq, clientRes);
  }

  getAuditLog() {
    return this.auditLog;
  }

  exportAuditLog(filename) {
    const fs = require('fs');
    fs.writeFileSync(filename, JSON.stringify(this.auditLog, null, 2));
    console.log(`[AUDIT] Exported ${this.auditLog.length} entries to ${filename}`);
  }
}

// Example usage
if (require.main === module) {
  console.log('Starting demo proxies...\n');

  // Start different proxy examples on different ports
  redactSensitiveDataProxy.start();
  console.log('  → Redaction proxy on port 8888\n');

  rateLimitProxy.start();
  console.log('  → Rate limit proxy on port 8889\n');

  mockServiceProxy.start();
  console.log('  → Mock service proxy on port 8890\n');

  validationProxy.start();
  console.log('  → Validation proxy on port 8891\n');

  const auditProxy = new AuditProxy({
    port: 8892,
    logRequests: true
  });
  auditProxy.start();
  console.log('  → Audit proxy on port 8892\n');

  // Example: Export audit log after 1 minute
  setTimeout(() => {
    auditProxy.exportAuditLog('./audit-log.json');
  }, 60000);

  console.log('\nTo use these proxies, set environment variables:');
  console.log('  HTTP_PROXY=http://localhost:8888');
  console.log('  HTTPS_PROXY=http://localhost:8888');
  console.log('\nOr use different ports for different behaviors');
}

module.exports = {
  NetworkControlProxy,
  AuditProxy
};
