/**
 * Pipedream Integration Examples for Secure Executor
 *
 * This file demonstrates how to use the Pipedream integration
 * through keyboard.dev's proxy API.
 */

import SecureExecutor from '../src/secure/SecureExecutor.js';

// Example 1: Secure Data Variables Mode with Pipedream
async function example1_SecureDataVariablesMode() {
  const executor = new SecureExecutor();
  const userJwt = 'your-user-jwt-token'; // Replace with actual JWT

  const payload = {
    secure_data_variables: {
      slackMessage: {
        keyboardApiProxy: {
          service: 'pipedream' as const,
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

  try {
    const result = await executor.executeCode(payload, {}, userJwt);
    console.log('Execution result:', result);
  } catch (error) {
    console.error('Execution failed:', error);
  }
}

// Example 2: General Code Execution Mode with Pipedream
async function example2_GeneralCodeExecutionMode() {
  const executor = new SecureExecutor();
  const userJwt = 'your-user-jwt-token'; // Replace with actual JWT

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

      console.log('User info:', userInfo);

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

  try {
    const result = await executor.executeCode(payload, {}, userJwt);
    console.log('Execution result:', result);
  } catch (error) {
    console.error('Execution failed:', error);
  }
}

// Example 3: Multiple Pipedream API Calls with Dependencies
async function example3_MultiplePipedreamCallsWithDependencies() {
  const executor = new SecureExecutor();
  const userJwt = 'your-user-jwt-token'; // Replace with actual JWT

  const payload = {
    secure_data_variables: {
      // First API call - Get GitHub user
      githubUser: {
        keyboardApiProxy: {
          service: 'pipedream' as const,
          externalUserId: 'github-user-789',
          accountId: 'apn_github_account',
          url: 'https://api.github.com/user',
          method: 'GET'
        }
      },

      // Second API call - Create GitHub issue using data from first call
      githubIssue: {
        keyboardApiProxy: {
          service: 'pipedream' as const,
          externalUserId: 'github-user-789',
          accountId: 'apn_github_account',
          url: 'https://api.github.com/repos/owner/repo/issues',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: {
            title: 'Automated Issue',
            body: 'This issue was created automatically.',
            labels: ['automation']
          }
        },
        passed_variables: {
          'body.assignee': {
            passed_from: 'githubUser',
            value: '${result.login}',
            field_name: 'body.assignee'
          }
        }
      }
    },
    Global_code: `
      const user = await githubUser();
      console.log('GitHub user:', user);

      const issue = await githubIssue();
      console.log('Created issue:', issue);

      return { user, issue };
    `
  };

  try {
    const result = await executor.executeCode(payload, {}, userJwt);
    console.log('Execution result:', result);
  } catch (error) {
    console.error('Execution failed:', error);
  }
}

// Example 4: Mixing Traditional HTTP and Pipedream Proxy
async function example4_MixingHttpAndPipedream() {
  const executor = new SecureExecutor();
  const userJwt = 'your-user-jwt-token'; // Replace with actual JWT

  const payload = {
    secure_data_variables: {
      // Traditional HTTP call to public API
      publicData: {
        fetchOptions: {
          url: 'https://api.example.com/public/data',
          method: 'GET'
        }
      },

      // Pipedream proxy call to authenticated service
      privateData: {
        keyboardApiProxy: {
          service: 'pipedream' as const,
          externalUserId: 'user-123',
          accountId: 'apn_account_id',
          url: 'https://api.private-service.com/data',
          method: 'GET'
        }
      }
    },
    Global_code: `
      const publicResult = await publicData();
      const privateResult = await privateData();

      return {
        public: publicResult,
        private: privateResult
      };
    `
  };

  try {
    const result = await executor.executeCode(payload, {}, userJwt);
    console.log('Execution result:', result);
  } catch (error) {
    console.error('Execution failed:', error);
  }
}

// Run examples
console.log('=== Pipedream Integration Examples ===\n');

// Uncomment to run specific examples:
// await example1_SecureDataVariablesMode();
// await example2_GeneralCodeExecutionMode();
// await example3_MultiplePipedreamCallsWithDependencies();
// await example4_MixingHttpAndPipedream();

export {
  example1_SecureDataVariablesMode,
  example2_GeneralCodeExecutionMode,
  example3_MultiplePipedreamCallsWithDependencies,
  example4_MixingHttpAndPipedream
};
