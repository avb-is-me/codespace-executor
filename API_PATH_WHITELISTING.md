# API Path Whitelisting - How It Works

## Overview

API path rules let you control **specific API endpoints** even within allowed domains.

**Example Use Case:**
- ✅ Allow: `GET /v1/products` (read products)
- ✅ Allow: `POST /v1/products` (create products)
- 🚫 Block: `POST /v1/charges` (prevent charges)
- 🚫 Block: `DELETE /v1/products/*` (prevent deletion)

All on the **same domain** (`api.stripe.com`)!

---

## Your API Response Format

Your policy API returns this structure:

```json
{
  "policy": {
    "allowedDomains": [
      "api.stripe.com",
      "*.okta.com"
    ],
    "apiPathRules": {
      "*.okta.com": [
        {
          "path": "/*",
          "allow": true,
          "method": "GET"
        },
        {
          "path": "/*",
          "allow": false,
          "method": "DELETE"
        }
      ],
      "api.stripe.com": [
        {
          "path": "/v1/products",
          "allow": true,
          "method": "GET"
        },
        {
          "path": "/v1/products",
          "allow": true,
          "method": "POST"
        },
        {
          "path": "/v1/charges",
          "allow": false,
          "method": "POST"
        }
      ]
    }
  }
}
```

---

## Two-Level Enforcement

### Level 1: Domain Check (Required)

**First, the domain must be in `allowedDomains`:**

```typescript
// From policy
allowedDomains: ["api.stripe.com", "*.okta.com"]

// Check
isAllowed("api.stripe.com")  → ✅ true (exact match)
isAllowed("dev-123.okta.com") → ✅ true (wildcard match *.okta.com)
isAllowed("api.github.com")   → ❌ false (not in list)
```

If domain is not in `allowedDomains`, request is **immediately blocked** regardless of path rules.

---

### Level 2: API Path Rules (Optional)

**If the domain has `apiPathRules`, check method and path:**

```typescript
// Example: Okta rules
"*.okta.com": [
  { "path": "/*", "allow": true, "method": "GET" },
  { "path": "/*", "allow": false, "method": "DELETE" }
]

// Requests to dev-123.okta.com
GET  /api/v1/users      → ✅ Matches rule 1 (GET /*)
POST /api/v1/users      → ✅ No blocking rule (allowed by default)
DELETE /api/v1/users/1  → 🚫 Matches rule 2 (DELETE /*)
```

**Important:** If `apiPathRules` exist for a domain, requests are evaluated against them. If no rule matches, the request is allowed by default (fail-open).

---

## Enforcement Flow in Proxy

Here's the code that runs in the **HTTP Proxy on the host**:

```typescript
// In DockerExecutorWithProxy handleRequest()
private handleRequest(clientReq, clientRes) {
  const url = new URL(clientReq.url);
  const hostname = url.hostname;      // e.g., "api.stripe.com"
  const method = clientReq.method;    // e.g., "POST"
  const path = url.pathname;          // e.g., "/v1/charges"

  // Check policy
  const decision = isRequestAllowed(
    this.policy,  // User's policy from JWT
    hostname,
    method,
    path
  );

  if (!decision.allowed) {
    // BLOCK - Return 403 to Docker container
    clientRes.writeHead(403, { 'Content-Type': 'application/json' });
    clientRes.end(JSON.stringify({
      error: 'Forbidden',
      reason: decision.reason
    }));

    // Log blocked request
    this.networkLog.push({
      method,
      url: clientReq.url,
      hostname,
      statusCode: 403,
      blocked: true,
      reason: decision.reason
    });

    return; // Don't forward to real API
  }

  // ALLOW - Forward to real API
  const proxyReq = https.request({
    hostname,
    path,
    method,
    headers: clientReq.headers
  }, (proxyRes) => {
    clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(clientRes);

    // Log allowed request
    this.networkLog.push({
      method,
      url: clientReq.url,
      hostname,
      statusCode: proxyRes.statusCode,
      blocked: false
    });
  });

  clientReq.pipe(proxyReq);
}
```

---

## Policy Checking Logic

