# JWT-Based Policy Integration Guide

This guide shows how to integrate user-specific security policies from your JWT API into the `/execute` endpoint.

## Overview

**Flow:**
```
POST /execute with Authorization: Bearer <JWT>
  ↓
Extract JWT from Authorization header
  ↓
Fetch policy from https://api.keyboard.dev/api/user/policies
  ↓
Create SecureExecutorUnified with user's policy
  ↓
Execute code with policy enforcement
  ↓
Return result (including blocked requests in networkLog)
```

---

## server.js Changes

### Step 1: Add Policy Fetcher Import

Add this near the top of `server.js` (around line 20):

```javascript
// Secure execution system with unified interface
const SecureExecutorUnified = require('./src/secure/SecureExecutorUnified').default;
const { getPolicyFetcher } = require('./src/utils/policy-fetcher');
const { DEFAULT_SECURITY_POLICY } = require('./src/config/security-policy');

let secureExecutor = null;
const policyFetcher = getPolicyFetcher();
```

### Step 2: Update executeCodeWithSecureMode()

**Replace the function at line 884 with:**

```javascript
async function executeCodeWithSecureMode(payload, res, headerEnvVars = {}, authHeader = null) {
    try {
        // Extract JWT from Authorization header
        const jwt = authHeader?.replace('Bearer ', '').trim();

        let policy = DEFAULT_SECURITY_POLICY;  // Fallback policy
        let policyInfo = {
            source: 'default',
            name: 'Default Policy'
        };

        // Fetch user-specific policy if JWT provided and Docker/Policy enabled
        if (jwt && process.env.DOCKER_EXECUTOR === 'true' && process.env.ENABLE_POLICY === 'true') {
            console.log('[Server] Fetching user policy from JWT');
            const policyResult = await policyFetcher.fetchPolicy(jwt);

            if (policyResult.success && policyResult.policy) {
                policy = policyResult.policy;
                policyInfo = {
                    source: 'jwt',
                    name: 'User Policy',
                    allowedDomains: policy.allowedDomains.length,
                    allowedPackages: policy.allowedPackages.length
                };
                console.log('[Server] Using user policy:', policyInfo);
            } else {
                console.warn('[Server] Failed to fetch policy, using default:', policyResult.error);
            }
        }

        // Create executor with policy
        const executor = new SecureExecutorUnified({
            timeout: 30000,
            policy: policy
        });

        const result = await executor.executeCode(payload, headerEnvVars);

        // Add policy info to response
        if (result.data) {
            result.data.policyInfo = policyInfo;
        }

        // Handle encryption if requested
        let finalResult = result;
        if (payload.encrypt_messages) {
            try {
                const responseString = JSON.stringify(result);
                const encryptedResponse = encrypt(responseString);
                finalResult = {
                    encrypted: true,
                    data: encryptedResponse
                };
            } catch (encryptError) {
                console.error('❌ Failed to encrypt response:', encryptError.message);
                finalResult.encryptionError = 'Failed to encrypt response: ' + encryptError.message;
            }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(finalResult));

    } catch (error) {
        console.error('❌ Secure execution error:', error);

        let errorResult = {
            success: false,
            error: error.error || 'Execution failed',
            details: error.details || error.message,
            executionMode: error.executionMode || 'unknown'
        };

        // Handle encryption for error response
        if (payload.encrypt_messages) {
            try {
                const errorString = JSON.stringify(errorResult);
                const encryptedError = encrypt(errorString);
                errorResult = {
                    encrypted: true,
                    data: encryptedError
                };
            } catch (encryptError) {
                console.error('❌ Failed to encrypt error response:', encryptError.message);
                errorResult.encryptionError = 'Failed to encrypt error response: ' + encryptError.message;
            }
        }

        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(errorResult));
    }
}
```

### Step 3: Update /execute Endpoint Call

**Modify line 517 to pass Authorization header:**

Find this line:
```javascript
executeCodeWithSecureMode(payload, res, headerEnvVars);
```

Replace with:
```javascript
executeCodeWithSecureMode(payload, res, headerEnvVars, req.headers.authorization);
```

---

## Environment Variables

```bash
# Enable Docker execution
DOCKER_EXECUTOR=true

# Enable HTTP Proxy for traffic visibility
ENABLE_HTTP_PROXY=true

# Enable Policy enforcement
ENABLE_POLICY=true

# Policy API URL (optional, defaults to https://api.keyboard.dev/api/user/policies)
POLICY_API_URL=https://api.keyboard.dev/api/user/policies
```

**Start server:**
```bash
DOCKER_EXECUTOR=true \
ENABLE_HTTP_PROXY=true \
ENABLE_POLICY=true \
node server.js
```

---

## Testing

### Test 1: Without JWT (Uses Default Policy)

```bash
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{
    "code": "console.log(\"Hello\");"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "stdout": "Hello\n",
    "stderr": "",
    "code": 0,
    "policyInfo": {
      "source": "default",
      "name": "Default Policy"
    }
  }
}
```

