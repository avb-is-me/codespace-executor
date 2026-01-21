# HTTP Proxy Modification Guide

## Overview

The `DockerExecutorWithProxy` now supports **complete control** over HTTP requests and responses:

- ✅ Modify request headers (inject auth, add tokens, etc.)
- ✅ Modify response headers (add metadata, custom headers)
- ✅ Modify response bodies (inject data, transform JSON)
- ✅ Change status codes (convert errors to success)
- ✅ Block requests with custom logic
- ✅ Return mock responses without hitting real APIs

---

## Quick Start

```typescript
import DockerExecutorWithProxy from './src/secure/DockerExecutorWithProxy';

const executor = new DockerExecutorWithProxy({
    proxyPort: 8888,
    logTraffic: true,
    captureResponses: true,

    // Modify requests before sending
    onRequest: (req) => {
        return {
            modifiedHeaders: {
                'Authorization': 'Bearer token123'
            }
        };
    },

    // Modify responses before returning
    onResponse: (res) => {
        return {
            headers: {
                ...res.headers,
                'X-Modified': 'true'
            }
        };
    }
});

const result = await executor.executeCode(userCode, envVars);
console.log(result.networkLog);  // See all requests/responses
```

---

## onRequest Hook

The `onRequest` hook is called **before** each request is sent to the target server.

### Signature

```typescript
type RequestModifier = (req: {
    method: string;           // HTTP method (GET, POST, etc.)
    url: string;             // Full URL
    hostname: string;        // Hostname being requested
    headers: Record<string, any>;  // Request headers
}) => {
    block?: boolean;         // Block the request
    mockResponse?: {         // Return mock response
        statusCode: number;
        headers?: Record<string, any>;
        body?: string;
    };
    modifiedHeaders?: Record<string, any>;  // Modify headers
} | null;  // Return null to allow request unchanged
```

### Examples

#### 1. Inject Authorization Headers

```typescript
const executor = new DockerExecutorWithProxy({
    onRequest: (req) => {
        // Automatically inject auth for specific APIs
        if (req.hostname === 'api.stripe.com') {
            return {
                modifiedHeaders: {
                    'Authorization': `Bearer ${process.env.STRIPE_KEY}`,
                    'X-Injected-By': 'proxy'
                }
            };
        }
        return null;
    }
});
```

User's code doesn't need to know the API key:
```javascript
// User's code - no auth header needed!
https.request({
    hostname: 'api.stripe.com',
    path: '/v1/customers'
}, (res) => {
    // Proxy injected the Authorization header automatically
});
```

---

#### 2. Block Requests Based on Custom Logic

```typescript
const executor = new DockerExecutorWithProxy({
    onRequest: (req) => {
        // Block all POST/PUT/DELETE requests
        if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
            return { block: true };
        }

        // Block requests to specific domains
        if (req.hostname.includes('dangerous.com')) {
            return { block: true };
        }

        // Block requests with suspicious patterns
        if (req.url.includes('../../')) {
            return { block: true };
        }

        return null;
    }
});
```

---

#### 3. Mock API Responses (No Real Calls)

```typescript
const executor = new DockerExecutorWithProxy({
    onRequest: (req) => {
        // Mock Stripe API
        if (req.hostname === 'api.stripe.com' && req.method === 'POST') {
            return {
                mockResponse: {
                    statusCode: 200,
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Mock': 'true'
                    },
                    body: JSON.stringify({
                        id: 'cus_mock_12345',
                        email: 'test@example.com',
                        created: Date.now(),
                        _mock: true
                    })
                }
            };
        }

        // Mock GitHub API
        if (req.hostname === 'api.github.com') {
            return {
                mockResponse: {
                    statusCode: 200,
                    body: JSON.stringify({
                        user: 'mock_user',
                        repos: []
                    })
                }
            };
        }

        return null;
    }
});
```

**Use case:** Test user code without hitting real APIs

---

#### 4. Rate Limiting

