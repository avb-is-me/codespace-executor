# Unified Server Integration - Same Output Format for All Modes

## Problem Solved

All execution modes now return the **same format**:

```typescript
{
  success: true,
  data: {
    stdout: "...",        // ← Always stdout
    stderr: "...",        // ← Always stderr
    code: 0,              // ← Always code
    executionTime: 1234,  // ← Always executionTime
    networkLog: [...],    // ← Only if using proxy
    dockerInfo: {...}     // ← Only if using Docker
  }
}
```

## server.js Changes

### Step 1: Update Import

**Before:**
```javascript
const SecureExecutor = require('./src/secure/SecureExecutor');
let secureExecutor = null;
```

**After:**
```javascript
const SecureExecutorUnified = require('./src/secure/SecureExecutorUnified').default;
let secureExecutor = null;
```

### Step 2: Update getSecureExecutor()

**Replace lines 33-40 with:**

```javascript
function getSecureExecutor() {
    if (!secureExecutor) {
        secureExecutor = new SecureExecutorUnified({
            timeout: 30000
            // Mode is auto-detected from environment variables:
            // - DOCKER_EXECUTOR=true → 'docker' or 'docker-proxy' or 'docker-policy'
            // - ENABLE_HTTP_PROXY=true → adds proxy
            // - ENABLE_POLICY=true → adds policy
        });
    }
    return secureExecutor;
}
```

### Step 3: No Changes Needed to executeCodeWithSecureMode()!

The function at line 884 already works because the output format is now consistent:

```javascript
async function executeCodeWithSecureMode(payload, res, headerEnvVars = {}) {
    try {
        const executor = getSecureExecutor();
        const result = await executor.executeCode(payload, headerEnvVars);

        // result.data.stdout - Always works! ✅
        // result.data.stderr - Always works! ✅
        // result.data.code - Always works! ✅
        // result.data.networkLog - Only present if proxy enabled ✅

        let finalResult = result;
        if (payload.encrypt_messages) {
            const responseString = JSON.stringify(result);
            const encryptedResponse = encrypt(responseString);
            finalResult = {
                encrypted: true,
                data: encryptedResponse
            };
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(finalResult));

    } catch (error) {
        console.error('❌ Secure execution error:', error);
        // ... error handling unchanged
    }
}
```

## Environment Variable Configuration

### Mode 1: Spawn (Legacy)
```bash
# No env vars needed
node server.js
```

**Output:**
```json
{
  "success": true,
  "data": {
    "stdout": "Hello world",
    "stderr": "",
    "code": 0,
    "executionTime": 123
  }
}
```

---

### Mode 2: Basic Docker
```bash
DOCKER_EXECUTOR=true node server.js
```

**Output:**
```json
{
  "success": true,
  "data": {
    "stdout": "Hello world",
    "stderr": "",
    "code": 0,
    "executionTime": 456,
    "dockerInfo": {
      "containerInfo": "container_abc123",
      "networkIsolation": true
    }
  }
}
```

---

### Mode 3: Docker + HTTP Proxy
```bash
DOCKER_EXECUTOR=true \
ENABLE_HTTP_PROXY=true \
node server.js
```

**Output:**
```json
{
  "success": true,
  "data": {
    "stdout": "Product fetched",
    "stderr": "",
    "code": 0,
    "executionTime": 789,
    "networkLog": [
      {
        "timestamp": "2024-01-15T10:30:00Z",
        "method": "GET",
        "url": "https://api.stripe.com/v1/products",
        "hostname": "api.stripe.com",
        "statusCode": 200,
        "blocked": false
      }
    ],
    "dockerInfo": {
      "containerInfo": "container_def456",
      "networkIsolation": true
    }
  }
}
```

---

### Mode 4: Docker + Proxy + Policy
```bash
DOCKER_EXECUTOR=true \
ENABLE_HTTP_PROXY=true \
ENABLE_POLICY=true \
node server.js
```

**Output:**
```json
{
  "success": true,
  "data": {
    "stdout": "Product created",
    "stderr": "",
    "code": 0,
    "executionTime": 1012,
    "networkLog": [
      {
        "method": "POST",
        "url": "https://api.stripe.com/v1/products",
        "statusCode": 200,
        "blocked": false
      },
      {
        "method": "POST",
        "url": "https://api.stripe.com/v1/charges",
        "statusCode": 403,
        "blocked": true,
        "reason": "API path /v1/charges is blocked by policy"
      }
    ],
    "dockerInfo": {
      "containerInfo": "container_ghi789",
      "networkIsolation": true
    }
  }
}
```

