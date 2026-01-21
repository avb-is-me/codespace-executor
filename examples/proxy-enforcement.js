/**
 * Enforcing HTTP Proxy - Prevent Bypass by Detecting Unset
 *
 * Multiple approaches to make spawn fail if HTTP_PROXY is unset
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// ============================================================================
// APPROACH 1: Watchdog Process (BEST)
// ============================================================================

/**
 * Use Object.defineProperty to make proxy vars immutable and monitored
 */
class WatchdogProxyEnforcer {
  generateEnforcedCode(userCode, proxyPort = 8888) {
    return `
// PROXY ENFORCEMENT - This runs BEFORE user code
(function() {
  'use strict';

  const PROXY_URL = 'http://localhost:${proxyPort}';
  let proxyTamperedWith = false;

  // Make HTTP_PROXY and HTTPS_PROXY immutable
  Object.defineProperty(process.env, 'HTTP_PROXY', {
    value: PROXY_URL,
    writable: false,
    configurable: false,
    enumerable: true
  });

  Object.defineProperty(process.env, 'HTTPS_PROXY', {
    value: PROXY_URL,
    writable: false,
    configurable: false,
    enumerable: true
  });

  // Monitor deletion attempts using Proxy
  const originalEnv = { ...process.env };

  const envProxy = new Proxy(process.env, {
    deleteProperty(target, prop) {
      if (prop === 'HTTP_PROXY' || prop === 'HTTPS_PROXY') {
        console.error('[SECURITY] Attempt to delete ' + prop + ' detected!');
        console.error('[SECURITY] Proxy tampering is not allowed. Terminating execution.');
        process.exit(1);
      }
      return Reflect.deleteProperty(target, prop);
    },

    set(target, prop, value) {
      if (prop === 'HTTP_PROXY' || prop === 'HTTPS_PROXY') {
        if (value !== PROXY_URL) {
          console.error('[SECURITY] Attempt to modify ' + prop + ' detected!');
          console.error('[SECURITY] Proxy tampering is not allowed. Terminating execution.');
          process.exit(1);
        }
      }
      return Reflect.set(target, prop, value);
    }
  });

  // Replace process.env with our monitored proxy
  // Note: This is tricky because process.env is special
  // Better approach: monitor periodically

  // Periodic check
  const checkInterval = setInterval(() => {
    if (!process.env.HTTP_PROXY || !process.env.HTTPS_PROXY) {
      console.error('[SECURITY] Proxy environment variables were removed!');
      console.error('[SECURITY] Terminating execution.');
      clearInterval(checkInterval);
      process.exit(1);
    }

    if (process.env.HTTP_PROXY !== PROXY_URL || process.env.HTTPS_PROXY !== PROXY_URL) {
      console.error('[SECURITY] Proxy environment variables were modified!');
      console.error('[SECURITY] Expected:', PROXY_URL);
      console.error('[SECURITY] Found HTTP_PROXY:', process.env.HTTP_PROXY);
      console.error('[SECURITY] Found HTTPS_PROXY:', process.env.HTTPS_PROXY);
      clearInterval(checkInterval);
      process.exit(1);
    }
  }, 100); // Check every 100ms

  // Clear interval when process exits normally
  process.on('exit', () => clearInterval(checkInterval));

  console.log('[SECURITY] Proxy enforcement enabled');
  console.log('[SECURITY] HTTP_PROXY:', process.env.HTTP_PROXY);
  console.log('[SECURITY] HTTPS_PROXY:', process.env.HTTPS_PROXY);
})();

// USER CODE STARTS HERE
(async () => {
${userCode}
})().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
`.trim();
  }

  async executeCode(userCode, proxyPort = 8888) {
    const enforcedCode = this.generateEnforcedCode(userCode, proxyPort);
    const tempFile = path.join(__dirname, '../temp', `enforced_${Date.now()}.js`);

    fs.writeFileSync(tempFile, enforcedCode);

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      const child = spawn('node', [tempFile], {
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          HTTP_PROXY: `http://localhost:${proxyPort}`,
          HTTPS_PROXY: `http://localhost:${proxyPort}`,
          NO_PROXY: 'localhost,127.0.0.1'
        }
      });

      child.stdout.on('data', data => stdout += data);
      child.stderr.on('data', data => stderr += data);

      child.on('close', (code) => {
        fs.unlinkSync(tempFile);

        resolve({
          success: code === 0,
          output: stdout,
          error: stderr,
          exitCode: code,
          tampered: code === 1 && stderr.includes('[SECURITY]')
        });
      });

