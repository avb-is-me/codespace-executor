# Docker Persistence Guide

## Question: Does the Docker environment reset each /execute request?

**Answer: YES, by default!** Each `executeCode()` call creates a NEW container that is removed after execution.

---

## Current Behavior (Ephemeral Containers)

### What Happens on Each executeCode():

```typescript
const executor = new DockerExecutor({ image: 'my-image' });

// Execution 1:
await executor.executeCode('console.log("hello")');
// → Creates container_1, runs code, removes container_1

// Execution 2:
await executor.executeCode('console.log("world")');
// → Creates container_2, runs code, removes container_2

// Each execution is completely isolated!
```

### Container Lifecycle:

```
executeCode() called
    ↓
Create new container
    ↓
Run user code
    ↓
Collect output
    ↓
Remove container ← State lost!
    ↓
Return result
```

---

## What Does NOT Persist Between Executions

### 1. File System Changes

```typescript
// Execution 1:
await executor.executeCode(`
    const fs = require('fs');
    fs.writeFileSync('/tmp/data.txt', 'hello');
    console.log('File written');
`);
// Output: "File written"

// Execution 2:
await executor.executeCode(`
    const fs = require('fs');
    const exists = fs.existsSync('/tmp/data.txt');
    console.log('File exists:', exists);
`);
// Output: "File exists: false"  ← File is gone!
```

**Why:** Container 1 was removed after execution 1.

---

### 2. Global Variables

```typescript
// Execution 1:
await executor.executeCode(`
    global.counter = 1;
    console.log('Counter:', global.counter);
`);
// Output: "Counter: 1"

// Execution 2:
await executor.executeCode(`
    console.log('Counter:', global.counter);
`);
// Output: "Counter: undefined"  ← Variable is gone!
```

**Why:** Each execution runs in a new Node.js process in a new container.

---

### 3. Installed Packages (Runtime)

```typescript
// Execution 1:
await executor.executeCode(`
    // Imagine we installed a package at runtime
    const { exec } = require('child_process');
    exec('npm install lodash', () => {
        console.log('Package installed');
    });
`);

// Execution 2:
await executor.executeCode(`
    const lodash = require('lodash');  // ← Error: Cannot find module
`);
```

**Why:** npm install happened in container 1, which was removed.

---

## What DOES Persist

### 1. Docker Image

The base image and its contents persist:

```typescript
const executor = new DockerExecutor({
    image: 'my-executor:v1'  // ← This image persists
});

// All executions use the same image
await executor.executeCode('...');  // Uses my-executor:v1
await executor.executeCode('...');  // Uses my-executor:v1
await executor.executeCode('...');  // Uses my-executor:v1
```

If your image has pre-installed packages, they're available in every execution!

---

### 2. Environment Variables (Per Execution)

```typescript
// These persist within a single execution:
await executor.executeCode(
    `
    console.log('Key:', process.env.KEYBOARD_STRIPE_KEY);
    `,
    { KEYBOARD_STRIPE_KEY: 'sk_live_...' }  // ← Passed to this execution
);
```

But you need to pass them to each execution!

---

## Why Ephemeral Containers? (By Design)

### ✅ Security Benefits:

1. **No state pollution**
   - User A's code can't affect User B's execution
   - No leftover files or data

2. **Clean slate**
   - Each execution starts fresh
   - No accumulated state or corruption

3. **Resource cleanup**
   - Memory freed after each execution
   - No container sprawl

4. **Isolation**
   - One user can't see another user's data
   - No cross-user information leakage

---

## When You Need Persistence

### Option 1: Pass State as Environment Variables

```typescript
// Store state outside Docker
let userState = { counter: 0 };

// Execution 1:
const result1 = await executor.executeCode(
    `
    const counter = parseInt(process.env.STATE_COUNTER) + 1;
    console.log('Counter:', counter);
    console.log('OUTPUT_STATE:' + JSON.stringify({ counter }));
    `,
    { STATE_COUNTER: String(userState.counter) }
);

// Parse output to get new state
const newState = parseOutputState(result1.output);
userState = newState;

// Execution 2:
const result2 = await executor.executeCode(
    `
    const counter = parseInt(process.env.STATE_COUNTER) + 1;
    console.log('Counter:', counter);  // Will be 2
    `,
    { STATE_COUNTER: String(userState.counter) }
);
```

✅ **Benefits:** Simple, secure, stateless containers
❌ **Limitations:** State size limited, need to serialize

---

### Option 2: Mount Persistent Volumes

```typescript
const executor = new DockerExecutor({
    image: 'my-executor:v1',
    volumes: [
        '/host/user-data:/app/data:rw'  // ← Persistent storage
    ]
});

// Execution 1:
await executor.executeCode(`
    const fs = require('fs');
    fs.writeFileSync('/app/data/counter.txt', '1');
`);

// Execution 2:
await executor.executeCode(`
    const fs = require('fs');
    const value = fs.readFileSync('/app/data/counter.txt', 'utf8');
    console.log('Counter:', value);  // Output: "Counter: 1"
`);
```

✅ **Benefits:** True persistence, file system access
⚠️ **Security risks:**
- User A can read User B's files
- Need careful path isolation per user
- Files persist forever (storage management)

**Recommendation:** Use per-user volumes:
```typescript
volumes: [
    `/host/user-${userId}/data:/app/data:rw`
]
```

---

### Option 3: External State Storage (Recommended)

Store state outside Docker entirely:

