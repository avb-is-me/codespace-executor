# How proxy-enforcement.js Works

## The Problem We're Solving

**Without enforcement:**
```javascript
// User code can easily bypass the proxy:
delete process.env.HTTP_PROXY;    // Bypass successful!
delete process.env.HTTPS_PROXY;   // Bypass successful!

const https = require('https');
https.get('https://api.stripe.com', ...);  // ✅ Works - proxy bypassed!
```

**With enforcement:**
```javascript
// User code tries to bypass:
delete process.env.HTTP_PROXY;    // ❌ Process killed immediately!
// Never gets here - execution terminated
```

---

## Three Approaches (All Prevent Bypass)

### **Approach 1: Watchdog Process** ⏱️

**How it works:**
1. Inject enforcement code BEFORE user code
2. Start periodic checks every 100ms
3. If proxy vars are missing/modified → kill process

**Visual Flow:**
```
┌────────────────────────────────────────────────────┐
│ 1. Parent Process                                  │
│    - Wraps user code with enforcement code         │
│    - Sets HTTP_PROXY and HTTPS_PROXY env vars     │
│    - Spawns child process                          │
└────────────────────────────────────────────────────┘
                        ↓
┌────────────────────────────────────────────────────┐
│ 2. Child Process Starts                            │
│    ENFORCEMENT CODE RUNS FIRST:                    │
│    - Makes proxy vars immutable (Object.define)    │
│    - Starts setInterval checking every 100ms       │
│    - Checks if HTTP_PROXY & HTTPS_PROXY exist     │
└────────────────────────────────────────────────────┘
                        ↓
┌────────────────────────────────────────────────────┐
│ 3. User Code Runs                                  │
│    - User tries: delete process.env.HTTP_PROXY    │
│    - Watchdog detects missing var within 100ms    │
│    - Calls process.exit(1)                         │
│    - Process terminated! ✅                        │
└────────────────────────────────────────────────────┘
```

**Code Injection Example:**

What gets written to the temp file:
```javascript
// ============ ENFORCEMENT CODE (injected) ============
(function() {
  'use strict';
  const PROXY_URL = 'http://localhost:8888';

  // Make vars immutable
  Object.defineProperty(process.env, 'HTTP_PROXY', {
    value: PROXY_URL,
    writable: false,      // Can't change value
    configurable: false,  // Can't delete or reconfigure
    enumerable: true
  });

  // Periodic watchdog check
  const checkInterval = setInterval(() => {
    if (!process.env.HTTP_PROXY || !process.env.HTTPS_PROXY) {
      console.error('[SECURITY] Proxy vars were removed!');
      process.exit(1);  // KILL THE PROCESS
    }

    if (process.env.HTTP_PROXY !== PROXY_URL) {
      console.error('[SECURITY] Proxy vars were modified!');
      process.exit(1);  // KILL THE PROCESS
    }
  }, 100);  // Check every 100ms
})();

// ============ USER CODE (original) ============
(async () => {
  // User's code runs here...
  console.log('Hello world');
})();
```

**Pros:**
- ✅ Catches tampering within 100ms
- ✅ Simple to understand
- ✅ Works on all platforms

**Cons:**
- ⚠️ 100ms window where tampering might slip through
- ⚠️ Periodic checks use some CPU

---

### **Approach 2: Native Module Enforcer** 🔒

**How it works:**
1. Intercept `require('http')` and `require('https')`
2. Wrap `.request()` and `.get()` methods
3. Check proxy vars BEFORE EVERY network request
4. If vars missing/modified → kill process immediately

**Visual Flow:**
```
┌────────────────────────────────────────────────────┐
│ 1. Enforcement Code Runs First                     │
│    - Save original http/https modules              │
│    - Override Module.prototype.require             │
│    - Return wrapped modules                        │
└────────────────────────────────────────────────────┘
                        ↓
┌────────────────────────────────────────────────────┐
│ 2. User Code: require('https')                     │
│    - User calls require('https')                   │
│    - Gets WRAPPED version with enforcement         │
│    - Not the original!                             │
└────────────────────────────────────────────────────┘
                        ↓
┌────────────────────────────────────────────────────┐
│ 3. User Code: https.get('api.stripe.com')         │
│    - Wrapped .get() method is called               │
│    - FIRST: Check if HTTP_PROXY exists            │
│    - FIRST: Check if HTTPS_PROXY exists           │
│    - If missing → process.exit(1)                  │
│    - If intact → call original https.get()         │
└────────────────────────────────────────────────────┘
```

