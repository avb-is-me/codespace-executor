```markdown
# 4-Layer Security Policy System

## Overview

Your secure executor implements 4 independent security layers:

1. **Domain Control** - Which domains can be accessed
2. **Language Control** - Which programming languages (Node.js only)
3. **API Path Control** - Which specific API endpoints
4. **Package Control** - Which npm packages and binaries

---

## Architecture

```
User Code
    ↓
Layer 1: Domain Control (HTTP Proxy)
  ↓ Allowed domain?
    ↓
Layer 2: Language Control (Distroless)
  ↓ Only Node.js available
    ↓
Layer 3: API Path Control (HTTP Proxy)
  ↓ Allowed endpoint?
    ↓
Layer 4: Package Control (Docker Image)
  ↓ Package exists?
    ↓
Execute
```

---

## Layer 1: Domain Control

**What:** Which external domains can be reached

**Implementation:** HTTP Proxy with domain filtering

**Configuration:**
```typescript
allowedDomains: [
    'api.stripe.com',
    'api.openai.com',
    'api.github.com'
]
```

**Examples:**
- ✅ `https://api.stripe.com/v1/products` → Allowed
- ❌ `https://evil.com` → Blocked (not in allowlist)

**MVP:** Hardcoded in `security-policy.ts`
**Future:** Load from user's JWT/database

---

## Layer 2: Language Control

**What:** Which programming language runtimes are available

**Implementation:** Distroless Docker image

**Configuration:** Dockerfile (what binaries to include)

