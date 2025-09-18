# Swingalyze — fast local runners mirroring CI (no node_modules needed)

# Usage:
#   make                 # run-all (skips live if env missing)
#   make smoke           # static/UI checks only
#   make live            # live compare + load test (requires env)
#   make serve           # serve /public on 0.0.0.0:3000 for Codespaces
#   make serve3001       # serve /public on 3001 if 3000 is busy
#   make dev-analyzer    # start stub analyzer on 0.0.0.0:3001 (CORS on)
#   ANALYZE_URL=... ANALYZE_VIDEO=clip.mp4 make harvest NAME=edge-field-01

SHELL := /bin/bash

.PHONY: all run-all smoke live contract bounds ranges coaching ui-signatures status compare load harvest serve serve3001 dev-analyzer

all: run-all

run-all:
	@node scripts/run-all.mjs

smoke: contract bounds ranges coaching ui-signatures
	@echo "🎉 Static smoke complete."

contract:
	@bash -lc 'set -e; for f in fixtures/*.golden.json; do echo "Contract: $$f"; node scripts/verify-analyze-shape.mjs "$$f"; done'

bounds:
	@node scripts/validate-metrics-bounds.mjs

ranges:
	@node scripts/validate-ranges-vs-bounds.mjs && node scripts/validate-ranges.mjs

coaching:
	@node scripts/test-coaching-normalization.mjs
	@node scripts/smoke-static.mjs

ui-signatures:
	@node scripts/smoke-ui-signatures.mjs

status:
	@[ -n "$$ANALYZE_URL" ] || { echo "SKIP status (set ANALYZE_URL)"; exit 0; }
	@node scripts/check-status.mjs

compare:
	@[ -n "$$ANALYZE_URL" ] && [ -n "$$ANALYZE_VIDEO" ] || { echo "SKIP compare (set ANALYZE_URL and ANALYZE_VIDEO)"; exit 0; }
	@node scripts/compare-to-golden.mjs

load:
	@[ -n "$$ANALYZE_URL" ] && [ -n "$$ANALYZE_VIDEO" ] || { echo "SKIP load (set ANALYZE_URL and ANALYZE_VIDEO)"; exit 0; }
	@node scripts/load-test.mjs 5 1

live: status compare load
	@echo "✅ Live checks done (status/compare/load)."

# Harvest a new golden: make harvest NAME=edge-sample
harvest:
	@[ -n "$$ANALYZE_URL" ] && [ -n "$$ANALYZE_VIDEO" ] && [ -n "$$NAME" ] || { echo "Usage: ANALYZE_URL=... ANALYZE_VIDEO=clip.mp4 make harvest NAME=<name>"; exit 2; }
	@node scripts/harvest-golden.mjs "$$NAME"
	@node scripts/verify-analyze-shape.mjs "fixtures/$$NAME.golden.json"
	@git add "fixtures/$$NAME.golden.json" && git commit -m "Goldens: add $$NAME" && git push

# Serve the static UI (Codespaces-friendly: binds 0.0.0.0)
serve:
	@cd public && python3 -m http.server 3000 --bind 0.0.0.0

serve3001:
	@cd public && python3 -m http.server 3001 --bind 0.0.0.0

# Dev analyzer stub (CORS enabled)
dev-analyzer:
	@node scripts/dev-analyzer.mjs