**Code Example:**

```javascript
// ENFORCEMENT CODE (injected before user code)
const Module = require('module');
const originalRequire = Module.prototype.require;

// Get real http/https modules
const originalHttp = originalRequire.call(module, 'http');
const originalHttps = originalRequire.call(module, 'https');

// Wrap the request methods
function wrapRequest(fn) {
  return function(...args) {
    // ⚡ CHECK HAPPENS HERE - BEFORE EVERY REQUEST
    if (!process.env.HTTP_PROXY || !process.env.HTTPS_PROXY) {
      console.error('[SECURITY] Proxy vars unset!');
      process.exit(1);  // KILL IMMEDIATELY
    }

    // Proxy vars intact, allow request
    return fn.apply(this, args);
  };
}

// Create wrapped modules
const wrappedHttps = {
  ...originalHttps,
  request: wrapRequest(originalHttps.request),
  get: wrapRequest(originalHttps.get)
};

// Intercept require
Module.prototype.require = function(id) {
  if (id === 'https') return wrappedHttps;  // Return wrapped version
  return originalRequire.apply(this, arguments);
};

// ============ USER CODE ============
const https = require('https');  // Gets wrapped version

delete process.env.HTTP_PROXY;   // Vars are gone

https.get('https://api.stripe.com', (res) => {
  // ❌ NEVER GETS HERE
  // Process was killed when https.get() checked vars
});
```

**Timeline:**
```
Time 0ms:   User code runs
Time 10ms:  User deletes HTTP_PROXY
Time 20ms:  User code continues running (no detection yet)
Time 50ms:  User calls https.get()
Time 50ms:  Wrapper function checks: HTTP_PROXY missing!
Time 50ms:  process.exit(1) - KILLED
```

**Pros:**
- ✅ Zero-delay detection (checks on every request)
- ✅ No periodic checks (no CPU overhead)
- ✅ Catches tampering before request is made

**Cons:**
- ⚠️ Only detects when network request is attempted
- ⚠️ User could delete vars and not make requests (no detection)

---

### **Approach 3: External Watchdog** 👁️

**How it works:**
1. Parent process monitors child process externally
2. Reads `/proc/<pid>/environ` file on Linux
3. Checks if proxy vars exist in child's actual environment
4. If missing/modified → parent kills child

**Visual Flow:**
```
┌──────────────────────────────┐
│ Parent Process               │
│                              │
│ 1. Spawn child               │
│ 2. Start watchdog interval   │
│    (every 50ms)              │
│                              │
│ 3. Read /proc/<pid>/environ  │
│ 4. Parse environment vars    │
│ 5. Check HTTP_PROXY exists   │
│ 6. If missing → kill child   │
└──────────────────────────────┘
        ↓ spawns ↓
┌──────────────────────────────┐
│ Child Process                │
│                              │
│ (User code runs here)        │
│                              │
│ delete process.env.HTTP_PROXY│
│ ↑ Vars deleted               │
└──────────────────────────────┘
        ↑ monitors ↑
┌──────────────────────────────┐
│ Watchdog Interval (50ms)     │
│                              │
│ Reads: /proc/1234/environ    │
│ Finds: PATH=/bin:...         │
│        HOME=/home/user       │
│        (no HTTP_PROXY!)      │
│                              │
│ → child.kill('SIGTERM')      │
└──────────────────────────────┘
```

**Reading /proc/<pid>/environ:**

Linux stores each process's environment variables in a special file:
```bash
$ cat /proc/1234/environ
PATH=/usr/bin:/bin\0HOME=/home/user\0HTTP_PROXY=http://localhost:8888\0
```

The watchdog reads this file:
```javascript
const environPath = `/proc/${child.pid}/environ`;
const environ = fs.readFileSync(environPath, 'utf8');

// Parse: vars are separated by null bytes (\0)
const envVars = environ.split('\0').reduce((acc, pair) => {
  const [key, value] = pair.split('=');
  if (key) acc[key] = value;
  return acc;
}, {});

// Check if proxy vars exist
if (!envVars.HTTP_PROXY) {
  child.kill('SIGTERM');  // Kill from parent!
}
```

**Timeline:**
```
Time 0ms:   Parent spawns child
Time 0ms:   Parent starts watchdog interval (every 50ms)
Time 10ms:  Child code deletes HTTP_PROXY
Time 50ms:  Watchdog checks /proc/<pid>/environ
Time 50ms:  Finds HTTP_PROXY missing
Time 50ms:  Parent kills child - TERMINATED
```

