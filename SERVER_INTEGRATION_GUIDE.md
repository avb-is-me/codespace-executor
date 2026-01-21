# Server Integration Guide: Docker + Proxy + Policy

This guide shows how to integrate the new Docker-based security system into `server.js`.

## Current Architecture

```
POST /execute
  ↓
executeCodeWithSecureMode()
  ↓
getSecureExecutor() → Creates SecureExecutor instance
  ↓
SecureExecutor.executeCode()
  ↓
If DOCKER_EXECUTOR=true → Docker execution
If DOCKER_EXECUTOR=false → spawn execution (legacy)
```

---

## Integration Options

### Option 1: Basic Docker Execution (Already Works! ✅)

**Status:** Already integrated in your codebase!

**How to enable:**
```bash
DOCKER_EXECUTOR=true node server.js
```

**What happens:**
- `SecureExecutor` checks `process.env.DOCKER_EXECUTOR === 'true'`
- Routes execution through `DockerExecutor`
- Creates fresh container for each execution
- Network isolated (networkMode='none')
- Automatic cleanup

**What you get:**
- ✅ Docker isolation
- ✅ Network blocking
- ❌ No traffic visibility
- ❌ No policy enforcement

**Code location:** `src/secure/SecureExecutor.ts` (lines 56-66, 154-168)

---

### Option 2: Docker + HTTP Proxy (Traffic Visibility)

**Use case:** You want to see what HTTP requests user code makes.

**Changes required:** Modify `getSecureExecutor()` in `server.js`

#### Before:
```javascript
const SecureExecutor = require('./src/secure/SecureExecutor');

function getSecureExecutor() {
    if (!secureExecutor) {
        secureExecutor = new SecureExecutor({
            timeout: 30000
        });
    }
    return secureExecutor;
}
```

#### After (TypeScript-compatible):
```javascript
// Add import
const DockerExecutorWithProxy = require('./src/secure/DockerExecutorWithProxy').default;

function getSecureExecutor() {
    if (!secureExecutor) {
        // Check if Docker mode is enabled
        if (process.env.DOCKER_EXECUTOR === 'true') {
            secureExecutor = new DockerExecutorWithProxy({
                image: process.env.DOCKER_IMAGE || 'gcr.io/distroless/nodejs20-debian12',
                proxyPort: parseInt(process.env.PROXY_PORT) || 8888,
                logTraffic: process.env.LOG_TRAFFIC !== 'false',  // Default: true
                filterSensitiveHeaders: true,  // Filter credentials from logs
                timeout: 30000,

                // Optional: Add request/response hooks
                onRequest: (req) => {
                    console.log(`[PROXY] ${req.method} ${req.url}`);
                    // Return null to allow, or { block: true } to block
                },

                onResponse: (res) => {
                    console.log(`[PROXY] Response: ${res.statusCode}`);
                }
            });
        } else {
            // Fall back to regular SecureExecutor
            secureExecutor = new (require('./src/secure/SecureExecutor').default)({
                timeout: 30000
            });
        }
    }
    return secureExecutor;
}
```

**Environment variables:**
```bash
DOCKER_EXECUTOR=true
DOCKER_IMAGE=gcr.io/distroless/nodejs20-debian12  # Optional
PROXY_PORT=8888  # Optional
LOG_TRAFFIC=true  # Optional (default: true)
```

**What you get:**
- ✅ Docker isolation
- ✅ HTTP traffic visibility (all requests logged)
- ✅ Request/response modification
- ✅ Automatic header filtering (credentials redacted)
- ❌ No domain/path policy enforcement yet

**Updated executeCodeWithSecureMode():**
```javascript
async function executeCodeWithSecureMode(payload, res, headerEnvVars = {}) {
    try {
        const executor = getSecureExecutor();
        const result = await executor.executeCode(payload.code, headerEnvVars);

        // result includes networkLog if using DockerExecutorWithProxy
        if (result.networkLog) {
            console.log(`[SERVER] Captured ${result.networkLog.length} HTTP requests`);
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
        // ... error handling
    }
}
```

---

### Option 3: Full 4-Layer Security System (Recommended for Production)

**Use case:** You want domain control, API path enforcement, and user-specific policies.

**Changes required:** Replace `SecureExecutor` with `SecureExecutorWithPolicy`

