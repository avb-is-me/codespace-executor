import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface DockerHealthStatus {
  healthy: boolean;
  issue?: 'containerd-timeout' | 'daemon-not-running' | 'other';
  errorMessage?: string;
}

/**
 * Check if Docker daemon is responsive
 */
export async function checkDockerHealth(): Promise<DockerHealthStatus> {
  try {
    await execAsync('docker info', { timeout: 5000 });
    return { healthy: true };
  } catch (error: any) {
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

    // Check if Docker daemon is not running
    if (errorMsg.includes('Cannot connect to the Docker daemon')) {
      return {
        healthy: false,
        issue: 'daemon-not-running',
        errorMessage: 'Docker daemon is not running',
      };
    }

    return {
      healthy: false,
      issue: 'other',
      errorMessage: errorMsg,
    };
  }
}

/**
 * Restart Docker daemon and containerd
 * Resolves containerd socket timeout issues
 */
export async function restartDocker(): Promise<boolean> {
  console.log('[DockerHealth] Restarting Docker daemon...');

  try {
    // Kill dockerd and containerd processes
    await execAsync('sudo killall dockerd containerd', { timeout: 5000 }).catch(() => {
      // Ignore errors if processes don't exist
    });

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
  } catch (error: any) {
    console.error(`[DockerHealth] Failed to restart Docker: ${error.message}`);
    return false;
  }
}

/**
 * Detect and automatically recover from Docker issues
 * Returns true if Docker is healthy or was successfully recovered
 */
export async function ensureDockerHealthy(options: {
  autoRestart?: boolean;
  maxRetries?: number;
} = {}): Promise<boolean> {
  const { autoRestart = true, maxRetries = 2 } = options;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const health = await checkDockerHealth();

    if (health.healthy) {
      return true;
    }

    console.log(`[DockerHealth] Docker is unhealthy (attempt ${attempt}/${maxRetries}): ${health.errorMessage}`);

    if (!autoRestart) {
      return false;
    }

    // Only attempt restart for containerd timeout issues
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
      // For other issues, don't attempt automatic restart
      console.error(`[DockerHealth] Cannot auto-recover from issue type: ${health.issue}`);
      return false;
    }
  }

  console.error('[DockerHealth] Failed to recover Docker health after all retries');
  return false;
}

/**
 * Run a Docker command with automatic health check and recovery
 * Useful for wrapping critical Docker operations
 */
export async function runDockerCommand<T>(
  command: () => Promise<T>,
  options: {
    retryOnContainerdError?: boolean;
    maxRetries?: number;
  } = {}
): Promise<T> {
  const { retryOnContainerdError = true, maxRetries = 2 } = options;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await command();
    } catch (error: any) {
      const errorMsg = error.message || '';

      // Check if this is a containerd timeout error
      const isContainerdError =
        errorMsg.includes('dial unix:///var/run/docker/containerd/containerd.sock: timeout') ||
        errorMsg.includes('connection error: desc = "transport: Error while dialing') ||
        errorMsg.includes('error creating temporary lease: Unavailable');

      if (isContainerdError && retryOnContainerdError && attempt < maxRetries) {
        console.log(`[DockerHealth] Detected containerd error, attempting recovery (attempt ${attempt}/${maxRetries})...`);

        const recovered = await ensureDockerHealthy({ autoRestart: true, maxRetries: 1 });

        if (recovered) {
          console.log('[DockerHealth] Recovery successful, retrying command...');
          continue;
        }
      }

      // If we can't recover or it's not a containerd error, throw
      throw error;
    }
  }

  throw new Error('Unexpected: max retries reached without success or error');
}
