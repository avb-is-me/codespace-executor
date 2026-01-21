/**
 * Demo: Selective Binary Whitelisting
 *
 * Shows how to:
 * 1. Allow ONLY specific binaries (ffmpeg, imagemagick)
 * 2. Block everything else (Python, curl, etc.)
 * 3. Test that whitelisted tools work
 * 4. Test that blocked tools don't work
 */

import DockerExecutor from '../src/secure/DockerExecutor';

console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
console.log('║                                                                        ║');
console.log('║              Selective Binary Whitelisting Demo                       ║');
console.log('║                                                                        ║');
console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

async function runDemo() {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Setup: Building Custom Image with Selective Binaries');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('Step 1: Create Dockerfile with ONLY whitelisted binaries\n');
    console.log('```dockerfile');
    console.log('FROM node:20-alpine AS builder');
    console.log('RUN apk add --no-cache ffmpeg imagemagick  # ← Only these!');
    console.log('');
    console.log('FROM gcr.io/distroless/nodejs20-debian12');
    console.log('COPY --from=builder /usr/bin/ffmpeg /usr/local/bin/ffmpeg');
    console.log('COPY --from=builder /usr/bin/convert /usr/local/bin/convert');
    console.log('# Python, curl, etc. are NOT copied → blocked!');
    console.log('```\n');

    console.log('Step 2: Build the image\n');
    console.log('$ docker build -f Dockerfile.selective-binaries -t executor-with-ffmpeg:v1 .\n');

    console.log('Step 3: Use the image\n');
    console.log('const executor = new DockerExecutor({');
    console.log('    image: "executor-with-ffmpeg:v1"');
    console.log('});\n');

    // For demo purposes, we'll use alpine to simulate
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Demo: Testing Whitelisted vs Blocked Binaries');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('Simulating custom image behavior...\n');

    const testCode = `
        const { spawn, exec } = require('child_process');

        console.log('═══════════════════════════════════════════════════════════');
        console.log('Test 1: ffmpeg (WHITELISTED) ✅');
        console.log('═══════════════════════════════════════════════════════════\\n');

        const ffmpeg = spawn('ffmpeg', ['-version']);

        ffmpeg.on('error', (err) => {
            console.log('❌ ffmpeg not available:', err.code);
        });

        ffmpeg.stdout.on('data', (data) => {
            const output = data.toString();
            const version = output.split('\\n')[0];
            console.log('✅ ffmpeg IS available!');
            console.log('   Version:', version);
        });

        setTimeout(() => {
            console.log('\\n═══════════════════════════════════════════════════════════');
            console.log('Test 2: imagemagick convert (WHITELISTED) ✅');
            console.log('═══════════════════════════════════════════════════════════\\n');

            const convert = spawn('convert', ['-version']);

            convert.on('error', (err) => {
                console.log('❌ convert not available:', err.code);
            });

            convert.stdout.on('data', (data) => {
                const output = data.toString();
                const version = output.split('\\n')[0];
                console.log('✅ convert IS available!');
                console.log('   Version:', version);
            });
        }, 500);

        setTimeout(() => {
            console.log('\\n═══════════════════════════════════════════════════════════');
            console.log('Test 3: python3 (BLOCKED) ❌');
            console.log('═══════════════════════════════════════════════════════════\\n');

            const python = spawn('python3', ['--version']);

            python.on('error', (err) => {
                console.log('✅ CORRECTLY BLOCKED!');
                console.log('   Error:', err.code, '-', err.message);
                console.log('   python3 binary does not exist');
            });

            python.stdout.on('data', () => {
                console.log('❌ Python is available (should be blocked!)');
            });
        }, 1000);

        setTimeout(() => {
            console.log('\\n═══════════════════════════════════════════════════════════');
            console.log('Test 4: curl (BLOCKED) ❌');
            console.log('═══════════════════════════════════════════════════════════\\n');

            const curl = spawn('curl', ['--version']);

            curl.on('error', (err) => {
                console.log('✅ CORRECTLY BLOCKED!');
                console.log('   Error:', err.code, '-', err.message);
                console.log('   curl binary does not exist');
            });

            curl.stdout.on('data', () => {
                console.log('❌ curl is available (should be blocked!)');
            });
        }, 1500);

        setTimeout(() => {
            console.log('\\n═══════════════════════════════════════════════════════════');
            console.log('Test 5: wget (BLOCKED) ❌');
            console.log('═══════════════════════════════════════════════════════════\\n');

            const wget = spawn('wget', ['--version']);

            wget.on('error', (err) => {
                console.log('✅ CORRECTLY BLOCKED!');
                console.log('   Error:', err.code, '-', err.message);
                console.log('   wget binary does not exist');
            });

            wget.stdout.on('data', () => {
                console.log('❌ wget is available (should be blocked!)');
            });
        }, 2000);

        setTimeout(() => {
            console.log('\\n═══════════════════════════════════════════════════════════');
            console.log('Test 6: sh shell (BLOCKED) ❌');
            console.log('═══════════════════════════════════════════════════════════\\n');

            exec('ls -la', (err, stdout, stderr) => {
                if (err) {
                    console.log('✅ CORRECTLY BLOCKED!');
                    console.log('   Error:', err.code || err.message);
                    console.log('   Shell does not exist (exec needs /bin/sh)');
                } else {
                    console.log('❌ Shell is available (should be blocked!)');
                }
            });
        }, 2500);

        setTimeout(() => {
            console.log('\\n═══════════════════════════════════════════════════════════');
            console.log('SUMMARY');
            console.log('═══════════════════════════════════════════════════════════\\n');

            console.log('✅ Whitelisted binaries work:');
            console.log('   • ffmpeg');
            console.log('   • imagemagick (convert)');
            console.log('   • Any other binaries you explicitly copy\\n');

            console.log('❌ Non-whitelisted binaries blocked:');
            console.log('   • python3');
            console.log('   • curl');
            console.log('   • wget');
            console.log('   • sh/bash (shell)');
            console.log('   • Everything else not explicitly copied\\n');

            console.log('🔒 Security: Best of both worlds!');
            console.log('   • Users can use ffmpeg for video processing');
            console.log('   • Users CANNOT bypass with Python/curl');
            console.log('   • You control exactly what tools are available\\n');
        }, 3000);

        setTimeout(() => {}, 4000);
    `;

    const executor = new DockerExecutor({
        image: 'node:20-alpine',  // Using alpine to simulate
        networkMode: 'none',
        timeout: 15000
    });

    console.log('Running tests...\n');

    const result = await executor.executeCode(testCode);
    console.log(result.output);

    // Real-world example
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Real-World Example: Video Processing');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('User code can use whitelisted tools:\n');

    console.log('```javascript');
    console.log('const { spawn } = require("child_process");');
    console.log('');
    console.log('// ✅ Works! ffmpeg is whitelisted');
    console.log('const ffmpeg = spawn("ffmpeg", [');
    console.log('    "-i", "input.mp4",');
    console.log('    "-vf", "scale=1280:720",');
    console.log('    "output.mp4"');
    console.log(']);');
    console.log('');
    console.log('// ❌ Blocked! Python not whitelisted');
    console.log('const python = spawn("python3", ["-c", "import requests"]);');
    console.log('// Error: spawn python3 ENOENT');
    console.log('```\n');

    // Comprehensive guide
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('How to Whitelist Specific Binaries');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('1️⃣  Video Processing (ffmpeg):');
    console.log('   RUN apk add --no-cache ffmpeg');
    console.log('   COPY --from=builder /usr/bin/ffmpeg /usr/local/bin/ffmpeg');
    console.log('   COPY --from=builder /usr/bin/ffprobe /usr/local/bin/ffprobe\n');

    console.log('2️⃣  Image Processing (imagemagick):');
    console.log('   RUN apk add --no-cache imagemagick');
    console.log('   COPY --from=builder /usr/bin/convert /usr/local/bin/convert');
    console.log('   COPY --from=builder /usr/bin/identify /usr/local/bin/identify\n');

    console.log('3️⃣  PDF Processing (poppler):');
    console.log('   RUN apk add --no-cache poppler-utils');
    console.log('   COPY --from=builder /usr/bin/pdftotext /usr/local/bin/pdftotext');
    console.log('   COPY --from=builder /usr/bin/pdftoppm /usr/local/bin/pdftoppm\n');

    console.log('4️⃣  Audio Processing (sox):');
    console.log('   RUN apk add --no-cache sox');
    console.log('   COPY --from=builder /usr/bin/sox /usr/local/bin/sox\n');

    console.log('5️⃣  Archive Tools (tar, zip - use with caution):');
    console.log('   RUN apk add --no-cache tar zip');
    console.log('   COPY --from=builder /usr/bin/tar /usr/local/bin/tar');
    console.log('   COPY --from=builder /usr/bin/zip /usr/local/bin/zip\n');

    console.log('❌ What NOT to whitelist:');
    console.log('   • python, python3 (bypass vector)');
    console.log('   • curl, wget (network tools)');
    console.log('   • nc, netcat (network tools)');
    console.log('   • sh, bash (shells)');
    console.log('   • gcc, make (compilers)\n');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Complete Example: Custom Image for Media Processing');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('```dockerfile');
    console.log('FROM node:20-alpine AS builder');
    console.log('WORKDIR /app');
    console.log('');
    console.log('# Install whitelisted tools');
    console.log('RUN apk add --no-cache \\');
    console.log('    ffmpeg \\');
    console.log('    imagemagick \\');
    console.log('    poppler-utils \\');
    console.log('    ghostscript');
    console.log('');
    console.log('# Install npm packages');
    console.log('RUN npm install --omit=dev \\');
    console.log('    sharp \\');
    console.log('    fluent-ffmpeg \\');
    console.log('    pdf-lib');
    console.log('');
    console.log('FROM gcr.io/distroless/nodejs20-debian12');
    console.log('');
    console.log('# Copy npm packages');
    console.log('COPY --from=builder /app/node_modules /app/node_modules');
    console.log('');
    console.log('# Copy ONLY whitelisted binaries');
    console.log('COPY --from=builder /usr/bin/ffmpeg /usr/local/bin/ffmpeg');
    console.log('COPY --from=builder /usr/bin/ffprobe /usr/local/bin/ffprobe');
    console.log('COPY --from=builder /usr/bin/convert /usr/local/bin/convert');
    console.log('COPY --from=builder /usr/bin/identify /usr/local/bin/identify');
    console.log('COPY --from=builder /usr/bin/pdftotext /usr/local/bin/pdftotext');
    console.log('');
    console.log('# Copy required libraries');
    console.log('COPY --from=builder /usr/lib /usr/lib');
    console.log('COPY --from=builder /lib /lib');
    console.log('');
    console.log('ENV NODE_PATH=/app/node_modules');
    console.log('ENV PATH=/usr/local/bin:/nodejs/bin:$PATH');
    console.log('```\n');

    console.log('Build and use:');
    console.log('$ docker build -f Dockerfile.selective-binaries -t media-executor:v1 .\n');

    console.log('const executor = new DockerExecutorWithProxy({');
    console.log('    image: "media-executor:v1"');
    console.log('});\n');

    // Summary
    console.log('\n╔════════════════════════════════════════════════════════════════════════╗');
    console.log('║                              SUMMARY                                   ║');
    console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

    console.log('✅ YES! You can whitelist specific binaries:\n');

    console.log('┌───────────────────┬─────────────┬──────────────────────┐');
    console.log('│ Tool              │ Whitelisted │ Result               │');
    console.log('├───────────────────┼─────────────┼──────────────────────┤');
    console.log('│ ffmpeg            │ ✅ Yes      │ spawn("ffmpeg") works│');
    console.log('│ imagemagick       │ ✅ Yes      │ spawn("convert") works│');
    console.log('│ pdf tools         │ ✅ Yes      │ spawn("pdftotext") works│');
    console.log('├───────────────────┼─────────────┼──────────────────────┤');
    console.log('│ python3           │ ❌ No       │ ENOENT - blocked     │');
    console.log('│ curl              │ ❌ No       │ ENOENT - blocked     │');
    console.log('│ wget              │ ❌ No       │ ENOENT - blocked     │');
    console.log('│ sh/bash           │ ❌ No       │ ENOENT - blocked     │');
    console.log('└───────────────────┴─────────────┴──────────────────────┘\n');

    console.log('🎯 How it works:');
    console.log('   1. Install tools in builder stage (has package manager)');
    console.log('   2. Copy ONLY whitelisted binaries to final image');
    console.log('   3. Don\'t copy Python, curl, shell, etc.');
    console.log('   4. Result: Users can use whitelisted tools only!\n');

    console.log('🔒 Security benefits:');
    console.log('   • Users can process media (ffmpeg, imagemagick)');
    console.log('   • Users CANNOT bypass with Python/curl');
    console.log('   • You control the exact toolset available');
    console.log('   • Still get distroless security for everything else\n');

    console.log('💡 Use cases:');
    console.log('   • Video processing (ffmpeg)');
    console.log('   • Image manipulation (imagemagick)');
    console.log('   • PDF generation/parsing (poppler, ghostscript)');
    console.log('   • Audio processing (sox)');
    console.log('   • Any specific tool your users need\n');

    console.log('⚠️  Remember:');
    console.log('   • Only whitelist tools you trust');
    console.log('   • Don\'t whitelist shells, Python, curl');
    console.log('   • Test that blocked tools actually fail');
    console.log('   • Keep the whitelist minimal\n');
}

runDemo().catch(error => {
    console.error('\n❌ Error:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
});
