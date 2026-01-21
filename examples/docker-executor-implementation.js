/**
 * Docker-based Code Executor
 * Drop-in replacement for spawn-based execution with true network isolation
 */

const Docker = require('dockerode');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

class DockerCodeExecutor {
  constructor(config = {}) {
    this.docker = new Docker();
    this.config = {
      // Docker image to use
      image: config.image || 'node:20-alpine',

      // Network control
      networkMode: config.networkMode || 'none', // 'none', 'bridge', or custom network name
      blockedDomains: config.blockedDomains || ['api.stripe.com'],

      // Resource limits
      memoryLimit: config.memoryLimit || 512 * 1024 * 1024, // 512MB
      cpuLimit: config.cpuLimit || 1000000000, // 1 CPU (in nanoseconds)

      // Execution settings
      timeout: config.timeout || 30000,
      readonlyRootfs: config.readonlyRootfs !== false,
      autoRemove: config.autoRemove !== false,

      // Temp directory
      tempDir: config.tempDir || path.join(__dirname, '../temp')
    };

    // Ensure temp directory exists
    if (!fs.existsSync(this.config.tempDir)) {
      fs.mkdirSync(this.config.tempDir, { recursive: true });
    }
  }

  /**
   * Execute code in Docker container (drop-in replacement for spawn)
   *
   * @param {string} code - JavaScript code to execute
   * @param {object} env - Environment variables (like spawn env option)
   * @returns {Promise<object>} - Execution result
   */
  async executeCode(code, env = {}) {
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const workDir = path.join(this.config.tempDir, executionId);

    try {
      // Create isolated directory for this execution
      fs.mkdirSync(workDir, { recursive: true });
      fs.writeFileSync(path.join(workDir, 'code.js'), code);

      // Pull image if it doesn't exist
      await this.ensureImage();

      // Create and run container
      const result = await this.runContainer(workDir, env, executionId);

      return result;

    } catch (error) {
      return {
        success: false,
        output: '',
        error: error.message,
        exitCode: 1
      };

    } finally {
      // Cleanup
      if (fs.existsSync(workDir)) {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
    }
  }

  /**
   * Ensure Docker image exists
   */
  async ensureImage() {
    try {
      await this.docker.getImage(this.config.image).inspect();
    } catch (error) {
      console.log(`Pulling image ${this.config.image}...`);
      await new Promise((resolve, reject) => {
        this.docker.pull(this.config.image, (err, stream) => {
          if (err) return reject(err);
          this.docker.modem.followProgress(stream, (err) => {
            if (err) return reject(err);
            resolve();
          });
        });
      });
    }
  }

  /**
   * Run code in Docker container
   */
  async runContainer(workDir, env, executionId) {
    const startTime = Date.now();

    // Prepare environment variables
    const containerEnv = Object.entries(env).map(([key, value]) => `${key}=${value}`);

    // Create container
    const container = await this.docker.createContainer({
      Image: this.config.image,
      Cmd: ['node', '/code/code.js'],
      name: `code-executor-${executionId}`,

      Env: containerEnv,

      HostConfig: {
        // Network isolation
        NetworkMode: this.config.networkMode,

        // Resource limits
        Memory: this.config.memoryLimit,
        NanoCpus: this.config.cpuLimit,

        // Security
        ReadonlyRootfs: this.config.readonlyRootfs,
        AutoRemove: this.config.autoRemove,

        // Mount code directory (read-only)
        Binds: [`${workDir}:/code:ro`],

        // Drop all capabilities for security
        CapDrop: ['ALL']
      },

      // Add tmpfs for /tmp since rootfs is read-only
      HostConfig: {
        ...this.config.readonlyRootfs && {
          Tmpfs: {
            '/tmp': 'rw,noexec,nosuid,size=100m'
          }
        }
      }
    });

    try {
      // Start container
      await container.start();

      // Set timeout to kill container if it runs too long
      const timeoutHandle = setTimeout(async () => {
        try {
          await container.kill();
        } catch (e) {
          // Container might have already finished
        }
      }, this.config.timeout);

      // Wait for container to finish
      const statusCode = await container.wait();

      clearTimeout(timeoutHandle);

      // Get stdout and stderr
      const logs = await container.logs({
        stdout: true,
        stderr: true,
        follow: false
      });

      // Parse logs (Docker combines stdout/stderr with headers)
      const { stdout, stderr } = this.parseLogs(logs);

      const executionTime = Date.now() - startTime;

      return {
        success: statusCode.StatusCode === 0,
        output: stdout,
        error: stderr,
        exitCode: statusCode.StatusCode,
        executionTime,
        containerInfo: {
          id: container.id,
          networkMode: this.config.networkMode
        }
      };

    } catch (error) {
      // Try to remove container on error
      try {
        await container.remove({ force: true });
      } catch (e) {
        // Ignore cleanup errors
      }

      throw error;
    }
  }

  /**
   * Parse Docker logs (they have special headers)
   */
  parseLogs(buffer) {
    let stdout = '';
    let stderr = '';
    let offset = 0;

    while (offset < buffer.length) {
      // Docker log format: [stream_type(1)][padding(3)][size(4)][payload(size)]
      const streamType = buffer[offset];
      const size = buffer.readUInt32BE(offset + 4);
      const payload = buffer.slice(offset + 8, offset + 8 + size).toString('utf8');

      if (streamType === 1) {
        stdout += payload;
      } else if (streamType === 2) {
        stderr += payload;
      }

      offset += 8 + size;
    }

    return { stdout, stderr };
  }

  /**
   * Create custom network with firewall rules
   */
  async createCustomNetwork(name, options = {}) {
    const { blockedDomains = [] } = options;

    try {
      // Create Docker network
      const network = await this.docker.createNetwork({
        Name: name,
        Driver: 'bridge',
        Options: {
          'com.docker.network.bridge.name': name
        }
      });

      // Set up iptables rules to block domains
      // Note: This requires host to have iptables and appropriate permissions
      const { execSync } = require('child_process');

      for (const domain of blockedDomains) {
        try {
          // Resolve domain to IP
          const ip = execSync(`dig +short ${domain} | head -1`).toString().trim();

          if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
            // Block traffic to this IP on the custom bridge
            execSync(`iptables -I DOCKER-USER -d ${ip} -i ${name} -j REJECT`);
            console.log(`[FIREWALL] Blocked ${domain} (${ip}) on network ${name}`);
          }
        } catch (e) {
          console.warn(`[FIREWALL] Could not block ${domain}:`, e.message);
        }
      }

      return network;

    } catch (error) {
      if (error.statusCode === 409) {
        // Network already exists
        return this.docker.getNetwork(name);
      }
      throw error;
    }
  }

