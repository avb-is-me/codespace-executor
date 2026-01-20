import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { generateKeyPair } from './utils/asymmetric-crypto.js';
import { XfceDesktopService, isXfceDesktopEnabled, XfceDesktopConfig } from './services/xfce-desktop.js';
import ProxyService from './proxy/ProxyService.js';
import { ProxyConfig, WhitelistConfig } from './types/index.js';

interface ServiceConfig {
  name: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: 'pipe' | 'inherit' | 'ignore';
}

interface ServiceProcess {
  name: string;
  process: ChildProcess;
  status: 'starting' | 'running' | 'failed' | 'stopped';
}

export class ServiceBootstrap {
  private services: ServiceProcess[] = [];
  private readonly projectRoot: string;
  private xfceDesktop: XfceDesktopService | null = null;
  private proxyService: ProxyService | null = null;

  constructor() {
    // Get project root (parent directory of dist/src)
    this.projectRoot = path.resolve(__dirname, '../..');
  }

  /**
   * Boot up all configured services
   */
  async bootUpServices(): Promise<void> {
    

    // Generate RSA key pair on boot
    try {
      generateKeyPair();
    } catch (error: any) {
      console.error('❌ Failed to generate encryption key pair:', error.message);
      console.error('⚠️  Server will continue without asymmetric encryption support');
    }

    const services: ServiceConfig[] = [
      // WebSocket server
      {
        name: 'WebSocket Server',
        command: 'node',
        args: ['dist/src/run-websocket.js'],
        cwd: this.projectRoot,
        stdio: 'inherit', // Show output directly
      },
    ];

    // Start all services
    for (const serviceConfig of services) {
      await this.startService(serviceConfig);
    }

    // Start HTTP Proxy service for URL whitelisting
    await this.startProxyService();

    // Start XFCE Desktop if enabled
    await this.startXfceDesktop();
  }

  /**
   * Start the HTTP Proxy service for URL whitelisting
   */
  private async startProxyService(): Promise<void> {
    const proxyEnabled = process.env.PROXY_ENABLED === 'true';

    if (!proxyEnabled) {
      console.log('[ServiceBootstrap] HTTP Proxy is disabled (set PROXY_ENABLED=true to enable)');
      return;
    }

    console.log('[ServiceBootstrap] Starting HTTP Proxy service...');

    try {
      // Build whitelist from environment variables
      const whitelist: WhitelistConfig = {
        domains: this.getProxyWhitelist(),
        allowLocalhost: process.env.PROXY_ALLOW_LOCALHOST === 'true',
        allowPrivateNetworks: process.env.PROXY_ALLOW_PRIVATE_NETWORKS === 'true'
      };

      const config: Partial<ProxyConfig> = {
        enabled: true,
        host: process.env.PROXY_HOST || '127.0.0.1',
        port: parseInt(process.env.PROXY_PORT || '8888', 10),
        whitelist,
        logBlocked: process.env.PROXY_LOG_BLOCKED !== 'false',
        logAllowed: process.env.PROXY_LOG_ALLOWED === 'true'
      };

      this.proxyService = new ProxyService(config);
      await this.proxyService.start();

      console.log(`[ServiceBootstrap] HTTP Proxy started on ${config.host}:${config.port}`);
      console.log(`[ServiceBootstrap] Whitelist: ${whitelist.domains.length} domain patterns`);
    } catch (error: any) {
      console.error(`[ServiceBootstrap] HTTP Proxy failed to start: ${error.message}`);
    }
  }

  /**
   * Get proxy whitelist from environment variable
   */
  private getProxyWhitelist(): string[] {
    const envWhitelist = process.env.PROXY_WHITELIST;
    if (envWhitelist) {
      return envWhitelist.split(',').map(d => d.trim()).filter(d => d.length > 0);
    }

    // Default trusted domains
    return [
      // Common API providers
      'api.github.com',
      '*.github.com',
      'api.notion.com',
      '*.notion.com',
      'api.openai.com',
      '*.anthropic.com',
      'api.stripe.com',
      '*.googleapis.com',
      '*.google.com',
      // Keyboard.dev
      '*.keyboard.dev',
      'login.keyboard.dev',
      // CDNs and common services
      '*.cloudflare.com',
      '*.amazonaws.com',
      '*.azure.com'
    ];
  }

  /**
   * Start XFCE Desktop container if enabled
   */
  private async startXfceDesktop(): Promise<void> {
    if (!isXfceDesktopEnabled()) {
      return;
    }

    console.log('[ServiceBootstrap] XFCE Desktop is enabled, starting...');

    try {
      // Get configuration from environment variables
      const config: XfceDesktopConfig = {
        webPort: parseInt(process.env.XFCE_WEB_PORT || '3001', 10),
        vncPort: parseInt(process.env.XFCE_VNC_PORT || '3002', 10),
        enableChrome: process.env.XFCE_INSTALL_CHROME === 'true',
        timezone: process.env.TZ || 'America/New_York',
      };

      this.xfceDesktop = new XfceDesktopService(config);
      const status = await this.xfceDesktop.start();

      if (status.running) {
        console.log(`[ServiceBootstrap] XFCE Desktop started on port ${status.webPort}`);
      } else {
        console.error(`[ServiceBootstrap] XFCE Desktop failed to start: ${status.error}`);
      }
    } catch (error: any) {
      console.error(`[ServiceBootstrap] XFCE Desktop error: ${error.message}`);
    }
  }