```typescript
const requestCounts = new Map<string, number>();

const executor = new DockerExecutorWithProxy({
    onRequest: (req) => {
        // Track requests per domain
        const count = (requestCounts.get(req.hostname) || 0) + 1;
        requestCounts.set(req.hostname, count);

        // Block after 10 requests
        if (count > 10) {
            return {
                mockResponse: {
                    statusCode: 429,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        error: 'Rate limit exceeded',
                        limit: 10
                    })
                }
            };
        }

        return null;
    }
});
```

---

#### 5. Request Logging and Audit Trail

```typescript
const auditLog: any[] = [];

const executor = new DockerExecutorWithProxy({
    onRequest: (req) => {
        // Log all requests for audit
        auditLog.push({
            timestamp: new Date(),
            method: req.method,
            url: req.url,
            hostname: req.hostname,
            headers: req.headers
        });

        // Check if auth header is present
        if (!req.headers['authorization']) {
            console.warn('⚠️ Request without auth:', req.hostname);
        }

        return null;  // Allow request
    }
});

// Later: analyze audit log
console.log('Total requests:', auditLog.length);
console.log('Unique domains:', new Set(auditLog.map(r => r.hostname)).size);
```

---

## onResponse Hook

The `onResponse` hook is called **after** receiving the response from the target server, **before** sending it to the container.

### Signature

```typescript
type ResponseModifier = (res: {
    method: string;              // HTTP method
    url: string;                 // Full URL
    hostname: string;            // Hostname
    statusCode: number;          // Response status code
    headers: Record<string, any>;  // Response headers
    body: Buffer;                // Response body (raw bytes)
}) => {
    statusCode?: number;         // Override status code
    headers?: Record<string, any>;  // Override headers
    body?: Buffer | string;      // Override body
} | null;  // Return null to pass response unchanged
```

### Examples

#### 1. Add Custom Headers to Responses

```typescript
const executor = new DockerExecutorWithProxy({
    onResponse: (res) => {
        return {
            headers: {
                ...res.headers,
                'X-Proxy-Modified': 'true',
                'X-Original-Status': String(res.statusCode),
                'X-Response-Time': new Date().toISOString(),
                'X-Response-From': res.hostname
            }
        };
    }
});
```

---

#### 2. Inject Data into JSON Responses

```typescript
const executor = new DockerExecutorWithProxy({
    onResponse: (res) => {
        // Only modify JSON responses
        if (res.headers['content-type']?.includes('application/json')) {
            try {
                const originalData = JSON.parse(res.body.toString());

                // Inject metadata
                const modifiedData = {
                    ...originalData,
                    _metadata: {
                        proxy_modified: true,
                        original_status: res.statusCode,
                        fetched_at: new Date().toISOString(),
                        source: res.hostname
                    }
                };

                return {
                    body: JSON.stringify(modifiedData),
                    headers: {
                        ...res.headers,
                        'content-length': undefined  // Recalculate
                    }
                };
            } catch (e) {
                // Not valid JSON, skip
            }
        }
        return null;
    }
});
```

**Result:** User code gets extra metadata in API responses automatically!

---

#### 3. Convert Errors to Success (Testing)

```typescript
const executor = new DockerExecutorWithProxy({
    onResponse: (res) => {
        // Convert all 4xx/5xx errors to 200 OK
        if (res.statusCode >= 400) {
            console.log(`Converting ${res.statusCode} error to 200 OK`);

            return {
                statusCode: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Original-Status': String(res.statusCode),
                    'X-Error-Converted': 'true'
                },
                body: JSON.stringify({
                    success: true,
                    message: 'Error converted to success for testing',
                    original_status: res.statusCode,
                    original_error: res.body.toString()
                })
            };
        }
        return null;
    }
});
```

**Use case:** Test error handling without real errors

---

#### 4. Filter Sensitive Data from Responses

