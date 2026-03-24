---
name: hud
description: Show full HUD dashboard — token usage, cost breakdown, git status. Trigger with /hud.
triggers:
  - "/hud"
  - "hud 보여줘"
  - "토큰 얼마나 썼어"
  - "show hud"
  - "hud status"
---

Run this Node.js script inline and show the result as a formatted dashboard:

```javascript
// Read token usage from ~/.claude/projects JSONL
import { readTokenUsage } from '${CLAUDE_PLUGIN_ROOT}/scripts/lib/token-reader.mjs';
import { readGitInfo } from '${CLAUDE_PLUGIN_ROOT}/scripts/lib/git-info.mjs';
import { tokenPanel, gitPanel, divider } from '${CLAUDE_PLUGIN_ROOT}/scripts/lib/formatter.mjs';
```

When the user invokes /hud, execute the following shell command and show the output:

```
node -e "
import('${CLAUDE_PLUGIN_ROOT}/scripts/lib/token-reader.mjs').then(async ({ readTokenUsage }) => {
  const { readGitInfo } = await import('${CLAUDE_PLUGIN_ROOT}/scripts/lib/git-info.mjs');
  const { tokenPanel, gitPanel, divider, fmtCost } = await import('${CLAUDE_PLUGIN_ROOT}/scripts/lib/formatter.mjs');
  const usage = readTokenUsage();
  const git = readGitInfo(process.cwd());
  const D = divider(54);
  console.log('◆ HUD  —  Full Dashboard');
  console.log(D);
  console.log('');
  console.log('[TOKENS]');
  console.log(tokenPanel(usage));
  console.log('');
  console.log('[GIT]');
  console.log(gitPanel(git));
  console.log('');
  console.log(D);
});
"
```

Display the output in a code block with no modification. If the script fails, show the error and suggest running \`/plugin install jhhan/hud-plugin\` to reinstall.
