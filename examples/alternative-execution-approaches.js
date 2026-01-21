/**
 * Alternative Execution Approaches
 * Comparing different ways to execute user code with network control
 */

// ============================================================================
// APPROACH 1: Module Patching (Better than Proxy)
// ============================================================================

/**
 * Patch Node.js built-in modules before code execution
 * This is MUCH harder to bypass than environment variables
 */
class ModulePatchingExecutor {
  constructor(config = {}) {
    this.blockedDomains = config.blockedDomains || ['api.stripe.com'];
    this.networkLog = [];
  }

  /**
   * Generate code that patches http/https modules
   */
  generatePatchedCode(userCode) {
    return `
// Patch http and https modules BEFORE any user code runs
(function() {
  const Module = require('module');
  const originalRequire = Module.prototype.require;

  // Store original modules
  const originalHttp = originalRequire.call(module, 'http');
  const originalHttps = originalRequire.call(module, 'https');

  const blockedDomains = ${JSON.stringify(this.blockedDomains)};
  const networkLog = [];

  function isBlocked(hostname) {
    return blockedDomains.some(domain =>
      hostname === domain || hostname.endsWith('.' + domain)
    );
  }

  function extractHostname(args) {
    const options = typeof args[0] === 'string' ? new URL(args[0]) : args[0];
    return options.hostname || options.host;
  }

  // Create patched http module
  const patchedHttp = { ...originalHttp };
  patchedHttp.request = function(...args) {
    const hostname = extractHostname(args);
    console.log('[NETWORK] HTTP request to:', hostname);
    networkLog.push({ protocol: 'http', hostname, timestamp: Date.now() });

    if (isBlocked(hostname)) {
      const error = new Error(\`Network request to \${hostname} is blocked by policy\`);
      error.code = 'NETWORK_BLOCKED';
      error.hostname = hostname;
      throw error;
    }

    return originalHttp.request.apply(this, args);
  };
  patchedHttp.get = function(...args) {
    return patchedHttp.request.apply(this, args);
  };

  // Create patched https module
  const patchedHttps = { ...originalHttps };
  patchedHttps.request = function(...args) {
    const hostname = extractHostname(args);
    console.log('[NETWORK] HTTPS request to:', hostname);
    networkLog.push({ protocol: 'https', hostname, timestamp: Date.now() });

    if (isBlocked(hostname)) {
      const error = new Error(\`Network request to \${hostname} is blocked by policy\`);
      error.code = 'NETWORK_BLOCKED';
      error.hostname = hostname;
      throw error;
    }

    return originalHttps.request.apply(this, args);
  };
  patchedHttps.get = function(...args) {
    return patchedHttps.request.apply(this, args);
  };

  // Override require to return patched modules
  Module.prototype.require = function(id) {
    if (id === 'http') return patchedHttp;
    if (id === 'https') return patchedHttps;
    return originalRequire.apply(this, arguments);
  };

  // Export network log for later retrieval
  global.__networkLog = networkLog;
})();

// Now execute user code
(async () => {
  ${userCode}
})().then(() => {
  // Print network log at the end
  console.log('\\n__NETWORK_LOG__');
  console.log(JSON.stringify(global.__networkLog));
}).catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
    `.trim();
  }

  async executeCode(userCode) {
    const patchedCode = this.generatePatchedCode(userCode);

    // Write to temp file and execute with spawn
    const fs = require('fs');
    const path = require('path');
    const { spawn } = require('child_process');

    const tempFile = path.join(__dirname, '../temp', `patched_${Date.now()}.js`);
    fs.writeFileSync(tempFile, patchedCode);

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      const child = spawn('node', [tempFile], {
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME
          // Note: NO HTTP_PROXY needed - patching is built into the code
        }
      });

      child.stdout.on('data', data => stdout += data);
      child.stderr.on('data', data => stderr += data);

      child.on('close', (code) => {
        fs.unlinkSync(tempFile);

        // Extract network log from output
        const logMatch = stdout.match(/__NETWORK_LOG__\n(.+)/s);
        const networkLog = logMatch ? JSON.parse(logMatch[1]) : [];

        resolve({
          success: code === 0,
          output: stdout.replace(/__NETWORK_LOG__\n.+/s, '').trim(),
          error: stderr,
          networkLog
        });
      });
    });
  }
}

