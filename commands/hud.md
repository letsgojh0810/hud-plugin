---
name: hud
description: Show full HUD dashboard (tokens, cost, git)
---

Execute the HUD dashboard script and display the results.

Run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/stop-hud.mjs"
```

Parse the JSON output and display the `message` field in a code block.

Show:
1. Token usage with progress bar
2. Cost breakdown (input / output / cache read / cache write / total)
3. Git branch and changed files
4. Recent commits
