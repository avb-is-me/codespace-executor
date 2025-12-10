# Pipedream-Style HTTP Request Format

The secure code executor now supports **Pipedream-style direct HTTP request format**, allowing you to send simple API requests without wrapping them in `api_calls` or writing custom `global_code`.

## Overview

Previously, you needed to structure requests like this:

```json
{
  "api_calls": {
    "functionName": {
      "url": "https://api.example.com",
      "method": "POST",
      "headers": {...},
      "body": {...}
    }
  },
  "global_code": "const result = await functionName();"
}
```

Now you can send requests directly in **Pipedream format**:

```json
{
  "url": "https://api.example.com",
  "method": "POST",
  "headers": {...},
  "body": {...}
}
```

## Format Specification

### Required Fields

- `url` (string): The target API endpoint URL
- `method` (string): HTTP method (GET, POST, PUT, PATCH, DELETE)

### Optional Fields

- `headers` (object): HTTP headers to include in the request
- `body` (any): Request body (automatically JSON-stringified for objects)
- `timeout` (number): Request timeout in milliseconds (default: 30000)

### Standard Execution Options

All standard execution options are still supported:

- `ai_eval` (boolean): Enable AI evaluation of results
- `encrypt_messages` (boolean): Encrypt response with symmetric encryption
- `use_asymmetric_encryption` (boolean): Encrypt response with asymmetric encryption
- `background` (boolean): Execute as background job
- `priority` (string): Job priority (low, normal, high)
- `maxRetries` (number): Maximum retry attempts for background jobs

## Examples

### Example 1: Simple GET Request

```javascript
const axios = require('axios');

const request = {
  url: "https://api.github.com/zen",
  method: "GET",
  headers: {
    "Accept": "application/json"
  }
};

axios.post('https://keyboard.dev/api/pipedream/execute', request, {
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN',
    'Content-Type': 'application/json'
  }
})
.then(response => console.log(response.data))
.catch(error => console.error(error));
```

### Example 2: POST with Body (Notion API)

```javascript
const axios = require('axios');

const request = {
  url: "https://api.notion.com/v1/pages",
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28"
  },
  body: {
    parent: {
      database_id: "your-database-id-here"
    },
    properties: {
      Title: {
        title: [{
          text: { content: "New Task from API" }
        }]
      },
      Status: {
        select: { name: "To Do" }
      },
      Priority: {
        select: { name: "High" }
      }
    }
  }
};

axios.post('https://keyboard.dev/api/pipedream/execute', request, {
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN',
    'Content-Type': 'application/json',
    'x-keyboard-provider-user-token-for-notion': 'YOUR_NOTION_TOKEN'
  }
})
.then(response => console.log(response.data))
.catch(error => console.error(error));
```

### Example 3: Using Environment Variables

Credentials passed via `x-keyboard-provider-user-token-for-*` headers are automatically converted to `KEYBOARD_*` environment variables and injected into the execution context.

```javascript
const request = {
  url: "https://api.notion.com/v1/search",
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28",
    "Authorization": "${process.env.KEYBOARD_PROVIDER_USER_TOKEN_FOR_NOTION}"
  },
  body: {
    page_size: 5
  }
};

// The executor will replace ${process.env.KEYBOARD_PROVIDER_USER_TOKEN_FOR_NOTION}
// with the actual token from the x-keyboard-provider-user-token-for-notion header
```

## How It Works

### 1. Request Detection

The executor detects Pipedream format when both `url` and `method` are present at the root level of the payload:

```typescript
// In SecureExecutor.executeCode()
if (payload.url && payload.method) {
    const convertedPayload = this.convertPipedreamToApiCalls(payload);
    return this.executeSecureWithDataVariables(convertedPayload, headerEnvVars);
}
```

### 2. Automatic Conversion

The request is automatically converted to the internal `api_calls` format:

**Original Pipedream format:**
```json
{
  "url": "https://api.example.com",
  "method": "POST",
  "headers": {"Content-Type": "application/json"},
  "body": {"key": "value"}
}
```

**Converted to:**
```json
{
  "api_calls": {
    "httpRequest": {
      "url": "https://api.example.com",
      "method": "POST",
      "headers": {"Content-Type": "application/json"},
      "body": {"key": "value"}
    }
  },
  "global_code": "const response = await httpRequest();\nconsole.log('HTTP Response Status:', response.status);\nconsole.log('HTTP Response Body:', JSON.stringify(response.body, null, 2));\nreturn response;"
}
```