#### Updated getSecureExecutor():
```javascript
// Add imports
const SecureExecutorWithPolicy = require('./src/secure/SecureExecutorWithPolicy').default;
const { DEFAULT_SECURITY_POLICY } = require('./src/config/security-policy');

function getSecureExecutor() {
    if (!secureExecutor) {
        if (process.env.DOCKER_EXECUTOR === 'true') {
            secureExecutor = new SecureExecutorWithPolicy({
                // Docker options
                image: process.env.DOCKER_IMAGE || 'gcr.io/distroless/nodejs20-debian12',
                memoryLimit: parseInt(process.env.DOCKER_MEMORY_LIMIT) || undefined,
                cpuLimit: parseFloat(process.env.DOCKER_CPU_LIMIT) || undefined,
                timeout: 30000,

                // Proxy options
                proxyPort: parseInt(process.env.PROXY_PORT) || 8888,
                logTraffic: process.env.LOG_TRAFFIC !== 'false',
                filterSensitiveHeaders: true,

                // Policy options (MVP: uses DEFAULT_SECURITY_POLICY)
                // Future: Load from JWT/database
                policy: DEFAULT_SECURITY_POLICY  // Or load per-user policy
            });
        } else {
            // Fall back to regular SecureExecutor
            const SecureExecutor = require('./src/secure/SecureExecutor').default;
            secureExecutor = new SecureExecutor({
                timeout: 30000
            });
        }
    }
    return secureExecutor;
}
```

**What you get:**
- ✅ Docker isolation (Layer 2: Language control)
- ✅ HTTP traffic visibility
- ✅ Domain control (Layer 1)
- ✅ API path enforcement (Layer 3)
- ✅ Package control documentation (Layer 4)
- ✅ Policy-based access control

**Security policies enforced:**
```javascript
// From security-policy.ts
{
    allowedDomains: ['api.stripe.com', 'api.openai.com', 'api.github.com'],

    apiPathRules: {
        'api.stripe.com': [
            { method: 'GET', path: '/v1/products', allow: true },
            { method: 'POST', path: '/v1/products', allow: true },
            { method: 'POST', path: '/v1/charges', allow: false }  // Blocked!
        ]
    }
}
```

---

## Future: Per-User Policies via JWT

**Step 1:** Extract JWT from request headers

```javascript
async function executeCodeWithSecureMode(payload, res, headerEnvVars = {}) {
    try {
        // Extract JWT from Authorization header
        const authHeader = req.headers.authorization;
        const jwt = authHeader?.split(' ')[1];  // "Bearer <token>"

        // Create executor with JWT (loads user's policy)
        const executor = getSecureExecutorWithJWT(jwt);

        const result = await executor.executeCode(payload.code, headerEnvVars);
        // ... rest of code
    } catch (error) {
        // ... error handling
    }
}
```

**Step 2:** Load user-specific policy

```javascript
function getSecureExecutorWithJWT(jwt) {
    if (process.env.DOCKER_EXECUTOR === 'true') {
        const SecureExecutorWithPolicy = require('./src/secure/SecureExecutorWithPolicy').default;
        const { loadPolicyFromJWT } = require('./src/config/security-policy');

        // Decode JWT and load user's policy from database
        const policy = await loadPolicyFromJWT(jwt);

        return new SecureExecutorWithPolicy({
            image: 'gcr.io/distroless/nodejs20-debian12',
            proxyPort: 8888,
            policy: policy  // User-specific policy!
        });
    }
    // ... fallback
}
```

**JWT payload example:**
```json
{
    "sub": "user_123",
    "tier": "pro",
    "allowedDomains": ["api.stripe.com"],
    "apiLimits": {
        "stripe_products": true,
        "stripe_charges": false
    }
}
```

---

## Response Format Changes

### Option 1 (Basic Docker):
```json
{
    "success": true,
    "output": "Hello world",
    "exitCode": 0
}
```

### Option 2 (Docker + Proxy):
```json
{
    "success": true,
    "output": "Hello world",
    "exitCode": 0,
    "networkLog": [
        {
            "timestamp": "2024-01-15T10:30:00Z",
            "method": "GET",
            "url": "https://api.stripe.com/v1/products",
            "hostname": "api.stripe.com",
            "statusCode": 200,
            "blocked": false
        }
    ]
}
```

