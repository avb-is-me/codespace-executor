/**
 * Integration Example: Adding Network Control to SecureExecutor
 *
 * This shows how to integrate the proxy into the existing codebase
 */

const NetworkControlProxy = require('./network-proxy-example');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Enhanced SecureExecutor with Network Control
 */
class SecureExecutorWithNetworkControl {
  constructor(config = {}) {
    this.config = {
      // Existing config
      timeout: config.timeout || 30000,
      maxDataMethods: config.maxDataMethods || 10,

      // New network control config
      networkControl: {
        enabled: config.networkControl?.enabled !== false,
        proxyPort: config.networkControl?.proxyPort || 8888,

        // Domain blocking
        blockedDomains: config.networkControl?.blockedDomains || [
          'api.stripe.com',
          'checkout.stripe.com',
          'js.stripe.com'
        ],

        // Or use allowlist mode
        allowedDomains: config.networkControl?.allowedDomains || null,

        // Mock responses for blocked services
        mockResponses: config.networkControl?.mockResponses || {
          'api.stripe.com': {
            error: {
              message: 'Stripe API is not allowed in this environment',
              type: 'policy_error',
              code: 'network_blocked'
            }
          }
        },

        // Response modification rules
        responseModifiers: config.networkControl?.responseModifiers || {},

        // Logging
        logRequests: config.networkControl?.logRequests !== false,
        auditLog: config.networkControl?.auditLog || false
      }
    };

    this.proxyServer = null;
    this.networkLog = [];
  }

  /**
   * Start the network control proxy
   */
  async startNetworkProxy() {
    if (!this.config.networkControl.enabled) {
      return null;
    }

    // Create proxy with custom logging
    const proxy = new NetworkControlProxy({
      port: this.config.networkControl.proxyPort,
      blockedDomains: this.config.networkControl.blockedDomains,
      allowedDomains: this.config.networkControl.allowedDomains,
      mockResponses: this.config.networkControl.mockResponses,
      modifyResponses: this.config.networkControl.responseModifiers,
      logRequests: this.config.networkControl.logRequests
    });

    // Enhance proxy to capture logs
    const originalHandleRequest = proxy.handleRequest.bind(proxy);
    proxy.handleRequest = (req, res) => {
      const logEntry = {
        timestamp: new Date().toISOString(),
        method: req.method,
        url: req.url,
        blocked: proxy.isBlocked(require('url').parse(req.url).hostname)
      };
      this.networkLog.push(logEntry);
      return originalHandleRequest(req, res);
    };

    this.proxyServer = proxy.start();

    // Give proxy time to start
    await new Promise(resolve => setTimeout(resolve, 100));

    return this.proxyServer;
  }

  /**
   * Stop the network control proxy
   */
  async stopNetworkProxy() {
    if (this.proxyServer) {
      return new Promise(resolve => {
        this.proxyServer.close(() => {
          this.proxyServer = null;
          resolve();
        });
      });
    }
  }

  /**
   * Execute code with network control
   */
  async executeCode(payload) {
    const { code, dataVariables = [], mode = 'secure' } = payload;

    try {
      // Start network proxy
      await this.startNetworkProxy();

      // Execute based on mode
      let result;
      if (mode === 'secure') {
        result = await this.executeTwoPhase(code, dataVariables);
      } else {
        result = await this.executeFullMode(code);
      }

      // Add network log to result
      if (this.config.networkControl.enabled) {
        result.networkActivity = {
          totalRequests: this.networkLog.length,
          blockedRequests: this.networkLog.filter(l => l.blocked).length,
          allowedRequests: this.networkLog.filter(l => !l.blocked).length,
          requests: this.networkLog
        };
      }

      return result;

    } finally {
      // Always cleanup
      await this.stopNetworkProxy();
      this.networkLog = [];
    }
  }

  /**
   * Execute in two-phase mode (Phase 1: Data, Phase 2: Global)
   */
  async executeTwoPhase(globalCode, dataVariables) {
    // Phase 1: Execute data variables WITH credentials but WITH network control
    const dataResults = {};
    for (const dataVar of dataVariables) {
      const result = await this.executeDataVariable(dataVar);
      dataResults[dataVar.name] = result;
    }

    // Phase 2: Execute global code WITHOUT credentials WITH network control
    const globalResult = await this.executeGlobalCode(globalCode, dataResults);

    return {
      success: true,
      output: globalResult.output,
      dataResults,
      executionTime: globalResult.executionTime
    };
  }

