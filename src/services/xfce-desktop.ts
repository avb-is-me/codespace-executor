import { exec, execSync, spawn, ChildProcess } from 'child_process';
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
   * Check if Docker is available
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
   * Start the XFCE desktop container
   */
  async start(): Promise<XfceDesktopStatus> {
    // Check if Docker is available
    const dockerAvailable = await this.isDockerAvailable();
    if (!dockerAvailable) {
      console.error('[XFCE Desktop] Docker is not available');
      return {
        running: false,
        error: 'Docker is not available. Enable Docker-in-Docker in devcontainer.json',
      };
    }

    // Check if already running
    if (await this.isRunning()) {
      console.log('[XFCE Desktop] Container already running');
      return this.getStatus();
    }

    console.log('[XFCE Desktop] Starting XFCE desktop...');

    try {
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
        '-e', 'TITLE=XFCE Desktop',
        '-p', `${this.config.webPort}:3000`,
        '-p', `${this.config.vncPort}:3001`,
        this.config.image,
      ];

      // Start the container
      await execAsync(`docker ${dockerArgs.join(' ')}`);

      console.log(`[XFCE Desktop] Started on port ${this.config.webPort}`);

      // Optionally install Chrome in background
      if (this.config.enableChrome) {
        this.installChromeInBackground();
      }

      return this.getStatus();
    } catch (error: any) {
      console.error(`[XFCE Desktop] Failed to start: ${error.message}`);
      return {
        running: false,
        error: error.message,
      };
    }
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
