# Selective Binary Whitelisting Guide

## Question: Can we whitelist specific binaries (like ffmpeg) while blocking Python/curl?

**Answer: YES!** You have complete control over which binaries exist in your Docker image.

---

## How It Works

### The Principle:

In Docker, binaries are just files. If a binary file doesn't exist, it can't be executed!

```
Image contains:           User tries:                 Result:
✅ /usr/local/bin/ffmpeg  → spawn('ffmpeg')          → ✅ Works!
❌ No /usr/bin/python3    → spawn('python3')         → ❌ ENOENT
❌ No /usr/bin/curl       → spawn('curl')            → ❌ ENOENT
```

**Strategy:** Copy ONLY the binaries you want into your final image.

---

## Step-by-Step: Building Selective Images

### Example: Whitelist ffmpeg, Block Everything Else

```dockerfile
# Stage 1: Install everything (has package manager)
FROM node:20-alpine AS builder

WORKDIR /app

# Install the tools you want to whitelist
RUN apk add --no-cache \
    ffmpeg \
    imagemagick

# Install npm packages
RUN npm install stripe axios

# Stage 2: Final image with ONLY selected binaries
FROM gcr.io/distroless/nodejs20-debian12

# Copy npm packages
COPY --from=builder /app/node_modules /app/node_modules

# Copy ONLY whitelisted binaries (one by one!)
COPY --from=builder /usr/bin/ffmpeg /usr/local/bin/ffmpeg
COPY --from=builder /usr/bin/ffprobe /usr/local/bin/ffprobe
COPY --from=builder /usr/bin/convert /usr/local/bin/convert
COPY --from=builder /usr/bin/identify /usr/local/bin/identify

# Copy required libraries
COPY --from=builder /usr/lib /usr/lib
COPY --from=builder /lib /lib

ENV NODE_PATH=/app/node_modules
ENV PATH=/usr/local/bin:/nodejs/bin:$PATH

# Result:
# ✅ ffmpeg exists → can be executed
# ✅ imagemagick exists → can be executed
# ❌ python3 NOT copied → cannot be executed
# ❌ curl NOT copied → cannot be executed
```

---

## What Gets Whitelisted vs Blocked

### Always Included (from distroless):

✅ Node.js runtime (`node`)
✅ Node.js built-in modules (`fs`, `https`, `crypto`, etc.)

### You Explicitly Whitelist:

✅ ffmpeg (if you copy it)
✅ imagemagick (if you copy it)
✅ PDF tools (if you copy them)
✅ Any other specific tools

### Automatically Blocked (not copied):

❌ Python (`python3`)
❌ curl
❌ wget
❌ netcat (`nc`)
❌ Shell (`sh`, `bash`)
❌ Package managers (`apk`, `apt`, `npm`)
❌ Compilers (`gcc`, `make`)
❌ Everything else not explicitly copied

---

## Common Whitelisting Scenarios

### 1. Video Processing (ffmpeg)

```dockerfile
FROM node:20-alpine AS builder
RUN apk add --no-cache ffmpeg

FROM gcr.io/distroless/nodejs20-debian12
COPY --from=builder /usr/bin/ffmpeg /usr/local/bin/ffmpeg
COPY --from=builder /usr/bin/ffprobe /usr/local/bin/ffprobe
COPY --from=builder /usr/lib/libavcodec.so* /usr/lib/
COPY --from=builder /usr/lib/libavformat.so* /usr/lib/
COPY --from=builder /usr/lib/libavutil.so* /usr/lib/
# ... other required libs
```

**User code can:**
```javascript
const { spawn } = require('child_process');
spawn('ffmpeg', ['-i', 'input.mp4', 'output.mp4']);  // ✅ Works!
```

**User code CANNOT:**
```javascript
spawn('python3', ['-c', 'import urllib']);  // ❌ ENOENT
spawn('curl', ['https://evil.com']);        // ❌ ENOENT
```

---

### 2. Image Processing (imagemagick)

```dockerfile
FROM node:20-alpine AS builder
RUN apk add --no-cache imagemagick

FROM gcr.io/distroless/nodejs20-debian12
COPY --from=builder /usr/bin/convert /usr/local/bin/convert
COPY --from=builder /usr/bin/identify /usr/local/bin/identify
COPY --from=builder /usr/bin/mogrify /usr/local/bin/mogrify
COPY --from=builder /usr/lib/libMagick*.so* /usr/lib/
```

**User code can:**
```javascript
spawn('convert', ['input.jpg', '-resize', '800x600', 'output.jpg']);  // ✅
spawn('identify', ['image.jpg']);  // ✅
```

---

### 3. PDF Processing (poppler)