**Pros:**
- ✅ Cannot be bypassed from inside child process
- ✅ Parent monitors child externally
- ✅ Fastest detection (50ms interval)

**Cons:**
- ❌ Linux-only (uses `/proc` filesystem)
- ❌ Requires file system access
- ❌ More complex architecture

---

## Side-by-Side Comparison

### Scenario: User tries to bypass by deleting vars

**Approach 1 (Watchdog):**
```javascript
// User code
delete process.env.HTTP_PROXY;   // Deleted
console.log('Still running...');  // Prints (for up to 100ms)
// ... up to 100ms later ...
// [SECURITY] Proxy vars removed!
// Process killed
```

**Approach 2 (Module Enforcer):**
```javascript
// User code
delete process.env.HTTP_PROXY;   // Deleted
console.log('Still running...');  // ✅ Prints
console.log('Still going...');    // ✅ Prints

https.get('api.stripe.com', ...); // ❌ Killed here
console.log('Never prints');      // ❌ Never executes
```

**Approach 3 (External Watchdog):**
```javascript
// User code
delete process.env.HTTP_PROXY;   // Deleted
console.log('Still running...');  // Prints (for up to 50ms)
// ... up to 50ms later ...
// [Parent kills process]
// Process terminated
```

---

## How to Use in Your Codebase

### Integration with SecureExecutor:

```javascript
const { WatchdogProxyEnforcer } = require('./proxy-enforcement');

class SecureExecutor {
  async executeCode(code) {
    // Option 1: Use watchdog enforcer
    const enforcer = new WatchdogProxyEnforcer();
    const result = await enforcer.executeCode(code, 8888);

    if (result.tampered) {
      console.log('⚠️ User attempted to bypass proxy!');
    }

    return result;
  }
}
```

### What Actually Gets Executed:

**Your original code:**
```javascript
const code = `
  const stripe = require('stripe')('sk_test_...');
  console.log('Calling Stripe...');
`;
```

**What actually runs (after enforcement injection):**
```javascript
// ========== INJECTED ENFORCEMENT CODE ==========
(function() {
  'use strict';
  const PROXY_URL = 'http://localhost:8888';

  Object.defineProperty(process.env, 'HTTP_PROXY', {
    value: PROXY_URL,
    writable: false,
    configurable: false,
    enumerable: true
  });

  const checkInterval = setInterval(() => {
    if (!process.env.HTTP_PROXY || !process.env.HTTPS_PROXY) {
      console.error('[SECURITY] Proxy vars removed!');
      process.exit(1);
    }
  }, 100);

  process.on('exit', () => clearInterval(checkInterval));
})();

// ========== YOUR ORIGINAL CODE ==========
(async () => {
  const stripe = require('stripe')('sk_test_...');
  console.log('Calling Stripe...');
})();
```

---

## Testing It Yourself

Run the test suite:
```bash
cd examples
node proxy-enforcement.js
```

**Expected Output:**
```
=== Testing: Watchdog Enforcer ===

Test 1: Normal code
Result: ✅ PASSED
Output: Hello from normal code!
        HTTP_PROXY: http://localhost:8888

Test 2: Delete HTTP_PROXY
Result: ✅ BLOCKED
Error: [SECURITY] Proxy environment variables were removed!

Test 3: Modify HTTP_PROXY
Result: ✅ BLOCKED
Error: [SECURITY] Proxy environment variables were modified!

Test 4: Network request after unset
Result: ✅ BLOCKED
Error: [SECURITY] Proxy enforcement failed
```

---

## Which Approach Should You Use?

| Use Case | Recommended Approach |
|----------|---------------------|
| **General use** | Approach 2 (Module Enforcer) |
| **Maximum security** | Approach 3 (External Watchdog) + Linux |
| **Fastest detection** | Approach 3 (50ms interval) |
| **Cross-platform** | Approach 1 or 2 |
| **Least CPU overhead** | Approach 2 (no intervals) |

**My recommendation: Approach 2 (Native Module Enforcer)**
- ✅ Zero-delay detection on network requests
- ✅ No periodic checks (no CPU waste)
- ✅ Works on all platforms
- ✅ Harder to bypass than Approach 1

---

## Key Takeaway

All three approaches work by **injecting security code before user code runs**:

```
Normal spawn:
[User Code] → runs directly

With enforcement:
[Enforcement Code] → [User Code] → enforcement checks protect execution
```

The enforcement code acts as a **security guard** that monitors and kills the process if tampering is detected.