---

### Test 2: With JWT (Uses User Policy)

```bash
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_HERE" \
  -d '{
    "code": "const https = require(\"https\"); https.get(\"https://api.stripe.com/v1/products\", r => console.log(r.statusCode));"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "stdout": "200\n",
    "stderr": "",
    "code": 0,
    "networkLog": [
      {
        "method": "GET",
        "url": "https://api.stripe.com/v1/products",
        "statusCode": 200,
        "blocked": false
      }
    ],
    "policyInfo": {
      "source": "jwt",
      "name": "User Policy",
      "allowedDomains": 2,
      "allowedPackages": 1
    }
  }
}
```

---

### Test 3: Policy Blocks Request

**User's policy allows `api.stripe.com` but blocks DELETE on `*.okta.com`:**

```bash
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_HERE" \
  -d '{
    "code": "const https = require(\"https\"); https.request({ hostname: \"dev-123.okta.com\", path: \"/api/v1/users/123\", method: \"DELETE\" }, r => console.log(r.statusCode)).end();"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "stdout": "403\n",
    "stderr": "",
    "code": 0,
    "networkLog": [
      {
        "method": "DELETE",
        "url": "https://dev-123.okta.com/api/v1/users/123",
        "statusCode": 403,
        "blocked": true,
        "reason": "Method DELETE not allowed for *.okta.com"
      }
    ],
    "policyInfo": {
      "source": "jwt",
      "name": "User Policy",
      "allowedDomains": 2,
      "allowedPackages": 1
    }
  }
}
```

---

### Test 4: Blocked Domain

**Try to access domain NOT in user's allowedDomains:**

```bash
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_HERE" \
  -d '{
    "code": "const https = require(\"https\"); https.get(\"https://api.github.com/users/github\", r => console.log(r.statusCode));"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "stdout": "403\n",
    "stderr": "",
    "code": 0,
    "networkLog": [
      {
        "method": "GET",
        "url": "https://api.github.com/users/github",
        "hostname": "api.github.com",
        "statusCode": 403,
        "blocked": true,
        "reason": "Domain api.github.com is not in allowed list"
      }
    ],
    "policyInfo": {
      "source": "jwt",
      "name": "User Policy",
      "allowedDomains": 2,
      "allowedPackages": 1
    }
  }
}
```

---

## Policy Caching

The PolicyFetcher caches policies for 1 minute by default to reduce API calls.

**Configure cache TTL:**
```javascript
const { PolicyFetcher } = require('./src/utils/policy-fetcher');

const policyFetcher = new PolicyFetcher({
    cacheTTL: 300000  // 5 minutes
});
```

**Clear cache manually:**
```javascript
// Clear specific JWT cache
policyFetcher.clearCache(jwt);

// Clear all cache
policyFetcher.clearCache();
```

**Get cache stats:**
```javascript
const stats = policyFetcher.getCacheStats();
console.log('Cache size:', stats.size);
```

---

## Policy Format Mapping

Your API returns this format:
```json
{
  "allowedDomains": ["api.stripe.com", "*.okta.com"],
  "apiPathRules": {
    "*.okta.com": [
      { "path": "/*", "allow": true, "method": "GET" },
      { "path": "/*", "allow": false, "method": "DELETE" }
    ]
  },
  "allowedPackages": ["@okta"],
  "allowedBinaries": ["ffmpeg"]
}
```

It's automatically transformed to internal `SecurityPolicy` format:
```typescript
{
  allowedDomains: ["api.stripe.com", "*.okta.com"],
  blockedDomains: [],  // Not in API yet
  apiPathRules: {
    "*.okta.com": [
      { method: "GET", path: "/*", allow: true },
      { method: "DELETE", path: "/*", allow: false }
    ]
  },
  allowedPackages: ["@okta"],
  allowedBinaries: ["ffmpeg"]
}
```

---

## Wildcard Domain Matching

Your policy supports wildcard domains like `*.okta.com`:

```javascript
// User's policy
{
  "allowedDomains": ["*.okta.com"]
}

// Matches:
✅ dev-123.okta.com
✅ test.okta.com
✅ prod-456.okta.com
❌ okta.com (doesn't match *.okta.com)
❌ api.okta.com.evil.com (must end with .okta.com)
```

---

## Error Handling

### Policy Fetch Fails

If policy fetch fails (API down, network error, etc.), the system:
1. Logs warning to console
2. Falls back to `DEFAULT_SECURITY_POLICY`
3. Execution continues normally
4. Response includes `policyInfo.source = "default"`

**Example:**
```json
{
  "success": true,
  "data": {
    "stdout": "...",
    "policyInfo": {
      "source": "default",
      "name": "Default Policy"
    }
  }
}
```

### Invalid JWT

If JWT is invalid or expired:
1. Policy fetch returns `{ success: false, error: "..." }`
2. Falls back to default policy
3. Execution continues
4. Consider: Add JWT validation before execution (optional)

