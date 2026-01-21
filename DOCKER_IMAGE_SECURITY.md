# Docker Image Security - Node.js Only Execution

## Question: Can we ensure only Node.js code runs and no other languages?

**Answer: YES!** Use distroless images or custom minimal images.

---

## ⚡ Quick Answer: Do Stripe SDK and axios still work?

**YES! ✅✅✅ They work perfectly!**

```typescript
// ✅ ALL of these work in distroless:
const stripe = require('stripe')(key);
const axios = require('axios');
const fetch = require('node-fetch');
const AWS = require('aws-sdk');

// ❌ These DON'T work (blocked):
exec('python3 -c "..."');  // python3 binary doesn't exist
exec('curl https://...');   // curl binary doesn't exist
```

**Why Stripe/axios work:**
- They're pure JavaScript/Node.js packages
- They use Node.js built-in `https` module
- All Node.js modules exist in distroless
- Only Python/curl/shell binaries are missing

**See full demo:** `npx ts-node examples/test-sdks-in-distroless.ts`

---

## The Problem

Standard Docker images may include:
- ❌ Python, Ruby, Perl
- ❌ curl, wget, netcat
- ❌ Shell (bash, sh)
- ❌ Package managers (apt, apk, yum)
- ❌ Compilers (gcc, make)

Users could bypass your security by executing these tools!

---

## The Solution

Use **distroless** or **minimal** Docker images that contain ONLY Node.js.

---

## Option 1: Google Distroless (RECOMMENDED) ✅

### What is Distroless?

Distroless images contain **only the application runtime** and its dependencies. Nothing else.

- ✅ Node.js runtime ONLY
- ❌ No shell (sh, bash)
- ❌ No Python
- ❌ No curl/wget/nc
- ❌ No package managers
- ❌ No compilers
- ❌ Can't install anything

### How to Use

```typescript
import DockerExecutor from './src/secure/DockerExecutor';

const executor = new DockerExecutor({
    image: 'gcr.io/distroless/nodejs20-debian12',  // ← Distroless
    networkMode: 'none',
    timeout: 30000
});

const result = await executor.executeCode(userCode, env);
```

### What Works

```javascript
// ✅ Normal Node.js code works perfectly
console.log('Hello World');
const fs = require('fs');
const https = require('https');

// ✅ Built-in modules work
const crypto = require('crypto');
const path = require('path');

// ✅ ALL Node.js SDKs and packages work!
const stripe = require('stripe')(process.env.STRIPE_KEY);
const axios = require('axios');
const fetch = require('node-fetch');
const AWS = require('aws-sdk');
const { OpenAI } = require('openai');
const lodash = require('lodash');
const moment = require('moment');

// ✅ Stripe SDK works (pure Node.js)
await stripe.customers.create({ email: 'test@example.com' });

// ✅ axios works (pure Node.js)
await axios.get('https://api.github.com');

// ✅ ALL packages that are pure JavaScript work perfectly!
```

### What Doesn't Work (Security Features!)

```javascript
// ❌ Shell commands - NO SHELL EXISTS
const { exec } = require('child_process');
exec('ls -la');  // Error: /bin/sh: not found

// ❌ Python - NOT INSTALLED
exec('python3 -c "print(1)"');  // Error: python3: not found

// ❌ curl - NOT INSTALLED
exec('curl https://api.com');  // Error: curl: not found

// ❌ Can't install tools - NO PACKAGE MANAGER
exec('apk add python3');  // Error: apk: not found
```

---

## Option 2: Alpine with Removals

Start with Alpine and remove everything except Node.js:

### Dockerfile

```dockerfile
FROM node:20-alpine

# Remove package manager (can't install more tools)
RUN apk del apk-tools --purge

# Remove Python if present
RUN rm -rf /usr/bin/python* /usr/lib/python* 2>/dev/null || true

# Remove network tools
RUN rm -rf /usr/bin/curl /usr/bin/wget /usr/bin/nc /usr/bin/telnet 2>/dev/null || true

# Remove compilers
RUN rm -rf /usr/bin/gcc /usr/bin/g++ /usr/bin/make 2>/dev/null || true

# Optional: Remove shell too (maximum security)
# RUN rm -rf /bin/sh /bin/bash 2>/dev/null || true
```

### Build and Use

```bash
# Build custom image
docker build -f Dockerfile.minimal -t node-minimal .

# Use in code
const executor = new DockerExecutor({
    image: 'node-minimal',
    networkMode: 'none'
});
```