// ============================================================================
// APPROACH 2: Docker Execution (Most Secure)
// ============================================================================

/**
 * Execute code in Docker containers with network isolation
 */
class DockerExecutor {
  constructor(config = {}) {
    this.image = config.image || 'node:20-alpine';
    this.networkMode = config.networkMode || 'none'; // 'none', 'bridge', 'custom'
    this.blockedDomains = config.blockedDomains || [];
  }

  /**
   * Execute code in an isolated Docker container
   */
  async executeCode(userCode) {
    const Docker = require('dockerode');
    const docker = new Docker();
    const fs = require('fs');
    const path = require('path');
    const { execSync } = require('child_process');

    // Create temp directory for code
    const tempDir = path.join(__dirname, '../temp', `docker_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'code.js'), userCode);

    try {
      // Create custom network with firewall rules if needed
      let networkName = this.networkMode;
      if (this.networkMode === 'custom' && this.blockedDomains.length > 0) {
        networkName = `code-exec-${Date.now()}`;
        await docker.createNetwork({
          Name: networkName,
          Driver: 'bridge'
        });

        // Set up iptables rules to block domains
        // (This requires the host to have iptables)
        for (const domain of this.blockedDomains) {
          const ip = execSync(`dig +short ${domain} | head -1`).toString().trim();
          if (ip) {
            execSync(`iptables -A FORWARD -d ${ip} -j REJECT`);
          }
        }
      }

      // Create and run container
      const container = await docker.createContainer({
        Image: this.image,
        Cmd: ['node', '/code/code.js'],
        HostConfig: {
          NetworkMode: networkName === 'custom' ? networkName : this.networkMode,
          AutoRemove: true,
          Memory: 512 * 1024 * 1024, // 512MB limit
          NanoCpus: 1000000000, // 1 CPU
          ReadonlyRootfs: false,
          Binds: [`${tempDir}:/code:ro`] // Mount code as read-only
        },
        NetworkingConfig: {
          EndpointsConfig: networkName !== 'none' ? {
            [networkName]: {}
          } : undefined
        }
      });

      await container.start();

      // Wait for container to finish
      const result = await container.wait();

      // Get logs
      const logs = await container.logs({
        stdout: true,
        stderr: true
      });

      // Cleanup
      if (networkName.startsWith('code-exec-')) {
        await docker.getNetwork(networkName).remove();
      }
      fs.rmSync(tempDir, { recursive: true });

      return {
        success: result.StatusCode === 0,
        output: logs.toString(),
        exitCode: result.StatusCode
      };

    } catch (error) {
      // Cleanup on error
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true });
      }
      throw error;
    }
  }
}

// ============================================================================
// APPROACH 3: isolated-vm (In-Process Sandboxing)
// ============================================================================

/**
 * Execute code using isolated-vm for true V8 isolation
 * This is much faster than Docker but still very secure
 */
class IsolatedVMExecutor {
  constructor(config = {}) {
    // Note: Requires 'isolated-vm' package: npm install isolated-vm
    this.timeout = config.timeout || 30000;
    this.memoryLimit = config.memoryLimit || 128; // MB
    this.blockedDomains = config.blockedDomains || [];
  }

  async executeCode(userCode) {
    const ivm = require('isolated-vm');

    // Create isolated VM instance
    const isolate = new ivm.Isolate({
      memoryLimit: this.memoryLimit
    });
    const context = await isolate.createContext();

    // Create network monitoring wrapper
    const networkLog = [];

    // Inject controlled http/https modules
    const httpModule = await this.createControlledHttpModule(networkLog);
    await context.global.set('__http', httpModule);
    await context.global.set('__https', httpModule);

    // Inject console
    await context.global.set('console', {
      log: (...args) => console.log('[VM]', ...args),
      error: (...args) => console.error('[VM]', ...args)
    });

    // Wrap user code with require override
    const wrappedCode = `
      // Override require for http/https
      const require = (id) => {
        if (id === 'http') return __http;
        if (id === 'https') return __https;
        throw new Error('Module ' + id + ' is not available in this sandbox');
      };

      ${userCode}
    `;

    try {
      // Compile and run code
      const script = await isolate.compileScript(wrappedCode);
      const result = await script.run(context, { timeout: this.timeout });

      return {
        success: true,
        output: result,
        networkLog
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        networkLog
      };
    } finally {
      // Cleanup
      context.release();
      isolate.dispose();
    }
  }

  async createControlledHttpModule(networkLog) {
    // Create a controlled http module that blocks certain domains
    return {
      request: (options, callback) => {
        const hostname = options.hostname || options.host;

        networkLog.push({
          hostname,
          timestamp: Date.now()
        });

        if (this.blockedDomains.includes(hostname)) {
          const error = new Error(`Network request to ${hostname} blocked`);
          error.code = 'NETWORK_BLOCKED';
          throw error;
        }

        // In isolated-vm, you'd need to use context.global.setReference
        // to allow actual network calls with approval
        throw new Error('Network calls not implemented in sandbox mode');
      },
      get: function(options, callback) {
        return this.request(options, callback);
      }
    };
  }
}

// ============================================================================
// APPROACH 4: VM2 (Simpler VM Sandboxing)
// ============================================================================

/**
 * Execute code using vm2 for simpler sandboxing
 * Easier than isolated-vm but less secure
 */
class VM2Executor {
  constructor(config = {}) {
    // Note: Requires 'vm2' package: npm install vm2
    this.timeout = config.timeout || 30000;
    this.blockedDomains = config.blockedDomains || [];
    this.networkLog = [];
  }

  async executeCode(userCode) {
    const { NodeVM } = require('vm2');

    const vm = new NodeVM({
      console: 'redirect',
      timeout: this.timeout,
      sandbox: {},
      require: {
        external: false, // Don't allow external modules by default
        builtin: ['http', 'https'], // Allow specific built-ins
        mock: {
          http: this.createMockHttpModule('http'),
          https: this.createMockHttpModule('https')
        }
      }
    });

    try {
      // Run code in VM
      const result = vm.run(userCode);

      return {
        success: true,
        output: result,
        networkLog: this.networkLog
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        networkLog: this.networkLog
      };
    }
  }

  createMockHttpModule(protocol) {
    const self = this;

    return {
      request(options, callback) {
        const hostname = options.hostname || options.host;

        self.networkLog.push({
          protocol,
          hostname,
          timestamp: Date.now()
        });

        console.log(`[NETWORK] ${protocol.toUpperCase()} request to:`, hostname);

        if (self.blockedDomains.includes(hostname)) {
          const error = new Error(`Network request to ${hostname} blocked by policy`);
          error.code = 'NETWORK_BLOCKED';
          throw error;
        }

        // Could implement actual network call here or block entirely
        throw new Error('Network calls are disabled in sandbox mode');
      },
      get(options, callback) {
        return this.request(options, callback);
      }
    };
  }
}

// ============================================================================
// COMPARISON DEMO
// ============================================================================

async function compareApproaches() {
  console.log('=== Execution Approach Comparison ===\n');

  // Test code that tries to call Stripe
  const testCode = `
    const stripe = require('stripe')('sk_test_fake');
    console.log('Attempting to call Stripe API...');
    // This will be blocked by all approaches
  `;

  // Approach 1: Module Patching
  console.log('1. Module Patching Approach:');
  const patcher = new ModulePatchingExecutor({
    blockedDomains: ['api.stripe.com']
  });
  const result1 = await patcher.executeCode(testCode);
  console.log('Result:', result1);
  console.log('');

  // Approach 2: Docker (commented out - requires Docker)
  console.log('2. Docker Approach:');
  console.log('   (Requires Docker daemon - see code for implementation)');
  console.log('   Provides kernel-level isolation');
  console.log('');

  // Approach 3: isolated-vm (commented out - requires package)
  console.log('3. isolated-vm Approach:');
  console.log('   (Requires npm install isolated-vm)');
  console.log('   Provides V8-level isolation');
  console.log('');

  // Approach 4: vm2 (commented out - requires package)
  console.log('4. VM2 Approach:');
  console.log('   (Requires npm install vm2)');
  console.log('   Simpler but less secure than isolated-vm');
  console.log('');
}

// Export for use in other files
module.exports = {
  ModulePatchingExecutor,
  DockerExecutor,
  IsolatedVMExecutor,
  VM2Executor
};

if (require.main === module) {
  compareApproaches().catch(console.error);
}
