# Pipedream-Style Requests in api_calls

This document explains how to use Pipedream-style requests within the `api_calls` object format.

## Overview

Pipedream requests are identical to regular `api_calls` entries, with two key differences:

1. **Add a `type` field**: Set to `"pipedream"` or use `pipedream: true`
2. **No Authorization header**: Authentication is handled via JWT token passed in the request header

## Format

```javascript
{
  api_calls: {
    requestName: {
      url: "https://api.example.com/endpoint",
      method: "POST",
      type: "pipedream",  // or pipedream: true
      headers: {
        "Content-Type": "application/json"
        // NO Authorization header
      },
      body: {
        // Your request body
      }
    }
  },
  global_code: `
    const result = await requestName();
    return result;
  `
}
```

## Authentication

Pass the Pipedream JWT token via the `x-keyboard-pipedream-jwt-token` header:

```javascript
axios.post('http://localhost:3000/execute', request, {
  headers: {
    'Content-Type': 'application/json',
    'x-keyboard-pipedream-jwt-token': 'your-pipedream-jwt-token'
  }
});
```

The executor will automatically:
1. Detect the `type: "pipedream"` flag
2. Extract the JWT token from the request headers
3. Add `Authorization: Bearer <jwt>` to the Pipedream request
4. Execute the request through the Pipedream execution path

## Complete Example

```javascript
const axios = require('axios');

const request = {
  api_calls: {
    createNotionPage: {
      url: "https://api.notion.com/v1/pages",
      method: "POST",
      type: "pipedream",
      headers: {
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28"
      },
      body: {
        parent: {
          database_id: "your-database-id"
        },
        properties: {
          Title: {
            title: [{
              text: { content: "New Task" }
            }]
          }
        }
      }
    }
  },
  global_code: `
    const result = await createNotionPage();
    console.log('Created:', result.body.id);
    return result;
  `
};

axios.post('http://localhost:3000/execute', request, {
  headers: {
    'Content-Type': 'application/json',
    'x-keyboard-pipedream-jwt-token': 'your-jwt-token'
  }
})
.then(response => console.log('Success:', response.data))
.catch(error => console.error('Error:', error.message));
```

## Comparison with Regular api_calls

### Regular api_calls (with environment variable)

```javascript
{
  api_calls: {
    createPage: {
      url: "https://api.notion.com/v1/pages",
      method: "POST",
      headers: {
        "Authorization": "${process.env.KEYBOARD_PROVIDER_USER_TOKEN_FOR_NOTION}"
      },
      body: { /* ... */ }
    }
  },
  global_code: `const result = await createPage();`
}

// Header:
'x-keyboard-provider-user-token-for-notion': 'secret_token'
```

### Pipedream api_calls (with JWT)

```javascript
{
  api_calls: {
    createPage: {
      url: "https://api.notion.com/v1/pages",
      method: "POST",
      type: "pipedream",  // Only difference in structure
      headers: {
        // NO Authorization header
      },
      body: { /* ... */ }
    }
  },
  global_code: `const result = await createPage();`
}

// Header:
'x-keyboard-pipedream-jwt-token': 'your-jwt-token'
```

## Multiple Pipedream Requests

You can mix Pipedream and regular requests in the same `api_calls` object:

```javascript
{
  api_calls: {
    pipedreamRequest: {
      url: "https://api.service1.com/endpoint",
      method: "GET",
      type: "pipedream"
    },
    regularRequest: {
      url: "https://api.service2.com/endpoint",
      method: "GET",
      headers: {
        "Authorization": "${process.env.KEYBOARD_API_KEY}"
      }
    }
  },
  global_code: `
    const result1 = await pipedreamRequest();
    const result2 = await regularRequest();
    return { result1, result2 };
  `
}
```

## How It Works

1. **Detection**: When converting `api_calls` to `secure_data_variables`, the executor checks for `type === "pipedream"` or `pipedream === true`
2. **Flag Preservation**: An `isPipedream: true` flag is added to the internal config
3. **Template Selection**: During execution, if `isPipedream` is true, the `isolatedPipedreamRequestGenerator` template is used instead of `isolatedDataVariableGenerator`
4. **JWT Injection**: The Pipedream template extracts the JWT token from `headerEnvVars['KEYBOARD_PIPEDREAM_JWT_TOKEN']` and adds it as `Authorization: Bearer <token>`
5. **Execution**: The request is executed with the JWT authentication

## Implementation Details

### Type Definition

```typescript
export interface ApiCallConfig {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  timeout?: number;
  passed_variables?: PassedVariables;
  type?: 'pipedream' | 'default';  // New field
  pipedream?: boolean;              // Alternative flag
}
```

### Files Modified

- **[src/types/index.ts](../src/types/index.ts)**: Added `type` and `pipedream` fields to `ApiCallConfig`
- **[src/secure/SecureExecutor.ts](../src/secure/SecureExecutor.ts)**:
  - Updated `convertApiCallsToSecureDataVariables` to preserve Pipedream flag
  - Updated `generateIsolatedDataVariableCode` to use Pipedream template when flagged
- **[src/secure/templates.ts](../src/secure/templates.ts)**: Added `isolatedPipedreamRequestGenerator` template

## Benefits

1. **Interchangeable**: Pipedream requests use the same format as regular `api_calls`
2. **Simple Migration**: Just add `type: "pipedream"` and change the auth header
3. **Consistent Interface**: Same `global_code` execution model
4. **Secure**: JWT tokens are handled separately from the request config

## Security Notes

- JWT tokens are passed via headers and never exposed in the request payload
- The Pipedream template automatically adds the JWT as a Bearer token
- All Pipedream requests go through the same secure two-phase execution model
- Authorization headers are sanitized from responses

## Related Documentation

- [Execute Endpoint Examples](./execute.md)
- [Secure Two-Phase Execution](./secure-two-phase-execution.md)
- [API Calls Format](./api-calls-format.md)
