# Docker Network Isolation: Two Approaches

## TL;DR

We have **two Docker executors** with different network strategies:

| Executor | Network Mode | URL Protection | Visibility | Use Case |
|----------|--------------|----------------|------------|----------|
| **DockerExecutor** | `none` | 🔒 Blocks ALL URLs | ❌ No logs | Maximum security |
| **DockerExecutorWithProxy** | `bridge` + Proxy | ✅ Selective blocking | ✅ Full logs | Policy enforcement |

---

## Approach 1: Complete Network Isolation (DockerExecutor)

**File:** `src/secure/DockerExecutor.ts`

```typescript
await docker.run(image, ['node', '/work/code.js'], stdout, {
  HostConfig: {
    NetworkMode: 'none',  // ← NO network access at all
    AutoRemove: true,
    Memory: this.memoryLimit,
    CpuQuota: this.cpuLimit
  }
});
```

### What This Does

**Blocks EVERYTHING at the kernel level:**

```javascript
// Inside Docker container with networkMode='none'

// ❌ ALL of these fail:
fetch('https://api.stripe.com')           // Error: ENETUNREACH
const stripe = require('stripe')('key');
stripe.products.list()                    // Error: ENETUNREACH

https.get('https://api.github.com')       // Error: ENETUNREACH
dns.resolve('google.com')                 // Error: ENETUNREACH
net.connect(443, 'api.stripe.com')       // Error: ENETUNREACH

// Even localhost is blocked:
fetch('http://127.0.0.1:3000')           // Error: ENETUNREACH
```

### How It Works

```
┌─────────────────────────────────────┐
│ Docker Container                     │
│ networkMode: 'none'                  │
│                                      │
│  ┌────────────────────────────┐    │
│  │ User Code                  │    │
│  │ fetch('https://...')       │    │
│  └────────────────────────────┘    │
│              ↓                       │
│  ┌────────────────────────────┐    │
│  │ Kernel Network Stack       │    │
│  │ "No network interface"     │    │
│  │ Returns: ENETUNREACH       │    │
│  └────────────────────────────┘    │
│                                      │
│  🚫 No network interface exists     │
│  🚫 No routing table                │
│  🚫 No DNS resolver                 │
│  🚫 Cannot reach ANY IP address     │
└─────────────────────────────────────┘
```

**Technical Details:**
- Container has NO network interface (not even `lo` loopback)
- No routing table entries
- No DNS resolution possible
- Kernel returns `ENETUNREACH` (Network is unreachable)
- **Cannot be bypassed** - it's enforced at the kernel level

### When to Use

✅ **Use when you want ZERO network access:**
- Code that only does local computation
- File processing
- Data transformations
- Testing untrusted code

❌ **Don't use when:**
- Code needs to call external APIs
- You want to enforce selective policies
- You need visibility into what URLs are attempted

---

## Approach 2: Selective Blocking with Proxy (DockerExecutorWithProxy)

**File:** `src/secure/DockerExecutorWithProxy.ts`

```typescript
await docker.run(image, ['node', '/work/code.js'], stdout, {
  Env: [
    `HTTP_PROXY=http://host.docker.internal:${this.proxyPort}`,
    `HTTPS_PROXY=http://host.docker.internal:${this.proxyPort}`,
    ...otherEnvVars
  ],
  HostConfig: {
    NetworkMode: 'bridge',  // ← Network is available but routed through proxy
    AutoRemove: true,
    Memory: this.memoryLimit,
    CpuQuota: this.cpuLimit
  }
});
```

### What This Does

**Routes ALL HTTP/HTTPS traffic through proxy on host:**

```javascript
// Inside Docker container with networkMode='bridge' + HTTP_PROXY

// ✅ These go through proxy (can be allowed or blocked by policy):
fetch('https://api.stripe.com')           // → Proxy checks policy → Allow/Block
const stripe = require('stripe')('key');
stripe.products.list()                    // → Proxy checks policy → Allow/Block

https.get('https://api.github.com')       // → Proxy checks policy → Allow/Block