```dockerfile
FROM node:20-alpine AS builder
RUN apk add --no-cache poppler-utils ghostscript

FROM gcr.io/distroless/nodejs20-debian12
COPY --from=builder /usr/bin/pdftotext /usr/local/bin/pdftotext
COPY --from=builder /usr/bin/pdftoppm /usr/local/bin/pdftoppm
COPY --from=builder /usr/bin/pdfinfo /usr/local/bin/pdfinfo
```

**User code can:**
```javascript
spawn('pdftotext', ['document.pdf', 'output.txt']);  // ✅
spawn('pdftoppm', ['input.pdf', 'output']);  // ✅
```

---

### 4. Audio Processing (sox)

```dockerfile
FROM node:20-alpine AS builder
RUN apk add --no-cache sox

FROM gcr.io/distroless/nodejs20-debian12
COPY --from=builder /usr/bin/sox /usr/local/bin/sox
COPY --from=builder /usr/bin/soxi /usr/local/bin/soxi
```

---

### 5. Multiple Tools Combined

```dockerfile
FROM node:20-alpine AS builder

# Install all tools you want to whitelist
RUN apk add --no-cache \
    ffmpeg \
    imagemagick \
    poppler-utils \
    ghostscript \
    sox

RUN npm install stripe axios sharp fluent-ffmpeg pdf-lib

FROM gcr.io/distroless/nodejs20-debian12

# Copy npm packages
COPY --from=builder /app/node_modules /app/node_modules

# Copy whitelisted binaries
COPY --from=builder /usr/bin/ffmpeg /usr/local/bin/ffmpeg
COPY --from=builder /usr/bin/ffprobe /usr/local/bin/ffprobe
COPY --from=builder /usr/bin/convert /usr/local/bin/convert
COPY --from=builder /usr/bin/identify /usr/local/bin/identify
COPY --from=builder /usr/bin/pdftotext /usr/local/bin/pdftotext
COPY --from=builder /usr/bin/sox /usr/local/bin/sox

# Copy libraries
COPY --from=builder /usr/lib /usr/lib
COPY --from=builder /lib /lib

ENV NODE_PATH=/app/node_modules
```

---

## Security Considerations

### ✅ Safe to Whitelist:

**Media Processing:**
- ffmpeg (video)
- imagemagick (images)
- sox (audio)
- ghostscript (PDF/PostScript)
- poppler-utils (PDF)

**Why safe?** These tools:
- Don't make network requests by default
- Process local files only
- Can't install packages
- Can't execute arbitrary code

---

### ⚠️ Use With Caution:

**Archive Tools:**
- tar
- zip
- unzip
- gzip

**Why caution?** Can be used to:
- Extract malicious files
- Create archive bombs (zip bombs)
- Read arbitrary files

**Mitigation:** Use with resource limits and path restrictions.

---

### ❌ DO NOT Whitelist:

**Network Tools:**
- curl, wget, nc, telnet
- **Why?** Bypass network isolation

**Shells:**
- sh, bash, zsh
- **Why?** Allow command chaining, script execution

**Language Runtimes:**
- python, python3, ruby, perl
- **Why?** Bypass vector for network requests

**Package Managers:**
- npm, pip, gem, apk, apt
- **Why?** Can install anything

**Compilers:**
- gcc, g++, make, rustc
- **Why?** Can compile bypass tools

---

## Testing Your Whitelist

### Test Script:

```javascript
const { spawn } = require('child_process');

// Test whitelisted (should work)
console.log('Testing whitelisted binaries:');

spawn('ffmpeg', ['-version']).on('error', (err) => {
    console.log('❌ ffmpeg not found:', err.code);
}).on('spawn', () => {
    console.log('✅ ffmpeg available');
});

// Test blocked (should fail)
console.log('\nTesting blocked binaries:');

spawn('python3', ['--version']).on('error', (err) => {
    console.log('✅ python3 correctly blocked:', err.code);
}).on('spawn', () => {
    console.log('❌ python3 available (SECURITY ISSUE!)');
});

spawn('curl', ['--version']).on('error', (err) => {
    console.log('✅ curl correctly blocked:', err.code);
}).on('spawn', () => {
    console.log('❌ curl available (SECURITY ISSUE!)');
});
```

**Expected output:**
```
Testing whitelisted binaries:
✅ ffmpeg available

Testing blocked binaries:
✅ python3 correctly blocked: ENOENT
✅ curl correctly blocked: ENOENT
```

---

## Example: Complete Media Processing Image