```typescript
// In src/config/security-policy.ts
export function isRequestAllowed(
  policy: SecurityPolicy,
  hostname: string,
  method: string,
  path: string
): { allowed: boolean; reason: string } {

  // ==========================================
  // STEP 1: Check Domain (Level 1)
  // ==========================================
  const domainAllowed = policy.allowedDomains.some(pattern => {
    if (pattern.includes('*')) {
      // Wildcard: *.okta.com matches dev-123.okta.com
      const regex = new RegExp(
        '^' + pattern.replace(/\*/g, '.*').replace(/\./g, '\\.') + '$'
      );
      return regex.test(hostname);
    }
    return pattern === hostname;
  });

  if (!domainAllowed) {
    return {
      allowed: false,
      reason: `Domain ${hostname} is not in allowed list`
    };
  }

  // ==========================================
  // STEP 2: Check API Path Rules (Level 2)
  // ==========================================

  // Find rules for this domain (exact or wildcard match)
  let pathRules = policy.apiPathRules[hostname];

  if (!pathRules) {
    // Check for wildcard domain match
    for (const [domain, rules] of Object.entries(policy.apiPathRules)) {
      if (domain.includes('*')) {
        const regex = new RegExp(
          '^' + domain.replace(/\*/g, '.*').replace(/\./g, '\\.') + '$'
        );
        if (regex.test(hostname)) {
          pathRules = rules;
          break;
        }
      }
    }
  }

  // If no path rules defined for this domain, allow by default
  if (!pathRules || pathRules.length === 0) {
    return { allowed: true, reason: '' };
  }

  // Check each rule
  for (const rule of pathRules) {
    // Check if method matches
    const methodMatches = rule.method === '*' || rule.method === method;

    // Check if path matches (supports wildcards)
    const pathMatches = matchPath(rule.path, path);

    if (methodMatches && pathMatches) {
      if (!rule.allow) {
        return {
          allowed: false,
          reason: `Method ${method} not allowed for ${hostname}${path}`
        };
      }
      // Found matching allow rule, continue checking other rules
    }
  }

  // No blocking rules matched, allow by default
  return { allowed: true, reason: '' };
}

// Helper: Match path with wildcards
function matchPath(pattern: string, path: string): boolean {
  if (pattern === '/*') {
    return true; // Match everything
  }

  if (pattern.includes('*')) {
    // Convert /v1/products/* to regex /v1/products/.*
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\//g, '\\/') + '$'
    );
    return regex.test(path);
  }

  return pattern === path; // Exact match
}
```

---

## Example Request Flows

### Example 1: Allowed Request (Stripe GET /v1/products)

```
1. User code (Docker):
   stripe.products.list()

2. Node.js makes request:
   GET https://api.stripe.com/v1/products

3. Proxy receives:
   hostname: "api.stripe.com"
   method: "GET"
   path: "/v1/products"

4. Policy check:
   Step 1: Is "api.stripe.com" in allowedDomains?
     ✅ YES (found in list)

   Step 2: Check apiPathRules["api.stripe.com"]:
     Rule 1: { path: "/v1/products", method: "GET", allow: true }
     ✅ MATCH: method=GET, path=/v1/products
     ✅ ALLOW: rule.allow = true

5. Proxy forwards to real API

6. Response:
   Status: 200
   networkLog: { blocked: false, statusCode: 200 }
```

---

### Example 2: Blocked Request (Stripe POST /v1/charges)

