#!/usr/bin/env ts-node
/**
 * Example: Programmatic Docker Health Check and Recovery
 *
 * This script demonstrates how to detect and automatically fix
 * Docker containerd timeout issues programmatically.
 */

import { checkDockerHealth, ensureDockerHealthy, runDockerCommand } from '../src/utils/docker-health';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function main() {
  console.log('=== Docker Health Check Example ===\n');

  // Example 1: Simple health check
  console.log('1. Checking Docker health...');
  const health = await checkDockerHealth();

  if (health.healthy) {
    console.log('   ✓ Docker is healthy\n');
  } else {
    console.log(`   ✗ Docker is unhealthy: ${health.issue}`);
    console.log(`   Error: ${health.errorMessage}\n`);
  }

  // Example 2: Ensure Docker is healthy (with auto-recovery)
  console.log('2. Ensuring Docker is healthy (with auto-recovery)...');
  const isHealthy = await ensureDockerHealthy({
    autoRestart: true,
    maxRetries: 2,
  });

  if (isHealthy) {
    console.log('   ✓ Docker is healthy and ready\n');
  } else {
    console.log('   ✗ Failed to restore Docker health\n');
    process.exit(1);
  }

  // Example 3: Run a Docker command with automatic recovery
  console.log('3. Running Docker command with automatic recovery...');
  try {
    await runDockerCommand(
      async () => {
        const { stdout } = await execAsync('docker ps');
        console.log('   Current containers:');
        console.log(stdout || '   (no containers running)');
      },
      {
        retryOnContainerdError: true,
        maxRetries: 2,
      }
    );
    console.log('   ✓ Command executed successfully\n');
  } catch (error: any) {
    console.error(`   ✗ Failed to run command: ${error.message}\n`);
  }

  // Example 4: Try to start a container with auto-recovery
  console.log('4. Starting XFCE desktop container (with auto-recovery)...');
  try {
    await runDockerCommand(
      async () => {
        // Clean up any existing container
        await execAsync('docker stop xfce-desktop 2>/dev/null || true');
        await execAsync('docker rm xfce-desktop 2>/dev/null || true');

        // Start the container
        const { stdout } = await execAsync(`
          docker run -d \
            --name xfce-desktop \
            --security-opt seccomp=unconfined \
            --shm-size 2gb \
            -e PUID=1000 \
            -e PGID=1000 \
            -e TZ=America/New_York \
            -e SUBFOLDER=/ \
            -e TITLE="XFCE Desktop" \
            -p 3001:3000 \
            -p 3002:3001 \
            linuxserver/webtop:ubuntu-xfce
        `);

        console.log(`   Container started: ${stdout.trim().substring(0, 12)}`);
      },
      {
        retryOnContainerdError: true,
        maxRetries: 2,
      }
    );
    console.log('   ✓ XFCE desktop started successfully');
    console.log('   Access at: http://localhost:3001\n');
  } catch (error: any) {
    console.error(`   ✗ Failed to start container: ${error.message}\n`);
  }

  console.log('=== Example completed ===');
}

// Run the example
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