  /**
   * Start a single service
   */
  private async startService(config: ServiceConfig): Promise<void> {
    

    try {
      const serviceProcess = spawn(config.command, config.args, {
        cwd: config.cwd || this.projectRoot,
        env: { ...process.env, ...config.env },
        stdio: config.stdio || 'pipe',
        detached: false, // Keep attached so they shutdown with parent
      });

      const serviceInfo: ServiceProcess = {
        name: config.name,
        process: serviceProcess,
        status: 'starting',
      };

      this.services.push(serviceInfo);

      // Handle service output if piped
      if (config.stdio === 'pipe') {
        serviceProcess.stdout?.on('data', (data) => {
          const output = data.toString().trim();
          if (output) {
            
          }
        });

        serviceProcess.stderr?.on('data', (data) => {
          const output = data.toString().trim();
          if (output) {
            console.error(`  [${config.name}] ${output}`);
          }
        });
      }

      // Handle service exit
      serviceProcess.on('exit', (code, signal) => {
        serviceInfo.status = code === 0 ? 'stopped' : 'failed';
        if (code !== 0 && code !== null) {
          console.error(`❌ ${config.name} exited with code ${code}`);
        } else if (signal) {
          
        } else {
          
        }
      });

      // Handle service errors
      serviceProcess.on('error', (error) => {
        serviceInfo.status = 'failed';
        console.error(`❌ Failed to start ${config.name}:`, error.message);
      });

      // Mark as running after a brief delay
      setTimeout(() => {
        if (serviceInfo.status === 'starting') {
          serviceInfo.status = 'running';
          
        }
      }, 1000);

      // Small delay between starting services
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error: any) {
      console.error(`❌ Error starting ${config.name}:`, error.message);
    }
  }

  /**
   * Get status of all services
   */
  getServicesStatus(): { name: string; status: string }[] {
    const statuses = this.services.map(service => ({
      name: service.name,
      status: service.status,
    }));

    // Add HTTP Proxy status if enabled
    if (this.proxyService) {
      statuses.push({
        name: 'HTTP Proxy',
        status: this.proxyService.isRunning() ? 'running' : 'stopped',
      });
    }

    // Add XFCE Desktop status if enabled
    if (this.xfceDesktop) {
      statuses.push({
        name: 'XFCE Desktop',
        status: 'running', // Will be updated by async check if needed
      });
    }

    return statuses;
  }

  /**
   * Get XFCE Desktop service instance (if enabled)
   */
  getXfceDesktop(): XfceDesktopService | null {
    return this.xfceDesktop;
  }

  /**
   * Get HTTP Proxy service instance (if enabled)
   */
  getProxyService(): ProxyService | null {
    return this.proxyService;
  }

  /**
   * Shutdown all services gracefully
   */
  async shutdown(): Promise<void> {
    // Stop HTTP Proxy service if running
    if (this.proxyService && this.proxyService.isRunning()) {
      try {
        console.log('[ServiceBootstrap] Stopping HTTP Proxy...');
        await this.proxyService.stop();
      } catch (error: any) {
        console.error(`[ServiceBootstrap] Failed to stop HTTP Proxy: ${error.message}`);
      }
    }

    // Stop XFCE Desktop container if running
    if (this.xfceDesktop) {
      try {
        console.log('[ServiceBootstrap] Stopping XFCE Desktop...');
        await this.xfceDesktop.stop();
      } catch (error: any) {
        console.error(`[ServiceBootstrap] Failed to stop XFCE Desktop: ${error.message}`);
      }
    }

    for (const service of this.services) {
      if (service.status === 'running' || service.status === 'starting') {
        
        try {
          service.process.kill('SIGTERM');
          service.status = 'stopped';
        } catch (error: any) {
          console.error(`  Failed to stop ${service.name}:`, error.message);
        }
      }
    }

    // Wait a bit for graceful shutdown
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Force kill any remaining processes
    for (const service of this.services) {
      if (service.status === 'running') {
        
        try {
          service.process.kill('SIGKILL');
        } catch (error) {
          // Ignore errors on force kill
        }
      }
    }

    
  }
}

/**
 * Main export function to boot up services
 * Can be called from server.ts
 */
export async function bootUpServices(): Promise<ServiceBootstrap> {
  const bootstrap = new ServiceBootstrap();
  await bootstrap.bootUpServices();
  return bootstrap;
}

/**
 * If running this file directly (for testing)
 */
if (require.main === module) {
  const bootstrap = new ServiceBootstrap();

  bootstrap.bootUpServices().catch((error) => {
    console.error('❌ Failed to boot services:', error);
    process.exit(1);
  });

  // Handle graceful shutdown
  process.on('SIGTERM', async () => {
    await bootstrap.shutdown();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    await bootstrap.shutdown();
    process.exit(0);
  });
}