```
1. User code (Docker):
   stripe.charges.create({ amount: 1000 })

2. Node.js makes request:
   POST https://api.stripe.com/v1/charges

3. Proxy receives:
   hostname: "api.stripe.com"
   method: "POST"
   path: "/v1/charges"

4. Policy check:
   Step 1: Is "api.stripe.com" in allowedDomains?
     ✅ YES (found in list)

   Step 2: Check apiPathRules["api.stripe.com"]:
     Rule 1: { path: "/v1/products", method: "GET", allow: true }
       ❌ NO MATCH: path doesn't match

     Rule 2: { path: "/v1/products", method: "POST", allow: true }
       ❌ NO MATCH: path doesn't match

     Rule 3: { path: "/v1/charges", method: "POST", allow: false }
       ✅ MATCH: method=POST, path=/v1/charges
       🚫 BLOCK: rule.allow = false

5. Proxy returns 403:
   {
     "error": "Forbidden",
     "reason": "Method POST not allowed for api.stripe.com/v1/charges"
   }

6. Response to Docker:
   Status: 403
   networkLog: {
     blocked: true,
     statusCode: 403,
     reason: "Method POST not allowed for api.stripe.com/v1/charges"
   }

7. User code receives error:
   stripe.charges.create() throws with status 403
```

---

### Example 3: Wildcard Domain (Okta DELETE - Blocked)

```
1. User code (Docker):
   axios.delete('https://dev-123.okta.com/api/v1/users/00u123')

2. Node.js makes request:
   DELETE https://dev-123.okta.com/api/v1/users/00u123

3. Proxy receives:
   hostname: "dev-123.okta.com"
   method: "DELETE"
   path: "/api/v1/users/00u123"

4. Policy check:
   Step 1: Is "dev-123.okta.com" in allowedDomains?
     Check: "api.stripe.com" → ❌ no match
     Check: "*.okta.com" → ✅ MATCH (wildcard)
     ✅ YES (wildcard match)

   Step 2: Check apiPathRules["*.okta.com"]:
     Rule 1: { path: "/*", method: "GET", allow: true }
       ❌ NO MATCH: method doesn't match (DELETE ≠ GET)

     Rule 2: { path: "/*", method: "DELETE", allow: false }
       ✅ MATCH: method=DELETE, path matches /*
       🚫 BLOCK: rule.allow = false

5. Proxy returns 403:
   {
     "error": "Forbidden",
     "reason": "Method DELETE not allowed for dev-123.okta.com/api/v1/users/00u123"
   }

6. Response to Docker:
   Status: 403
   networkLog: {
     blocked: true,
     statusCode: 403,
     reason: "Method DELETE not allowed..."
   }
```

---

### Example 4: No Path Rules (Default Allow)

```
Policy:
{
  "allowedDomains": ["api.example.com"],
  "apiPathRules": {}  // No rules for api.example.com
}

Request:
POST https://api.example.com/anything

Result:
Step 1: Domain check → ✅ Allowed
Step 2: No path rules defined → ✅ Allow by default
```

---

## Path Pattern Matching

### Exact Match
```javascript
// Rule
{ path: "/v1/products", method: "GET", allow: true }

// Matches
GET /v1/products          ✅
GET /v1/products?limit=10 ✅ (query params ignored)

// Doesn't Match
GET /v1/products/123      ❌
GET /v1/product           ❌
POST /v1/products         ❌ (different method)
```

### Wildcard Match
```javascript
// Rule
{ path: "/v1/products/*", method: "*", allow: true }

// Matches
GET  /v1/products/123     ✅
POST /v1/products/456     ✅
DELETE /v1/products/789   ✅

// Doesn't Match
GET /v1/products          ❌ (no trailing part)
GET /v1/prices/123        ❌ (different base path)
```

### Catch-All
```javascript
// Rule
{ path: "/*", method: "DELETE", allow: false }

// Matches
DELETE /anything          ✅
DELETE /v1/users/123      ✅
DELETE /                  ✅

// Doesn't Match
GET /anything             ❌ (different method)
POST /v1/users            ❌ (different method)
```

---

## Rule Evaluation Order

**Rules are checked in order, first match wins:**

```javascript
// Policy
"apiPathRules": {
  "api.stripe.com": [
    { path: "/v1/products/*", method: "*", allow: false },  // Rule 1: Block all product operations
    { path: "/v1/products", method: "GET", allow: true }    // Rule 2: Allow GET products list
  ]
}

// Request: GET /v1/products
// ❌ BLOCKED by Rule 1 (/* matches /products)

// Better ordering:
"apiPathRules": {
  "api.stripe.com": [
    { path: "/v1/products", method: "GET", allow: true },    // Rule 1: Allow GET products list
    { path: "/v1/products/*", method: "*", allow: false }    // Rule 2: Block specific products
  ]
}

// Request: GET /v1/products
// ✅ ALLOWED by Rule 1 (exact match)

// Request: GET /v1/products/123
// 🚫 BLOCKED by Rule 2 (wildcard match)
```

