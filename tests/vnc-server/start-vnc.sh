#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  jobs -pr | xargs -r kill || true
}
trap cleanup EXIT

Xvfb :1 -screen 0 1280x720x24 &
for _ in $(seq 1 50); do
  if [[ -S /tmp/.X11-unix/X1 ]]; then
    break
  fi
  sleep 0.1
done

if [[ ! -S /tmp/.X11-unix/X1 ]]; then
  echo "Xvfb did not start in time"
  exit 1
fi

export DISPLAY=:1
fluxbox -display :1 &
xterm -geometry 80x24+10+10 -e 'echo "Welcome to react-vnc tests!"; bash' &
x11vnc -display :1 -rfbport 5900 -forever -shared -nopw -xkb -quiet &
websockify 6080 localhost:5900 &

wait -n