```typescript
const executor = new DockerExecutorWithProxy({
    onResponse: (res) => {
        if (res.headers['content-type']?.includes('application/json')) {
            try {
                const data = JSON.parse(res.body.toString());

                // Remove sensitive fields
                const sanitized = sanitizeObject(data, [
                    'password',
                    'api_key',
                    'secret',
                    'token',
                    'ssn',
                    'credit_card'
                ]);

                return {
                    body: JSON.stringify(sanitized)
                };
            } catch (e) {
                // Not JSON
            }
        }
        return null;
    }
});

function sanitizeObject(obj: any, sensitiveKeys: string[]): any {
    if (typeof obj !== 'object' || obj === null) return obj;

    const result: any = Array.isArray(obj) ? [] : {};

    for (const key in obj) {
        if (sensitiveKeys.some(k => key.toLowerCase().includes(k))) {
            result[key] = '[REDACTED]';
        } else if (typeof obj[key] === 'object') {
            result[key] = sanitizeObject(obj[key], sensitiveKeys);
        } else {
            result[key] = obj[key];
        }
    }

    return result;
}
```

---

#### 5. Compress Responses

```typescript
import zlib from 'zlib';

const executor = new DockerExecutorWithProxy({
    onResponse: (res) => {
        // Only compress large responses
        if (res.body.length > 1024) {
            const compressed = zlib.gzipSync(res.body);

            return {
                body: compressed,
                headers: {
                    ...res.headers,
                    'content-encoding': 'gzip',
                    'content-length': String(compressed.length)
                }
            };
        }
        return null;
    }
});
```

---

#### 6. Cache Responses

```typescript
const responseCache = new Map<string, { body: Buffer; headers: any }>();

const executor = new DockerExecutorWithProxy({
    onRequest: (req) => {
        // Check cache before making request
        const cacheKey = `${req.method}:${req.url}`;
        const cached = responseCache.get(cacheKey);

        if (cached) {
            console.log('✅ Returning cached response');
            return {
                mockResponse: {
                    statusCode: 200,
                    headers: {
                        ...cached.headers,
                        'X-Cache': 'HIT'
                    },
                    body: cached.body.toString()
                }
            };
        }
        return null;
    },

    onResponse: (res) => {
        // Store in cache
        const cacheKey = `${res.method}:${res.url}`;
        responseCache.set(cacheKey, {
            body: res.body,
            headers: res.headers
        });

        return {
            headers: {
                ...res.headers,
                'X-Cache': 'MISS'
            }
        };
    }
});
```

---

## Combining Multiple Modifications

You can combine request and response modifications:

```typescript
const executor = new DockerExecutorWithProxy({
    // Before request
    onRequest: (req) => {
        console.log(`→ ${req.method} ${req.hostname}`);

        // Inject auth
        if (req.hostname.includes('api.')) {
            return {
                modifiedHeaders: {
                    'Authorization': 'Bearer auto_injected',
                    'X-Request-ID': crypto.randomUUID()
                }
            };
        }
        return null;
    },

    // After response
    onResponse: (res) => {
        console.log(`← ${res.statusCode} from ${res.hostname}`);

        // Add tracking headers
        return {
            headers: {
                ...res.headers,
                'X-Response-ID': crypto.randomUUID(),
                'X-Original-Status': String(res.statusCode)
            }
        };
    }
});
```

---

## Real-World Example: Stripe API Testing

```typescript
const executor = new DockerExecutorWithProxy({
    proxyPort: 8888,
    logTraffic: true,

    onRequest: (req) => {
        // Mock all Stripe API calls for testing
        if (req.hostname === 'api.stripe.com') {
            console.log(`[TEST] Mocking Stripe ${req.method} ${req.url}`);

            // Customer creation
            if (req.url.includes('/v1/customers') && req.method === 'POST') {
                return {
                    mockResponse: {
                        statusCode: 200,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            id: 'cus_test_' + Date.now(),
                            object: 'customer',
                            email: 'test@example.com',
                            created: Math.floor(Date.now() / 1000),
                            _test_mode: true
                        })
                    }
                };
            }

            // Charge creation
            if (req.url.includes('/v1/charges') && req.method === 'POST') {
                return {
                    mockResponse: {
                        statusCode: 200,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            id: 'ch_test_' + Date.now(),
                            object: 'charge',
                            amount: 1000,
                            currency: 'usd',
                            status: 'succeeded',
                            _test_mode: true
                        })
                    }
                };
            }
        }
        return null;
    }
});

// Now user code can "call" Stripe API without real charges!
const result = await executor.executeCode(`
    const stripe = require('stripe')(process.env.STRIPE_KEY);

    const customer = await stripe.customers.create({
        email: 'test@example.com'
    });

    console.log('Customer created:', customer.id);
    // Output: Customer created: cus_test_1234567890