  /**
   * Execute a single data variable with network control
   */
  async executeDataVariable(dataVar) {
    const { name, url, method = 'GET', headers = {}, body } = dataVar;

    // Generate code for this data variable
    const code = this.generateDataVariableCode(dataVar);

    // Create temp file
    const tempFile = path.join(__dirname, '../temp', `data_${name}_${Date.now()}.js`);
    fs.writeFileSync(tempFile, code);

    try {
      // Execute with network proxy
      const env = this.getExecutionEnvironment(true); // with credentials
      const result = await this.executeInProcess(tempFile, env);
      return result;
    } finally {
      // Cleanup
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  }

  /**
   * Execute global code with network control
   */
  async executeGlobalCode(code, dataResults) {
    // Generate wrapped code with data injection
    const wrappedCode = this.generateGlobalCodeWrapper(code, dataResults);

    // Create temp file
    const tempFile = path.join(__dirname, '../temp', `global_${Date.now()}.js`);
    fs.writeFileSync(tempFile, wrappedCode);

    try {
      // Execute WITHOUT credentials but WITH network control
      const env = this.getExecutionEnvironment(false); // no credentials
      const result = await this.executeInProcess(tempFile, env);
      return result;
    } finally {
      // Cleanup
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  }

  /**
   * Execute code in a child process with network control
   */
  async executeInProcess(scriptPath, env) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';

      const child = spawn('node', [scriptPath], {
        env,
        timeout: this.config.timeout
      });

      child.stdout.on('data', data => {
        stdout += data.toString();
      });

      child.stderr.on('data', data => {
        stderr += data.toString();
      });

      child.on('close', code => {
        const executionTime = Date.now() - startTime;

        if (code === 0) {
          resolve({
            success: true,
            output: stdout,
            executionTime
          });
        } else {
          reject({
            success: false,
            error: stderr || 'Process exited with non-zero code',
            executionTime
          });
        }
      });

      child.on('error', error => {
        reject({
          success: false,
          error: error.message
        });
      });
    });
  }

  /**
   * Get execution environment with network control
   */
  getExecutionEnvironment(withCredentials = false) {
    const env = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: 'production'
    };

    // Add credentials if in Phase 1
    if (withCredentials) {
      Object.keys(process.env).forEach(key => {
        if (key.startsWith('KEYBOARD_')) {
          env[key] = process.env[key];
        }
      });
    }

    // Add network control proxy settings
    if (this.config.networkControl.enabled) {
      env.HTTP_PROXY = `http://localhost:${this.config.networkControl.proxyPort}`;
      env.HTTPS_PROXY = `http://localhost:${this.config.networkControl.proxyPort}`;
      env.NO_PROXY = 'localhost,127.0.0.1';
    }

    return env;
  }

  /**
   * Generate code for data variable
   */
  generateDataVariableCode(dataVar) {
    const { url, method = 'GET', headers = {}, body } = dataVar;

    return `
const https = require('https');
const http = require('http');

const urlObj = new URL('${url}');
const client = urlObj.protocol === 'https:' ? https : http;

const options = {
  hostname: urlObj.hostname,
  port: urlObj.port,
  path: urlObj.pathname + urlObj.search,
  method: '${method}',
  headers: ${JSON.stringify(headers)}
};

const req = client.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log(data);
  });
});

req.on('error', (error) => {
  console.error('Network error:', error.message);
  process.exit(1);
});

${body ? `req.write(${JSON.stringify(body)});` : ''}
req.end();
    `.trim();
  }

  /**
   * Generate wrapped global code
   */
  generateGlobalCodeWrapper(code, dataResults) {
    return `
// Data results injected as async functions
${Object.entries(dataResults).map(([name, result]) => `
async function ${name}() {
  return ${JSON.stringify(result.output)};
}
`).join('\n')}

// User's global code
(async () => {
  ${code}
})().catch(err => {
  console.error('Execution error:', err);
  process.exit(1);
});
    `.trim();
  }

  /**
   * Execute in full mode (direct execution with network control)
   */
  async executeFullMode(code) {
    const tempFile = path.join(__dirname, '../temp', `full_${Date.now()}.js`);
    fs.writeFileSync(tempFile, code);

    try {
      const env = this.getExecutionEnvironment(true); // full access
      const result = await this.executeInProcess(tempFile, env);
      return result;
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  }
}

// Example usage
async function demo() {
  console.log('=== Network Control Integration Demo ===\n');

  const executor = new SecureExecutorWithNetworkControl({
    timeout: 30000,
    networkControl: {
      enabled: true,
      proxyPort: 8888,
      blockedDomains: ['api.stripe.com'],
      logRequests: true,
      mockResponses: {
        'api.stripe.com': {
          error: 'Stripe blocked for security'
        }
      }
    }
  });

  // Example 1: Code that tries to call Stripe
  console.log('Example 1: Blocked Stripe API call\n');
  try {
    const result1 = await executor.executeCode({
      code: `
        const stripe = require('stripe')('sk_test_fake');
        const customer = await stripe.customers.create({
          email: 'test@example.com'
        });
        console.log('Customer created:', customer.id);
      `,
      mode: 'full'
    });

    console.log('Result:', result1);
    console.log('\nNetwork Activity:');
    console.log(JSON.stringify(result1.networkActivity, null, 2));
  } catch (error) {
    console.error('Error:', error);
  }

  // Example 2: Code with data variables
  console.log('\n\nExample 2: Data variables with network control\n');
  try {
    const result2 = await executor.executeCode({
      dataVariables: [
        {
          name: 'userData',
          url: 'https://api.example.com/user/123',
          method: 'GET',
          headers: {
            'Authorization': 'Bearer token123'
          }
        }
      ],
      code: `
        const user = await userData();
        console.log('User data:', user);
      `,
      mode: 'secure'
    });

    console.log('Result:', result2);
    console.log('\nNetwork Activity:');
    console.log(JSON.stringify(result2.networkActivity, null, 2));
  } catch (error) {
    console.error('Error:', error);
  }
}

if (require.main === module) {
  demo().catch(console.error);
}

module.exports = SecureExecutorWithNetworkControl;
