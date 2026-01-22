# Postman Examples Using fetch() - Native Node.js

All examples use native `fetch()` - no packages required!

---

## Quick Copy-Paste Examples

### 1. Simple fetch GET
```json
{
  "code": "fetch('https://api.stripe.com/v1/products').then(res => { console.log('Status:', res.status); return res.json(); }).then(data => console.log('Data:', data)).catch(err => console.error('Error:', err.message));"
}
```

### 2. fetch with Headers
```json
{
  "code": "fetch('https://api.stripe.com/v1/products', { headers: { 'Authorization': 'Bearer sk_test_key', 'User-Agent': 'MyApp/1.0' } }).then(res => { console.log('Status:', res.status); return res.json(); }).then(data => console.log('Products:', data.data?.length || 0)).catch(err => console.error('Error:', err.message));"
}
```

### 3. fetch POST Request
```json
{
  "code": "fetch('https://api.stripe.com/v1/products', { method: 'POST', headers: { 'Authorization': 'Bearer sk_test_key', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=Test Product&description=Created from fetch' }).then(res => { console.log('Status:', res.status); return res.json(); }).then(data => console.log('Created:', data.id)).catch(err => console.error('Error:', err.message));"
}
```

### 4. Test Blocked Domain
```json
{
  "code": "fetch('https://api.github.com/users/github').then(res => { if (res.status === 403) { console.log('🚫 Blocked:', res.status, 'Domain not in allowlist'); } else { console.log('✅ Allowed:', res.status); } }).catch(err => console.error('Error:', err.message));"
}
```

### 5. Test All Policies
```json
{
  "code": "async function testPolicies() {\n  const tests = [\n    { name: 'Stripe (allowed)', url: 'https://api.stripe.com/v1/products', method: 'GET' },\n    { name: 'Okta GET (allowed)', url: 'https://dev-123.okta.com/api/v1/users', method: 'GET' },\n    { name: 'Okta DELETE (blocked)', url: 'https://dev-123.okta.com/api/v1/users/123', method: 'DELETE' },\n    { name: 'GitHub (blocked)', url: 'https://api.github.com/users/github', method: 'GET' }\n  ];\n\n  for (const test of tests) {\n    try {\n      const res = await fetch(test.url, { method: test.method });\n      if (res.status === 403) {\n        console.log(`🚫 ${test.name}: ${res.status} (blocked by policy)`);\n      } else {\n        console.log(`✅ ${test.name}: ${res.status}`);\n      }\n    } catch (err) {\n      console.log(`❌ ${test.name}: ERROR -`, err.message);\n    }\n  }\n}\n\ntestPolicies();"
}
```

---

## Detailed Examples for Postman

### Example 1: Basic fetch GET

**Request Body:**
```json
{
  "code": "console.log('Fetching Stripe products...');\n\nfetch('https://api.stripe.com/v1/products')\n  .then(res => {\n    console.log('Status:', res.status);\n    console.log('Headers:', Object.fromEntries(res.headers));\n    return res.json();\n  })\n  .then(data => {\n    console.log('Success! Received', data.data?.length || 0, 'products');\n  })\n  .catch(err => {\n    console.error('Error:', err.message);\n  });"
}
```

---

### Example 2: fetch with Authorization Header

**Headers:**
```
Content-Type: application/json
Authorization: Bearer YOUR_JWT_TOKEN
x-keyboard-provider-user-token-for-stripe: sk_test_your_key
```

**Request Body:**
```json
{
  "code": "const apiKey = process.env.KEYBOARD_PROVIDER_USER_TOKEN_FOR_STRIPE;\nconsole.log('API Key available:', !!apiKey);\n\nfetch('https://api.stripe.com/v1/products', {\n  headers: {\n    'Authorization': `Bearer ${apiKey}`\n  }\n})\n  .then(res => {\n    console.log('Status:', res.status);\n    return res.json();\n  })\n  .then(data => {\n    console.log('Products:', data.data?.length || 0);\n    data.data?.slice(0, 3).forEach(p => console.log('-', p.name));\n  })\n  .catch(err => console.error('Error:', err.message));"
}
```

---