---

## Security Considerations

### 1. JWT Validation

**Current:** Policy API validates JWT
**Recommended:** Add local JWT validation for faster failures

```javascript
const jwt = require('jsonwebtoken');

function validateJWT(token) {
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        return { valid: true, decoded };
    } catch (error) {
        return { valid: false, error: error.message };
    }
}
```

### 2. Rate Limiting

Add rate limiting for policy fetch to prevent API abuse:

```javascript
const rateLimit = require('express-rate-limit');

const policyRateLimit = rateLimit({
    windowMs: 60 * 1000,  // 1 minute
    max: 60,  // 60 requests per minute
    message: 'Too many policy requests'
});

app.use('/execute', policyRateLimit);
```

### 3. Policy Update Latency

**Cache TTL = 1 minute means:**
- Policy changes take up to 1 minute to apply
- Reduce TTL for faster updates (more API calls)
- Increase TTL for better performance (slower updates)

**Recommendation:**
- Development: 10 seconds
- Production: 5 minutes

### 4. Default Policy Security

Ensure `DEFAULT_SECURITY_POLICY` is restrictive:

```javascript
// In src/config/security-policy.ts
export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
    allowedDomains: [],  // Block everything by default!
    blockedDomains: ['*'],
    apiPathRules: {},
    allowedPackages: ['lodash', 'axios'],  // Only safe packages
    allowedBinaries: []  // No binaries
};
```

---

## Monitoring & Logging

### Log Policy Usage

```javascript
console.log('[Server] Policy applied:', {
    jwt: jwt.substring(0, 20) + '...',  // Don't log full JWT
    source: policyInfo.source,
    allowedDomains: policy.allowedDomains.length,
    blockedRequests: result.data.networkLog?.filter(r => r.blocked).length || 0
});
```

### Track Blocked Requests

```javascript
if (result.data.networkLog) {
    const blocked = result.data.networkLog.filter(r => r.blocked);
    if (blocked.length > 0) {
        console.warn('[Security] Blocked requests:', {
            count: blocked.length,
            domains: blocked.map(r => r.hostname),
            user: decoded.sub  // From JWT
        });
    }
}
```

---

## Complete server.js Diff

```diff
 // Secure execution system
-const SecureExecutor = require('./src/secure/SecureExecutor');
+const SecureExecutorUnified = require('./src/secure/SecureExecutorUnified').default;
+const { getPolicyFetcher } = require('./src/utils/policy-fetcher');
+const { DEFAULT_SECURITY_POLICY } = require('./src/config/security-policy');
+
 let secureExecutor = null;
+const policyFetcher = getPolicyFetcher();

-function getSecureExecutor() {
-    if (!secureExecutor) {
-        secureExecutor = new SecureExecutor({
-            timeout: 30000
-        });
-    }
-    return secureExecutor;
-}

-async function executeCodeWithSecureMode(payload, res, headerEnvVars = {}) {
+async function executeCodeWithSecureMode(payload, res, headerEnvVars = {}, authHeader = null) {
     try {
-        const executor = getSecureExecutor();
+        // Extract JWT and fetch policy
+        const jwt = authHeader?.replace('Bearer ', '').trim();
+        let policy = DEFAULT_SECURITY_POLICY;
+
+        if (jwt && process.env.DOCKER_EXECUTOR === 'true' && process.env.ENABLE_POLICY === 'true') {
+            const policyResult = await policyFetcher.fetchPolicy(jwt);
+            if (policyResult.success && policyResult.policy) {
+                policy = policyResult.policy;
+            }
+        }
+
+        // Create executor with user's policy
+        const executor = new SecureExecutorUnified({
+            timeout: 30000,
+            policy: policy
+        });
+
         const result = await executor.executeCode(payload, headerEnvVars);
         // ... rest unchanged
     }
 }

 // In /execute endpoint (line 517)
-executeCodeWithSecureMode(payload, res, headerEnvVars);
+executeCodeWithSecureMode(payload, res, headerEnvVars, req.headers.authorization);
```

---

## Next Steps

1. ✅ Compile TypeScript: `npm run build`
2. ✅ Set environment variables (see above)
3. ✅ Start server with policy enforcement enabled
4. ✅ Test with your JWT token
5. ✅ Monitor logs for policy fetch and enforcement
6. ✅ Adjust cache TTL based on needs
7. ✅ Add monitoring/alerting for blocked requests

---

## Summary

✅ **JWT-based policy fetching** - Pulls user policies from your API
✅ **Automatic caching** - 1 minute TTL, reduces API calls
✅ **Graceful fallback** - Uses default policy if fetch fails
✅ **Policy enforcement** - Domain, API path, package, binary control
✅ **Transparent logging** - See what's blocked in networkLog
✅ **Wildcard support** - `*.okta.com` matches all subdomains
✅ **Minimal changes** - Only ~30 lines added to server.js

Your users now have **per-user security policies** applied automatically! 🎉
