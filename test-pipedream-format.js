/**
 * Test script for Pipedream-style HTTP request format
 *
 * This demonstrates how to send a direct HTTP request in Pipedream format
 * to the secure code executor, which will automatically convert it to the
 * internal api_calls format.
 */

const axios = require('axios');

// Example 1: Notion API request (from user's example)
const notionRequest = {
  url: "https://api.notion.com/v1/pages",
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28",
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

// Example 2: Simple GET request
const githubRequest = {
  url: "https://api.github.com/zen",
  method: "GET",
  headers: {
    "Accept": "application/json"
  }
};

// Example 3: Search request (original user example)
const notionSearchRequest = {
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

async function testPipedreamFormat(requestPayload, testName) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${testName}`);
  console.log(`${'='.repeat(60)}`);
  console.log('Request Payload:');
  console.log(JSON.stringify(requestPayload, null, 2));

  try {
    const config = {
      method: 'post',
      maxBodyLength: Infinity,
      url: 'http://localhost:3000/execute',
      headers: {
        'Content-Type': 'application/json'
      },
      data: requestPayload  // Send as object, NOT JSON.stringify()
    };

    const response = await axios.request(config);

    console.log('\n✅ Success!');
    console.log('Response Status:', response.status);
    console.log('Response Data:');
    console.log(JSON.stringify(response.data, null, 2));

  } catch (error) {
    console.error('\n❌ Error:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
  }
}

// Run tests
async function runTests() {
  console.log('🧪 Testing Pipedream-style HTTP Request Format');
  console.log('================================================\n');
  console.log('This test verifies that the secure code executor can accept');
  console.log('Pipedream-style requests with url, method, headers, and body');
  console.log('at the root level (no api_calls wrapper needed).\n');

  // Test simple GET request first
  await testPipedreamFormat(githubRequest, 'Simple GET Request (GitHub Zen)');

  // Uncomment these when ready to test with actual credentials
  // await testPipedreamFormat(notionSearchRequest, 'Notion Search API');
  // await testPipedreamFormat(notionRequest, 'Notion Create Page API');
}

// Check if server is running
axios.get('http://localhost:3000/health')
  .then(() => {
    console.log('✅ Server is running\n');
    runTests();
  })
  .catch((error) => {
    console.error('❌ Server is not running at http://localhost:3000');
    console.error('Please start the server first with: npm start');
    process.exit(1);
  });