### Example 3: fetch POST with JSON Body

**Request Body:**
```json
{
  "code": "fetch('https://api.stripe.com/v1/products', {\n  method: 'POST',\n  headers: {\n    'Authorization': 'Bearer sk_test_key',\n    'Content-Type': 'application/x-www-form-urlencoded'\n  },\n  body: new URLSearchParams({\n    name: 'Test Product',\n    description: 'Created via fetch'\n  })\n})\n  .then(res => {\n    console.log('Status:', res.status);\n    return res.json();\n  })\n  .then(data => {\n    console.log('Created product:', data.id);\n  })\n  .catch(err => console.error('Error:', err.message));"
}
```

---

### Example 4: Test Blocked Domain (GitHub)

**Request Body:**
```json
{
  "code": "console.log('Testing blocked domain...');\n\nfetch('https://api.github.com/users/github')\n  .then(res => {\n    console.log('Response status:', res.status);\n    \n    if (res.status === 403) {\n      console.log('🚫 BLOCKED: Domain not in allowed list');\n    } else if (res.ok) {\n      console.log('✅ ALLOWED: Request succeeded');\n      return res.json();\n    }\n  })\n  .then(data => {\n    if (data) console.log('User:', data.login);\n  })\n  .catch(err => {\n    console.error('Error:', err.message);\n  });"
}
```

---

### Example 5: Test Blocked HTTP Method (DELETE)

**Request Body:**
```json
{
  "code": "console.log('Testing blocked HTTP method (DELETE)...');\n\nfetch('https://dev-123.okta.com/api/v1/users/123', {\n  method: 'DELETE',\n  headers: {\n    'Authorization': 'SSWS your_okta_token'\n  }\n})\n  .then(res => {\n    console.log('Response status:', res.status);\n    \n    if (res.status === 403) {\n      console.log('🚫 BLOCKED: DELETE method not allowed by policy');\n    } else if (res.status === 204) {\n      console.log('✅ DELETED: User removed');\n    }\n  })\n  .catch(err => {\n    console.error('Error:', err.message);\n  });"
}
```

---

### Example 6: Multiple Sequential Requests

**Request Body:**
```json
{
  "code": "async function testMultiple() {\n  console.log('Testing multiple API calls...\\n');\n\n  // Test 1: Stripe\n  console.log('1. Fetching Stripe products...');\n  try {\n    const stripeRes = await fetch('https://api.stripe.com/v1/products');\n    console.log('   ✅ Stripe:', stripeRes.status);\n  } catch (err) {\n    console.log('   ❌ Stripe:', err.message);\n  }\n\n  // Test 2: Okta GET\n  console.log('\\n2. Fetching Okta users...');\n  try {\n    const oktaRes = await fetch('https://dev-123.okta.com/api/v1/users');\n    console.log('   ✅ Okta:', oktaRes.status);\n  } catch (err) {\n    console.log('   ❌ Okta:', err.message);\n  }\n\n  // Test 3: GitHub (should be blocked)\n  console.log('\\n3. Fetching GitHub user...');\n  try {\n    const githubRes = await fetch('https://api.github.com/users/github');\n    if (githubRes.status === 403) {\n      console.log('   🚫 GitHub: Blocked (403)');\n    } else {\n      console.log('   ✅ GitHub:', githubRes.status);\n    }\n  } catch (err) {\n    console.log('   ❌ GitHub:', err.message);\n  }\n\n  console.log('\\n✅ Test complete!');\n}\n\ntestMultiple();"
}
```

---

### Example 7: Complete Policy Test Suite

