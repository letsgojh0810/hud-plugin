# claude-code-hud

A Terminal HUD (Heads-Up Display) for Claude Code — real-time token usage, git status, and interactive project file browser in a separate terminal window or tmux pane.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ◆  HUD  [1 TOKENS] 2 PROJECT  3 GIT                    sonnet-4-6  ·  up 4m │
├──────────────────────────────────────────────────────────────────────────────┤
│ CONTEXT WINDOW                                                                │
│ ████████████████████░░░░░░░░░░░░░░░░░░░░░░░  46%  92K / 200K  OK             │
├──────────────────────────────────────────────────────────────────────────────┤
│ USAGE WINDOW  (Anthropic API)                                                 │
│ 5h ████████░░░░░░░░░░░░░░░░░░░░  28.0%  resets in 3h                         │
│ wk ███░░░░░░░░░░░░░░░░░░░░░░░░░   9.0%  resets in 148h                       │
├──────────────────────────────────────────────────────────────────────────────┤
│ TOKENS  (this session)                                                        │
│ input         ░░░░░░░░░░░░░░░░░░░░░░░░    4.8K   0%                          │
│ output        ░░░░░░░░░░░░░░░░░░░░░░░░  188.5K   0%                          │
│ cache-read    ████████████████████████   51.5M 100%                          │
│ cache-write   ██░░░░░░░░░░░░░░░░░░░░░░    3.8M   7%                          │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Features

### 1 TOKENS tab
- Context window usage gauge with percentage (OK / MID / WARN)
- **5h and weekly usage** from Anthropic OAuth API — real percentages, not estimates
- Input / output / cache-read / cache-write token breakdown with bars
- Output tokens sparkline (▁▂▃▄▅▆▇█) over the last 12 hours
- Model name and session uptime

### 2 PROJECT tab — interactive file browser
- Directory tree with `▶`/`▼` expand/collapse
- **Source file viewer** — select any file and read its contents in a split panel
- File count per directory, extension-based color coding
- Package dependency tree from `package.json`
- API endpoint detection (GET / POST / PUT / DELETE / PATCH)

```
TREE                            │ SOURCE  src/index.ts
▼ src/            23f           │  1  import React from 'react'
  ▼ components/    8f           │  2  import { render } from 'ink'
    Header.tsx   ◀ open         │  3
  ▶ hooks/         4f           │  4  render(<App />)
▶ scripts/         6f           │  …  [j/k] scroll  [esc] close
```

### 3 GIT tab
- Current branch, ahead/behind remote counts
- Changed file list (MOD / ADD / DEL)
- Per-file diff visualization with real `+N -N` line counts
- Recent commit history with hash, message, and relative time

---

## Installation

### Option 1 — npx (no install required)

```bash
npx claude-code-hud
```

### Option 2 — npm global install

```bash
npm install -g claude-code-hud
claude-hud
```

### Option 3 — Claude Code Plugin

```bash
/plugin install letsgojh0810/hud-plugin
```

---

## Usage

터미널 두 개를 열고, 같은 프로젝트 디렉토리에서 실행하면 됩니다.

```
터미널 A                         터미널 B
─────────────────────────────    ─────────────────────────────
cd ~/my-project                  cd ~/my-project
claude                           npx claude-code-hud
(Claude Code 작업 중...)          (HUD 실시간 표시)
```

HUD는 현재 디렉토리를 기준으로 토큰, git, 프로젝트 정보를 자동으로 인식합니다.

```bash
# tmux로 한 화면에서 split
cd ~/my-project
tmux split-window -h "npx claude-code-hud"
```

---

## Keyboard Shortcuts

### Global

| Key     | Action                   |
|---------|--------------------------|
| `1`     | Switch to TOKENS tab     |
| `2`     | Switch to PROJECT tab    |
| `3`     | Switch to GIT tab        |
| `d`     | Toggle dark / light mode |
| `r`     | Manual refresh           |
| `q`     | Quit                     |

### TOKENS / GIT tab

| Key     | Action       |
|---------|--------------|
| `j` / `↓` | Scroll down |
| `k` / `↑` | Scroll up   |

### PROJECT tab — file browser

| Key          | Action                        |
|--------------|-------------------------------|
| `j` / `↓`   | Move cursor down              |
| `k` / `↑`   | Move cursor up                |
| `→` / `Enter`| Expand directory              |
| `←`          | Collapse directory / close viewer |
| `Enter` on file | Open source viewer        |
| `Esc`        | Close source viewer           |
| `j` / `k`   | Scroll source (when open)     |

---

## Requirements

- **Node.js 18+**
- **Claude Code** installed and authenticated (for token data)
- **Claude Pro or Max plan** recommended — enables real 5h/weekly usage % from Anthropic API
- Git (optional, for GIT tab)

---

## Environment Variables

| Variable              | Default         | Description                              |
|-----------------------|-----------------|------------------------------------------|
| `CLAUDE_PROJECT_ROOT` | `process.cwd()` | Project root directory to monitor        |

---

## How it works

- **Token data**: Watches `~/.claude/projects/*/sessions/*.jsonl` with chokidar — updates instantly when Claude responds
- **Usage window**: Calls `api.anthropic.com/api/oauth/usage` with your local Claude credentials (same as Claude Code uses) — cached 5 min
- **Git status**: Polls git every 3 seconds
- **Project scan**: One-time fast-glob scan on startup, `r` to rescan

---

## Color Theme

Toss Blue (`#3182F6`) based palette. Full dark and light mode — toggle with `d`.

---

## Development

```bash
git clone https://github.com/letsgojh0810/hud-plugin.git
cd hud-plugin
npm install
npm run hud
```

---

## License

MIT — [letsgojh0810](https://github.com/letsgojh0810)
