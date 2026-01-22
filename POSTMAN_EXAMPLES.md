# Postman Examples for /execute Endpoint

Complete examples for testing code execution with JWT-based security policies.

---

## Setup

**Base URL:** `http://localhost:3000` (or your server URL)

**Endpoint:** `POST /execute`

**Headers:**
```
Content-Type: application/json
Authorization: Bearer YOUR_JWT_TOKEN_HERE
```

---

## Example 1: Simple axios GET Request

### Request Body
```json
{
  "code": "const axios = require('axios'); axios.get('https://api.stripe.com/v1/products').then(res => console.log('Status:', res.status)).catch(err => console.error('Error:', err.message));"
}
```

### Expected Response
```json
{
  "success": true,
  "data": {
    "stdout": "Status: 200\n",
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

## Example 2: axios with Headers

### Request Body
```json
{
  "code": "const axios = require('axios'); axios.get('https://api.stripe.com/v1/products', { headers: { 'Authorization': 'Bearer sk_test_your_key', 'User-Agent': 'MyApp/1.0' } }).then(res => { console.log('Status:', res.status); console.log('Products:', res.data.data.length); }).catch(err => console.error('Error:', err.message));"
}
```

---

## Example 3: axios POST Request

### Request Body
```json
{
  "code": "const axios = require('axios'); axios.post('https://api.stripe.com/v1/products', { name: 'Test Product', description: 'Created from code execution' }, { headers: { 'Authorization': 'Bearer sk_test_your_key', 'Content-Type': 'application/x-www-form-urlencoded' } }).then(res => { console.log('Created product:', res.data.id); }).catch(err => console.error('Error:', err.response?.status, err.message));"
}
```

---

## Example 4: Test Blocked Domain (GitHub - not in allowlist)

### Request Body
```json
{
  "code": "const axios = require('axios'); axios.get('https://api.github.com/users/github').then(res => console.log('Status:', res.status)).catch(err => console.error('Blocked:', err.response?.status, err.message));"
}
```

### Expected Response (Blocked)
```json
{
  "success": true,
  "data": {
    "stdout": "",
    "stderr": "",
    "code": 0,
    "networkLog": [
      {
        "method": "GET",
        "url": "https://api.github.com/users/github",
        "hostname": "api.github.com",
        "statusCode": 403,
        "blocked": true,
        "reason": "Domain api.github.com is not in allowed list"
      }
    ]
  }
}
```

---

## Example 5: Test Blocked HTTP Method (DELETE on Okta)

### Request Body
```json
{
  "code": "const axios = require('axios'); axios.delete('https://dev-123.okta.com/api/v1/users/00u123', { headers: { 'Authorization': 'SSWS your_okta_token' } }).then(res => console.log('Deleted:', res.status)).catch(err => console.error('Blocked:', err.response?.status, err.message));"
}
```

### Expected Response (Blocked)
```json
{
  "success": true,
  "data": {
    "stdout": "Blocked: 403 Request failed with status code 403\n",
    "stderr": "",
    "code": 0,
    "networkLog": [
      {
        "method": "DELETE",
        "url": "https://dev-123.okta.com/api/v1/users/00u123",
        "hostname": "dev-123.okta.com",
        "statusCode": 403,
        "blocked": true,
        "reason": "Method DELETE not allowed for *.okta.com"
      }
    ]
  }
}
```

---

## Example 6: Multiple API Calls (Sequential)

### Request Body
```json
{
  "code": "const axios = require('axios'); async function test() { try { const stripe = await axios.get('https://api.stripe.com/v1/products'); console.log('Stripe:', stripe.status); const okta = await axios.get('https://dev-123.okta.com/api/v1/users'); console.log('Okta:', okta.status); } catch (err) { console.error('Error:', err.message); } } test();"
}
```

### Expected Response
```json
{
  "success": true,
  "data": {
    "stdout": "Stripe: 200\nOkta: 200\n",
    "stderr": "",
    "code": 0,
    "networkLog": [
      {
        "method": "GET",
        "url": "https://api.stripe.com/v1/products",
        "statusCode": 200,
        "blocked": false
      },
      {
        "method": "GET",
        "url": "https://dev-123.okta.com/api/v1/users",
        "statusCode": 200,
        "blocked": false
      }
    ]
  }
}
```

---

## Example 7: Stripe SDK (Real Usage)

### Request Body
```json
{
  "code": "const stripe = require('stripe')('sk_test_your_key_here'); stripe.products.list({ limit: 3 }).then(products => { console.log('Found', products.data.length, 'products'); products.data.forEach(p => console.log('-', p.name)); }).catch(err => console.error('Error:', err.message));"
}
```

---

## Example 8: Okta SDK

### Request Body
```json
{
  "code": "const okta = require('@okta/okta-sdk-nodejs'); const client = new okta.Client({ orgUrl: 'https://dev-123.okta.com', token: 'your_okta_token' }); client.listUsers().each(user => console.log('User:', user.profile.email)).catch(err => console.error('Error:', err.message));"
}
```

---

## Example 9: Test with Environment Variables

### Request Body (with KEYBOARD env vars)
```json
{
  "code": "const axios = require('axios'); const apiKey = process.env.KEYBOARD_PROVIDER_USER_TOKEN_FOR_STRIPE; console.log('API Key available:', !!apiKey); axios.get('https://api.stripe.com/v1/products', { headers: { 'Authorization': `Bearer ${apiKey}` } }).then(res => console.log('Status:', res.status)).catch(err => console.error('Error:', err.message));"
}
```

### Headers
```
Content-Type: application/json
x-keyboard-provider-user-token-for-stripe: sk_test_your_stripe_key
```

---

## Example 10: Formatted Code (Multi-line)

### Request Body
```json
{
  "code": "const axios = require('axios');\n\nasync function fetchData() {\n  try {\n    // Fetch Stripe products\n    const stripeRes = await axios.get('https://api.stripe.com/v1/products', {\n      headers: { 'Authorization': 'Bearer sk_test_key' }\n    });\n    \n    console.log('Stripe Products:', stripeRes.data.data.length);\n    \n    // Try to fetch from GitHub (should be blocked)\n    const githubRes = await axios.get('https://api.github.com/users/github');\n    console.log('GitHub Status:', githubRes.status);\n    \n  } catch (error) {\n    console.error('Error:', error.message);\n    if (error.response) {\n      console.error('Status:', error.response.status);\n    }\n  }\n}\n\nfetchData();"
}
```

---

## Example 11: Test All Policy Rules

### Request Body
```json
{
  "code": "const axios = require('axios');\n\nasync function testPolicies() {\n  const tests = [\n    { name: 'Stripe (allowed)', url: 'https://api.stripe.com/v1/products', method: 'get' },\n    { name: 'Okta GET (allowed)', url: 'https://dev-123.okta.com/api/v1/users', method: 'get' },\n    { name: 'Okta DELETE (blocked)', url: 'https://dev-123.okta.com/api/v1/users/123', method: 'delete' },\n    { name: 'GitHub (blocked)', url: 'https://api.github.com/users/github', method: 'get' }\n  ];\n\n  for (const test of tests) {\n    try {\n      const res = await axios[test.method](test.url);\n      console.log(`✅ ${test.name}: ${res.status}`);\n    } catch (err) {\n      console.log(`🚫 ${test.name}: ${err.response?.status || 'ERROR'}`);\n    }\n  }\n}\n\ntestPolicies();"
}
```

### Expected Response
```json
{
  "success": true,
  "data": {
    "stdout": "✅ Stripe (allowed): 200\n✅ Okta GET (allowed): 200\n🚫 Okta DELETE (blocked): 403\n🚫 GitHub (blocked): 403\n",
    "stderr": "",
    "code": 0,
    "networkLog": [
      { "method": "GET", "url": "https://api.stripe.com/v1/products", "statusCode": 200, "blocked": false },
      { "method": "GET", "url": "https://dev-123.okta.com/api/v1/users", "statusCode": 200, "blocked": false },
      { "method": "DELETE", "url": "https://dev-123.okta.com/api/v1/users/123", "statusCode": 403, "blocked": true, "reason": "Method DELETE not allowed" },
      { "method": "GET", "url": "https://api.github.com/users/github", "statusCode": 403, "blocked": true, "reason": "Domain not in allowed list" }
    ]
  }
}
```

---

## Example 12: Using Native https Module

### Request Body
```json
{
  "code": "const https = require('https'); https.get('https://api.stripe.com/v1/products', (res) => { console.log('Status:', res.statusCode); let data = ''; res.on('data', chunk => data += chunk); res.on('end', () => console.log('Received', data.length, 'bytes')); }).on('error', err => console.error('Error:', err.message));"
}
```

---

## Example 13: Error Handling Test

### Request Body
```json
{
  "code": "const axios = require('axios');\n\ntry {\n  // This will be blocked\n  axios.get('https://evil-domain.com/steal-data').then(res => {\n    console.log('Should not reach here');\n  }).catch(err => {\n    console.log('Caught error:', err.response?.status);\n    console.log('Message:', err.message);\n  });\n} catch (e) {\n  console.error('Execution error:', e.message);\n}"
}
```

---

## Example 14: Check Policy Info

### Request Body
```json
{
  "code": "console.log('Environment:', process.env.NODE_ENV || 'not set'); console.log('Docker:', !!process.env.DOCKER || 'checking...'); console.log('Test completed');"
}
```

---

## Example 15: Timeout Test (Long Request)

### Request Body
```json
{
  "code": "const axios = require('axios'); axios.get('https://api.stripe.com/v1/products', { timeout: 10000 }).then(res => console.log('Success:', res.status)).catch(err => console.error('Timeout or error:', err.message));",
  "timeout": 15000
}
```

---

## Postman Collection Structure

Create a collection with these requests:

```
JWT Policy Tests
├── 1. Basic Tests
│   ├── Simple axios GET
│   ├── axios with headers
│   └── axios POST
├── 2. Policy Enforcement
│   ├── Allowed: Stripe API
│   ├── Allowed: Okta GET
│   ├── Blocked: Okta DELETE
│   └── Blocked: GitHub API
├── 3. SDK Tests
│   ├── Stripe SDK
│   └── Okta SDK
└── 4. Advanced
    ├── Multiple API calls
    ├── Error handling
    └── All policy rules test