**Result:**
- ✅ Node.js - Available (in distroless base image)
- ❌ Python - Not available (binary doesn't exist)
- ❌ Ruby - Not available
- ❌ Shell - Not available

**Why secure:** Even if user tries `spawn('python3')`, it fails with ENOENT because Python binary doesn't exist in the image.

**MVP:** `gcr.io/distroless/nodejs20-debian12` (Node.js only)
**Future:** Same (language control doesn't need per-user config)

---

## Layer 3: API Path Control

**What:** Which specific API endpoints can be called

**Implementation:** HTTP Proxy with path-level filtering

**Configuration:**
```typescript
apiPathRules: {
    'api.stripe.com': [
        // Allow: Product management
        { method: 'GET', path: '/v1/products', allow: true },
        { method: 'POST', path: '/v1/products', allow: true },

        // Block: Charges (can't create charges)
        { method: 'POST', path: '/v1/charges', allow: false }
    ]
}
```

**Examples:**
- ✅ `GET api.stripe.com/v1/products` → Allowed
- ✅ `POST api.stripe.com/v1/products` → Allowed
- ❌ `POST api.stripe.com/v1/charges` → Blocked (charges not allowed)

**Use case:** Allow users to read products but not create charges

**MVP:** Hardcoded per-domain rules
**Future:** User-specific rules from database

---

## Layer 4: Package Control

**What:** Which npm packages and binaries are available

**Implementation:** Custom Docker image with pre-installed packages

**Configuration:** Dockerfile.with-packages

```dockerfile
FROM node:20-alpine AS builder
RUN npm install stripe axios lodash
RUN apk add --no-cache ffmpeg imagemagick

FROM gcr.io/distroless/nodejs20-debian12
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /usr/bin/ffmpeg /usr/local/bin/ffmpeg
```

**Result:**
- ✅ `require('stripe')` → Works (pre-installed)
- ✅ `spawn('ffmpeg')` → Works (binary copied)
- ❌ `require('some-random-package')` → Fails (not installed)

**MVP:** Build different images for different use cases
**Future:** Dynamic per-user images or multiple pre-built tiers

---

## MVP Implementation

### Current Structure:

```
src/
  config/
    security-policy.ts          ← Hardcoded policies (MVP)
  secure/
    SecureExecutorWithPolicy.ts ← Main executor with policy enforcement
    DockerExecutorWithProxy.ts  ← Underlying Docker + Proxy
```

### Usage (MVP):

```typescript
import SecureExecutorWithPolicy from './src/secure/SecureExecutorWithPolicy';

// MVP: Uses DEFAULT_SECURITY_POLICY
const executor = new SecureExecutorWithPolicy({
    image: 'my-executor:v1',  // Your custom image with packages
    proxyPort: 8888,
    logTraffic: true
});

const result = await executor.executeCode(userCode, credentials);
```

---

## Future: JWT-Based Policies

### How It Will Work:

```
User Request
    ↓
Extract JWT from Authorization header
    ↓
Decode JWT → Get user ID
    ↓
Load user's policy from database
    ↓
Create executor with user's policy
    ↓
Execute with user-specific restrictions
```

### JWT Payload Example:

```json
{
    "sub": "user_123",
    "tier": "pro",
    "policy_version": "v1",
    "allowed_domains": ["api.stripe.com"],
    "api_limits": {
        "stripe_products": true,
        "stripe_charges": false
    }
}
```

### Database Schema:

```sql
CREATE TABLE user_policies (
    user_id VARCHAR(255) PRIMARY KEY,
    tier VARCHAR(50),  -- free, pro, enterprise
    allowed_domains JSON,
    api_path_rules JSON,
    allowed_packages JSON,
    allowed_binaries JSON,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

### Future Usage:

```typescript
// User sends JWT with request
const jwt = req.headers.authorization?.split(' ')[1];

// Create executor with JWT
const executor = new SecureExecutorWithPolicy({
    jwt: jwt  // ← Automatically loads policy from JWT
});

// Execute with user's policy
const result = await executor.executeCode(userCode, credentials);
```

---

## Example: User Tiers

### Free Tier:
```typescript
{
    allowedDomains: ['api.github.com'],
    apiPathRules: {
        'api.github.com': [
            { method: 'GET', path: '/users/*', allow: true }
        ]
    },
    allowedPackages: ['axios', 'lodash'],
    allowedBinaries: []
}
```

**Capabilities:**
- Can call GitHub API (read-only)
- Can use axios and lodash
- No media processing (no ffmpeg)
- No Stripe API access

---

### Pro Tier:
```typescript
{
    allowedDomains: ['api.stripe.com', 'api.github.com'],
    apiPathRules: {
        'api.stripe.com': [
            { method: 'GET', path: '/v1/products/*', allow: true },
            { method: 'POST', path: '/v1/products', allow: true }
        ]
    },
    allowedPackages: ['stripe', 'axios', 'lodash'],
    allowedBinaries: []
}
```

**Capabilities:**
- Can manage Stripe products
- Can read GitHub API
- Can use Stripe SDK
- Still no media processing

---

### Enterprise Tier:
```typescript
{
    allowedDomains: [
        'api.stripe.com',
        'api.openai.com',
        'api.github.com',
        's3.amazonaws.com'
    ],
    apiPathRules: {
        'api.stripe.com': [
            { method: '*', path: '/v1/products/*', allow: true },
            { method: '*', path: '/v1/customers/*', allow: true }
        ],
        'api.openai.com': [
            { method: 'POST', path: '/v1/chat/completions', allow: true }
        ]
    },
    allowedPackages: ['stripe', 'axios', 'openai', 'aws-sdk'],
    allowedBinaries: ['ffmpeg', 'ffprobe', 'convert']
}
```

**Capabilities:**
- Full Stripe products + customers API
- OpenAI chat completions
- AWS S3 access
- Media processing (ffmpeg, imagemagick)

---

## Implementation Roadmap

### Phase 1: MVP (Current) ✅
- [x] Implement 4 security layers
- [x] Hardcoded DEFAULT_SECURITY_POLICY
- [x] Test all layers independently
- [x] Document configuration format

### Phase 2: Multiple Hardcoded Policies
- [ ] Define policies for free/pro/enterprise
- [ ] Create multiple executor instances
- [ ] Manual tier selection

### Phase 3: JWT Integration
- [ ] Implement JWT decoding
- [ ] Load policy from JWT payload
- [ ] Test with sample JWTs

### Phase 4: Database Integration
- [ ] Create user_policies table
- [ ] Implement loadPolicyFromDB()
- [ ] Cache policies for performance

### Phase 5: Policy Management UI
- [ ] Admin interface to manage policies
- [ ] Per-user policy editor
- [ ] Audit log for policy changes

---

## Testing Your Policies

### Test Script:

```typescript
const executor = new SecureExecutorWithPolicy({
    policy: testPolicy
});

// Test allowed domain + allowed path
await executor.executeCode(`
    https.get('https://api.stripe.com/v1/products');
`);
// Expected: Success

// Test allowed domain + blocked path
await executor.executeCode(`
    https.post('https://api.stripe.com/v1/charges');
`);
// Expected: 403 Forbidden

// Test blocked domain
await executor.executeCode(`
    https.get('https://evil.com');
`);
// Expected: 403 Forbidden

// Test blocked language
await executor.executeCode(`
    spawn('python3', ['-c', 'print(1)']);
`);
// Expected: ENOENT
```

---

## Best Practices

### 1. Start Restrictive
Begin with minimal permissions and add as needed:
```typescript
allowedDomains: [],  // Start with nothing
apiPathRules: {}     // Deny all by default
```

### 2. Use Wildcards Carefully
```typescript
// ❌ Too permissive
{ method: '*', path: '/*', allow: true }

// ✅ Specific
{ method: 'GET', path: '/v1/products/*', allow: true }
```

### 3. Layer Defense
Don't rely on one layer alone:
- Domain control blocks evil.com
- Path control blocks dangerous endpoints
- Language control blocks Python bypass
- Package control limits tools

### 4. Log Everything
```typescript
logTraffic: true,  // Log all requests
captureResponses: true  // Capture responses
```

### 5. Test Each Layer
Test that each layer independently blocks:
- Try blocked domain → Should fail
- Try blocked path → Should fail
- Try Python → Should fail
- Try missing package → Should fail

---

## Migration Path: MVP → JWT

### Step 1: MVP (Now)
```typescript
const executor = new SecureExecutorWithPolicy();
// Uses DEFAULT_SECURITY_POLICY
```

### Step 2: Multiple Policies
```typescript
const policy = tier === 'pro' ? PRO_POLICY : FREE_POLICY;
const executor = new SecureExecutorWithPolicy({ policy });
```

### Step 3: JWT
```typescript
const executor = new SecureExecutorWithPolicy({ jwt });
// Automatically loads policy from JWT
```

### Step 4: Database
```typescript
// In loadPolicyFromJWT():
const userId = decodeJWT(jwt).sub;
const policy = await db.getUserPolicy(userId);
return policy;
```

**Key benefit:** Executor code never changes! Just swap configuration source.

---

## Summary

✅ **4 Security Layers:**
1. Domain - Which domains (proxy)
2. Language - Which runtimes (distroless)
3. API Path - Which endpoints (proxy)
4. Package - Which tools (docker image)

✅ **MVP Approach:**
- Hardcode policies in security-policy.ts
- Easy to test and iterate
- Clear structure for future migration

✅ **Future: JWT-Based:**
- Load per-user policies
- Different tiers (free/pro/enterprise)
- No executor code changes

✅ **Migration Path:**
- MVP → Multiple hardcoded → JWT → Database
- Each step is incremental
- Backward compatible

🎯 **You're ready to start with MVP and migrate smoothly to JWT-based policies!**
```