### Option 3 (Full Policy):
```json
{
    "success": true,
    "output": "Product created",
    "exitCode": 0,
    "networkLog": [
        {
            "timestamp": "2024-01-15T10:30:00Z",
            "method": "POST",
            "url": "https://api.stripe.com/v1/products",
            "statusCode": 200,
            "blocked": false
        },
        {
            "timestamp": "2024-01-15T10:30:01Z",
            "method": "POST",
            "url": "https://api.stripe.com/v1/charges",
            "statusCode": 403,
            "blocked": true,
            "reason": "API path /v1/charges is blocked by policy"
        }
    ]
}
```

---

## Testing Each Option

### Test Option 1 (Basic Docker):
```bash
# Start server with Docker enabled
DOCKER_EXECUTOR=true node server.js

# Test execution
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{
    "code": "console.log(\"Hello from Docker!\");"
  }'
```

### Test Option 2 (Docker + Proxy):
```bash
# Start server
DOCKER_EXECUTOR=true LOG_TRAFFIC=true node server.js

# Test with HTTP request
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{
    "code": "const https = require(\"https\"); https.get(\"https://api.github.com/users/github\", res => { console.log(res.statusCode); });"
  }'

# Check server logs for:
# [PROXY] GET https://api.github.com/users/github
```

### Test Option 3 (Full Policy):
```bash
# Start server
DOCKER_EXECUTOR=true node server.js

# Test allowed endpoint
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{
    "code": "const https = require(\"https\"); https.get(\"https://api.stripe.com/v1/products\", res => { console.log(res.statusCode); });"
  }'
# Expected: 200 OK (allowed by policy)

# Test blocked endpoint
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{
    "code": "const https = require(\"https\"); https.request({ hostname: \"api.stripe.com\", path: \"/v1/charges\", method: \"POST\" }, res => { console.log(res.statusCode); });"
  }'
# Expected: 403 Forbidden (blocked by policy)
```

---

## Recommended Rollout Plan

### Phase 1: Enable Basic Docker (This Week)
```bash
DOCKER_EXECUTOR=true node server.js
```
- Test with existing code
- Monitor performance
- Verify isolation works

### Phase 2: Add HTTP Proxy (Next Week)
- Modify `getSecureExecutor()` to use `DockerExecutorWithProxy`
- Enable traffic logging
- Analyze what domains/APIs users call

### Phase 3: Add Policy Enforcement (Week 3)
- Switch to `SecureExecutorWithPolicy`
- Start with permissive DEFAULT_SECURITY_POLICY
- Gradually tighten restrictions based on Phase 2 data

### Phase 4: Per-User Policies (Week 4+)
- Implement JWT decoding
- Create database schema for user policies
- Build admin UI for policy management

---

## Environment Variables Summary

```bash
# Basic Docker
DOCKER_EXECUTOR=true                           # Enable Docker execution

# Docker Configuration
DOCKER_IMAGE=gcr.io/distroless/nodejs20-debian12
DOCKER_MEMORY_LIMIT=512                        # MB
DOCKER_CPU_LIMIT=1.0                           # Cores

# HTTP Proxy
PROXY_PORT=8888
LOG_TRAFFIC=true                               # Log all HTTP requests

# Policy (Future)
JWT_SECRET=your-secret-key
POLICY_DB_URL=postgresql://...
```

---

## Troubleshooting

### "docker: command not found"
- You're in Codespaces - Docker daemon not available
- Use Kubernetes NetworkPolicies instead (see GKE_SANDBOX_IMPLEMENTATION.md)

### "Cannot find module './src/secure/DockerExecutorWithProxy'"
- Compile TypeScript first: `npm run build` or `tsc`
- Or require with `.ts` extension if using ts-node

### "Address already in use (proxy port)"
- Another process using port 8888
- Change PROXY_PORT: `PROXY_PORT=9999 node server.js`

### "Policy blocked my request but shouldn't have"
- Check `DEFAULT_SECURITY_POLICY` in `src/config/security-policy.ts`
- Add domain to `allowedDomains`
- Add path rule to `apiPathRules`

---

## Next Steps

1. **Choose your integration option** (recommended: start with Option 1, upgrade to Option 3)
2. **Update server.js** with chosen implementation
3. **Set environment variables**
4. **Test with existing code**
5. **Monitor logs** for security events
6. **Plan JWT migration** for per-user policies

📋 See also:
- `SECURITY_POLICY_GUIDE.md` - Policy configuration details
- `DOCKER_INTEGRATION_GUIDE.md` - Docker setup
- `HTTP_PROXY_FEATURES.md` - Proxy capabilities
