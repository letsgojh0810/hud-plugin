# claude-code-hud

A Terminal HUD (Heads-Up Display) for Claude Code — real-time token usage, git status, and project info in a separate terminal window or tmux pane.

```
┌────────────────────────────────────────────────────────┐
│ ◆  HUD  [1 TOKENS] 2 PROJECT  3 GIT    sonnet-4-6      │
├────────────────────────────────────────────────────────┤
│ CONTEXT WINDOW                                          │
│ ████████████████░░░░░░░░░░░  34%  67K / 200K  OK        │
├────────────────────────────────────────────────────────┤
│ USAGE WINDOW  (Anthropic API)                           │
│ 5h ████████████████░░░░  62.0%  resets in 4h            │
│ wk ████░░░░░░░░░░░░░░░░  15.0%  resets in 144h          │
├────────────────────────────────────────────────────────┤
│ INPUT   ██████░░░░░░░░░░░░░░  48.2K  $0.0145            │
│ OUTPUT  ██░░░░░░░░░░░░░░░░░░   8.1K  $0.0122            │
│ CACHE   ████████████░░░░░░░░  52.0K  $0.0047            │
│                                              $0.0314    │
└────────────────────────────────────────────────────────┘
```

---

## Features

### TOKENS tab
- Context window usage gauge (█░ progress bar) with percentage and token counts
- 5-hour and weekly usage window from Anthropic API (real %)
- Input / output / cache-read / cache-write breakdown with cost
- Processing sparkline (▁▂▃▄▅▆▇█) over recent turns
- Model name display

### PROJECT tab
- Total file count, package count, detected endpoints
- Package dependency tree (├─ └─)
- Endpoint summary (GET / POST / PUT / DELETE counts)
- Alerts and anomalies

### GIT tab
- Current branch, ahead/behind counts
- Changed file list (MOD / ADD / DEL)
- Per-file diff visualization (+/- bars)
- Recent commit history with hash, message, and time

---

## Installation

### Option 1 — Claude Code Plugin (recommended)

```bash
/plugin install letsgojh0810/hud-plugin
```

Then use the `/hud` command inside Claude Code to get a status snapshot.

### Option 2 — npx (no install required)

```bash
npx claude-code-hud
```

Runs the full interactive TUI in your current terminal. Open a separate terminal window or tmux pane first.

### Option 3 — npm global install

```bash
npm install -g claude-code-hud
claude-hud
```

---

## Usage

Run in a **separate terminal window** or **tmux split pane** while Claude Code is active in another pane:

```bash
# Separate terminal
npx claude-code-hud

# tmux split (open right pane with HUD)
tmux split-window -h "npx claude-code-hud"

# Point to a specific project directory
CLAUDE_PROJECT_ROOT=/path/to/project npx claude-code-hud
```

---

## Keyboard Shortcuts

| Key   | Action                     |
|-------|----------------------------|
| `1`   | Switch to TOKENS tab       |
| `2`   | Switch to PROJECT tab      |
| `3`   | Switch to GIT tab          |
| `j`   | Scroll down                |
| `k`   | Scroll up                  |
| `d`   | Toggle dark / light mode   |
| `q`   | Quit                       |

---

## Requirements

- **Node.js 18+**
- **Claude Code** installed and active (for token data from JSONL session files)
- **Claude Pro or Max plan** recommended for full 5h/7d usage window data from Anthropic API
- Git (for git status features)

---

## Environment Variables

| Variable              | Default     | Description                                         |
|-----------------------|-------------|-----------------------------------------------------|
| `CLAUDE_PROJECT_ROOT` | `process.cwd()` | Root directory of the project to monitor        |

---

## How it works

- **Token data**: Parses `~/.claude/projects/<hash>/sessions/*.jsonl` in real-time using chokidar file watching
- **Usage window**: Reads Anthropic API usage limits (5h / weekly) when available
- **Git status**: Polls `simple-git` every 3–5 seconds for branch, diff, and commit info
- **Project scan**: Uses `fast-glob` to scan files and detect packages/endpoints once, then caches

---

## Color Theme

Toss Blue (`#3182F6`) based palette with full dark and light mode support.

Dark mode uses `#0E1117` background. Light mode uses `#FFFFFF`.
Toggle with the `d` key at any time.

---

## Development

```bash
git clone https://github.com/letsgojh0810/hud-plugin.git
cd hud-plugin
npm install
npm run hud        # launches TUI in dev mode
```

---

## Notes for Korean users

이 플러그인은 Claude Code를 터미널에서 집중적으로 사용하는 개발자를 위해 만들어졌습니다.
토큰 사용량, Git 상태, 프로젝트 구조를 별도 터미널 창에서 실시간으로 확인할 수 있습니다.

---

## License

MIT — [letsgojh0810](https://github.com/letsgojh0810)