**Recommendation:** Put specific rules before wildcard rules.

---

## Where Does This Happen?

### 1. Policy is Fetched (Host)
```typescript
// In server.js
const jwt = req.headers.authorization?.replace('Bearer ', '');
const policyResult = await policyFetcher.fetchPolicy(jwt);

// policyResult.policy contains:
{
  allowedDomains: ["api.stripe.com", "*.okta.com"],
  apiPathRules: {
    "api.stripe.com": [
      { path: "/v1/charges", method: "POST", allow: false }
    ]
  }
}
```

### 2. Policy is Passed to Executor (Host)
```typescript
// In server.js
const executor = new SecureExecutorUnified({
  policy: policyResult.policy  // ← Policy stays on host
});
```

### 3. Policy is Used in Proxy (Host)
```typescript
// In DockerExecutorWithProxy.ts
class DockerExecutorWithProxy {
  private policy: SecurityPolicy;  // ← Stored in proxy

  constructor(options) {
    this.policy = options.policy;
  }

  private handleRequest(clientReq, clientRes) {
    // ← Enforcement happens here
    const decision = isRequestAllowed(
      this.policy,  // ← Check against policy
      hostname,
      method,
      path
    );
  }
}
```

### 4. Docker Container is Unaware
```typescript
// Inside Docker - user code has no idea about path rules
const stripe = require('stripe')('sk_test_key');
stripe.charges.create({ amount: 1000 });
// ↑ This request goes through proxy
// ↑ Proxy checks path rules
// ↑ Returns 403 if blocked
```

---

## Response to User Code

### Allowed Request
```javascript
// User code sees normal response
const products = await stripe.products.list();
// products = { data: [...], ... }
```

### Blocked Request
```javascript
// User code sees 403 error
try {
  await stripe.charges.create({ amount: 1000 });
} catch (err) {
  console.log(err.statusCode);  // 403
  console.log(err.message);     // "Forbidden"
  // Response body: { error: "Forbidden", reason: "Method POST not allowed..." }
}
```

---

## networkLog Output

After execution, you can see all requests in the response:

```json
{
  "success": true,
  "data": {
    "stdout": "...",
    "networkLog": [
      {
        "timestamp": "2024-01-15T10:30:00Z",
        "method": "GET",
        "url": "https://api.stripe.com/v1/products",
        "hostname": "api.stripe.com",
        "path": "/v1/products",
        "statusCode": 200,
        "blocked": false
      },
      {
        "timestamp": "2024-01-15T10:30:01Z",
        "method": "POST",
        "url": "https://api.stripe.com/v1/charges",
        "hostname": "api.stripe.com",
        "path": "/v1/charges",
        "statusCode": 403,
        "blocked": true,
        "reason": "Method POST not allowed for api.stripe.com/v1/charges"
      }
    ]
  }
}
```

---

## Summary

**API Path Whitelisting = Fine-grained control within allowed domains**

| Level | What It Controls | Example |
|-------|-----------------|---------|
| **Level 1:** `allowedDomains` | Which domains can be accessed | ✅ `api.stripe.com` <br> 🚫 `api.github.com` |
| **Level 2:** `apiPathRules` | Which endpoints within allowed domains | ✅ `GET /v1/products` <br> 🚫 `POST /v1/charges` |

**Key Points:**
- ✅ Policy checked on **host** in HTTP proxy
- ✅ User code in Docker is **completely unaware**
- ✅ Works with **all SDKs** (Stripe, axios, fetch)
- ✅ **Complete audit trail** in `networkLog`
- ✅ Supports **wildcards** in domains and paths
- ✅ **Method-specific** rules (GET allowed, DELETE blocked)

The whitelist enforcement happens **transparently** at the network level - user code just sees normal HTTP responses (200 or 403).
