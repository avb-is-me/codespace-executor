# Pipedream Integration for Secure Executor

This document describes the implementation of Pipedream Connect proxy API integration in the Secure Executor, enabling authenticated access to 3,000+ apps through keyboard.dev's proxy service.

## Overview

The Pipedream integration allows users to make authenticated API calls to external services (Slack, Notion, GitHub, etc.) through Pipedream's managed OAuth system without exposing credentials in the execution environment. All authentication is handled server-side by the keyboard.dev API.

## Architecture

### Security Model
- **Client-side**: No Pipedream credentials stored in execution environment
- **Server-side**: keyboard.dev API handles Pipedream authentication using stored client credentials
- **User context**: JWT passed from client authenticates the user making proxy requests

### Components Added

1. **Type Definitions** (`src/types/index.ts`)
   - `KeyboardApiProxyConfig`: Configuration for proxy requests
   - `KeyboardApiProxyRequest`: Internal request format
   - `KeyboardApiProxyResponse`: Standard response format

2. **API Client** (`src/utils/keyboard-api-client.ts`)
   - `KeyboardApiClient`: HTTP client for keyboard.dev API
   - `executeKeyboardApiProxy`: Standalone proxy function

3. **SecureExecutor Enhancements** (`src/secure/SecureExecutor.ts`)
   - Support for keyboard API proxy in both execution modes
   - JWT parameter added to execution methods
   - Validation for proxy configurations

4. **Template Updates** (`src/secure/templates.ts`)
   - Injection of `keyboardApiProxy` function in global execution
   - Support for proxy calls in secure global context

## Usage Patterns

### 1. Secure Data Variables Mode

Use `keyboardApiProxy` within the `secure_data_variables` section:

```typescript
const payload = {
  secure_data_variables: {
    slackMessage: {
      keyboardApiProxy: {
        service: 'pipedream',
        externalUserId: 'user-123',
        accountId: 'apn_1234567', 
        url: 'https://slack.com/api/chat.postMessage',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: {
          channel: '#general',
          text: 'Hello from Pipedream!'
        }
      }
    }
  },
  Global_code: `
    console.log('Sending Slack message...');
    const result = await slackMessage();
    console.log('Message sent:', result);
    return result;
  `
};

// Execute with JWT
const result = await secureExecutor.executeCode(payload, headerEnvVars, userJwt);
```

### 2. General Code Execution Mode

Use the injected `keyboardApiProxy` function directly in your code:

