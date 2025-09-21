#!/usr/bin/env bash
set -euo pipefail
file="${1:-}"
h="${2:-}"  # optional horizon deg
if [[ -z "$file" || ! -f "$file" ]]; then
  echo "Usage: $0 uploads/<file>.mp4 [--horizon <deg>]" >&2
  exit 1
fi
if [[ -n "${h}" ]]; then
  python3 analyzer_pose.py "$file" --horizon="${h}" | tee .bench.json
else
  python3 analyzer_pose.py "$file" | tee .bench.json
fi
if command -v jq >/dev/null 2>&1; then
  echo "— TEMPO —" && jq '.tempo' .bench.json
  echo "— POSE  —" && jq '.pose'  .bench.json
fi