`);
```

---

## Integration with SecureExecutor

Add proxy-enabled Docker execution to `SecureExecutor`:

```typescript
// src/secure/SecureExecutor.ts

import DockerExecutor from './DockerExecutor';
import DockerExecutorWithProxy from './DockerExecutorWithProxy';

export default class SecureExecutor {
    private dockerExecutor: DockerExecutor | null = null;
    private dockerProxyExecutor: DockerExecutorWithProxy | null = null;

    constructor(options = {}) {
        // Standard Docker (no network)
        if (process.env.DOCKER_EXECUTOR === 'true') {
            this.dockerExecutor = new DockerExecutor({ networkMode: 'none' });
        }

        // Docker with proxy (network + inspection)
        if (process.env.DOCKER_PROXY_EXECUTOR === 'true') {
            this.dockerProxyExecutor = new DockerExecutorWithProxy({
                proxyPort: 8888,
                logTraffic: true,
                captureResponses: true,

                // Add your custom modifications
                onRequest: (req) => {
                    // Custom request logic
                    return null;
                },
                onResponse: (res) => {
                    // Custom response logic
                    return null;
                }
            });
        }
    }

    async executeCode(payload: ExecutionPayload): Promise<ExecutionResult> {
        // Route to proxy-enabled Docker
        if (this.dockerProxyExecutor && payload.inspectNetwork) {
            return this.executeWithProxyDocker(payload);
        }

        // Route to standard Docker
        if (this.dockerExecutor) {
            return this.executeWithDocker(payload);
        }

        // Fall back to spawn
        return this.executeWithSpawn(payload);
    }
}
```

---

## Environment Variables

```bash
# .env

# Standard Docker (no network)
DOCKER_EXECUTOR=false

# Docker with HTTP proxy (network + inspection)
DOCKER_PROXY_EXECUTOR=true
PROXY_PORT=8888
```

---

## Testing

Run the comprehensive demo:

```bash
npx ts-node demo-proxy-modification.ts
```

Tests:
1. ✅ Modify response headers
2. ✅ Modify response body (inject data)
3. ✅ Mock responses (fake Stripe API)
4. ✅ Modify request headers (inject auth)
5. ✅ Block requests (custom logic)
6. ✅ Modify status codes

---

## Performance

- **Overhead**: ~50-100ms per request (proxy processing)
- **Memory**: Minimal (unless capturing large responses)
- **Network**: All traffic goes through proxy on localhost (fast)

---

## Security Benefits

1. **Complete Visibility**: See every HTTP request/response
2. **Request Control**: Block dangerous requests before they happen
3. **Response Control**: Filter sensitive data from responses
4. **Audit Trail**: Log all network activity
5. **Testing Safety**: Mock APIs without real calls
6. **Credential Management**: Inject auth automatically, users don't need keys

---

## Summary

Three execution modes available:

| Mode | Network | Inspection | Use Case |
|------|---------|------------|----------|
| **Spawn** | ✅ Full | ❌ None | Fast development |
| **Docker (none)** | ❌ Blocked | ❌ None | Maximum security |
| **Docker (proxy)** | ✅ Controlled | ✅ Full | Security + visibility |

Choose based on your needs:
- **Development**: Spawn (fastest)
- **Production (untrusted)**: Docker with networkMode=none (most secure)
- **Production (monitoring)**: Docker with proxy (secure + visible)

---

## Next Steps

1. ✅ Read this guide
2. ✅ Run demo: `npx ts-node demo-proxy-modification.ts`
3. ✅ Integrate with your SecureExecutor
4. ✅ Add custom onRequest/onResponse hooks
5. ✅ Test with your use case
6. ✅ Deploy to production!
