/**
 * Pipedream-Style Notion API Request Example
 *
 * This example demonstrates the correct way to send a Pipedream-style
 * HTTP request to the secure code executor.
 */

const axios = require('axios');

// ✅ CORRECT: Send the request object directly (not stringified)
const requestPayload = {
  url: "https://api.notion.com/v1/pages",
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28",
    // The token will be injected from the x-keyboard-provider-user-token-for-notion header
    "Authorization": "${process.env.KEYBOARD_PROVIDER_USER_TOKEN_FOR_NOTION}"
  },
  body: {
    parent: {
      database_id: "your-database-id-here"
    },
    properties: {
      Title: {
        title: [
          {
            text: {
              content: "New Task from API"
            }
          }
        ]
      },
      Status: {
        select: {
          name: "To Do"
        }
      },
      Priority: {
        select: {
          name: "High"
        }
      }
    }
  }
};

// Configure the axios request
const config = {
  method: 'post',
  maxBodyLength: Infinity,
  url: 'https://keyboard.dev/api/pipedream/execute',
  headers: {
    'Authorization': 'Bearer YOUR_API_TOKEN',
    'Content-Type': 'application/json',
    // Pass Notion token via header (automatically converted to environment variable)
    'x-keyboard-provider-user-token-for-notion': 'secret_YourNotionToken'
  },
  data: requestPayload  // ✅ Send as object, NOT JSON.stringify(requestPayload)
};

// Make the request
axios.request(config)
  .then((response) => {
    console.log('✅ Success!');
    console.log('Status:', response.status);
    console.log('Response:');
    console.log(JSON.stringify(response.data, null, 2));
  })
  .catch((error) => {
    console.error('❌ Error:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Response:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Message:', error.message);
    }
  });


// ❌ WRONG: Do NOT do this!
// const wrongData = JSON.stringify({
//   url: "https://api.notion.com/v1/pages",
//   method: "POST",
//   headers: {...},
//   body: {...}
// });
//
// axios.post('https://keyboard.dev/api/pipedream/execute', wrongData);
//
// This will double-stringify the data and cause parsing errors!