```

---

## Environment Variables in Postman

Create environment with:

```
BASE_URL: http://localhost:3000
JWT_TOKEN: your-jwt-token-from-api
STRIPE_KEY: sk_test_your_stripe_key
OKTA_TOKEN: your_okta_token
OKTA_DOMAIN: dev-123.okta.com
```

Then use in requests:
```json
{
  "code": "const axios = require('axios'); axios.get('https://api.stripe.com/v1/products', { headers: { 'Authorization': 'Bearer {{STRIPE_KEY}}' } })..."
}
```

---

## Testing Without JWT (Uses Default Policy)

Remove the `Authorization` header to test with default policy:

### Headers
```
Content-Type: application/json
```

### Request Body
```json
{
  "code": "const axios = require('axios'); axios.get('https://api.stripe.com/v1/products').then(res => console.log(res.status)).catch(err => console.error(err.message));"
}
```

---

## Quick Copy-Paste Templates

### Basic axios GET
```json
{"code": "const axios = require('axios'); axios.get('YOUR_URL_HERE').then(res => console.log('Status:', res.status, 'Data:', JSON.stringify(res.data))).catch(err => console.error('Error:', err.message));"}
```

### Basic axios POST
```json
{"code": "const axios = require('axios'); axios.post('YOUR_URL_HERE', { key: 'value' }).then(res => console.log('Created:', res.data)).catch(err => console.error('Error:', err.message));"}
```

### Stripe SDK
```json
{"code": "const stripe = require('stripe')('sk_test_YOUR_KEY'); stripe.products.list().then(p => console.log('Products:', p.data.length)).catch(e => console.error(e.message));"}
```

### Test Policy (Replace URL)
```json
{"code": "const axios = require('axios'); axios.get('REPLACE_WITH_YOUR_TEST_URL').then(res => console.log('✅ Allowed:', res.status)).catch(err => console.log('🚫 Blocked:', err.response?.status, err.message));"}
```

---

## Response Fields Reference

**Always present:**
- `success`: boolean
- `data.stdout`: string (console.log output)
- `data.stderr`: string (console.error output)
- `data.code`: number (exit code, 0 = success)
- `data.executionTime`: number (milliseconds)

**Present when Docker enabled:**
- `data.dockerInfo.containerInfo`: string
- `data.dockerInfo.networkIsolation`: boolean

**Present when HTTP Proxy enabled:**
- `data.networkLog`: array of request logs
  - `timestamp`: ISO 8601 timestamp
  - `method`: HTTP method
  - `url`: Full URL
  - `hostname`: Domain
  - `statusCode`: HTTP status code
  - `blocked`: boolean
  - `reason`: string (if blocked)

---

## Pro Tips

1. **Use \n for newlines** in code string for readability
2. **Escape quotes** inside code: `\"` for JSON strings
3. **Use async/await** for multiple sequential requests
4. **Check networkLog** to see what was blocked
5. **Set timeout** for long-running operations
6. **Use environment variables** for sensitive data (KEYBOARD_* headers)

---

## Common Issues

**"Policy fetch failed"**
- Check JWT token is valid
- Check Authorization header format: `Bearer <token>`

**"Domain not allowed"**
- Check your policy's `allowedDomains` includes the domain
- Wildcards: `*.okta.com` matches subdomains

**"Method not allowed"**
- Check `apiPathRules` for method restrictions
- GET usually allowed, DELETE often blocked

**"Request timeout"**
- Increase timeout: `{"code": "...", "timeout": 30000}`
- Default is 30 seconds

---

## Next Steps

1. Import examples into Postman
2. Replace `YOUR_JWT_TOKEN_HERE` with real JWT
3. Replace `YOUR_URL_HERE` with your test URLs
4. Run requests and check `networkLog` field
5. Monitor server logs for policy enforcement details