      child.on('error', err => reject(err));
    });
  }
}

// ============================================================================
// APPROACH 2: Native Module Protection (STRONGER)
// ============================================================================

/**
 * Freeze http/https modules AND monitor proxy vars
 */
class NativeModuleEnforcer {
  generateEnforcedCode(userCode, proxyPort = 8888) {
    return `
// PROXY + MODULE ENFORCEMENT
(function() {
  'use strict';

  const PROXY_URL = 'http://localhost:${proxyPort}';
  const Module = require('module');
  const originalRequire = Module.prototype.require;

  // Store originals
  const originalHttp = originalRequire.call(module, 'http');
  const originalHttps = originalRequire.call(module, 'https');

  // Create wrapper that ALWAYS checks proxy vars first
  function createEnforcedModule(original, protocol) {
    const enforced = { ...original };

    const wrapRequest = (fn) => {
      return function(...args) {
        // Check proxy vars BEFORE every request
        if (!process.env.HTTP_PROXY || !process.env.HTTPS_PROXY) {
          const err = new Error('Proxy enforcement failed: HTTP_PROXY or HTTPS_PROXY was unset');
          err.code = 'PROXY_ENFORCEMENT_FAILED';
          console.error('[SECURITY]', err.message);
          process.exit(1);
        }

        if (process.env.HTTP_PROXY !== PROXY_URL || process.env.HTTPS_PROXY !== PROXY_URL) {
          const err = new Error('Proxy enforcement failed: Proxy URL was modified');
          err.code = 'PROXY_ENFORCEMENT_FAILED';
          console.error('[SECURITY]', err.message);
          process.exit(1);
        }

        // Proxy vars are intact, proceed with request
        return fn.apply(this, args);
      };
    };

    enforced.request = wrapRequest(original.request);
    enforced.get = wrapRequest(original.get);

    return enforced;
  }

  const enforcedHttp = createEnforcedModule(originalHttp, 'http');
  const enforcedHttps = createEnforcedModule(originalHttps, 'https');

  // Override require
  Module.prototype.require = function(id) {
    if (id === 'http') return enforcedHttp;
    if (id === 'https') return enforcedHttps;
    return originalRequire.apply(this, arguments);
  };

  console.log('[SECURITY] Module enforcement enabled with proxy checking');
})();

// USER CODE
(async () => {
${userCode}
})().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
`.trim();
  }

  async executeCode(userCode, proxyPort = 8888) {
    const enforcedCode = this.generateEnforcedCode(userCode, proxyPort);
    const tempFile = path.join(__dirname, '../temp', `native_${Date.now()}.js`);

    fs.writeFileSync(tempFile, enforcedCode);

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      const child = spawn('node', [tempFile], {
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          HTTP_PROXY: `http://localhost:${proxyPort}`,
          HTTPS_PROXY: `http://localhost:${proxyPort}`
        }
      });

      child.stdout.on('data', data => stdout += data);
      child.stderr.on('data', data => stderr += data);

      child.on('close', (code) => {
        fs.unlinkSync(tempFile);

        resolve({
          success: code === 0,
          output: stdout,
          error: stderr,
          exitCode: code
        });
      });
    });
  }
}

// ============================================================================
// APPROACH 3: External Watchdog (NUCLEAR OPTION)
// ============================================================================

/**
 * Parent process monitors child and kills it if proxy vars are tampered
 */
class ExternalWatchdog {
  async executeCode(userCode, proxyPort = 8888) {
    const tempFile = path.join(__dirname, '../temp', `watched_${Date.now()}.js`);
    fs.writeFileSync(tempFile, userCode);

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let killed = false;

      const child = spawn('node', [tempFile], {
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          HTTP_PROXY: `http://localhost:${proxyPort}`,
          HTTPS_PROXY: `http://localhost:${proxyPort}`
        }
      });

