---
name: hud
description: Show HUD status — token usage, git info, 5h/7d usage percentages
---

Run the following and display output in a code block:

```bash
node -e "
import('${CLAUDE_PLUGIN_ROOT}/scripts/lib/token-reader.mjs').then(async ({ readTokenUsage }) => {
  const { readGitInfo } = await import('${CLAUDE_PLUGIN_ROOT}/scripts/lib/git-info.mjs');
  const { getUsage } = await import('${CLAUDE_PLUGIN_ROOT}/scripts/lib/usage-api.mjs');

  const usage = readTokenUsage();
  const git = readGitInfo(process.cwd());
  const limits = await getUsage();

  const ctxPct = Math.round(usage.totalTokens / usage.contextWindow * 100);
  const model = usage.model.replace('claude-', '').replace(/-202\d+(-\d+)?$/, '');

  console.log('◆ HUD  ─  ' + model);
  console.log('');
  console.log('Context  ' + ctxPct + '%  (' + Math.round(usage.totalTokens/1000) + 'K / ' + Math.round(usage.contextWindow/1000) + 'K)');
  if (limits) {
    console.log('5h usage ' + limits.fiveHourPercent.toFixed(1) + '%');
    console.log('wk usage ' + limits.weeklyPercent.toFixed(1) + '%');
  }
  console.log('');
  console.log('Branch   ' + git.branch + (git.ahead ? ' +' + git.ahead : '') + (git.behind ? ' -' + git.behind : ''));
  if (git.totalChanges > 0) {
    const changes = [...git.modified.map(f => 'M ' + f), ...git.added.map(f => 'A ' + f), ...git.deleted.map(f => 'D ' + f)].slice(0, 5);
    changes.forEach(c => console.log('         ' + c));
  }
  console.log('');
  console.log('TUI → run in separate terminal: npx claude-code-hud');
});
"
```

Display the output exactly as-is.
