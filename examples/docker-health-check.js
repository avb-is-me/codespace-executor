#!/usr/bin/env node
/**
 * Example: Programmatic Docker Health Check and Recovery (JavaScript)
 *
 * This script demonstrates how to detect and automatically fix
 * Docker containerd timeout issues programmatically.
 *
 * Run with: node examples/docker-health-check.js
 */

const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// Check if Docker daemon is responsive
async function checkDockerHealth() {
  try {
    await execAsync('docker info', { timeout: 5000 });
    return { healthy: true };
  } catch (error) {
    const errorMsg = error.message || '';

    // Check for containerd-specific timeout errors
    if (
      errorMsg.includes('dial unix:///var/run/docker/containerd/containerd.sock: timeout') ||
      errorMsg.includes('connection error: desc = "transport: Error while dialing') ||
      errorMsg.includes('error creating temporary lease: Unavailable')
    ) {
      return {
        healthy: false,
        issue: 'containerd-timeout',
        errorMessage: 'Containerd is not responding',
      };
    }

    return {
      healthy: false,
      issue: 'other',
      errorMessage: errorMsg,
    };
  }
}

// Restart Docker daemon and containerd
async function restartDocker() {
  console.log('[DockerHealth] Restarting Docker daemon...');

  try {
    // Kill dockerd and containerd processes
    await execAsync('sudo killall dockerd containerd', { timeout: 5000 }).catch(() => {});

    // Wait for processes to terminate
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Start dockerd in the background
    await execAsync('sudo nohup dockerd > /tmp/docker-restart.log 2>&1 &', { timeout: 5000 });

    // Wait for Docker to initialize
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Verify Docker is responsive
    const health = await checkDockerHealth();
    if (health.healthy) {
      console.log('[DockerHealth] Docker daemon restarted successfully');
      return true;
    } else {
      console.error('[DockerHealth] Docker daemon failed to become healthy after restart');
      return false;
    }
  } catch (error) {
    console.error(`[DockerHealth] Failed to restart Docker: ${error.message}`);
    return false;
  }
}

// Ensure Docker is healthy (with auto-recovery)
async function ensureDockerHealthy(maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const health = await checkDockerHealth();

    if (health.healthy) {
      return true;
    }

    console.log(`[DockerHealth] Docker is unhealthy (attempt ${attempt}/${maxRetries}): ${health.errorMessage}`);

    if (health.issue === 'containerd-timeout') {
      console.log('[DockerHealth] Attempting automatic recovery...');
      const restarted = await restartDocker();

      if (restarted) {
        return true;
      }

      if (attempt < maxRetries) {
        console.log(`[DockerHealth] Retry ${attempt + 1}/${maxRetries} in 5 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    } else {
      console.error(`[DockerHealth] Cannot auto-recover from issue type: ${health.issue}`);
      return false;
    }
  }

  return false;
}

// Main function
async function main() {
  console.log('=== Docker Health Check Example ===\n');

  // Step 1: Check health
  console.log('1. Checking Docker health...');
  const health = await checkDockerHealth();

  if (health.healthy) {
    console.log('   ✓ Docker is healthy\n');
  } else {
    console.log(`   ✗ Docker is unhealthy: ${health.issue}`);
    console.log(`   Error: ${health.errorMessage}\n`);

    // Step 2: Auto-recover if needed
    console.log('2. Attempting automatic recovery...');
    const recovered = await ensureDockerHealthy(2);

    if (!recovered) {
      console.error('   ✗ Failed to restore Docker health');
      process.exit(1);
    }
    console.log('   ✓ Docker recovered successfully\n');
  }

  // Step 3: Run a test Docker command
  console.log('3. Testing Docker with "docker ps"...');
  try {
    const { stdout } = await execAsync('docker ps');
    console.log('   ✓ Docker is working');
    console.log('   Current containers:');
    console.log(stdout || '   (no containers running)');
  } catch (error) {
    console.error(`   ✗ Docker command failed: ${error.message}`);
    process.exit(1);
  }

  console.log('\n=== Example completed successfully ===');
}

// Run the example
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