**Request Body:**
```json
{
  "code": "async function runPolicyTests() {\n  console.log('🧪 Policy Enforcement Test Suite\\n');\n  console.log('='.repeat(50));\n\n  const tests = [\n    {\n      name: 'Stripe API (allowed domain)',\n      url: 'https://api.stripe.com/v1/products',\n      method: 'GET',\n      expectedBlocked: false\n    },\n    {\n      name: 'Okta GET (allowed method)',\n      url: 'https://dev-123.okta.com/api/v1/users',\n      method: 'GET',\n      expectedBlocked: false\n    },\n    {\n      name: 'Okta DELETE (blocked method)',\n      url: 'https://dev-123.okta.com/api/v1/users/123',\n      method: 'DELETE',\n      expectedBlocked: true\n    },\n    {\n      name: 'GitHub API (blocked domain)',\n      url: 'https://api.github.com/users/github',\n      method: 'GET',\n      expectedBlocked: true\n    }\n  ];\n\n  let passed = 0;\n  let failed = 0;\n\n  for (const test of tests) {\n    try {\n      const res = await fetch(test.url, { method: test.method });\n      const blocked = res.status === 403;\n      const success = blocked === test.expectedBlocked;\n\n      if (success) {\n        console.log(`✅ PASS: ${test.name}`);\n        console.log(`   Status: ${res.status} (expected ${test.expectedBlocked ? 'blocked' : 'allowed'})`);\n        passed++;\n      } else {\n        console.log(`❌ FAIL: ${test.name}`);\n        console.log(`   Status: ${res.status} (expected ${test.expectedBlocked ? 'blocked' : 'allowed'})`);\n        failed++;\n      }\n    } catch (err) {\n      console.log(`❌ ERROR: ${test.name}`);\n      console.log(`   ${err.message}`);\n      failed++;\n    }\n\n    console.log(''); // blank line\n  }\n\n  console.log('='.repeat(50));\n  console.log(`Results: ${passed} passed, ${failed} failed\\n`);\n}\n\nrunPolicyTests();"
}
```

---

### Example 8: Fetch with Timeout

**Request Body:**
```json
{
  "code": "async function fetchWithTimeout(url, options = {}, timeout = 10000) {\n  const controller = new AbortController();\n  const id = setTimeout(() => controller.abort(), timeout);\n\n  try {\n    const response = await fetch(url, {\n      ...options,\n      signal: controller.signal\n    });\n    clearTimeout(id);\n    return response;\n  } catch (err) {\n    clearTimeout(id);\n    if (err.name === 'AbortError') {\n      console.error('Request timeout after', timeout, 'ms');\n    }\n    throw err;\n  }\n}\n\nconsole.log('Fetching with 10s timeout...');\nfetchWithTimeout('https://api.stripe.com/v1/products', {}, 10000)\n  .then(res => console.log('Success:', res.status))\n  .catch(err => console.error('Error:', err.message));"
}
```

---

### Example 9: Handle JSON vs Text Responses

**Request Body:**
```json
{
  "code": "fetch('https://api.stripe.com/v1/products')\n  .then(async (res) => {\n    console.log('Status:', res.status);\n    console.log('Content-Type:', res.headers.get('content-type'));\n\n    const contentType = res.headers.get('content-type');\n    \n    if (contentType?.includes('application/json')) {\n      const data = await res.json();\n      console.log('JSON response:', Object.keys(data));\n      return data;\n    } else {\n      const text = await res.text();\n      console.log('Text response:', text.substring(0, 100));\n      return text;\n    }\n  })\n  .then(data => {\n    console.log('Success! Received data');\n  })\n  .catch(err => {\n    console.error('Error:', err.message);\n  });"
}
```

---

### Example 10: Stripe SDK Alternative (fetch-based)

**Request Body:**
```json
{
  "code": "const apiKey = process.env.KEYBOARD_PROVIDER_USER_TOKEN_FOR_STRIPE;\n\nasync function listStripeProducts() {\n  console.log('Listing Stripe products...');\n\n  const res = await fetch('https://api.stripe.com/v1/products?limit=5', {\n    headers: {\n      'Authorization': `Bearer ${apiKey}`\n    }\n  });\n\n  if (!res.ok) {\n    console.error('Error:', res.status, res.statusText);\n    return;\n  }\n\n  const data = await res.json();\n  console.log(`Found ${data.data.length} products:`);\n  \n  data.data.forEach((product, i) => {\n    console.log(`${i + 1}. ${product.name}`);\n    console.log(`   ID: ${product.id}`);\n    console.log(`   Active: ${product.active}`);\n  });\n}\n\nlistStripeProducts().catch(err => console.error('Error:', err.message));"
}
```

---

### Example 11: Check Response Headers