// ⚠️ These bypass the HTTP proxy:
dns.resolve('google.com')                 // Works (not HTTP/HTTPS)
net.connect(443, 'api.stripe.com')       // Works (raw TCP socket)
```

### How It Works

```
┌──────────────────────────────────────────────────────────┐
│ Docker Container                                          │
│ networkMode: 'bridge'                                     │
│ HTTP_PROXY=http://host.docker.internal:8888             │
│                                                           │
│  ┌────────────────────────────────────────┐             │
│  │ User Code                               │             │
│  │ fetch('https://api.stripe.com')        │             │
│  └────────────────────────────────────────┘             │
│                    ↓                                      │
│  ┌────────────────────────────────────────┐             │
│  │ Node.js HTTP/HTTPS Module              │             │
│  │ Reads HTTP_PROXY env var                │             │
│  │ "Send to proxy instead of api.stripe.com"│           │
│  └────────────────────────────────────────┘             │
│                    ↓                                      │
│  ┌────────────────────────────────────────┐             │
│  │ Kernel Network Stack                    │             │
│  │ Has network interface (eth0)            │             │
│  │ Can route to host via bridge            │             │
│  └────────────────────────────────────────┘             │
│                    ↓                                      │
└────────────────────┼──────────────────────────────────────┘
                     │
                     │ TCP to host.docker.internal:8888
                     ↓
┌──────────────────────────────────────────────────────────┐
│ Host Machine                                              │
│                                                           │
│  ┌────────────────────────────────────────┐             │
│  │ HTTP Proxy (port 8888)                 │             │
│  │ Has user's SecurityPolicy               │             │
│  │                                         │             │
│  │ decision = isRequestAllowed(           │             │
│  │   policy,                              │             │
│  │   'api.stripe.com',                    │             │
│  │   'GET',                               │             │
│  │   '/v1/products'                       │             │
│  │ )                                      │             │
│  │                                         │             │
│  │ if (allowed) → Forward to real API     │             │
│  │ if (blocked) → Return 403              │             │
│  └────────────────────────────────────────┘             │
└──────────────────────────────────────────────────────────┘
```

### When to Use

✅ **Use when you want selective enforcement:**
- Allow some domains, block others
- Allow some API paths, block others
- Need visibility into what URLs are called
- Want complete audit trail

❌ **Don't use when:**
- You want 100% network blocking (use Approach 1)
- User code uses raw TCP sockets (bypass proxy)

---

## Security Comparison

### Approach 1: networkMode='none'

**Strengths:**
- 🔒 **100% secure** - No network access possible
- 🔒 **Cannot be bypassed** - Kernel-level enforcement
- 🔒 **Works for raw TCP** - Blocks everything, not just HTTP

**Weaknesses:**
- ❌ **No visibility** - Can't see what URLs were attempted
- ❌ **All or nothing** - Can't allow specific domains
- ❌ **No audit trail** - Don't know what user tried to access

**Bypass attempts:**
```javascript
// All of these fail with ENETUNREACH
https.get('https://api.stripe.com')      // ❌ Blocked
fetch('https://api.github.com')          // ❌ Blocked
net.connect(443, 'evil.com')            // ❌ Blocked
child_process.exec('curl evil.com')     // ❌ Blocked (curl not in distroless anyway)
```

---

### Approach 2: networkMode='bridge' + Proxy

**Strengths:**
- ✅ **Selective enforcement** - Allow some, block others
- ✅ **Complete visibility** - See all HTTP requests in networkLog
- ✅ **Audit trail** - Know exactly what was allowed/blocked
- ✅ **Policy-based** - Different rules per user

**Weaknesses:**
- ⚠️ **Only protects HTTP/HTTPS** - Raw TCP/UDP can bypass
- ⚠️ **Proxy can be discovered** - User can see HTTP_PROXY env var
- ⚠️ **DNS works** - User can do DNS lookups

**Bypass attempts:**
```javascript
// HTTP/HTTPS - goes through proxy ✅
https.get('https://api.stripe.com')      // ✅ Proxy checks policy
fetch('https://api.github.com')          // ✅ Proxy checks policy

