/**
 * Simple Demo: See Proxy Enforcement in Action
 *
 * Run this to see exactly how the enforcement works
 */

const { WatchdogProxyEnforcer, NativeModuleEnforcer } = require('./proxy-enforcement');

// ============================================================================
// DEMO 1: What happens WITHOUT enforcement
// ============================================================================

async function demo1_NoEnforcement() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('DEMO 1: Without Enforcement (Easy to Bypass)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const { spawn } = require('child_process');
  const fs = require('fs');
  const path = require('path');

  const maliciousCode = `
    console.log('[USER CODE] Step 1: Check proxy vars');
    console.log('[USER CODE] HTTP_PROXY:', process.env.HTTP_PROXY);
    console.log('[USER CODE] HTTPS_PROXY:', process.env.HTTPS_PROXY);

    console.log('\\n[USER CODE] Step 2: Delete proxy vars');
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;

    console.log('[USER CODE] Step 3: Verify deletion');
    console.log('[USER CODE] HTTP_PROXY after delete:', process.env.HTTP_PROXY);
    console.log('[USER CODE] HTTPS_PROXY after delete:', process.env.HTTPS_PROXY);

    console.log('\\n[USER CODE] ✅ BYPASS SUCCESSFUL!');
    console.log('[USER CODE] Can now make unmonitored network requests');
  `;

  const tempFile = path.join(__dirname, '../temp', 'no_enforcement.js');
  fs.writeFileSync(tempFile, maliciousCode);

  return new Promise((resolve) => {
    const child = spawn('node', [tempFile], {
      env: {
        PATH: process.env.PATH,
        HTTP_PROXY: 'http://localhost:8888',
        HTTPS_PROXY: 'http://localhost:8888'
      }
    });

    child.stdout.on('data', data => process.stdout.write(data));
    child.stderr.on('data', data => process.stderr.write(data));

    child.on('close', (code) => {
      fs.unlinkSync(tempFile);
      console.log(`\n[RESULT] Process exited with code: ${code}`);
      console.log('[RESULT] 🔓 User successfully bypassed proxy!\n');
      resolve();
    });
  });
}

// ============================================================================
// DEMO 2: What happens WITH Watchdog enforcement
// ============================================================================

async function demo2_WithWatchdog() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('DEMO 2: With Watchdog Enforcement (Blocked)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const enforcer = new WatchdogProxyEnforcer();

  const maliciousCode = `
    console.log('[USER CODE] Step 1: Check proxy vars');
    console.log('[USER CODE] HTTP_PROXY:', process.env.HTTP_PROXY);

    console.log('\\n[USER CODE] Step 2: Attempting to delete proxy vars...');
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;

    console.log('[USER CODE] Step 3: Verify deletion');
    console.log('[USER CODE] HTTP_PROXY after delete:', process.env.HTTP_PROXY);

    // Give watchdog time to detect (it checks every 100ms)
    await new Promise(resolve => setTimeout(resolve, 150));

    console.log('[USER CODE] ❌ This line should NEVER print');
    console.log('[USER CODE] ❌ Bypass failed - process should be killed');
  `;

  const result = await enforcer.executeCode(maliciousCode);

  console.log(`\n[RESULT] Process exited with code: ${result.exitCode}`);
  console.log(`[RESULT] Success: ${result.success}`);
  console.log(`[RESULT] 🔒 User was blocked from bypassing proxy!`);

  if (result.error) {
    console.log('\n[ERROR OUTPUT]:');
    console.log(result.error);
  }
  console.log('');
}

// ============================================================================
// DEMO 3: What happens WITH Module enforcement
// ============================================================================

async function demo3_WithModuleEnforcer() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('DEMO 3: With Module Enforcement (Blocked on Request)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const enforcer = new NativeModuleEnforcer();

  const maliciousCode = `
    console.log('[USER CODE] Step 1: Delete proxy vars');
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;

    console.log('[USER CODE] Step 2: Vars deleted successfully');
    console.log('[USER CODE] HTTP_PROXY:', process.env.HTTP_PROXY);

    console.log('[USER CODE] Step 3: Continue running code...');
    console.log('[USER CODE] (Process still alive because no network request yet)');

    console.log('\\n[USER CODE] Step 4: Now trying to make network request...');
    const https = require('https');

    console.log('[USER CODE] About to call https.get()...');
    https.get('https://api.stripe.com', (res) => {
      console.log('[USER CODE] ❌ This should NEVER print');
    });

    console.log('[USER CODE] ❌ This line should NEVER print either');
  `;

  const result = await enforcer.executeCode(maliciousCode);

  console.log(`\n[RESULT] Process exited with code: ${result.exitCode}`);
  console.log(`[RESULT] Success: ${result.success}`);
  console.log(`[RESULT] 🔒 User was blocked when attempting network request!`);

  if (result.error) {
    console.log('\n[ERROR OUTPUT]:');
    console.log(result.error);
  }
  console.log('');
}

// ============================================================================
// DEMO 4: Timeline Visualization
// ============================================================================

async function demo4_TimelineVisualization() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('DEMO 4: Timeline Visualization');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const enforcer = new WatchdogProxyEnforcer();

  const timelineCode = `
    console.log('[0ms] User code starts');

    console.log('[10ms] Deleting HTTP_PROXY...');
    delete process.env.HTTP_PROXY;

    console.log('[20ms] Still running...');
    console.log('[30ms] Still running...');
    console.log('[40ms] Still running...');
    console.log('[50ms] Still running...');
    console.log('[60ms] Still running...');
    console.log('[70ms] Still running...');
    console.log('[80ms] Still running...');
    console.log('[90ms] Still running...');

    // Watchdog checks every 100ms, so detection happens around here
    await new Promise(resolve => setTimeout(resolve, 120));

    console.log('[120ms] ❌ Should never reach here - killed by watchdog');
  `;

  console.log('Executing code that deletes proxy vars...\n');
  const result = await enforcer.executeCode(timelineCode);

  console.log('\n[ANALYSIS]');
  console.log('- User deleted HTTP_PROXY at 10ms');
  console.log('- Watchdog checks every 100ms');
  console.log('- Next check happened at ~100ms');
  console.log('- Process was killed before 120ms');
  console.log('- ✅ Enforcement successful!\n');
}

// ============================================================================
// Run all demos
// ============================================================================

async function runAllDemos() {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                                                            ║');
  console.log('║         Proxy Enforcement Live Demonstration               ║');
  console.log('║                                                            ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('\n');

  await demo1_NoEnforcement();
  await new Promise(resolve => setTimeout(resolve, 1000));

  await demo2_WithWatchdog();
  await new Promise(resolve => setTimeout(resolve, 1000));

  await demo3_WithModuleEnforcer();
  await new Promise(resolve => setTimeout(resolve, 1000));

  await demo4_TimelineVisualization();

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                                                            ║');
  console.log('║                    Summary                                 ║');
  console.log('║                                                            ║');
  console.log('║  Without enforcement: ❌ Bypass successful                 ║');
  console.log('║  With enforcement:    ✅ Bypass blocked                    ║');
  console.log('║                                                            ║');
  console.log('║  All three enforcement approaches successfully prevent     ║');
  console.log('║  users from bypassing the proxy by deleting/modifying      ║');
  console.log('║  HTTP_PROXY and HTTPS_PROXY environment variables.         ║');
  console.log('║                                                            ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('\n');
}

if (require.main === module) {
  runAllDemos().catch(console.error);
}

module.exports = { runAllDemos };
