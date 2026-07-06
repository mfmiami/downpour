#!/usr/bin/env bash
# Back-compat wrapper — use scripts/sync-safari.sh
exec "$(cd "$(dirname "$0")" && pwd)/scripts/sync-safari.sh" "$@"