  /**
   * Remove custom network
   */
  async removeCustomNetwork(name) {
    try {
      const network = this.docker.getNetwork(name);
      await network.remove();

      // Clean up iptables rules
      const { execSync } = require('child_process');
      execSync(`iptables -D DOCKER-USER -i ${name} -j REJECT`, { stdio: 'ignore' });

    } catch (error) {
      // Network might not exist, ignore
    }
  }
}

// ============================================================================
// Drop-in Replacement for spawn
// ============================================================================

/**
 * Adapter to make DockerCodeExecutor work exactly like spawn
 */
class DockerSpawnAdapter {
  constructor(dockerExecutor) {
    this.executor = dockerExecutor;
  }

  /**
   * Execute code file (compatible with spawn API)
   *
   * @param {string} command - Should be 'node'
   * @param {string[]} args - Should be [filepath]
   * @param {object} options - Options with env property
   * @returns {Promise} - Promise that resolves with result
   */
  async spawn(command, args, options = {}) {
    if (command !== 'node') {
      throw new Error('DockerSpawnAdapter only supports node command');
    }

    const filepath = args[0];
    const code = fs.readFileSync(filepath, 'utf8');
    const env = options.env || {};

    return this.executor.executeCode(code, env);
  }
}

// ============================================================================
// Usage Examples
// ============================================================================

async function example1_basic() {
  console.log('=== Example 1: Basic Execution (No Network) ===\n');

  const executor = new DockerCodeExecutor({
    networkMode: 'none'  // Complete network isolation
  });

  const code = `
    console.log('Hello from Docker!');
    console.log('Node version:', process.version);

    // This will fail - no network access
    try {
      const https = require('https');
      https.get('https://api.stripe.com', () => {});
    } catch (err) {
      console.error('Network error (expected):', err.message);
    }
  `;

  const result = await executor.executeCode(code);
  console.log('Result:', result);
  console.log('');
}

async function example2_withNetwork() {
  console.log('=== Example 2: Controlled Network Access ===\n');

  const executor = new DockerCodeExecutor({
    networkMode: 'bridge',  // Allow network
    blockedDomains: []
  });

  const code = `
    const https = require('https');

    https.get('https://api.github.com/users/github', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const user = JSON.parse(data);
        console.log('GitHub user:', user.login);
      });
    }).on('error', err => {
      console.error('Error:', err.message);
    });
  `;

  const result = await executor.executeCode(code);
  console.log('Result:', result);
  console.log('');
}

async function example3_customNetwork() {
  console.log('=== Example 3: Custom Network with Firewall ===\n');

  const executor = new DockerCodeExecutor();

  // Create custom network that blocks Stripe
  const networkName = 'code-exec-net';
  await executor.createCustomNetwork(networkName, {
    blockedDomains: ['api.stripe.com']
  });

  // Use custom network
  executor.config.networkMode = networkName;

  const code = `
    const https = require('https');

    // This will be blocked by firewall
    https.get('https://api.stripe.com/v1/customers', (res) => {
      console.log('Stripe response:', res.statusCode);
    }).on('error', err => {
      console.error('Stripe blocked:', err.message);
    });

    // This will work
    https.get('https://api.github.com/users/github', (res) => {
      console.log('GitHub response:', res.statusCode);
    }).on('error', err => {
      console.error('GitHub error:', err.message);
    });
  `;

  const result = await executor.executeCode(code);
  console.log('Result:', result);

  // Cleanup
  await executor.removeCustomNetwork(networkName);
  console.log('');
}

async function example4_spawnReplacement() {
  console.log('=== Example 4: Drop-in Replacement for spawn ===\n');

  const executor = new DockerCodeExecutor({ networkMode: 'none' });
  const adapter = new DockerSpawnAdapter(executor);

  // Write test code to file
  const testFile = path.join(__dirname, '../temp/test.js');
  fs.writeFileSync(testFile, `
    console.log('Executed via spawn adapter!');
    console.log('Args:', process.argv.slice(2));
  `);

  // Use exactly like spawn (but async)
  const result = await adapter.spawn('node', [testFile], {
    env: {
      PATH: process.env.PATH,
      TEST_VAR: 'hello'
    }
  });

  console.log('Result:', result);
  fs.unlinkSync(testFile);
  console.log('');
}

// ============================================================================
// Run Examples
// ============================================================================

async function runExamples() {
  try {
    await example1_basic();
    await example2_withNetwork();
    // await example3_customNetwork(); // Requires iptables permissions
    await example4_spawnReplacement();

    console.log('✅ All examples completed!');

  } catch (error) {
    console.error('❌ Error running examples:', error);
  }
}

// Export
module.exports = {
  DockerCodeExecutor,
  DockerSpawnAdapter
};

if (require.main === module) {
  runExamples();
}