```javascript
const payload = {
  code: `
    // Get Slack user info
    const userInfo = await keyboardApiProxy({
      service: 'pipedream',
      externalUserId: 'user-456',
      accountId: 'apn_7654321',
      url: 'https://slack.com/api/users.info?user=U123456',
      method: 'GET'
    });
    
    // Create Notion page
    const notionPage = await keyboardApiProxy({
      service: 'pipedream', 
      externalUserId: 'user-456',
      accountId: 'apn_7654321',
      url: 'https://api.notion.com/v1/pages',
      method: 'POST',
      headers: {
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: {
        parent: { database_id: 'database-id' },
        properties: {
          title: { 
            title: [{ text: { content: 'New Page' } }]
          }
        }
      }
    });
    
    return { userInfo, notionPage };
  `
};

const result = await secureExecutor.executeCode(payload, headerEnvVars, userJwt);
```

## Configuration

### Environment Variables

- `KEYBOARD_API_BASE_URL`: Base URL for keyboard.dev API (default: https://api.keyboard.dev)

### Required Parameters

- **service**: Currently only `'pipedream'` is supported
- **externalUserId**: User identifier in your system (alphanumeric, dashes, underscores)
- **accountId**: Pipedream account ID (must start with `'apn_'`)
- **url**: Target API endpoint URL
- **method**: HTTP method (GET, POST, PUT, PATCH, DELETE)
- **headers**: Optional request headers
- **body**: Optional request body (for non-GET requests)
- **timeout**: Optional timeout in milliseconds (default: 30000)

## keyboard.dev API Endpoint

The implementation expects a server-side endpoint:

```
POST https://api.keyboard.dev/api/pipedream/execute
```

### Request Format
```json
{
  "service": "pipedream",
  "externalUserId": "user-123",
  "accountId": "apn_1234567",
  "url": "https://slack.com/api/chat.postMessage",
  "method": "POST", 
  "headers": {
    "Content-Type": "application/json"
  },
  "body": {
    "channel": "#general",
    "text": "Hello World"
  }
}
```

### Response Format
```json
{
  "success": true,
  "data": {
    "status": 200,
    "headers": {},
    "body": {
      "ok": true,
      "channel": "C123456",
      "ts": "1234567890.123456"
    }
  }
}
```

## Security Features

### Validation
- Service validation (only 'pipedream' allowed)
- URL format validation
- HTTP method validation
- User ID and account ID format validation
- JWT requirement for all proxy requests

### Isolation
- Data variable phase: Has access to JWT for proxy calls
- Global code phase: Proxy function available but no direct credential access
- All responses sanitized before passing to global code

### Error Handling
- Invalid configurations rejected with descriptive errors
- Network errors handled gracefully
- Timeout protection on all requests

## Implementation Notes

### JWT Handling
- JWT passed as optional parameter throughout execution chain
- Required for keyboard API proxy requests
- Not stored in environment or execution context

### Mutual Exclusivity  
- `keyboardApiProxy` and `fetchOptions` cannot be used together in the same data variable
- Each data variable must use either traditional HTTP or keyboard API proxy

### Response Format
- Keyboard API proxy responses normalized to match traditional HTTP response format
- Consistent error handling between proxy and direct HTTP requests

## Examples

### Slack Integration
```typescript
const slackConfig = {
  keyboardApiProxy: {
    service: 'pipedream',
    externalUserId: 'slack-user-123',
    accountId: 'apn_slack_account',
    url: 'https://slack.com/api/chat.postMessage',
    method: 'POST',
    body: {
      channel: '#notifications',
      text: 'Deployment completed successfully!'
    }
  }
};
```

### Notion Integration
```typescript
const notionConfig = {
  keyboardApiProxy: {
    service: 'pipedream',
    externalUserId: 'notion-user-456', 
    accountId: 'apn_notion_account',
    url: 'https://api.notion.com/v1/databases/query',
    method: 'POST',
    headers: {
      'Notion-Version': '2022-06-28'
    },
    body: {
      filter: {
        property: 'Status',
        select: { equals: 'Active' }
      }
    }
  }
};
```

### GitHub Integration
```typescript
const githubConfig = {
  keyboardApiProxy: {
    service: 'pipedream',
    externalUserId: 'github-user-789',
    accountId: 'apn_github_account', 
    url: 'https://api.github.com/repos/owner/repo/issues',
    method: 'POST',
    body: {
      title: 'Automated Issue',
      body: 'This issue was created automatically.',
      labels: ['automation']
    }
  }
};
```

## Migration Guide

### From Direct HTTP Calls
Replace direct `fetchOptions` configurations with `keyboardApiProxy` configurations:

**Before:**
```typescript
fetchOptions: {
  url: 'https://api.example.com/data',
  method: 'GET',
  headers: { 'Authorization': 'Bearer token' }
}
```

**After:**
```typescript
keyboardApiProxy: {
  service: 'pipedream', 
  externalUserId: 'user-id',
  accountId: 'apn_account_id',
  url: 'https://api.example.com/data',
  method: 'GET'
}
```

### Execution Method Calls
Add JWT parameter to execution calls:

**Before:**
```typescript
const result = await executor.executeCode(payload, headerEnvVars);
```

**After:**
```typescript
const result = await executor.executeCode(payload, headerEnvVars, userJwt);
```

## Benefits

1. **Security**: No credential management in execution environment
2. **Scale**: Access to 3,000+ pre-integrated apps
3. **Maintenance**: No OAuth flow implementation required
4. **Auditability**: All API calls logged server-side
5. **Reliability**: Pipedream handles rate limiting and retries