# Network Control Approaches: Comparison

## Quick Answer to Your Questions

### Q1: Can approaches #2 and #3 work in both Codespaces and Kubernetes?

| Approach | GitHub Codespaces | Kubernetes | Notes |
|----------|------------------|------------|-------|
| **#2: Network Namespaces** | ⚠️ Limited | ✅ Yes | Requires `CAP_NET_ADMIN` in Codespaces |
| **#3: HTTP Proxy** | ✅ Yes | ✅ Yes | Works everywhere, no special permissions |

### Q2: Can we control the response for approach #3?

**YES!** The HTTP proxy can:
- ✅ Modify response body (add, remove, redact data)
- ✅ Modify response headers
- ✅ Change status codes
- ✅ Mock entire responses
- ✅ Inject metadata
- ✅ Validate and sanitize content
- ✅ Log everything for audit

---

## Detailed Comparison

### Approach #2: Network Namespace Isolation

#### In GitHub Codespaces

**Limitations:**
```bash
# Check current capabilities
capsh --print

# Typical Codespace - missing NET_ADMIN
Current: = cap_chown,cap_dac_override,cap_fowner,cap_fsetid,...

# Required for network namespaces
Current: = cap_chown,cap_dac_override,...,cap_net_admin,...
```

**Workaround - Modify `.devcontainer/devcontainer.json`:**
```json
{
  "name": "Code Executor",
  "runArgs": [
    "--cap-add=NET_ADMIN",
    "--cap-add=NET_RAW"
  ],
  "containerEnv": {
    "ENABLE_NETWORK_CONTROL": "true"
  },
  "features": {
    "ghcr.io/devcontainers/features/docker-in-docker:2": {}
  }
}
```

**Then you can use:**
```bash
# Create isolated network namespace
ip netns add code-exec-isolated

# Execute code in isolated namespace
ip netns exec code-exec-isolated node user-code.js

# Configure firewall rules
ip netns exec code-exec-isolated iptables -A OUTPUT -d api.stripe.com -j REJECT
```

**Verdict:** ⚠️ Works but requires privileged Codespace configuration

---

#### In Kubernetes

**Native Support - Several Options:**

##### Option 1: NetworkPolicy (Easiest)
```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: restrict-egress
spec:
  podSelector:
    matchLabels:
      app: code-executor
  policyTypes:
  - Egress
  egress:
  # Allow DNS only
  - ports:
    - protocol: UDP
      port: 53
  # Deny all other egress (including Stripe)
```

##### Option 2: Init Container + iptables
```yaml
initContainers:
- name: setup-firewall
  image: alpine/iptables
  securityContext:
    capabilities:
      add: ["NET_ADMIN"]
  command: ["sh", "-c"]
  args:
  - |
    # Block Stripe
    iptables -A OUTPUT -d 54.187.174.169 -j REJECT  # Stripe IP
    iptables -A OUTPUT -p tcp --dport 443 -m string --string "api.stripe.com" --algo bm -j REJECT

    # Log all outbound
    iptables -A OUTPUT -j LOG --log-prefix "EGRESS: "
```

##### Option 3: Istio Service Mesh
```yaml
apiVersion: security.istio.io/v1beta1
kind: ServiceEntry
metadata:
  name: block-stripe
spec:
  hosts:
  - "api.stripe.com"
  location: MESH_EXTERNAL
  resolution: DNS
  ---
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: deny-stripe
spec:
  action: DENY
  rules:
  - to:
    - operation:
        hosts: ["api.stripe.com"]
```

**Verdict:** ✅ Kubernetes has excellent native support

---

### Approach #3: HTTP Proxy with Traffic Inspection

#### Works Everywhere ✅

**Key Advantages:**
1. ✅ No special permissions required
2. ✅ Works in Codespaces, Kubernetes, local dev
3. ✅ Can modify requests AND responses
4. ✅ Easy to test and debug
5. ✅ Portable across environments

#### Response Control Examples

##### 1. Redact Sensitive Data
```javascript
modifyResponses: {
  'api.stripe.com': (body, headers) => {
    // Redact card numbers
    if (body.card && body.card.number) {
      body.card.number = body.card.number.replace(/(\d{4})\d+(\d{4})/, '$1****$2');
    }
    // Redact CVV
    if (body.card && body.card.cvc) {
      body.card.cvc = '***';
    }
    return body;
  }
}
```

##### 2. Inject Metadata
```javascript
modifyResponses: {
  '*': (body, headers) => {
    // Add proxy metadata to all responses
    body._proxy = {
      timestamp: new Date().toISOString(),
      cached: false,
      modified: true
    };
    return body;
  }
}
```

##### 3. Rate Limit Information
```javascript
modifyResponses: {
  'api.github.com': (body, headers) => {
    body._rateLimit = {
      limit: headers['x-ratelimit-limit'],
      remaining: headers['x-ratelimit-remaining'],
      reset: new Date(headers['x-ratelimit-reset'] * 1000)
    };
    return body;
  }
}
```

##### 4. Mock Responses
```javascript
mockResponses: {
  'api.stripe.com': {
    id: 'cus_mock',
    object: 'customer',
    email: 'test@example.com',
    _mock: true,
    _message: 'Stripe mocked for security'
  }
}
```

