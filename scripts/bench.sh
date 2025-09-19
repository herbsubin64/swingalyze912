#!/usr/bin/env bash
set -euo pipefail
file="${1:-}"
if [[ -z "$file" || ! -f "$file" ]]; then
  echo "Usage: $0 uploads/<file>.mp4" >&2
  exit 1
fi
python3 analyzer_pose.py "$file" | tee .bench.json
if command -v jq >/dev/null 2>&1; then
  echo "— TEMPO —" && jq '.tempo' .bench.json
  echo "— POSE  —" && jq '.pose'  .bench.json
fi
