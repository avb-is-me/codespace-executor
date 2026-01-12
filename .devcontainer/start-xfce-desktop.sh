#!/bin/bash
# XFCE Desktop Startup Script
# This script can be used to manually start the XFCE desktop container
# The container is normally started automatically via boot-up-services.ts

set -e

CONTAINER_NAME="${XFCE_CONTAINER_NAME:-xfce-desktop}"
WEB_PORT="${XFCE_WEB_PORT:-3001}"
VNC_PORT="${XFCE_VNC_PORT:-3002}"
IMAGE="${XFCE_IMAGE:-linuxserver/webtop:ubuntu-xfce}"
TIMEZONE="${TZ:-America/New_York}"
INSTALL_CHROME="${XFCE_INSTALL_CHROME:-false}"

echo "Starting XFCE Desktop..."
echo "  Container: $CONTAINER_NAME"
echo "  Web Port: $WEB_PORT"
echo "  VNC Port: $VNC_PORT"

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo "Error: Docker is not installed or not in PATH"
    exit 1
fi

# Stop any existing container
echo "Cleaning up existing container..."
docker stop "$CONTAINER_NAME" 2>/dev/null || true
docker rm "$CONTAINER_NAME" 2>/dev/null || true

# Pull image if needed
if ! docker images -q "$IMAGE" | grep -q .; then
    echo "Pulling image $IMAGE..."
    docker pull "$IMAGE"
fi

# Start the container
echo "Starting container..."
docker run -d \
  --name "$CONTAINER_NAME" \
  --security-opt seccomp=unconfined \
  --shm-size="2gb" \
  -e PUID="${PUID:-1000}" \
  -e PGID="${PGID:-1000}" \
  -e TZ="$TIMEZONE" \
  -e SUBFOLDER=/ \
  -e TITLE="XFCE Desktop" \
  -p "$WEB_PORT:3000" \
  -p "$VNC_PORT:3001" \
  "$IMAGE"

echo ""
echo "XFCE Desktop started successfully!"
echo "  Web access: http://localhost:$WEB_PORT"
echo "  VNC access: http://localhost:$VNC_PORT"

# Optionally install Chrome
if [ "$INSTALL_CHROME" = "true" ]; then
    echo ""
    echo "Installing Chrome in background..."
    docker exec "$CONTAINER_NAME" bash -c "
        apt-get update -qq &&
        apt-get install -y -qq wget gnupg &&
        wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - &&
        echo 'deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main' > /etc/apt/sources.list.d/google-chrome.list &&
        apt-get update -qq &&
        apt-get install -y -qq google-chrome-stable
    " &
    echo "Chrome installation started in background"
fi

echo ""
echo "To stop: docker stop $CONTAINER_NAME"
echo "To view logs: docker logs $CONTAINER_NAME"
