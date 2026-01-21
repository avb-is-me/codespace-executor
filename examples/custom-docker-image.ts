/**
 * Demo: Using Custom Docker Images with Pre-installed Libraries
 *
 * Shows 3 approaches:
 * 1. Pre-built custom image (fastest, recommended)
 * 2. Runtime npm install (slower, flexible)
 * 3. Mount node_modules from host (fastest for development)
 */

import DockerExecutor from '../src/secure/DockerExecutor';
import DockerExecutorWithProxy from '../src/secure/DockerExecutorWithProxy';

console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
console.log('║                                                                        ║');
console.log('║         Custom Docker Images with Pre-installed Libraries             ║');
console.log('║                                                                        ║');
console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

async function runExamples() {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Approach 1: Pre-built Custom Image (RECOMMENDED)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('Step 1: Build custom image with packages pre-installed\n');

    console.log('$ cat Dockerfile.with-packages');
    console.log('```dockerfile');
    console.log('FROM node:20-alpine AS builder');
    console.log('WORKDIR /app');
    console.log('RUN npm install stripe axios lodash');
    console.log('');
    console.log('FROM gcr.io/distroless/nodejs20-debian12');
    console.log('COPY --from=builder /app/node_modules /app/node_modules');
    console.log('ENV NODE_PATH=/app/node_modules');
    console.log('```\n');

    console.log('Step 2: Build the image\n');
    console.log('$ docker build -f Dockerfile.with-packages -t my-executor:latest .\n');

    console.log('Step 3: Use the custom image\n');
    console.log('```typescript');
    console.log('const executor = new DockerExecutor({');
    console.log('    image: "my-executor:latest",  // ← Your custom image');
    console.log('    networkMode: "none"');
    console.log('});');
    console.log('```\n');

    console.log('✅ Benefits:');
    console.log('   • Fast execution (packages already installed)');
    console.log('   • Still uses distroless (secure)');
    console.log('   • No npm install on each run');
    console.log('   • Packages cached in image\n');

    console.log('⏱️  Performance:');
    console.log('   • First build: ~30-60 seconds (one time)');
    console.log('   • Each execution: ~500ms-2s (fast!)');
    console.log('   • No package installation overhead\n');

    // Example code that uses pre-installed packages
    console.log('Example: User code using pre-installed packages\n');

    const exampleCode = `
        // These packages are already installed in the image!
        const axios = require('axios');
        const lodash = require('lodash');
        const moment = require('moment');

        console.log('[CODE] axios version:', axios.VERSION);
        console.log('[CODE] lodash chunk:', lodash.chunk([1, 2, 3, 4], 2));
        console.log('[CODE] moment:', moment().format('YYYY-MM-DD'));

        // Works perfectly because packages are in /app/node_modules
    `;

    console.log('```javascript' + exampleCode + '```\n');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Approach 2: Runtime Package Installation (Flexible)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('Automatically install packages before execution:\n');

    console.log('```typescript');
    console.log('const executor = new DockerExecutor({');
    console.log('    image: "node:20-alpine",');
    console.log('    networkMode: "bridge",  // Need network for npm install');
    console.log('    preInstallPackages: ["stripe", "axios", "lodash"]  // ← Auto-install');
    console.log('});');
    console.log('```\n');

    console.log('⚠️  Limitations:');
    console.log('   • Slower (npm install on every execution)');
    console.log('   • Requires network access (can\'t use networkMode=none)');
    console.log('   • Not available in distroless (no npm)');
    console.log('   • Security risk (packages downloaded at runtime)\n');

    console.log('⏱️  Performance:');
    console.log('   • Each execution: ~5-15 seconds (slow!)');
    console.log('   • npm install overhead on every run\n');

    console.log('💡 Use case: Development/testing only, not production\n');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Approach 3: Mount node_modules from Host (Development)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('Mount host node_modules into container:\n');

    console.log('```typescript');
    console.log('const executor = new DockerExecutor({');
    console.log('    image: "node:20-alpine",');
    console.log('    networkMode: "none",');
    console.log('    volumes: [');
    console.log('        "/path/to/host/node_modules:/app/node_modules:ro"  // Read-only');
    console.log('    ]');
    console.log('});');
    console.log('```\n');

    console.log('✅ Benefits:');
    console.log('   • Very fast (no npm install)');
    console.log('   • Easy to update packages (on host)');
    console.log('   • Good for development\n');

    console.log('⚠️  Limitations:');
    console.log('   • Not portable (depends on host filesystem)');
    console.log('   • Platform issues (macOS modules ≠ Linux modules)');
    console.log('   • Not suitable for production\n');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Comparison');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('┌─────────────────┬──────────┬──────────┬──────────┬────────────┐');
    console.log('│ Approach        │ Speed    │ Security │ Portable │ Use Case   │');
    console.log('├─────────────────┼──────────┼──────────┼──────────┼────────────┤');
    console.log('│ Pre-built image │ ⚡⚡⚡      │ ✅✅✅     │ ✅✅✅     │ Production │');
    console.log('│ Runtime install │ 🐢        │ ⚠️        │ ✅✅       │ Testing    │');
    console.log('│ Mount volumes   │ ⚡⚡       │ ✅        │ ❌        │ Dev only   │');
    console.log('└─────────────────┴──────────┴──────────┴──────────┴────────────┘\n');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Recommended Setup for Production');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('1. Create Dockerfile.with-packages:');
    console.log('   - Start with distroless');
    console.log('   - Copy pre-installed node_modules');
    console.log('   - Include commonly used packages\n');

    console.log('2. Build image:');
    console.log('   $ docker build -f Dockerfile.with-packages -t my-executor:v1.0 .\n');

    console.log('3. Push to registry (optional):');
    console.log('   $ docker tag my-executor:v1.0 gcr.io/my-project/executor:v1.0');
    console.log('   $ docker push gcr.io/my-project/executor:v1.0\n');

    console.log('4. Use in production:');
    console.log('   const executor = new DockerExecutorWithProxy({');
    console.log('       image: "my-executor:v1.0",  // or from registry');
    console.log('       networkMode: "bridge",');
    console.log('       proxyPort: 8888,');
    console.log('       filterSensitiveHeaders: true');
    console.log('   });\n');

    console.log('✅ Result:');
    console.log('   • Fast execution (packages cached)');
    console.log('   • Secure (distroless + network control)');
    console.log('   • Portable (same image everywhere)');
    console.log('   • Version controlled (tag images)\n');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Dynamic Package Support');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('If users need packages not in your image:\n');

    console.log('Option 1: Build multiple images');
    console.log('   my-executor:base       → Core packages (stripe, axios)');
    console.log('   my-executor:ml         → + ML packages (tensorflow)');
    console.log('   my-executor:data       → + Data packages (pandas-js)\n');

    console.log('Option 2: Allow user-specified packages (development only)');
    console.log('   const executor = new DockerExecutor({');
    console.log('       image: "node:20-alpine",');
    console.log('       allowPackageInstall: true,  // Enable runtime install');
    console.log('       networkMode: "bridge"');
    console.log('   });\n');

    console.log('   // User code can specify packages:');
    console.log('   // PACKAGES: stripe@12.0.0, axios@1.6.0');
    console.log('   const stripe = require("stripe");  // Auto-installed\n');

    console.log('⚠️  Security note: Runtime package install requires network,');
    console.log('   which increases attack surface. Only for trusted code!\n');
}

runExamples().catch(error => {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
});
