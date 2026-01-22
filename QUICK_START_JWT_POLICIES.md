# Quick Start: Enable JWT-Based Policies

This is the **minimal code** needed to enable JWT-based policies in your server.js.

## Step 1: Add Imports (Line ~20)

```javascript
// Secure execution system with JWT policies
const SecureExecutorUnified = require('./src/secure/SecureExecutorUnified').default;
const { getPolicyFetcher } = require('./src/utils/policy-fetcher');
const { DEFAULT_SECURITY_POLICY } = require('./src/config/security-policy');

const policyFetcher = getPolicyFetcher();
```

## Step 2: Replace executeCodeWithSecureMode() (Line ~884)

```javascript
async function executeCodeWithSecureMode(payload, res, headerEnvVars = {}, authHeader = null) {
    try {
        // Extract JWT and fetch policy
        const jwt = authHeader?.replace('Bearer ', '').trim();
        let policy = DEFAULT_SECURITY_POLICY;

        if (jwt && process.env.DOCKER_EXECUTOR === 'true' && process.env.ENABLE_POLICY === 'true') {
            console.log('[Server] Fetching policy for JWT');
            const policyResult = await policyFetcher.fetchPolicy(jwt);
            if (policyResult.success && policyResult.policy) {
                policy = policyResult.policy;
                console.log('[Server] Using user policy:', {
                    domains: policy.allowedDomains.length,
                    packages: policy.allowedPackages.length
                });
            }
        }

        // Create executor with policy
        const executor = new SecureExecutorUnified({
            timeout: 30000,
            policy: policy
        });

        const result = await executor.executeCode(payload, headerEnvVars);

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

## Step 3: Update /execute Call (Line ~517)

Find:
```javascript
executeCodeWithSecureMode(payload, res, headerEnvVars);
```

Replace with:
```javascript
executeCodeWithSecureMode(payload, res, headerEnvVars, req.headers.authorization);
```

## Step 4: Remove getSecureExecutor() (Line ~33)

Delete the old `getSecureExecutor()` function - it's no longer needed since we create the executor per-request with the user's policy.

## Step 5: Compile TypeScript

```bash
npm run build
# or
npx tsc
```

## Step 6: Start Server with Policies Enabled

```bash
DOCKER_EXECUTOR=true \
ENABLE_HTTP_PROXY=true \
ENABLE_POLICY=true \
node server.js
```

## Done! 🎉

Now test with a real JWT:

```bash
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
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
    ]
  }
}
```

## What Happens?

1. ✅ Extracts JWT from `Authorization: Bearer <token>` header
2. ✅ Fetches policy from `https://api.keyboard.dev/api/user/policies`
3. ✅ Caches policy for 1 minute
4. ✅ Applies user's domain/API path/package restrictions
5. ✅ Logs all network requests in `networkLog`
6. ✅ Blocks unauthorized requests with 403 + reason

## Troubleshooting

**"Policy fetch failed"**
- Check JWT is valid
- Check API endpoint is accessible
- Falls back to DEFAULT_SECURITY_POLICY automatically

**"Docker not available"**
- You're in Codespaces - use Kubernetes NetworkPolicies instead
- See GKE_SANDBOX_IMPLEMENTATION.md

**"No network logs"**
- Make sure `ENABLE_HTTP_PROXY=true`
- Make sure `DOCKER_EXECUTOR=true`

## See Also

- `JWT_POLICY_INTEGRATION.md` - Complete integration guide
- `SERVER_UNIFIED_INTEGRATION.md` - Output format details
- `SECURITY_POLICY_GUIDE.md` - Policy configuration
- `demo-jwt-policy.ts` - Working demo with real JWT
- `demo-mock-policy-api.ts` - Demo without JWT