### 3. Secure Two-Phase Execution

The converted request follows the standard secure two-phase execution model:

**Phase 1: Data Variable Execution (with credentials)**
- Executes `httpRequest()` in isolated environment
- Full access to credentials via environment variables
- Makes HTTP request using Node.js `http`/`https` modules
- Returns response with status, headers, and body

**Phase 2: Global Code Execution (without credentials)**
- Executes auto-generated global_code
- No access to credentials
- Receives sanitized response from Phase 1
- Logs and returns the response

### 4. Response Format

The response includes:

```json
{
  "success": true,
  "executionMode": "secure-two-phase",
  "stdout": "HTTP Response Status: 200\nHTTP Response Body: {...}",
  "data": {
    "status": 200,
    "headers": {...},
    "body": {...}
  },
  "sanitizedDataVariables": {
    "httpRequest": {
      "status": 200,
      "headers": {...},
      "body": {...}
    }
  }
}
```

## Important Notes

### ⚠️ Do NOT Double-Stringify

**WRONG:**
```javascript
let data = JSON.stringify({
  url: "https://api.example.com",
  method: "POST",
  headers: {...},
  body: {...}
});

axios.post('https://keyboard.dev/api/pipedream/execute', data);
```

**CORRECT:**
```javascript
let data = {
  url: "https://api.example.com",
  method: "POST",
  headers: {...},
  body: {...}
};

axios.post('https://keyboard.dev/api/pipedream/execute', data);
```

Axios (and most HTTP clients) automatically serialize JSON objects. Manual `JSON.stringify()` will result in double-encoding.

### 🔒 Security

- Credentials are isolated in Phase 1 execution
- Authorization headers are sanitized from responses
- Environment variables only resolved during credential phase
- No credential access during global code execution

### 📊 Rate Limiting

- Subject to standard data method rate limits
- Max 100 executions per hour per method
- Configurable via `maxDataMethodExecutionsPerHour` option

## Migration Guide

### From Wrapper Format to Pipedream Format

**Before:**
```json
{
  "api_calls": {
    "myRequest": {
      "url": "https://api.example.com",
      "method": "GET"
    }
  },
  "global_code": "const result = await myRequest(); return result;"
}
```

**After:**
```json
{
  "url": "https://api.example.com",
  "method": "GET"
}
```

### Multiple Requests

If you need to make **multiple API calls** or **chain requests**, use the full `api_calls` format:

```json
{
  "api_calls": {
    "getUserData": {
      "url": "https://api.github.com/user",
      "method": "GET"
    },
    "getUserRepos": {
      "url": "https://api.github.com/user/repos",
      "method": "GET",
      "passed_variables": {
        "fetchOptions.url": {
          "passed_from": "getUserData",
          "value": "https://api.github.com/users/${result.login}/repos"
        }
      }
    }
  },
  "global_code": "const user = await getUserData(); const repos = await getUserRepos(); return { user, repos };"
}
```

The Pipedream format is ideal for **single, simple API requests**.

## Implementation Details

### Files Modified

1. **[src/secure/SecureExecutor.ts](../src/secure/SecureExecutor.ts)**
   - Added Pipedream format detection in `executeCode()` (line 82-86)
   - Implemented `convertPipedreamToApiCalls()` method (line 156-210)

2. **[src/types/index.ts](../src/types/index.ts)**
   - Added `url`, `method`, `headers`, `body` fields to `ExecutionPayload` interface (line 20-24)

### Type Definitions

```typescript
export interface ExecutionPayload {
  // ... existing fields ...

  // Pipedream-style direct HTTP request format
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: any;
}
```

## Testing

Run the test script to verify Pipedream format support:

```bash
# Start the server
npm start

# In another terminal, run the test
node test-pipedream-format.js
```

The test script includes examples for:
- Simple GET requests
- POST requests with body
- Requests with authentication headers

## Related Documentation

- [Secure Two-Phase Execution](./secure-two-phase-execution.md)
- [API Calls Format](./api-calls-format.md)
- [Environment Variables and Credentials](./credentials.md)