##### 5. Validate & Sanitize
```javascript
modifyResponses: {
  '*': (body, headers) => {
    let str = JSON.stringify(body);

    // Remove any leaked secrets
    str = str.replace(/sk_live_[a-zA-Z0-9]+/g, '[REDACTED_SECRET_KEY]');
    str = str.replace(/AKIA[0-9A-Z]{16}/g, '[REDACTED_AWS_KEY]');

    // Remove XSS attempts
    str = str.replace(/<script[^>]*>.*?<\/script>/gi, '');

    return JSON.parse(str);
  }
}
```

---

## Response Control Capabilities Matrix

| Capability | HTTP Proxy | Network Namespace | Service Mesh (Istio) |
|------------|------------|-------------------|---------------------|
| **Block domains** | ✅ Yes | ✅ Yes | ✅ Yes |
| **Log requests** | ✅ Yes | ⚠️ Limited | ✅ Yes |
| **Modify request headers** | ✅ Yes | ❌ No | ✅ Yes |
| **Modify request body** | ✅ Yes | ❌ No | ⚠️ Limited |
| **Modify response headers** | ✅ Yes | ❌ No | ✅ Yes |
| **Modify response body** | ✅ Yes | ❌ No | ⚠️ Limited (with Lua) |
| **Mock responses** | ✅ Yes | ❌ No | ⚠️ Partial |
| **Audit logging** | ✅ Yes | ⚠️ Limited | ✅ Yes |
| **Content inspection** | ✅ Yes | ❌ No | ✅ Yes |
| **Redact sensitive data** | ✅ Yes | ❌ No | ⚠️ Complex |
| **Rate limiting** | ✅ Yes | ❌ No | ✅ Yes |

---

## Recommended Approach

### For Your Codespace-Executor Project

**Best Choice: HTTP Proxy (#3)**

**Reasons:**
1. ✅ Works in both Codespaces and Kubernetes
2. ✅ No special permissions required
3. ✅ Full request/response control
4. ✅ Easy to integrate with existing `SecureExecutor.ts`
5. ✅ Portable and testable

### Implementation Strategy

```javascript
// In SecureExecutor.ts - before executing user code

// 1. Start proxy server
const proxy = new NetworkControlProxy({
  port: 8888,
  blockedDomains: this.config.blockedDomains || [],
  allowedDomains: this.config.allowedDomains || null,
  mockResponses: this.config.mockResponses || {},
  modifyResponses: this.config.responseModifiers || {},
  logRequests: true
});

const proxyServer = proxy.start();

// 2. Set environment variables for child process
const env = {
  ...limitedEnv,
  HTTP_PROXY: 'http://localhost:8888',
  HTTPS_PROXY: 'http://localhost:8888',
  NO_PROXY: 'localhost,127.0.0.1'
};

// 3. Execute code with proxy
const result = await this.executeInProcess(code, env);

// 4. Stop proxy
proxyServer.close();

// 5. Return result with network logs
return {
  ...result,
  networkLog: proxy.getRequestLog()
};
```

---

## Example: Detecting Stripe SDK Usage

When user code runs:
```javascript
const stripe = require('stripe')('sk_test_...');
const customer = await stripe.customers.create({
  email: 'test@example.com'
});
```

**With HTTP Proxy, you see:**
```
[PROXY] HTTPS CONNECT api.stripe.com:443
[PROXY] ❌ BLOCKED: api.stripe.com
[ERROR] Stripe API blocked by network policy
```

**Response returned to user:**
```json
{
  "error": "Network request blocked by policy",
  "domain": "api.stripe.com",
  "reason": "Domain is in blocklist",
  "suggestion": "Use mock mode or request access"
}
```

---

## Performance Comparison

| Approach | Latency Overhead | CPU Overhead | Memory Overhead |
|----------|-----------------|--------------|-----------------|
| Network Namespace | ~1-5ms | Low | Very Low |
| HTTP Proxy | ~5-20ms | Medium | Low |
| Service Mesh (Istio) | ~10-50ms | Medium-High | Medium |
| Module Patching | ~0.1-1ms | Very Low | Very Low |

---

## Security Comparison

| Approach | Bypass Difficulty | Security Level |
|----------|------------------|----------------|
| Network Namespace | Very Hard | ⭐⭐⭐⭐⭐ |
| HTTP Proxy (env vars) | Easy (unset vars) | ⭐⭐⭐ |
| Service Mesh | Very Hard | ⭐⭐⭐⭐⭐ |
| Module Patching | Medium (native modules) | ⭐⭐⭐⭐ |

**Best Security: Combine Multiple Approaches**
```javascript
// 1. Module patching (first line of defense)
patchHttpModules();

// 2. HTTP Proxy (second line of defense)
startProxy();

// 3. Network namespace (if available - ultimate defense)
if (hasCapNetAdmin()) {
  executeInNetworkNamespace();
}
```

---

## Next Steps

Want me to implement network control for your codebase? I can add:

1. ✅ HTTP/HTTPS module patching
2. ✅ HTTP proxy with response control
3. ✅ Domain blocklist/allowlist
4. ✅ Request/response logging
5. ✅ Automatic Stripe/AWS SDK detection
6. ✅ Kubernetes deployment configs
7. ✅ Network namespace support (when available)

Let me know which features you want!
