import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface XfceDesktopConfig {
  containerName?: string;
  webPort?: number;
  vncPort?: number;
  image?: string;
  timezone?: string;
  shmSize?: string;
  enableChrome?: boolean;
}

export interface XfceDesktopStatus {
  running: boolean;
  containerId?: string;
  webPort?: number;
  vncPort?: number;
  error?: string;
}

const DEFAULT_CONFIG: Required<XfceDesktopConfig> = {
  containerName: 'xfce-desktop',
  webPort: 3001,
  vncPort: 3002,
  image: 'linuxserver/webtop:ubuntu-xfce',
  timezone: 'America/New_York',
  shmSize: '2gb',
  enableChrome: false,
};

export class XfceDesktopService {
  private config: Required<XfceDesktopConfig>;
  private chromeInstallProcess: ChildProcess | null = null;

  constructor(config: XfceDesktopConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if Docker is available (binary exists)
   */
  async isDockerAvailable(): Promise<boolean> {
    try {
      await execAsync('docker --version');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if Docker daemon is ready and responsive
   */
  async isDockerReady(): Promise<boolean> {
    try {
      await execAsync('docker info', { timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Detect if Docker is experiencing containerd communication issues
   * Returns true if containerd timeout errors are detected
   */
  async detectContainerdIssue(): Promise<boolean> {
    try {
      await execAsync('docker ps 2>&1', { timeout: 5000 });
      return false; // Command succeeded
    } catch (error: any) {
      const errorMsg = error.message || '';
      // Check for containerd-specific timeout errors
      return (
        errorMsg.includes('dial unix:///var/run/docker/containerd/containerd.sock: timeout') ||
        errorMsg.includes('connection error: desc = "transport: Error while dialing') ||
        errorMsg.includes('error creating temporary lease: Unavailable')
      );
    }
  }

  /**
   * Restart Docker daemon and containerd
   * This resolves the containerd socket timeout issue
   */
  async restartDocker(): Promise<boolean> {
    console.log('[XFCE Desktop] Restarting Docker daemon to fix containerd issue...');

    try {
      // Kill dockerd and containerd processes
      await execAsync('sudo killall dockerd containerd', { timeout: 5000 }).catch(() => {
        // Ignore errors if processes don't exist
      });

      // Wait for processes to terminate
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Start dockerd in the background
      // Using nohup to ensure it stays running even if the parent process exits
      await execAsync('sudo nohup dockerd > /tmp/docker-restart.log 2>&1 &', { timeout: 5000 });

      // Wait for Docker to initialize
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Verify Docker is responsive
      const isReady = await this.isDockerReady();
      if (isReady) {
        console.log('[XFCE Desktop] Docker daemon restarted successfully');
        return true;
      } else {
        console.error('[XFCE Desktop] Docker daemon failed to become ready after restart');
        return false;
      }
    } catch (error: any) {
      console.error(`[XFCE Desktop] Failed to restart Docker: ${error.message}`);
      return false;
    }
  }

  /**
   * Detect and recover from Docker/containerd issues
   * Returns true if recovery was successful or not needed
   */
  async detectAndRecoverDockerIssues(): Promise<boolean> {
    const hasContainerdIssue = await this.detectContainerdIssue();

    if (hasContainerdIssue) {
      console.log('[XFCE Desktop] Detected containerd communication issue, attempting recovery...');
      return await this.restartDocker();
    }

    return true; // No issues detected
  }

  /**
   * Check if containerd socket exists (indicates Docker is fully initialized)
   */
  async isContainerdSocketReady(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('sudo ls /var/run/docker/containerd/containerd.sock 2>/dev/null || echo "missing"');
      return stdout.trim() !== 'missing';
    } catch {
      return false;
    }
  }

  /**
   * Wait for Docker to be fully ready (daemon running and responsive)
   * This handles the case where Docker-in-Docker is still initializing
   */
  async waitForDockerReady(maxWaitSeconds: number = 120): Promise<boolean> {
    console.log('[XFCE Desktop] Waiting for Docker daemon to be ready...');

    for (let i = 0; i < maxWaitSeconds; i++) {
      // Check both docker info and containerd socket
      const dockerReady = await this.isDockerReady();
      const containerdReady = await this.isContainerdSocketReady();

      if (dockerReady && containerdReady) {
        console.log(`[XFCE Desktop] Docker daemon and containerd fully ready (after ${i + 1}s)`);
        return true;
      }

      // Log progress every 10 seconds with detailed status
      if ((i + 1) % 10 === 0) {
        console.log(`[XFCE Desktop] Still waiting for Docker... (${i + 1}/${maxWaitSeconds}s) - docker: ${dockerReady ? 'ready' : 'waiting'}, containerd: ${containerdReady ? 'ready' : 'waiting'}`);
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.error(`[XFCE Desktop] Docker daemon not ready after ${maxWaitSeconds} seconds`);
    return false;
  }

  /**
   * Check if the XFCE container is running
   */
  async isRunning(): Promise<boolean> {
    try {
      const { stdout } = await execAsync(
        `docker ps --filter "name=${this.config.containerName}" --format "{{.Names}}"`
      );
      return stdout.trim() === this.config.containerName;
    } catch {
      return false;
    }
  }

  /**
   * Get the status of the XFCE desktop service
   */
  async getStatus(): Promise<XfceDesktopStatus> {
    try {
      const running = await this.isRunning();

      if (!running) {
        return { running: false };
      }

      const { stdout } = await execAsync(
        `docker inspect ${this.config.containerName} --format "{{.Id}}"`
      );

      return {
        running: true,
        containerId: stdout.trim().substring(0, 12),
        webPort: this.config.webPort,
        vncPort: this.config.vncPort,
      };
    } catch (error: any) {
      return {
        running: false,
        error: error.message,
      };
    }
  }

  /**
   * Verify Docker is fully operational by running a simple test
   */
  async verifyDockerOperational(): Promise<boolean> {
    try {
      // Try to list images - this requires full Docker + containerd stack to be working
      await execAsync('docker images', { timeout: 5000 });
      return true;
    } catch (error: any) {
      console.log(`[XFCE Desktop] Docker not fully operational yet: ${error.message}`);
      return false;
    }
  }

  /**
   * Pull the XFCE desktop image if not present
   */
  async pullImage(): Promise<void> {
    try {
      const { stdout } = await execAsync(`docker images -q ${this.config.image}`);

      if (!stdout.trim()) {
        console.log(`[XFCE Desktop] Pulling image ${this.config.image}...`);
        await execAsync(`docker pull ${this.config.image}`, {
          maxBuffer: 50 * 1024 * 1024, // 50MB buffer for pull output
        });
        console.log(`[XFCE Desktop] Image pulled successfully`);
      }
    } catch (error: any) {
      throw new Error(`Failed to pull image: ${error.message}`);
    }
  }

  /**
   * Stop and remove the existing container
   */
  async cleanup(): Promise<void> {
    try {
      // Stop container if running
      await execAsync(`docker stop ${this.config.containerName} 2>/dev/null || true`);
      // Remove container
      await execAsync(`docker rm ${this.config.containerName} 2>/dev/null || true`);
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Start the XFCE desktop container with retry logic
   */
  async start(maxRetries: number = 3): Promise<XfceDesktopStatus> {
    // Check if Docker binary is available
    const dockerAvailable = await this.isDockerAvailable();
    if (!dockerAvailable) {
      console.error('[XFCE Desktop] Docker is not available');
      return {
        running: false,
        error: 'Docker is not available. Enable Docker-in-Docker in devcontainer.json',
      };
    }

    // Wait for Docker daemon to be ready (handles boot timing issues)
    const dockerReady = await this.waitForDockerReady(120);
    if (!dockerReady) {
      return {
        running: false,
        error: 'Docker daemon not ready after 120 seconds',
      };
    }

    // Detect and recover from any Docker/containerd issues
    const dockerHealthy = await this.detectAndRecoverDockerIssues();
    if (!dockerHealthy) {
      return {
        running: false,
        error: 'Docker daemon is not healthy and recovery failed',
      };
    }

    // Check if already running
    if (await this.isRunning()) {
      console.log('[XFCE Desktop] Container already running');
      return this.getStatus();
    }

    console.log('[XFCE Desktop] Starting XFCE desktop...');

    // Retry logic for starting the container
    let lastError: string = '';
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[XFCE Desktop] Start attempt ${attempt}/${maxRetries}`);

        // Verify Docker is fully operational before attempting to start container
        if (!await this.verifyDockerOperational()) {
          throw new Error('Docker is not fully operational yet');
        }

        // Clean up any existing container
        await this.cleanup();

        // Pull image if needed
        await this.pullImage();

        // Build docker run command
        const dockerArgs = [
          'run', '-d',
          '--name', this.config.containerName,
          '--security-opt', 'seccomp=unconfined',
          '--shm-size', this.config.shmSize,
          '-e', `PUID=${process.getuid?.() || 1000}`,
          '-e', `PGID=${process.getgid?.() || 1000}`,
          '-e', `TZ=${this.config.timezone}`,
          '-e', 'SUBFOLDER=/',
          '-e', 'TITLE="XFCE Desktop"',
          '-p', `${this.config.webPort}:3000`,
          '-p', `${this.config.vncPort}:3001`,
          this.config.image,
        ];

        // Start the container
        await execAsync(`docker ${dockerArgs.join(' ')}`);

        // Wait a moment for container to start
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Verify container is running
        if (await this.isRunning()) {
          console.log(`[XFCE Desktop] Started successfully on port ${this.config.webPort}`);

          // Optionally install Chrome in background
          if (this.config.enableChrome) {
            this.installChromeInBackground();
          }

          return this.getStatus();
        } else {
          throw new Error('Container started but is not running');
        }
      } catch (error: any) {
        lastError = error.message;
        console.error(`[XFCE Desktop] Attempt ${attempt}/${maxRetries} failed: ${error.message}`);

        if (attempt < maxRetries) {
          // Exponential backoff: 5s, 10s, 20s
          const waitTime = 5000 * Math.pow(2, attempt - 1);
          console.log(`[XFCE Desktop] Waiting ${waitTime / 1000}s before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }

    console.error(`[XFCE Desktop] Failed to start after ${maxRetries} attempts`);
    return {
      running: false,
      error: `Failed after ${maxRetries} attempts. Last error: ${lastError}`,
    };
  }

  /**
   * Install Chrome in the container (runs in background)
   */
  private installChromeInBackground(): void {
    console.log('[XFCE Desktop] Installing Chrome in background...');

    const chromeInstallScript = `
      apt-get update -qq &&
      apt-get install -y -qq wget gnupg &&
      wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - &&
      echo 'deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main' > /etc/apt/sources.list.d/google-chrome.list &&
      apt-get update -qq &&
      apt-get install -y -qq google-chrome-stable
    `;

    this.chromeInstallProcess = spawn('docker', [
      'exec', this.config.containerName,
      'bash', '-c', chromeInstallScript,
    ], {
      stdio: 'ignore',
      detached: true,
    });

    this.chromeInstallProcess.unref();

    this.chromeInstallProcess.on('exit', (code) => {
      if (code === 0) {
        console.log('[XFCE Desktop] Chrome installed successfully');
      } else {
        console.error(`[XFCE Desktop] Chrome installation failed with code ${code}`);
      }
      this.chromeInstallProcess = null;
    });
  }

  /**
   * Stop the XFCE desktop container
   */
  async stop(): Promise<void> {
    console.log('[XFCE Desktop] Stopping...');

    try {
      await execAsync(`docker stop ${this.config.containerName}`);
      console.log('[XFCE Desktop] Stopped');
    } catch (error: any) {
      console.error(`[XFCE Desktop] Failed to stop: ${error.message}`);
    }
  }

  /**
   * Restart the XFCE desktop container
   */
  async restart(): Promise<XfceDesktopStatus> {
    await this.stop();
    await this.cleanup();
    return this.start();
  }

  /**
   * Get container logs
   */
  async getLogs(tail: number = 50): Promise<string> {
    try {
      const { stdout } = await execAsync(
        `docker logs --tail ${tail} ${this.config.containerName} 2>&1`
      );
      return stdout;
    } catch (error: any) {
      return `Failed to get logs: ${error.message}`;
    }
  }
}

/**
 * Singleton instance for easy import
 */
let instance: XfceDesktopService | null = null;

export function getXfceDesktopService(config?: XfceDesktopConfig): XfceDesktopService {
  if (!instance) {
    instance = new XfceDesktopService(config);
  }
  return instance;
}

/**
 * Check if XFCE Desktop should be enabled
 */
export function isXfceDesktopEnabled(): boolean {
  return process.env.ENABLE_XFCE_DESKTOP === 'true';
}
