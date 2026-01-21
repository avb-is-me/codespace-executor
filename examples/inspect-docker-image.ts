/**
 * Inspect Docker Image - See what tools are available
 *
 * This script checks what's installed in different Docker images:
 * - Node.js version
 * - Available shells
 * - Python availability
 * - Network tools (curl, wget, nc)
 * - Package managers
 */

import DockerExecutor from '../src/secure/DockerExecutor';

async function inspectImage(imageName: string) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`Inspecting: ${imageName}`);
    console.log('='.repeat(70));

    const executor = new DockerExecutor({
        image: imageName,
        networkMode: 'none',
        timeout: 10000
    });

    const inspectionCode = `
        console.log('\\n🔍 INSPECTION RESULTS:\\n');

        // Node.js
        console.log('1. Node.js:');
        console.log('   Version:', process.version);
        console.log('   Platform:', process.platform);
        console.log('   Arch:', process.arch);

        // Check for shells
        console.log('\\n2. Shells:');
        const { execSync } = require('child_process');

        function checkCommand(cmd, name) {
            try {
                const result = execSync(cmd + ' --version 2>&1', {
                    encoding: 'utf8',
                    timeout: 1000
                });
                console.log(\`   \${name}: ✅ Available\`);
                console.log(\`      \${result.split('\\n')[0].substring(0, 60)}\`);
                return true;
            } catch (e) {
                console.log(\`   \${name}: ❌ Not available\`);
                return false;
            }
        }

        checkCommand('sh', 'sh shell');
        checkCommand('bash', 'bash shell');

        // Check for Python
        console.log('\\n3. Python:');
        checkCommand('python', 'python');
        checkCommand('python3', 'python3');

        // Check for network tools
        console.log('\\n4. Network Tools:');
        checkCommand('curl', 'curl');
        checkCommand('wget', 'wget');
        checkCommand('nc', 'netcat');
        checkCommand('telnet', 'telnet');

        // Check for package managers
        console.log('\\n5. Package Managers:');
        checkCommand('npm', 'npm');
        checkCommand('apk', 'apk (Alpine)');
        checkCommand('apt', 'apt (Debian)');
        checkCommand('yum', 'yum (RedHat)');

        // Check for compilers
        console.log('\\n6. Compilers:');
        checkCommand('gcc', 'gcc');
        checkCommand('g++', 'g++');
        checkCommand('make', 'make');

        // Check file system
        console.log('\\n7. File System Check:');
        try {
            const fs = require('fs');
            const binaries = fs.readdirSync('/usr/bin').length;
            console.log(\`   /usr/bin contains: \${binaries} binaries\`);
        } catch (e) {
            console.log('   /usr/bin: Not accessible or doesn\\'t exist');
        }

        console.log('\\n' + '─'.repeat(70));
    `;

    try {
        const result = await executor.executeCode(inspectionCode);
        console.log(result.output);

        if (result.error) {
            console.log('\n⚠️ Errors during inspection:');
            console.log(result.error.substring(0, 500));
        }
    } catch (error: any) {
        console.log('\n❌ Failed to inspect:', error.message);
    }
}

async function runInspections() {
    console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
    console.log('║                                                                        ║');
    console.log('║                    Docker Image Inspection Tool                        ║');
    console.log('║                                                                        ║');
    console.log('╚════════════════════════════════════════════════════════════════════════╝');

    const images = [
        'node:20-alpine',                        // Standard Alpine
        'gcr.io/distroless/nodejs20-debian12',  // Distroless (most secure)
        'node:20-slim',                          // Debian slim
        // 'node:20',                            // Full Debian (uncomment to test)
    ];

    for (const image of images) {
        await inspectImage(image);
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Summary
    console.log('\n\n╔════════════════════════════════════════════════════════════════════════╗');
    console.log('║                         SECURITY SUMMARY                               ║');
    console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

    console.log('Image Security Levels:\n');

    console.log('🔒 Most Secure → Least Secure:\n');

    console.log('1. gcr.io/distroless/nodejs20-debian12 (RECOMMENDED)');
    console.log('   ✅ ONLY Node.js runtime');
    console.log('   ✅ No shell, no Python, no tools');
    console.log('   ✅ Can\'t install anything');
    console.log('   ✅ Smallest attack surface');
    console.log('   📦 Size: ~50-80 MB\n');

    console.log('2. node:20-alpine');
    console.log('   ✅ Node.js + minimal OS');
    console.log('   ⚠️ Has shell (sh)');
    console.log('   ⚠️ Has package manager (apk)');
    console.log('   ⚠️ Can install tools');
    console.log('   📦 Size: ~150 MB\n');

    console.log('3. node:20-slim');
    console.log('   ✅ Node.js + Debian minimal');
    console.log('   ⚠️ Has shell (bash)');
    console.log('   ⚠️ Has package manager (apt)');
    console.log('   ⚠️ More system tools');
    console.log('   📦 Size: ~200 MB\n');

    console.log('4. node:20 (Full)');
    console.log('   ✅ Node.js + full Debian');
    console.log('   ⚠️ Many system tools');
    console.log('   ⚠️ May have Python, curl, etc.');
    console.log('   ⚠️ Largest attack surface');
    console.log('   📦 Size: ~900 MB\n');

    console.log('💡 Recommendation for Production:\n');
    console.log('   Use: gcr.io/distroless/nodejs20-debian12');
    console.log('   Why: Absolute minimum - ONLY Node.js\n');

    console.log('⚙️ How to Use:\n');
    console.log('   const executor = new DockerExecutor({');
    console.log('       image: "gcr.io/distroless/nodejs20-debian12",');
    console.log('       networkMode: "none"');
    console.log('   });\n');
}

runInspections().catch(error => {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
});