// Raw TCP - bypasses proxy ⚠️
const net = require('net');
const socket = net.connect(443, 'evil.com');  // ⚠️ Bypasses proxy!

// DNS - not protected ⚠️
const dns = require('dns');
dns.resolve('evil.com', (err, addrs) => {});  // ⚠️ Works

// However, in distroless image:
child_process.exec('curl evil.com')     // ❌ curl doesn't exist
child_process.exec('python -c ...')     // ❌ python doesn't exist
```

---

## Which One Do We Use?

**It depends on environment variables:**

### Current Implementation (SecureExecutor.ts)

```typescript
// Line 64-77 in SecureExecutor.ts
if (process.env.DOCKER_EXECUTOR === 'true') {
  // Uses DockerExecutor (networkMode='none')
  this.dockerExecutor = new DockerExecutor({
    networkMode: 'none',  // ← Complete isolation
    timeout: this.defaultTimeout
  });
}
```

**This gives complete network blocking but NO visibility.**

---

### With Unified Executor (Recommended)

```typescript
// In SecureExecutorUnified.ts
const mode = this.detectMode(
  dockerEnabled,    // DOCKER_EXECUTOR=true
  proxyEnabled,     // ENABLE_HTTP_PROXY=true
  policyEnabled     // ENABLE_POLICY=true
);

if (mode === 'docker-policy') {
  // Uses DockerExecutorWithProxy (networkMode='bridge' + proxy)
  this.executor = new DockerExecutorWithProxy({
    networkMode: 'bridge',
    proxyPort: 8888,
    policy: userPolicy
  });
}
```

**This gives selective enforcement with complete visibility.**

---

## Configuration Matrix

| Env Variables | Executor Used | Network Mode | Protection | Visibility |
|---------------|---------------|--------------|------------|------------|
| None | spawn | N/A | ❌ None | ❌ None |
| `DOCKER_EXECUTOR=true` | DockerExecutor | `none` | 🔒 Block ALL | ❌ None |
| `DOCKER_EXECUTOR=true`<br>`ENABLE_HTTP_PROXY=true` | DockerExecutorWithProxy | `bridge` + proxy | ✅ HTTP/HTTPS only | ✅ Full logs |
| `DOCKER_EXECUTOR=true`<br>`ENABLE_HTTP_PROXY=true`<br>`ENABLE_POLICY=true` | SecureExecutorWithPolicy | `bridge` + proxy | ✅ Policy-based | ✅ Full logs |

---

## Recommendation: Layered Security

**Best practice: Use BOTH approaches in layers:**

### Layer 1: Docker networkMode='none' (Base)
- Default: Block ALL network access
- No policy needed
- 100% secure for compute-only tasks

### Layer 2: Add Proxy When Needed (Opt-in)
- User explicitly requests network access via policy
- Enable networkMode='bridge' + proxy for that user
- Enforce their specific allowlist

**Example:**
```typescript
// In SecureExecutorUnified.ts
if (policy && policy.allowedDomains.length > 0) {
  // User has network permissions, use proxy
  return new DockerExecutorWithProxy({
    networkMode: 'bridge',
    policy
  });
} else {
  // No network permissions, complete isolation
  return new DockerExecutor({
    networkMode: 'none'
  });
}
```

---

## Summary

**Yes, Docker DOES protect against URLs** - in TWO different ways:

1. **Complete Blocking** (`networkMode='none'`)
   - No network interface
   - ALL URLs blocked
   - Kernel-level enforcement
   - Can't be bypassed
   - ❌ No visibility

2. **Selective Blocking** (`networkMode='bridge'` + Proxy)
   - Network available
   - HTTP/HTTPS routed through proxy
   - Policy enforcement
   - ⚠️ Raw TCP can bypass
   - ✅ Complete visibility

**Currently using:** Approach 1 (complete blocking) when `DOCKER_EXECUTOR=true`

**With policies:** Switch to Approach 2 (selective blocking) when `ENABLE_POLICY=true`

Both protect against URLs, just in different ways for different use cases!
