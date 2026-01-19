#!/bin/bash
# Initialize containerd to ensure it's running properly
# This fixes the "dial unix:///var/run/docker/containerd/containerd.sock: timeout" error

set -e

echo "Checking containerd status..."

# Check if containerd socket exists
if [ ! -S /var/run/docker/containerd/containerd.sock ]; then
    echo "Containerd socket not found, restarting containerd..."

    # Kill any existing containerd processes
    sudo pkill -9 containerd 2>/dev/null || true

    # Wait a moment
    sleep 1

    # Start containerd with the Docker-managed config
    if [ -f /var/run/docker/containerd/containerd.toml ]; then
        echo "Starting containerd..."
        sudo nohup containerd --config /var/run/docker/containerd/containerd.toml > /tmp/containerd.log 2>&1 &

        # Wait for socket to be created (up to 2 minutes during system bootup)
        echo "Waiting for containerd socket to be created..."
        for i in {1..120}; do
            if [ -S /var/run/docker/containerd/containerd.sock ]; then
                echo "Containerd socket created successfully (after ${i}s)"
                break
            fi
            if [ $((i % 10)) -eq 0 ]; then
                echo "Still waiting for containerd socket... (${i}/120s)"
            fi
            sleep 1
        done

        if [ ! -S /var/run/docker/containerd/containerd.sock ]; then
            echo "ERROR: Containerd socket was not created after 120 seconds"
            echo "Containerd logs:"
            cat /tmp/containerd.log 2>/dev/null || echo "No logs available"
            exit 1
        fi
    else
        echo "ERROR: Containerd config not found at /var/run/docker/containerd/containerd.toml"
        exit 1
    fi
else
    echo "Containerd is already running"
fi

# Test Docker connectivity
if docker info > /dev/null 2>&1; then
    echo "Docker and containerd are working correctly"
else
    echo "WARNING: Docker cannot connect to containerd"
    exit 1
fi
