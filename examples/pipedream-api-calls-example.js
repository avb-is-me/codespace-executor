const axios = require('axios');

/**
 * Example: Using Pipedream-style requests within api_calls
 *
 * Key differences from regular api_calls:
 * 1. Add `type: "pipedream"` or `pipedream: true` to the request
 * 2. NO Authorization header in the request (Pipedream handles auth via JWT)
 * 3. Pass JWT token via `x-keyboard-pipedream-jwt-token` header
 */

const request = {
  api_calls: {
    createNotionPage: {
      url: "https://api.notion.com/v1/pages",
      method: "POST",
      type: "pipedream",  // This marks it as a Pipedream request
      headers: {
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28"
        // NO Authorization header - Pipedream JWT handles auth
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
            select: { name: "To Do" }
          },
          Priority: {
            select: { name: "High" }
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
    // Pass Pipedream JWT token via this header
    'x-keyboard-pipedream-jwt-token': 'your-pipedream-jwt-token-here'
  }
})
.then(response => {
  console.log('✅ Success!');
  console.log('Response:', JSON.stringify(response.data, null, 2));
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
