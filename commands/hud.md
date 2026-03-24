---
name: hud
description: Show full HUD dashboard (tokens, cost, git)
---

Execute the full HUD dashboard script and display the output directly in a code block.

Run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/full-hud.mjs"
```

Display the full stdout output as-is in a code block. Do not summarize or modify it.

The output includes:
1. Context window progress bar + percentage
2. Token breakdown (input / output / cache-read / cache-write) with bars and costs
3. Total session cost
4. Git branch, changed files (MOD/ADD/DEL)
5. Recent commits with hash, message, and time