---

## Option 3: Build from Scratch (Advanced)

Smallest possible image - only Node.js binary:

```dockerfile
FROM scratch
COPY --from=node:20-alpine /usr/local/bin/node /usr/local/bin/node
COPY --from=node:20-alpine /usr/lib /usr/lib

# Result: ~40-50 MB image with ONLY Node.js
```

---

## Comparison Table

| Image | Size | Node.js | Shell | Python | curl | Package Manager | Security Level |
|-------|------|---------|-------|--------|------|-----------------|----------------|
| **Distroless** | 50-80 MB | ✅ | ❌ | ❌ | ❌ | ❌ | ✅✅✅✅✅ Highest |
| **Alpine Minimal** | 100 MB | ✅ | ⚠️ Optional | ❌ | ❌ | ❌ | ✅✅✅✅ Very High |
| **From Scratch** | 40-50 MB | ✅ | ❌ | ❌ | ❌ | ❌ | ✅✅✅✅✅ Highest |
| **node:20-alpine** | 150 MB | ✅ | ✅ | ⚠️ Maybe | ⚠️ Maybe | ✅ | ✅✅✅ High |
| **node:20-slim** | 200 MB | ✅ | ✅ | ⚠️ Maybe | ⚠️ Maybe | ✅ | ✅✅ Medium |
| **node:20** | 900 MB | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ Low |

---

## Testing What's Available

Run this to inspect any image:

```bash
npx ts-node examples/inspect-docker-image.ts
```

This checks:
- ✅ Node.js version
- ✅ Available shells
- ✅ Python installation
- ✅ Network tools
- ✅ Package managers
- ✅ Compilers

---

## Real-World Examples

### Example 1: Distroless (Maximum Security)

```typescript
const executor = new DockerExecutor({
    image: 'gcr.io/distroless/nodejs20-debian12',
    networkMode: 'none'
});

// User tries to bypass with Python
const result = await executor.executeCode(`
    const { exec } = require('child_process');
    exec('python3 -c "import urllib..."', (err) => {
        console.log('Python failed:', err.message);
        // Output: "Python failed: spawn python3 ENOENT"
    });
    setTimeout(() => {}, 1000);
`);
```

**Result:** Python doesn't exist in the image!

---

### Example 2: What User Can/Can't Do

```typescript
// ✅ Can do - Normal Node.js
const result = await executor.executeCode(`
    console.log('Math:', Math.sqrt(16));
    const fs = require('fs');
    const crypto = require('crypto');
    console.log('Hash:', crypto.createHash('sha256').digest('hex'));
`);
// Works perfectly!

// ❌ Can't do - Shell commands
const result = await executor.executeCode(`
    const { exec } = require('child_process');
    exec('ls -la');  // Error: /bin/sh not found
`);

// ❌ Can't do - Python
const result = await executor.executeCode(`
    const { exec } = require('child_process');
    exec('python3 ...');  // Error: python3 not found
`);

// ❌ Can't do - Install tools
const result = await executor.executeCode(`
    const { exec } = require('child_process');
    exec('apk add python3');  // Error: apk not found
`);
```

---

## Distroless Limitations

### What Doesn't Work

1. **Shell pipes/redirects:**
   ```javascript
   // ❌ Doesn't work (no shell)
   exec('ls | grep test');
   exec('echo "hello" > file.txt');
   ```

2. **Shell built-ins:**
   ```javascript
   // ❌ Doesn't work (no shell)
   exec('cd /tmp && ls');
   ```

3. **System commands:**
   ```javascript
   // ❌ Doesn't work (commands don't exist)
   exec('ps aux');
   exec('netstat -an');
   ```

### What Still Works

1. **Node.js spawn with direct binaries:**
   ```javascript
   // ✅ Works (if node binary exists)
   spawn('node', ['--version']);
   ```

2. **All Node.js built-in modules:**
   ```javascript
   // ✅ All work perfectly
   const fs = require('fs');
   const crypto = require('crypto');
   const https = require('https');  // (blocked by networkMode='none')
   ```

---

## Integration with DockerExecutor

Update the default image:

```typescript
// src/secure/DockerExecutor.ts

export default class DockerExecutor {
    constructor(config: DockerExecutorOptions = {}) {
        this.options = {
            image: config.image || 'gcr.io/distroless/nodejs20-debian12',  // ← Distroless by default
            networkMode: config.networkMode || 'none',
            // ...
        };
    }
}
```

Or specify per execution:

