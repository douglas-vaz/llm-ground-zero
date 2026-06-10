#!/usr/bin/env bash
# Launch the llm-ground-zero dashboard (default http://localhost:7788).
cd "$(dirname "${BASH_SOURCE[0]}")" && exec python3 server.py "${1:-7788}"