```dockerfile
# Dockerfile.media-processing
FROM node:20-alpine AS builder

WORKDIR /app

# Install media processing tools
RUN apk add --no-cache \
    ffmpeg \
    imagemagick \
    ghostscript \
    poppler-utils

# Install npm packages for media processing
RUN npm install --omit=dev \
    sharp \
    fluent-ffmpeg \
    pdf-lib \
    node-canvas

FROM gcr.io/distroless/nodejs20-debian12

# Copy npm packages
COPY --from=builder /app/node_modules /app/node_modules

# Video processing
COPY --from=builder /usr/bin/ffmpeg /usr/local/bin/ffmpeg
COPY --from=builder /usr/bin/ffprobe /usr/local/bin/ffprobe

# Image processing
COPY --from=builder /usr/bin/convert /usr/local/bin/convert
COPY --from=builder /usr/bin/identify /usr/local/bin/identify
COPY --from=builder /usr/bin/mogrify /usr/local/bin/mogrify

# PDF processing
COPY --from=builder /usr/bin/pdftotext /usr/local/bin/pdftotext
COPY --from=builder /usr/bin/pdftoppm /usr/local/bin/pdftoppm
COPY --from=builder /usr/bin/pdfinfo /usr/local/bin/pdfinfo
COPY --from=builder /usr/bin/gs /usr/local/bin/gs

# Libraries
COPY --from=builder /usr/lib /usr/lib
COPY --from=builder /lib /lib

ENV NODE_PATH=/app/node_modules
ENV PATH=/usr/local/bin:/nodejs/bin:$PATH
```

**Build:**
```bash
docker build -f Dockerfile.media-processing -t media-executor:v1 .
```

**Use:**
```typescript
const executor = new DockerExecutorWithProxy({
    image: 'media-executor:v1',
    proxyPort: 8888,
    filterSensitiveHeaders: true
});
```

**User code capabilities:**
```javascript
// ✅ Can do video processing
spawn('ffmpeg', ['-i', 'video.mp4', '-vf', 'scale=1280:720', 'out.mp4']);

// ✅ Can do image processing
spawn('convert', ['image.jpg', '-resize', '50%', 'thumbnail.jpg']);

// ✅ Can extract text from PDFs
spawn('pdftotext', ['document.pdf', 'output.txt']);

// ✅ Can use Node.js packages
const sharp = require('sharp');
await sharp('input.jpg').resize(300, 200).toFile('output.jpg');

// ❌ CANNOT bypass with Python
spawn('python3', ['-c', 'import requests']);  // ENOENT

// ❌ CANNOT use curl
spawn('curl', ['https://evil.com']);  // ENOENT
```

---

## Minimal Library Copying (Advanced)

For smaller images, copy only required libraries:

```dockerfile
# Instead of copying entire /usr/lib:
COPY --from=builder /usr/lib /usr/lib

# Copy only specific libraries:
COPY --from=builder /usr/lib/libavcodec.so* /usr/lib/
COPY --from=builder /usr/lib/libavformat.so* /usr/lib/
COPY --from=builder /usr/lib/libavutil.so* /usr/lib/
COPY --from=builder /usr/lib/libswscale.so* /usr/lib/

# Find required libraries:
# $ ldd /usr/bin/ffmpeg
```

**Benefits:**
- Smaller image size
- Faster pulls
- Less attack surface

**Trade-off:**
- More manual work
- Need to identify all dependencies
- May break if libraries change

---

## Best Practices

### 1. Document Your Whitelist

```dockerfile
# Whitelisted binaries and rationale:
# - ffmpeg: Video processing for user uploads
# - imagemagick: Thumbnail generation
# - pdftotext: Extract text from user PDFs
#
# Blocked for security:
# - python3: Bypass vector
# - curl/wget: Network bypass
# - shells: Command injection
```

### 2. Version Pin Your Tools

```dockerfile
RUN apk add --no-cache \
    ffmpeg=6.0-r0 \
    imagemagick=7.1.1.15-r0
```

### 3. Test Blocking

Always test that blocked tools actually fail:

```bash
docker run your-image node -e "
    require('child_process').spawn('python3', ['--version'])
        .on('error', () => console.log('✅ Blocked'))
        .on('spawn', () => console.log('❌ NOT blocked!'));
"
```

### 4. Regular Security Audits

Periodically verify:
- Whitelisted tools are still necessary
- No new binaries accidentally added
- Blocked tools remain blocked

---

## Summary

✅ **YES! Selective whitelisting is possible and recommended**

**How it works:**
1. Install tools in builder stage
2. Copy ONLY whitelisted binaries to final image
3. Don't copy Python, curl, shells, etc.
4. Result: Users can only use whitelisted tools

**Benefits:**
- 🎯 **Precise control** - Choose exactly which tools are available
- 🔒 **Security** - Block bypass vectors (Python, curl)
- ⚡ **Functionality** - Users can still process media
- 📦 **Flexibility** - Different images for different use cases

**Common whitelists:**
- Media processing: ffmpeg, imagemagick, ghostscript
- Data processing: jq, sed, awk (use with caution)
- Format conversion: pandoc, wkhtmltopdf

**Never whitelist:**
- Network tools: curl, wget, nc
- Shells: sh, bash
- Runtimes: python, ruby, perl
- Package managers: npm, pip, apk

🎉 **You get the best of both worlds: functionality + security!**
