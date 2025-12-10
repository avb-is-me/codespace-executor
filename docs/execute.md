# /execute Endpoint Examples

This document provides comprehensive examples of making requests to the `/execute` endpoint with all three supported execution modes.

## Table of Contents

- [Regular Code Execution](#regular-code-execution)
- [Secure Code Execution (Two-Phase)](#secure-code-execution-two-phase)
- [Pipedream-Style HTTP Requests](#pipedream-style-http-requests)
  - [New Format: Multiple Chained Requests](#new-format-multiple-chained-requests)
  - [Legacy Format: Single Request](#legacy-format-single-request)

---

## Regular Code Execution

Execute JavaScript code directly in the Node.js environment.

### Example 1: Simple Code Execution

```javascript
const axios = require('axios');

const request = {
  code: `
    const result = { message: 'Hello World', timestamp: new Date().toISOString() };
    console.log(JSON.stringify(result, null, 2));
    return result;
  `
};

axios.post('http://localhost:3000/execute', request, {
  headers: {
    'Content-Type': 'application/json'
  }
})
.then(response => {
  console.log('✅ Success!');
  console.log(JSON.stringify(response.data, null, 2));
})
.catch(error => console.error('❌ Error:', error.message));
```

**Response:**
```json
{
  "success": true,
  "executionMode": "full-access",
  "stdout": "{\n  \"message\": \"Hello World\",\n  \"timestamp\": \"2025-12-10T10:30:00.000Z\"\n}",
  "data": {
    "message": "Hello World",
    "timestamp": "2025-12-10T10:30:00.000Z"
  }
}
```

### Example 2: Code with AI Evaluation

```javascript
const axios = require('axios');

const request = {
  code: `
    const numbers = [1, 2, 3, 4, 5];
    const sum = numbers.reduce((acc, num) => acc + num, 0);
    console.log('Sum:', sum);
    return { numbers, sum };
  `,
  ai_eval: true  // Enable AI analysis of the execution results
};

axios.post('http://localhost:3000/execute', request, {
  headers: {
    'Content-Type': 'application/json'
  }
})
.then(response => {
  console.log('✅ Success!');
  console.log('AI Analysis:', response.data.aiAnalysis);
  console.log('Result:', response.data.data);
})
.catch(error => console.error('❌ Error:', error.message));
```

---

## Secure Code Execution (Two-Phase)

Secure two-phase execution separates credential-sensitive operations from general code execution.

### Example 1: API Call with Secure Data Methods

```javascript
const axios = require('axios');

const request = {
  api_calls: {
    fetchGitHubUser: {
      url: "https://api.github.com/users/octocat",
      method: "GET",
      headers: {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "Codespace-Executor"
      }
    }
  },
  global_code: `
    // Phase 2: Process the API response without access to credentials
    const userData = await fetchGitHubUser();

    console.log('User:', userData.body.login);
    console.log('Name:', userData.body.name);
    console.log('Public Repos:', userData.body.public_repos);

    return {
      login: userData.body.login,
      name: userData.body.name,
      repos: userData.body.public_repos,
      followers: userData.body.followers
    };
  `
};

axios.post('http://localhost:3000/execute', request, {
  headers: {
    'Content-Type': 'application/json'
  }
})
.then(response => {
  console.log('✅ Success!');
  console.log('Execution Mode:', response.data.executionMode);
  console.log('Result:', JSON.stringify(response.data.data, null, 2));
})
.catch(error => console.error('❌ Error:', error.message));
```

**Response:**
```json
{
  "success": true,
  "executionMode": "secure-two-phase",
  "stdout": "User: octocat\nName: The Octocat\nPublic Repos: 8",
  "data": {
    "login": "octocat",
    "name": "The Octocat",
    "repos": 8,
    "followers": 5000
  },
  "sanitizedDataVariables": {
    "fetchGitHubUser": {
      "status": 200,
      "headers": {...},
      "body": {...}
    }
  }
}
```

### Example 2: Authenticated API Request with Environment Variables

```javascript
const axios = require('axios');

const request = {
  api_calls: {
    createNotionPage: {
      url: "https://api.notion.com/v1/pages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
        // Credential injected from header
        "Authorization": "${process.env.KEYBOARD_PROVIDER_USER_TOKEN_FOR_NOTION}"
      },
      body: {
        parent: {
          database_id: "your-database-id-here"
        },
        properties: {
          Title: {
            title: [{
              text: { content: "New Task from Secure Executor" }
            }]
          },
          Status: {
            select: { name: "To Do" }
          }
        }
      }
    }
  },
  global_code: `
    const result = await createNotionPage();

    console.log('Created page:', result.body.id);
    console.log('Status:', result.status);

    return {
      pageId: result.body.id,
      url: result.body.url,
      status: result.status
    };
  `
};

axios.post('http://localhost:3000/execute', request, {
  headers: {
    'Content-Type': 'application/json',
    // Pass Notion token via header (automatically converted to env var)
    'x-keyboard-provider-user-token-for-notion': 'secret_YourNotionIntegrationToken'
  }
})
.then(response => {
  console.log('✅ Success!');
  console.log('Page Created:', response.data.data);
})
.catch(error => console.error('❌ Error:', error.message));
```

### Example 3: Multiple Chained API Calls

```javascript
const axios = require('axios');

const request = {
  api_calls: {
    getUser: {
      url: "https://api.github.com/user",
      method: "GET",
      headers: {
        "Accept": "application/vnd.github.v3+json",
        "Authorization": "${process.env.KEYBOARD_PROVIDER_USER_TOKEN_FOR_GITHUB}"
      }
    },
    getUserRepos: {
      url: "https://api.github.com/users/placeholder/repos",
      method: "GET",
      headers: {
        "Accept": "application/vnd.github.v3+json"
      },
      // Chain the repos URL from the first call
      passed_variables: {
        "fetchOptions.url": {
          passed_from: "getUser",
          value: "https://api.github.com/users/${result.body.login}/repos"
        }
      }
    }
  },
  global_code: `
    const user = await getUser();
    const repos = await getUserRepos();

    console.log('User:', user.body.login);
    console.log('Total Repos:', repos.body.length);

    return {
      user: {
        login: user.body.login,
        name: user.body.name
      },
      repoCount: repos.body.length,
      repos: repos.body.map(r => ({
        name: r.name,
        stars: r.stargazers_count
      }))
    };
  `
};

axios.post('http://localhost:3000/execute', request, {
  headers: {
    'Content-Type': 'application/json',
    'x-keyboard-provider-user-token-for-github': 'ghp_YourGitHubPersonalAccessToken'
  }
})
.then(response => {
  console.log('✅ Success!');
  console.log('Result:', JSON.stringify(response.data.data, null, 2));
})
.catch(error => console.error('❌ Error:', error.message));
```

---

## Pipedream-Style HTTP Requests

Simplified format for single HTTP requests without wrapping in `api_calls`.

### Example 1: Simple GET Request

```javascript
const axios = require('axios');

const request = {
  url: "https://api.github.com/zen",
  method: "GET",
  headers: {
    "Accept": "application/json",
    "User-Agent": "Codespace-Executor"
  }
};

axios.post('http://localhost:3000/execute', request, {
  headers: {
    'Content-Type': 'application/json'
  }
})
.then(response => {
  console.log('✅ Success!');
  console.log('GitHub Zen:', response.data.data.body);
})
.catch(error => console.error('❌ Error:', error.message));
```

**Response:**
```json
{
  "success": true,
  "executionMode": "secure-two-phase",
  "stdout": "HTTP Response Status: 200\nHTTP Response Body: \"Keep it logically awesome.\"",
  "data": {
    "status": 200,
    "headers": {...},
    "body": "Keep it logically awesome."
  },
  "sanitizedDataVariables": {
    "httpRequest": {
      "status": 200,
      "headers": {...},
      "body": "Keep it logically awesome."
    }
  }
}
```

### Example 2: POST Request with Body

```javascript
const axios = require('axios');

const request = {
  url: "https://jsonplaceholder.typicode.com/posts",
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: {
    title: "Test Post",
    body: "This is a test post from the code executor",
    userId: 1
  }
};

axios.post('http://localhost:3000/execute', request, {
  headers: {
    'Content-Type': 'application/json'
  }
})
.then(response => {
  console.log('✅ Success!');
  console.log('Created Post ID:', response.data.data.body.id);
  console.log('Response:', JSON.stringify(response.data.data.body, null, 2));
})
.catch(error => console.error('❌ Error:', error.message));
```

### Example 3: Authenticated Pipedream Request (Notion)

```javascript
const axios = require('axios');

const request = {
  url: "https://api.notion.com/v1/pages",
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28",
    // Credential will be injected from the header
    "Authorization": "${process.env.KEYBOARD_PROVIDER_USER_TOKEN_FOR_NOTION}"
  },
  body: {
    parent: {
      database_id: "your-database-id-here"
    },
    properties: {
      Title: {
        title: [{
          text: { content: "New Task from Pipedream Format" }
        }]
      },
      Status: {
        select: { name: "In Progress" }
      },
      Priority: {
        select: { name: "High" }
      }
    }
  }
};

axios.post('http://localhost:3000/execute', request, {
  headers: {
    'Content-Type': 'application/json',
    // Pass Notion token via header (automatically converted to env var)
    'x-keyboard-provider-user-token-for-notion': 'secret_YourNotionIntegrationToken'
  }
})
.then(response => {
  console.log('✅ Success!');
  console.log('Status:', response.data.data.status);
  console.log('Created Page ID:', response.data.data.body.id);
})
.catch(error => {
  console.error('❌ Error:');
  if (error.response) {
    console.error('Status:', error.response.status);
    console.error('Data:', error.response.data);
  } else {
    console.error('Message:', error.message);
  }
});
```

**Response:**
```json
{
  "success": true,
  "executionMode": "secure-two-phase",
  "stdout": "HTTP Response Status: 200\nHTTP Response Body: {...}",
  "data": {
    "status": 200,
    "headers": {
      "content-type": "application/json; charset=utf-8",
      "notion-version": "2022-06-28"
    },
    "body": {
      "id": "page-uuid-here",
      "url": "https://www.notion.so/...",
      "properties": {...}
    }
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

---

## Additional Features

### Background Execution

Submit long-running tasks as background jobs:

```javascript
const request = {
  code: `
    // Long-running operation
    await new Promise(resolve => setTimeout(resolve, 60000));
    return { completed: true };
  `,
  background: true,
  priority: 'high',
  timeout: 120000,
  maxRetries: 2
};

axios.post('http://localhost:3000/execute', request)
.then(response => {
  console.log('Job ID:', response.data.jobId);
  console.log('Status:', response.data.status);

  // Poll for results
  const jobId = response.data.jobId;
  // GET /jobs/{jobId} to check status
});
```

### Encrypted Responses

Request encrypted responses using asymmetric encryption:

```javascript
const request = {
  code: `return { secret: 'sensitive data' };`,
  use_asymmetric_encryption: true
};

axios.post('http://localhost:3000/execute', request)
.then(response => {
  console.log('Encrypted:', response.data.encrypted);
  console.log('Data:', response.data.data); // Encrypted payload

  // Decrypt on client side using private key
});
```

---

## Format Detection

The executor automatically detects the request format:

1. **Pipedream Format**: If `url` and `method` are present at the root level
2. **Secure Two-Phase**: If `api_calls` or `Secure_data_methods` are present
3. **Regular Execution**: If only `code` or `Global_code` is present

---

## Important Notes

### ⚠️ Do NOT Double-Stringify

**WRONG:**
```javascript
const data = JSON.stringify({ url: "...", method: "POST" });
axios.post('/execute', data);
```

**CORRECT:**
```javascript
const data = { url: "...", method: "POST" };
axios.post('/execute', data);
```

Axios automatically serializes JSON objects. Manual `JSON.stringify()` will cause parsing errors.

### 🔒 Security

- **Credentials** passed via `x-keyboard-provider-user-token-for-*` headers are automatically converted to environment variables
- **Two-phase execution** ensures credentials are isolated from user code
- **Authorization headers** are sanitized from responses

### 📊 Timeouts

- **Default timeout**: 30,000ms (30 seconds)
- **Background jobs**: 600,000ms (10 minutes)
- **Custom timeout**: Use the `timeout` parameter

---

## Related Documentation

- [Pipedream Format Documentation](./pipedream-format.md)
- [Secure Two-Phase Execution](./secure-two-phase-execution.md)
- [Job System Documentation](./jobs.md)
