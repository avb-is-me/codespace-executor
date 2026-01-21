# Header Filtering Guide

## Overview

The HTTP proxy automatically filters sensitive headers from:
1. **Network logs** - Prevents credentials from appearing in logs
2. **Response headers** - Removes sensitive headers before sending to user code

This prevents credential leakage in monitoring, logging, and debugging scenarios.

---

## What Gets Filtered

### Default Sensitive Headers

By default, these headers are filtered:

- `authorization` - Bearer tokens, Basic auth
- `cookie` - Session cookies
- `set-cookie` - Response cookies
- `x-api-key` - API keys
- `x-auth-token` - Authentication tokens
- `x-csrf-token` - CSRF tokens
- `x-xsrf-token` - XSRF tokens
- `proxy-authorization` - Proxy authentication
- `www-authenticate` - Authentication challenges
- `x-amz-security-token` - AWS security tokens
- `x-goog-iam-authorization-token` - Google IAM tokens
- `x-goog-authenticated-user-email` - Google user emails

---

## How It Works

### 1. In Network Logs

Sensitive header values are replaced with `[REDACTED]`:

```javascript
// Original request headers:
{
    "authorization": "Bearer sk_live_abc123...",
    "x-api-key": "secret_key_12345",
    "user-agent": "Node.js"
}

// In network log:
{
    "authorization": "[REDACTED]",
    "x-api-key": "[REDACTED]",
    "user-agent": "Node.js"
}
```

### 2. In Response Headers

Sensitive headers are completely removed before sending to user code:

```javascript
// Original response from server:
{
    "content-type": "application/json",
    "set-cookie": "session=abc123",
    "x-api-key": "server_key",
    "x-custom-header": "value"
}

// Sent to user code:
{
    "content-type": "application/json",
    "x-custom-header": "value"
    // set-cookie and x-api-key removed
}
```

---

## Configuration

### Default (Recommended)

```typescript
import DockerExecutorWithProxy from './src/secure/DockerExecutorWithProxy';

const executor = new DockerExecutorWithProxy({
    proxyPort: 8888,
    logTraffic: true,
    filterSensitiveHeaders: true  // ← Default: true
});
```

Filtering is **enabled by default** for security.

---

### Custom Sensitive Headers

Add your own headers to filter:

```typescript
const executor = new DockerExecutorWithProxy({
    proxyPort: 8888,
    filterSensitiveHeaders: true,
    sensitiveHeaders: [
        'authorization',
        'x-stripe-key',
        'x-aws-secret-key',
        'x-openai-api-key',
        'x-my-custom-secret'
    ]
});
```

**Note:** This replaces the default list. Include all headers you want to filter.

---

### Disable Filtering (Not Recommended)

```typescript
const executor = new DockerExecutorWithProxy({
    proxyPort: 8888,
    filterSensitiveHeaders: false  // ⚠️ Insecure!
});
```

**Warning:** Only disable for debugging in development. Never in production!

---

## Examples

### Example 1: Stripe API Request