---

## Complete server.js Diff

```diff
 // Secure execution system
-const SecureExecutor = require('./src/secure/SecureExecutor');
+const SecureExecutorUnified = require('./src/secure/SecureExecutorUnified').default;
 let secureExecutor = null;

 function getSecureExecutor() {
     if (!secureExecutor) {
-        secureExecutor = new SecureExecutor({
+        secureExecutor = new SecureExecutorUnified({
             timeout: 30000
         });
     }
     return secureExecutor;
 }
```

**That's it!** Only 2 lines changed.

---

## Comparison Table

| Feature | Spawn | Docker | Docker+Proxy | Docker+Proxy+Policy |
|---------|-------|--------|--------------|---------------------|
| **data.stdout** | ✅ | ✅ | ✅ | ✅ |
| **data.stderr** | ✅ | ✅ | ✅ | ✅ |
| **data.code** | ✅ | ✅ | ✅ | ✅ |
| **data.executionTime** | ✅ | ✅ | ✅ | ✅ |
| **data.networkLog** | ❌ | ❌ | ✅ | ✅ |
| **data.dockerInfo** | ❌ | ✅ | ✅ | ✅ |
| **Network Isolation** | ❌ | ✅ | ✅ | ✅ |
| **Traffic Visibility** | ❌ | ❌ | ✅ | ✅ |
| **Policy Enforcement** | ❌ | ❌ | ❌ | ✅ |

---

## Testing

### Test Unified Output

```bash
# Compile TypeScript
npm run build

# Test spawn mode
node server.js

curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{"code": "console.log(\"test\");"}'

# Expected: {"success":true,"data":{"stdout":"test\n","stderr":"","code":0,...}}
```

```bash
# Test Docker mode
DOCKER_EXECUTOR=true node server.js

curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{"code": "console.log(\"test\");"}'

# Expected: {"success":true,"data":{"stdout":"test\n","stderr":"","code":0,"dockerInfo":{...}}}
```

```bash
# Test Docker + Proxy mode
DOCKER_EXECUTOR=true ENABLE_HTTP_PROXY=true node server.js

curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{"code": "const https = require(\"https\"); https.get(\"https://api.github.com\", r => console.log(r.statusCode));"}'

# Expected: {"success":true,"data":{"stdout":"200\n","stderr":"","code":0,"networkLog":[...],"dockerInfo":{...}}}
```

---

## Backward Compatibility

✅ **All existing code continues to work!**

Old code accessing:
- `result.data.stdout` → Still works
- `result.data.stderr` → Still works
- `result.data.code` → Still works

New fields are **additive only**:
- `result.data.networkLog` → Only present if proxy enabled
- `result.data.dockerInfo` → Only present if Docker enabled

No breaking changes to API responses!

---

## Rollout Plan

### Phase 1: Update server.js (5 minutes)
1. Change 2 lines in server.js
2. Run `npm run build` to compile TypeScript
3. Test with existing code

### Phase 2: Enable Docker (same day)
```bash
DOCKER_EXECUTOR=true node server.js
```
- Same output format ✅
- Better isolation ✅

### Phase 3: Enable Proxy (next day)
```bash
DOCKER_EXECUTOR=true ENABLE_HTTP_PROXY=true node server.js
```
- Same output format ✅
- Adds `networkLog` field ✅
- Traffic visibility ✅

### Phase 4: Enable Policy (next week)
```bash
DOCKER_EXECUTOR=true ENABLE_HTTP_PROXY=true ENABLE_POLICY=true node server.js
```
- Same output format ✅
- `networkLog` includes blocking decisions ✅
- Policy enforcement ✅

---

## Summary

✅ **ONE unified interface** - `SecureExecutorUnified`
✅ **ONE output format** - Always `{ success, data: { stdout, stderr, code, ... } }`
✅ **TWO lines changed** in server.js
✅ **ZERO breaking changes** - Backward compatible
✅ **FOUR execution modes** - spawn, docker, docker+proxy, docker+policy

**All modes return the same format!** 🎉