```typescript
import redis from 'redis';
const redis = redis.createClient();

// Execution 1:
await executor.executeCode(`
    // Code that modifies state
    console.log('OUTPUT_STATE:' + JSON.stringify({ counter: 1 }));
`);

// Save state to Redis
await redis.set(`user:${userId}:state`, JSON.stringify({ counter: 1 }));

// Execution 2:
const state = JSON.parse(await redis.get(`user:${userId}:state`));
await executor.executeCode(
    `
    const counter = parseInt(process.env.STATE_COUNTER) + 1;
    console.log('Counter:', counter);
    `,
    { STATE_COUNTER: String(state.counter) }
);
```

✅ **Benefits:**
- Secure (per-user isolation)
- Scalable (distributed state)
- Clean (containers stay stateless)
- Manageable (easy to expire/delete)

---

## Persistent Container (Advanced)

If you REALLY need persistent containers:

```typescript
class PersistentDockerExecutor {
    private containerMap = new Map<string, Docker.Container>();

    async executeForUser(userId: string, code: string) {
        let container = this.containerMap.get(userId);

        if (!container) {
            // Create new container for this user
            container = await this.docker.createContainer({
                Image: 'my-executor:v1',
                Cmd: ['node'],
                Tty: true,
                OpenStdin: true
            });
            await container.start();
            this.containerMap.set(userId, container);
        }

        // Execute in existing container
        const exec = await container.exec({
            Cmd: ['node', '-e', code],
            AttachStdout: true,
            AttachStderr: true
        });

        const stream = await exec.start();
        // ... collect output

        return output;
    }

    async cleanupUser(userId: string) {
        const container = this.containerMap.get(userId);
        if (container) {
            await container.stop();
            await container.remove();
            this.containerMap.delete(userId);
        }
    }
}
```

⚠️ **Challenges:**
- Memory leaks (containers run forever)
- Resource management (when to cleanup?)
- Security (long-running containers are risky)
- Complexity (lifecycle management)

**Only use if:**
- You have a specific reason
- You implement proper cleanup
- You understand the security implications

---

## Recommended Approach for Production

### For Stateless Execution (Most Use Cases):

```typescript
const executor = new DockerExecutorWithProxy({
    image: 'my-executor:v1',  // Pre-built with packages
    networkMode: 'bridge',
    proxyPort: 8888,
    filterSensitiveHeaders: true
});

// Each execution is independent
await executor.executeCode(userCode, envVars);
```

**Why:**
- ✅ Simple
- ✅ Secure
- ✅ Scalable
- ✅ Resource efficient

---

### For Stateful Execution:

```typescript
// 1. Load state from external storage
const state = await redis.get(`user:${userId}:state`);

// 2. Pass state as env vars
const result = await executor.executeCode(
    userCode,
    {
        ...credentials,
        STATE_DATA: state
    }
);

// 3. Extract new state from output
const newState = parseState(result.output);

// 4. Save state back to external storage
await redis.set(`user:${userId}:state`, newState);
```

**Why:**
- ✅ Containers stay stateless
- ✅ State is managed externally
- ✅ Easy to scale
- ✅ Easy to backup/restore

---

## Summary Table

| Approach | Persistence | Security | Complexity | Scalability | Recommended |
|----------|-------------|----------|------------|-------------|-------------|
| **Ephemeral (default)** | None | ✅✅✅ High | ✅ Low | ✅✅✅ High | ✅ Yes |
| **Env vars** | Per-execution | ✅✅✅ High | ✅ Low | ✅✅✅ High | ✅ Yes |
| **External storage** | Full | ✅✅✅ High | ✅✅ Medium | ✅✅✅ High | ✅ Yes |
| **Mounted volumes** | Full | ⚠️ Medium | ✅✅ Medium | ✅✅ Medium | ⚠️ Maybe |
| **Persistent containers** | Full | ❌ Low | ❌ High | ❌ Low | ❌ No |

---

## FAQ

### Q: I want to install npm packages at runtime. Do they persist?

**A:** No! Each execution gets a fresh container. Use a pre-built image instead:

```bash
# Build once:
docker build -f Dockerfile.with-packages -t my-executor:v1 .

# Use everywhere:
const executor = new DockerExecutor({ image: 'my-executor:v1' });
```

### Q: Can I keep a database connection open?

**A:** No, containers are removed after execution. Use connection pooling outside Docker:

```typescript
// Pool lives outside Docker
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Pass connection string to each execution
await executor.executeCode(code, {
    DATABASE_URL: process.env.DATABASE_URL
});
```

### Q: What about WebSocket connections?

**A:** Ephemeral containers can't maintain WebSocket connections. Use:
1. HTTP requests instead (RESTful)
2. External service to manage WebSockets
3. Persistent containers (not recommended)

### Q: How do I share data between executions?

**A:** Use external storage (Redis, S3, Database):

```typescript
// Execution 1: Save data
await s3.putObject({
    Bucket: 'user-data',
    Key: `${userId}/data.json`,
    Body: JSON.stringify(data)
});

// Execution 2: Load data
const data = await s3.getObject({
    Bucket: 'user-data',
    Key: `${userId}/data.json`
});
```

---

## Conclusion

**Default Behavior:** ✅ Ephemeral containers (reset each time)

**Why:** Security, resource management, isolation

**Recommendation:** Keep it ephemeral! Use external storage for state.

**Key Takeaway:** Each `executeCode()` is independent. Design your system accordingly!