      // Monitor process environment via /proc/<pid>/environ (Linux only)
      // This reads the actual environment of the child process
      const watchdog = setInterval(() => {
        try {
          if (killed) {
            clearInterval(watchdog);
            return;
          }

          // Read child process environment
          const environPath = \`/proc/\${child.pid}/environ\`;

          if (fs.existsSync(environPath)) {
            const environ = fs.readFileSync(environPath, 'utf8');
            const envVars = environ.split('\\0').reduce((acc, pair) => {
              const [key, value] = pair.split('=');
              if (key) acc[key] = value;
              return acc;
            }, {});

            // Check if proxy vars are intact
            if (!envVars.HTTP_PROXY || !envVars.HTTPS_PROXY) {
              console.error('[WATCHDOG] Proxy variables were removed from child process!');
              killed = true;
              child.kill('SIGTERM');
              clearInterval(watchdog);
            } else if (
              envVars.HTTP_PROXY !== \`http://localhost:\${proxyPort}\` ||
              envVars.HTTPS_PROXY !== \`http://localhost:\${proxyPort}\`
            ) {
              console.error('[WATCHDOG] Proxy variables were modified in child process!');
              killed = true;
              child.kill('SIGTERM');
              clearInterval(watchdog);
            }
          }
        } catch (err) {
          // Process might have exited, ignore
        }
      }, 50); // Check every 50ms

      child.stdout.on('data', data => stdout += data);
      child.stderr.on('data', data => stderr += data);

      child.on('close', (code) => {
        clearInterval(watchdog);
        fs.unlinkSync(tempFile);

        resolve({
          success: code === 0 && !killed,
          output: stdout,
          error: stderr,
          exitCode: code,
          killedByWatchdog: killed
        });
      });
    });
  }
}

// ============================================================================
// DEMO: Test All Approaches
// ============================================================================

async function testApproach(name, executor) {
  console.log(\`\n=== Testing: \${name} ===\\n\`);

  // Test 1: Normal code (should work)
  console.log('Test 1: Normal code');
  const result1 = await executor.executeCode(\`
    console.log('Hello from normal code!');
    console.log('HTTP_PROXY:', process.env.HTTP_PROXY);
  \`);
  console.log('Result:', result1.success ? '✅ PASSED' : '❌ FAILED');
  console.log('Output:', result1.output.trim());

  // Test 2: Try to delete HTTP_PROXY (should fail)
  console.log('\\nTest 2: Delete HTTP_PROXY');
  const result2 = await executor.executeCode(\`
    console.log('Before delete:', process.env.HTTP_PROXY);
    delete process.env.HTTP_PROXY;
    console.log('After delete:', process.env.HTTP_PROXY);
    console.log('If you see this, bypass succeeded');
  \`);
  console.log('Result:', result2.success ? '❌ BYPASS SUCCEEDED' : '✅ BLOCKED');
  if (result2.error) console.log('Error:', result2.error.substring(0, 200));

  // Test 3: Try to modify HTTP_PROXY (should fail)
  console.log('\\nTest 3: Modify HTTP_PROXY');
  const result3 = await executor.executeCode(\`
    console.log('Before modify:', process.env.HTTP_PROXY);
    process.env.HTTP_PROXY = 'http://evil.com:9999';
    console.log('After modify:', process.env.HTTP_PROXY);
    console.log('If you see this, bypass succeeded');
  \`);
  console.log('Result:', result3.success ? '❌ BYPASS SUCCEEDED' : '✅ BLOCKED');
  if (result3.error) console.log('Error:', result3.error.substring(0, 200));

  // Test 4: Try to make network request after unsetting (should fail)
  console.log('\\nTest 4: Network request after unset');
  const result4 = await executor.executeCode(\`
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;

    const https = require('https');
    https.get('https://api.stripe.com', (res) => {
      console.log('Bypass succeeded! Got response:', res.statusCode);
    }).on('error', (err) => {
      console.log('Request failed:', err.message);
    });
  \`);
  console.log('Result:', result4.success ? '❌ BYPASS SUCCEEDED' : '✅ BLOCKED');
  if (result4.error) console.log('Error:', result4.error.substring(0, 200));
}

async function runTests() {
  console.log('========================================');
  console.log('Proxy Enforcement Bypass Tests');
  console.log('========================================');

  // Test Approach 1: Watchdog
  await testApproach('Watchdog Enforcer', new WatchdogProxyEnforcer());

  // Test Approach 2: Native Module
  await testApproach('Native Module Enforcer', new NativeModuleEnforcer());

  // Test Approach 3: External Watchdog (Linux only)
  if (process.platform === 'linux') {
    await testApproach('External Watchdog', new ExternalWatchdog());
  } else {
    console.log('\\n=== Skipping External Watchdog (Linux only) ===');
  }

  console.log('\\n========================================');
  console.log('All tests completed!');
  console.log('========================================');
}

module.exports = {
  WatchdogProxyEnforcer,
  NativeModuleEnforcer,
  ExternalWatchdog
};

if (require.main === module) {
  runTests().catch(console.error);
}