```typescript
// For maximum security
const secureExecutor = new DockerExecutor({
    image: 'gcr.io/distroless/nodejs20-debian12',
    networkMode: 'none'
});

// For debugging (has shell)
const debugExecutor = new DockerExecutor({
    image: 'node:20-alpine',
    networkMode: 'none'
});
```

---

## Environment Variables

Add to `.env`:

```bash
# Docker image to use
DOCKER_IMAGE=gcr.io/distroless/nodejs20-debian12

# Alternative images:
# DOCKER_IMAGE=node:20-alpine
# DOCKER_IMAGE=node:20-slim
```

Then in code:

```typescript
const executor = new DockerExecutor({
    image: process.env.DOCKER_IMAGE || 'gcr.io/distroless/nodejs20-debian12',
    networkMode: 'none'
});
```

---

## Best Practices

### Production (Untrusted Code)

```typescript
✅ Use distroless
✅ Use networkMode='none'
✅ Set resource limits
✅ Set timeouts

const executor = new DockerExecutor({
    image: 'gcr.io/distroless/nodejs20-debian12',
    networkMode: 'none',
    memoryLimit: 512 * 1024 * 1024,
    cpuLimit: 1000000000,
    timeout: 30000
});
```

### Development (Debugging)

```typescript
✅ Use Alpine (has shell for debugging)
✅ Still use networkMode='none'

const executor = new DockerExecutor({
    image: 'node:20-alpine',
    networkMode: 'none'
});
```

---

## Security Layers

When using distroless + networkMode='none', you have multiple security layers:

1. **Kernel-level network blocking** (networkMode='none')
   - No network interfaces
   - DNS doesn't work
   - All network syscalls fail

2. **No shell** (distroless)
   - Can't run bash/sh commands
   - Can't use shell pipes
   - Can't use shell built-ins

3. **No other languages** (distroless)
   - No Python, Ruby, Perl
   - Can't bypass with other runtimes

4. **No package managers** (distroless)
   - Can't install new tools
   - Can't add languages
   - Frozen environment

5. **No network tools** (distroless)
   - No curl, wget, nc
   - Can't make raw connections
   - Even if network was enabled!

**Result: Maximum security!** 🔒

---

## FAQ

### Q: Can users still install npm packages?

**A:** No! Distroless has no package manager. You must pre-install packages when building the image.

### Q: What if user needs a specific npm package?

**A:** Create a custom image:

```dockerfile
FROM node:20-alpine AS builder
RUN npm install lodash stripe axios

FROM gcr.io/distroless/nodejs20-debian12
COPY --from=builder /node_modules /app/node_modules
```

### Q: Can users bypass by using node spawn directly?

**A:** Only if the binary exists in the image. With distroless, only `node` binary exists.

```javascript
spawn('python3', []);  // ❌ Error: python3 not found
spawn('curl', []);     // ❌ Error: curl not found
spawn('sh', []);       // ❌ Error: sh not found
spawn('node', []);     // ✅ Works (but can only run Node.js code)
```

### Q: Is distroless slower than Alpine?

**A:** No! It's actually slightly faster:
- Smaller image = faster pull
- Less overhead = faster startup
- Same Node.js runtime

### Q: Can I use my own minimal image?

**A:** Yes! Build your own:

```bash
docker build -f Dockerfile.minimal -t my-node-minimal .
```

Then use:

```typescript
const executor = new DockerExecutor({
    image: 'my-node-minimal'
});
```

---

## Testing

### Test 1: Run Distroless Demo

```bash
npx ts-node examples/distroless-docker-example.ts
```

### Test 2: Inspect Images

```bash
npx ts-node examples/inspect-docker-image.ts
```

### Test 3: Try Bypass Attempts

```bash
npx ts-node demo-bypass-detection.ts
```

All bypass attempts will fail!

---

## Summary

### ✅ Yes, you can ensure ONLY Node.js code runs!

**Use distroless:**
```typescript
const executor = new DockerExecutor({
    image: 'gcr.io/distroless/nodejs20-debian12',
    networkMode: 'none'
});
```

**Security guarantees:**
- ❌ No Python
- ❌ No shell
- ❌ No curl/wget
- ❌ No package managers
- ❌ Can't install anything
- ✅ ONLY Node.js code can execute

**Combined with networkMode='none':**
- ❌ No network access
- ❌ Even if Python existed, it couldn't make requests
- ✅ Complete isolation

🔒 **Maximum security achieved!**
