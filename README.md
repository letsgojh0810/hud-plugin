# claude-code-hud

[한국어](#한국어) | [English](#english)

---

## 한국어

Claude Code를 CLI로만 작업하다 보면 불편한 게 있습니다. 토큰이 얼마나 남았는지, 지금 Git 상태가 어떤지, 이 파일 구조가 어떻게 생겼는지 확인하려면 IDE를 따로 켜거나 터미널 탭을 여러 개 열어야 했습니다.

그래서 만들었습니다. 터미널 두 개만 띄우면 됩니다. 하나는 Claude Code, 하나는 HUD. 나머지는 필요 없습니다.

Claude Code 작업 중 터미널을 떠나지 않고 토큰 사용량, Git 상태, 프로젝트 파일을 실시간으로 확인할 수 있는 터미널 HUD입니다.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ◆  HUD  [1 TOKENS] 2 PROJECT  3 GIT                    sonnet-4-6  ·  up 4m  │
├──────────────────────────────────────────────────────────────────────────────┤
│ CONTEXT WINDOW                                                               │
│ ████████████████████░░░░░░░░░░░░░░░░░░░░░░░  46%  92K / 200K  OK             │
├──────────────────────────────────────────────────────────────────────────────┤
│ USAGE WINDOW  (Anthropic API)                                                │
│ 5h ████████░░░░░░░░░░░░░░░░░░░░  28.0%  resets in 3h                         │
│ wk ███░░░░░░░░░░░░░░░░░░░░░░░░░   9.0%  resets in 148h                       │
├──────────────────────────────────────────────────────────────────────────────┤
│ TOKENS  (this session)                                                       │
│ input         ░░░░░░░░░░░░░░░░░░░░░░░░    4.8K   0%                          │
│ output        ░░░░░░░░░░░░░░░░░░░░░░░░  188.5K   0%                          │
│ cache-read    ████████████████████████   51.5M 100%                          │
│ cache-write   ██░░░░░░░░░░░░░░░░░░░░░░    3.8M   7%                          │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 사용법

터미널 두 개를 열고 같은 프로젝트 디렉토리에서 실행하면 됩니다.

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

### 설치

```bash
# 설치 없이 바로 실행
npx claude-code-hud

# 전역 설치
npm install -g claude-code-hud
claude-hud

# Claude Code 플러그인
/plugin install letsgojh0810/hud-plugin
```

### 기능

**1 TOKENS 탭**
- 컨텍스트 윈도우 사용량 게이지 (OK / MID / WARN)
- Anthropic API 기반 5h / 주간 사용률 (실제 값, 추정치 아님)
- input / output / cache-read / cache-write 토큰 분류
- 최근 12시간 output 토큰 sparkline

**2 PROJECT 탭 — 인터랙티브 파일 브라우저**
- 디렉토리 트리 (펼치기/접기)
- 파일 선택 시 소스 코드 뷰어 (split 패널)
- 패키지 의존성 트리
- API 엔드포인트 감지

```
TREE                            │ SOURCE  src/index.ts
▼ src/            23f           │  1  import React from 'react'
  ▼ components/    8f           │  2  import { render } from 'ink'
    Header.tsx   ◀ open         │  3
  ▶ hooks/         4f           │  4  render(<App />)
▶ scripts/         6f           │  …  [j/k] scroll  [esc] close
```

**3 GIT 탭**
- 현재 브랜치, ahead/behind 카운트
- 변경 파일 목록 (MOD / ADD / DEL)
- 파일별 diff 시각화 (+/- 바)
- 최근 커밋 히스토리

### 키보드 단축키

| 키 | 동작 |
|----|------|
| `1` `2` `3` | 탭 전환 |
| `j` / `k` | 스크롤 / 트리 이동 |
| `→` / `Enter` | 디렉토리 펼치기 / 파일 열기 |
| `←` / `Esc` | 접기 / 소스 뷰어 닫기 |
| `d` | 다크 / 라이트 모드 전환 |
| `r` | 수동 새로고침 |
| `q` | 종료 |

### 요구사항

- Node.js 18+
- Claude Code 설치 및 로그인 (토큰 데이터 수집)
- Claude Pro / Max 플랜 권장 (5h / 주간 사용률 표시)
- Git (GIT 탭 사용 시)

---

## English

When working with Claude Code in the terminal, I kept running into the same friction: how many tokens are left? what's the git status? what does this file structure look like? — answering any of these meant switching to another app or opening more terminal tabs.

So I built this. Two terminals. One for Claude Code, one for the HUD. That's it.

A Terminal HUD (Heads-Up Display) for Claude Code — real-time token usage, git status, and interactive project file browser in a separate terminal window or tmux pane.

### Usage

Open two terminals in the same project directory.

```
Terminal A                       Terminal B
─────────────────────────────    ─────────────────────────────
cd ~/my-project                  cd ~/my-project
claude                           npx claude-code-hud
(working with Claude Code)       (HUD live display)
```

The HUD automatically detects your current directory and shows token, git, and project info for that project.

```bash
# tmux split pane
cd ~/my-project
tmux split-window -h "npx claude-code-hud"
```

### Installation

```bash
# No install — run directly
npx claude-code-hud

# Global install
npm install -g claude-code-hud
claude-hud

# Claude Code plugin
/plugin install letsgojh0810/hud-plugin
```

### Features

**1 TOKENS tab**
- Context window usage gauge (OK / MID / WARN)
- Real 5h / weekly usage from Anthropic OAuth API — not estimates
- Input / output / cache-read / cache-write breakdown
- Output tokens sparkline over the last 12 hours

**2 PROJECT tab — interactive file browser**
- Navigable directory tree with expand/collapse
- Source file viewer in a split panel
- Package dependency tree from `package.json`
- API endpoint detection (GET / POST / PUT / DELETE / PATCH)

**3 GIT tab**
- Branch status, ahead/behind remote
- Changed file list (MOD / ADD / DEL) with real `+N -N` diff counts
- Recent commit history

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `1` `2` `3` | Switch tabs |
| `j` / `k` | Scroll / move tree cursor |
| `→` / `Enter` | Expand dir / open file |
| `←` / `Esc` | Collapse / close source viewer |
| `d` | Toggle dark / light mode |
| `r` | Manual refresh |
| `q` | Quit |

### Requirements

- Node.js 18+
- Claude Code installed and authenticated
- Claude Pro or Max plan recommended (for real 5h / weekly usage %)
- Git (optional, for GIT tab)

### How it works

- **Token data**: Watches `~/.claude/projects/*/sessions/*.jsonl` with chokidar — updates instantly on each Claude response
- **Usage window**: Calls `api.anthropic.com/api/oauth/usage` using local Claude credentials — cached 5 min
- **Git**: Polls every 3 seconds
- **Project scan**: One-time fast-glob scan on startup, `r` to rescan

---

MIT — [letsgojh0810](https://github.com/letsgojh0810)
