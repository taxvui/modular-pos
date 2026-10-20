#!/usr/bin/env bash
set -euo pipefail

# Install Graphify for this repository (Python 3.10+ required).
if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi

export PATH="$HOME/.local/bin:$PATH"
uv tool install 'graphifyy[sql]==0.9.93'

graphify --version
graphify extract . --code-only --max-workers 2
graphify cluster-only . --no-label
graphify hook install
graphify hook status

cat <<'EOF'

Graphify setup complete.
To keep the graph updated while editing, run this in a separate terminal:
  graphify watch .
Stop the watcher with Ctrl+C.
EOF
