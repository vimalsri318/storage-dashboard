#!/bin/zsh
# Double-click to open the Storage dashboard (starts the server if it isn't running).
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if curl -s --max-time 1 http://127.0.0.1:4747/api/status >/dev/null; then
  open http://127.0.0.1:4747
else
  echo "Starting Storage dashboard… (close this window to stop it)"
  node server.js --open
fi