**Request Body:**
```json
{
  "code": "fetch('https://api.stripe.com/v1/products')\n  .then(res => {\n    console.log('Status:', res.status, res.statusText);\n    console.log('\\nResponse Headers:');\n    \n    // Log all headers\n    res.headers.forEach((value, key) => {\n      console.log(`  ${key}: ${value}`);\n    });\n    \n    return res.json();\n  })\n  .then(data => {\n    console.log('\\nData received:', Object.keys(data));\n  })\n  .catch(err => console.error('Error:', err.message));"
}
```

---

### Example 12: POST with JSON Body

**Request Body:**
```json
{
  "code": "fetch('https://api.example.com/data', {\n  method: 'POST',\n  headers: {\n    'Content-Type': 'application/json',\n    'Authorization': 'Bearer token'\n  },\n  body: JSON.stringify({\n    name: 'Test Item',\n    value: 123,\n    active: true\n  })\n})\n  .then(res => {\n    console.log('Status:', res.status);\n    return res.json();\n  })\n  .then(data => {\n    console.log('Created:', data);\n  })\n  .catch(err => console.error('Error:', err.message));"
}
```

---

### Example 13: Parallel Requests with Promise.all

**Request Body:**
```json
{
  "code": "async function fetchParallel() {\n  console.log('Fetching multiple APIs in parallel...\\n');\n\n  const urls = [\n    'https://api.stripe.com/v1/products',\n    'https://dev-123.okta.com/api/v1/users',\n    'https://api.github.com/users/github'\n  ];\n\n  try {\n    const results = await Promise.all(\n      urls.map(url => \n        fetch(url)\n          .then(res => ({ url, status: res.status, ok: res.ok }))\n          .catch(err => ({ url, error: err.message }))\n      )\n    );\n\n    results.forEach(result => {\n      if (result.error) {\n        console.log(`❌ ${result.url}: ${result.error}`);\n      } else if (result.status === 403) {\n        console.log(`🚫 ${result.url}: ${result.status} (blocked)`);\n      } else {\n        console.log(`✅ ${result.url}: ${result.status}`);\n      }\n    });\n\n    console.log('\\n✅ All requests completed!');\n  } catch (err) {\n    console.error('Error:', err.message);\n  }\n}\n\nfetchParallel();"
}
```

---

## Comparison: axios vs fetch

| Feature | axios | fetch (native) |
|---------|-------|----------------|
| Installation | `npm install axios` | Built-in Node.js 18+ |
| JSON parsing | Automatic | Manual `.json()` |
| Error handling | Throws on 4xx/5xx | Only throws on network errors |
| Request cancellation | CancelToken | AbortController |
| Timeout | Built-in | Manual with AbortController |
| Browser support | Wider | Modern browsers + Node 18+ |

---

## fetch Error Handling Pattern

```javascript
fetch(url)
  .then(res => {
    // fetch doesn't throw on 4xx/5xx, must check manually
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return res.json();
  })
  .then(data => {
    console.log('Success:', data);
  })
  .catch(err => {
    // Catches network errors AND thrown errors above
    console.error('Error:', err.message);
  });
```

---

## Template: Replace YOUR_URL

```json
{
  "code": "fetch('YOUR_URL_HERE').then(res => { console.log('Status:', res.status); return res.json(); }).then(data => console.log('Data:', data)).catch(err => console.error('Error:', err.message));"
}
```

---

## Expected Response Format

All examples return the same format:

```json
{
  "success": true,
  "data": {
    "stdout": "Status: 200\nData: {...}\n",
    "stderr": "",
    "code": 0,
    "executionTime": 1234,
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
}
```

---

## Pro Tips for fetch

1. **Always check `res.ok`** - fetch doesn't throw on 4xx/5xx
2. **Use async/await** - cleaner than promise chains
3. **AbortController** for timeouts and cancellation
4. **URLSearchParams** for form data
5. **JSON.stringify()** for JSON POST bodies
6. **res.headers.get()** to read response headers

---

## Next Steps

1. Copy any example above
2. Paste into Postman request body
3. Set Authorization header with your JWT
4. Send request
5. Check `networkLog` in response for policy enforcement
