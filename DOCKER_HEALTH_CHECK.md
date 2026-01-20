# Docker Health Check & Auto-Recovery

This document explains how to programmatically detect and fix Docker containerd timeout issues.

## The Problem

When running Docker-in-Docker (especially in containerized environments), you may encounter this error:

```
docker: Error response from daemon: error creating temporary lease: Unavailable: connection error: desc = "transport: Error while dialing: dial unix:///var/run/docker/containerd/containerd.sock: timeout"
```

This occurs when Docker's containerd process becomes unresponsive, causing Docker commands to fail.

## The Solution

We've implemented automatic detection and recovery mechanisms that:

1. Detect when containerd is unresponsive
2. Restart the Docker daemon automatically
3. Retry failed operations after recovery

## Usage

### Option 1: Using the Utility Module (TypeScript)

```typescript
import { checkDockerHealth, ensureDockerHealthy, runDockerCommand } from './src/utils/docker-health';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Simple health check
const health = await checkDockerHealth();
if (!health.healthy) {
  console.log(`Docker issue: ${health.issue}`);
}

// Ensure Docker is healthy (with auto-recovery)
const isHealthy = await ensureDockerHealthy({
  autoRestart: true,
  maxRetries: 2,
});

// Run a Docker command with automatic recovery
await runDockerCommand(
  async () => {
    const { stdout } = await execAsync('docker ps');
    console.log(stdout);
  },
  {
    retryOnContainerdError: true,
    maxRetries: 2,
  }
);
```

### Option 2: Using XfceDesktopService

The `XfceDesktopService` class already includes automatic Docker health checks:

```typescript
import { XfceDesktopService } from './src/services/xfce-desktop';

const service = new XfceDesktopService({
  webPort: 3001,
  vncPort: 3002,
});

// The start method automatically detects and recovers from Docker issues
const status = await service.start();

if (status.running) {
  console.log('XFCE Desktop started successfully');
} else {
  console.error(`Failed to start: ${status.error}`);
}
```

### Option 3: Run the Example Scripts

We've provided ready-to-use example scripts:

```bash
# JavaScript example (no compilation needed)
node examples/docker-health-check.js

# TypeScript example (requires ts-node)
ts-node examples/docker-health-check.ts
```

## How It Works

### Detection

The system detects containerd issues by:

1. Running `docker info` with a timeout
2. Checking error messages for containerd-specific patterns:
   - `dial unix:///var/run/docker/containerd/containerd.sock: timeout`
   - `connection error: desc = "transport: Error while dialing`
   - `error creating temporary lease: Unavailable`

### Recovery

When a containerd issue is detected:

1. Kill the `dockerd` and `containerd` processes
2. Wait 2 seconds for graceful termination
3. Restart `dockerd` in the background
4. Wait 5 seconds for initialization
5. Verify Docker is responsive with `docker info`

### Retry Logic

Operations can be wrapped with automatic retry:

- If a Docker command fails with a containerd error
- The system attempts recovery
- The command is retried after successful recovery
- Configurable max retries (default: 2)

## API Reference

### `checkDockerHealth()`

Returns the current health status of Docker.

```typescript
interface DockerHealthStatus {
  healthy: boolean;
  issue?: 'containerd-timeout' | 'daemon-not-running' | 'other';
  errorMessage?: string;
}
```

### `restartDocker()`

Restarts the Docker daemon to fix containerd issues.

Returns `true` if Docker was successfully restarted and is responsive.

### `ensureDockerHealthy(options)`

Checks Docker health and attempts automatic recovery if needed.

**Options:**
- `autoRestart` (default: `true`) - Automatically restart Docker if unhealthy
- `maxRetries` (default: `2`) - Maximum number of recovery attempts

### `runDockerCommand(command, options)`

Wraps a Docker command with automatic error detection and recovery.

**Options:**
- `retryOnContainerdError` (default: `true`) - Retry after recovering from containerd errors
- `maxRetries` (default: `2`) - Maximum number of retry attempts

## Integration with Existing Code

The Docker health check is automatically integrated into:

1. **XfceDesktopService** ([src/services/xfce-desktop.ts](src/services/xfce-desktop.ts))
   - Checks Docker health before starting containers
   - Automatically recovers from containerd issues
   - Includes retry logic for robust startup

2. **ServiceBootstrap** ([src/boot-up-services.ts](src/boot-up-services.ts))
   - Waits for Docker to be ready on boot
   - Uses XfceDesktopService with built-in recovery

## Manual Recovery (If Needed)

If automatic recovery fails, you can manually restart Docker:

```bash
# Kill Docker processes
sudo killall dockerd containerd

# Wait a moment
sleep 2

# Restart Docker daemon
sudo dockerd &> /tmp/docker-restart.log &

# Wait for initialization
sleep 5

# Verify it's working
docker ps
```

## Environment Variables

The XFCE Desktop service supports these environment variables:

- `ENABLE_XFCE_DESKTOP` - Set to `true` to enable XFCE Desktop
- `XFCE_WEB_PORT` - Web access port (default: 3001)
- `XFCE_VNC_PORT` - VNC access port (default: 3002)
- `XFCE_INSTALL_CHROME` - Set to `true` to install Chrome in background
- `TZ` - Timezone (default: America/New_York)

## Troubleshooting

### Docker still not working after recovery

1. Check Docker logs: `cat /tmp/docker-restart.log`
2. Verify Docker processes are running: `ps aux | grep -E 'dockerd|containerd'`
3. Check if containerd socket exists: `sudo ls -la /var/run/docker/containerd/containerd.sock`

### Permission denied errors

Make sure your user has sudo access without password for Docker commands, or run with appropriate permissions.

### Container fails to start even after Docker recovery

1. Check if the image exists: `docker images`
2. Try pulling manually: `docker pull linuxserver/webtop:ubuntu-xfce`
3. Check for port conflicts: `netstat -tulpn | grep -E '3001|3002'`

## Best Practices

1. Always use `runDockerCommand()` wrapper for critical Docker operations
2. Set appropriate retry limits to avoid infinite loops
3. Monitor Docker health regularly in long-running processes
4. Log recovery attempts for debugging
5. Consider implementing health check endpoints for monitoring

## Additional Resources

- [Docker-in-Docker documentation](https://docs.docker.com/engine/reference/commandline/dockerd/)
- [containerd documentation](https://containerd.io/)
- [XFCE Desktop container](https://docs.linuxserver.io/images/docker-webtop)