```typescript
const executor = new DockerExecutorWithProxy({
    proxyPort: 8888,
    filterSensitiveHeaders: true
});

const result = await executor.executeCode(`
    const https = require('https');

    https.request({
        hostname: 'api.stripe.com',
        path: '/v1/customers',
        method: 'POST',
        headers: {
            'Authorization': 'Bearer sk_live_abc123...',  // ← Sensitive!
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    }, (res) => {
        console.log('Status:', res.statusCode);
    }).end();
`);

// Check network log
console.log(result.networkLog[0].requestHeaders);
// Output:
// {
//     "authorization": "[REDACTED]",
//     "content-type": "application/x-www-form-urlencoded"
// }
```

**Benefit:** Stripe secret key doesn't appear in logs!

---

### Example 2: AWS Request

```typescript
const executor = new DockerExecutorWithProxy({
    proxyPort: 8888,
    filterSensitiveHeaders: true,
    sensitiveHeaders: [
        'authorization',
        'x-amz-security-token',
        'x-amz-date'
    ]
});

const result = await executor.executeCode(`
    const https = require('https');

    https.request({
        hostname: 's3.amazonaws.com',
        headers: {
            'Authorization': 'AWS4-HMAC-SHA256...',
            'X-Amz-Security-Token': 'FwoGZXIv...',
            'X-Amz-Date': '20240120T120000Z'
        }
    }, (res) => {
        console.log('Status:', res.statusCode);
    }).end();
`);

// AWS credentials filtered from log
```

---

### Example 3: onRequest Hook with Filtering

```typescript
const executor = new DockerExecutorWithProxy({
    proxyPort: 8888,
    filterSensitiveHeaders: true,

    onRequest: (req) => {
        // You still have access to original headers
        const hasAuth = !!req.headers['authorization'];
        console.log('Request has auth:', hasAuth);

        // But they're filtered in logs
        return null;
    }
});
```

**Note:** Hooks see original headers, but logs don't!

---

## Security Benefits

### 1. Prevents Log Leakage

```typescript
// Without filtering:
[2024-01-20 12:00:00] Request to api.stripe.com
Headers: {"authorization": "Bearer sk_live_abc123..."}  // ⚠️ Leaked!

// With filtering:
[2024-01-20 12:00:00] Request to api.stripe.com
Headers: {"authorization": "[REDACTED]"}  // ✅ Safe
```

---

### 2. Compliance

Many compliance standards (PCI-DSS, SOC 2, ISO 27001) require:
- No credentials in logs
- Sensitive data redaction
- Audit trail without secrets

Header filtering helps meet these requirements!

---

### 3. Safe Debugging

```typescript
// You can safely share logs with team:
console.log('Debug info:', result.networkLog);

// Output is safe:
// {
//     "method": "POST",
//     "url": "https://api.stripe.com/v1/customers",
//     "requestHeaders": {
//         "authorization": "[REDACTED]",  // ✅ Safe to share
//         "content-type": "application/json"
//     }
// }
```

---

### 4. Monitoring Without Risk

```typescript
// Send logs to monitoring system:
await sendToDatadog(result.networkLog);
await sendToSplunk(result.networkLog);
await logToS3(result.networkLog);

// All filtered - no credential leakage!
```

---

## What's NOT Filtered

These are intentionally not filtered (safe to log):

- `content-type`
- `content-length`
- `user-agent`
- `accept`
- `accept-encoding`
- `host`
- `connection`
- `cache-control`
- Custom headers starting with `x-` (unless specified)

---

## Best Practices

### ✅ Do:

1. **Keep filtering enabled** (default)
   ```typescript
   filterSensitiveHeaders: true  // Always!
   ```

2. **Add custom sensitive headers** if needed
   ```typescript
   sensitiveHeaders: [...defaultHeaders, 'x-my-secret']
   ```

3. **Use filtered logs for debugging**
   ```typescript
   console.log('Safe to log:', result.networkLog);
   ```

4. **Store filtered logs** in monitoring systems
   ```typescript
   await sendToMonitoring(result.networkLog);
   ```

---

### ❌ Don't:

1. **Disable filtering in production**
   ```typescript
   filterSensitiveHeaders: false  // ⚠️ Never in prod!
   ```

2. **Log original headers manually**
   ```typescript
   // ❌ Bad:
   console.log('Auth:', req.headers['authorization']);

   // ✅ Good:
   console.log('Has auth:', !!req.headers['authorization']);
   ```

3. **Send unfiltered data to third parties**
   ```typescript
   // ❌ Bad:
   await analytics.track(originalHeaders);

   // ✅ Good:
   await analytics.track(filteredHeaders);
   ```

---

## Testing

Run the demo to see filtering in action:

```bash
npx ts-node demo-header-filtering.ts
```

Tests:
1. ✅ Default filtering (enabled)
2. ⚠️ Filtering disabled (shows risk)
3. ✅ Custom sensitive headers

---

## Integration with SecureExecutor

```typescript
import DockerExecutorWithProxy from './src/secure/DockerExecutorWithProxy';

export default class SecureExecutor {
    private dockerProxyExecutor: DockerExecutorWithProxy;

    constructor() {
        this.dockerProxyExecutor = new DockerExecutorWithProxy({
            proxyPort: 8888,
            logTraffic: true,
            filterSensitiveHeaders: true,  // ← Always enabled

            // Add your API-specific headers
            sensitiveHeaders: [
                'authorization',
                'cookie',
                'set-cookie',
                'x-api-key',
                'x-stripe-key',
                'x-aws-key',
                'x-openai-api-key'
            ]
        });
    }

    async executeWithProxy(code: string, env: Record<string, string>) {
        const result = await this.dockerProxyExecutor.executeCode(code, env);

        // Safe to log - headers filtered
        console.log('Network activity:', result.networkLog);

        // Safe to store - headers filtered
        await this.saveToDatabase(result.networkLog);

        return result;
    }
}
```

---

## FAQ

### Q: Can I still see headers in onRequest/onResponse hooks?

**A:** Yes! Hooks receive original, unfiltered headers. Filtering only affects:
- Network logs (`result.networkLog`)
- Response headers sent to user code

### Q: What if I need to log specific headers?

**A:** Log metadata instead:

```typescript
onRequest: (req) => {
    // ✅ Good: Log presence, not value
    console.log('Has auth:', !!req.headers['authorization']);
    console.log('Auth type:', req.headers['authorization']?.split(' ')[0]);

    // ❌ Bad: Log actual value
    console.log('Auth value:', req.headers['authorization']);
}
```

### Q: Does this affect performance?

**A:** Minimal impact (<1ms per request). Filtering is a simple object iteration.

### Q: Can I filter request bodies too?

**A:** Not automatically. Use `onRequest`/`onResponse` hooks to filter bodies:

```typescript
onResponse: (res) => {
    const data = JSON.parse(res.body.toString());
    delete data.password;
    delete data.secret;
    return {
        body: JSON.stringify(data)
    };
}
```

---

## Summary

✅ **Header filtering is enabled by default** for security

✅ **Filters both request and response headers**

✅ **Redacts in logs, removes from responses**

✅ **Customizable list of sensitive headers**

✅ **Helps meet compliance requirements**

✅ **Safe to log and monitor**

🔒 **Keep it enabled in production!**

---

## Next Steps

1. ✅ Read this guide
2. ✅ Run demo: `npx ts-node demo-header-filtering.ts`
3. ✅ Keep default settings (filtering enabled)
4. ✅ Add custom headers if needed
5. ✅ Test with your monitoring system
6. ✅ Deploy to production safely!
