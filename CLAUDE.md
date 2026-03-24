# claude-hud — Project Brief for Claude Code

## 프로젝트 정의

Claude Code 사용 중 터미널을 떠나지 않고 프로젝트 상태를 확인할 수 있는 **터미널 HUD(Heads-Up Display)**. `h` 키로 토글되는 오버레이 팝업 + 항상 보이는 1줄 status bar 조합.

### 핵심 페인포인트
- Claude Code에서 작업 중 프로젝트 구조 확인하려면 IntelliJ를 따로 켜야 함
- 토큰 사용량/잔여량을 실시간으로 파악할 방법이 부족함
- Git 상태 확인하려고 별도 터미널 탭을 열어야 함
- 이 모든 걸 CLI를 떠나지 않고 해결하고 싶음

### 타겟 사용자
- Claude Code를 일상적으로 쓰는 개발자
- 터미널 중심 워크플로우를 선호하는 개발자
- 토큰 비용에 민감한 API 사용자 및 Max/Pro 구독자

---

## 확정된 설계 결정

### UI 구조: 토글 팝업 + 상시 Status Bar

**Status Bar (항상 보임, 하단 1줄)**
```
◆ HUD │ tok 48.2K/200K OK │ $0.0342 │ ⎇ feature/auth-v2 +5 -1 │ files 127 │ ☀ light │ h toggle
```
- 토큰 사용량/잔여량 + 상태 (OK/MID/LOW)
- 세션 비용 ($)
- Git 브랜치 + 변경파일 수
- 총 파일 수
- 다크/라이트 모드 토글
- `h`로 풀 HUD 열기

**HUD 오버레이 (h 토글, 65vh)**
3개 탭:
1. **TOKENS** — 컨텍스트 윈도우 게이지 (█░ 프로그레스바), input/output/cache-read/cache-write 분류 (█░ 막대), 비용 breakdown (숫자), 처리량 sparkline (▁▂▃▄▅▆▇█), 모델 정보 (숫자)
2. **PROJECT** — 상단 요약 한 줄 (files/packages/endpoints + 레이어별 숫자), 패키지 트리 (├─ └─ 텍스트), 엔드포인트 요약 (GET 22 POST 18 등 한 줄), 알림
3. **GIT** — 브랜치 상태 (숫자), 변경 파일 목록 (MOD/ADD/DEL), diff 시각화 (파일별 +/- 막대 — 시각화 유용), 최근 커밋

**UI 원칙:**
- 시각화가 의미 있는 곳(토큰 게이지, sparkline, git diff 막대)만 █░ 블록 사용
- 숫자로 충분한 곳(레이어 분포, 엔드포인트 통계, 모델 정보)은 숫자만
- 뱃지/태그 같은 장식 최소화. 과하지 않게. 깔끔하게.

**키보드 단축키:**
- `1`, `2`, `3` — 탭 전환
- `d` — 다크/라이트 모드 전환
- `j`/`k` — 스크롤
- `q` — 종료

> 토글 없음. 항상 실행 상태. 별도 터미널 창 또는 tmux split pane에서 실행.

### 컬러 시스템: 토스 블루 기반 (#3182F6)

다크/라이트 모드 각각 최적화. 깔끔한 핀테크 스타일.

**다크 모드:**
```
bg:            #0E1117
bgElevated:    #161B22
bgPanel:       #1C2128
border:        #30363D
brand:         #3182F6    (토스 블루)
brandFaint:    rgba(49,130,246,0.12)
text:          #E6EDF3
textSecondary: #8B949E
textTertiary:  #6E7681
green:         #3FB950
yellow:        #D29922
red:           #F85149
purple:        #A371F7
cyan:          #58A6FF
```

**라이트 모드:**
```
bg:            #FFFFFF
bgElevated:    #F6F8FA
bgPanel:       #F6F8FA
border:        #D8DEE4
brand:         #3182F6    (동일)
text:          #1F2328
textSecondary: #656D76
textTertiary:  #8C959F
green:         #1A7F37
yellow:        #9A6700
red:           #CF222E
purple:        #8250DF
cyan:          #0969DA
```

**폰트:**
- UI: Pretendard, SF Pro Display, -apple-system
- 코드/숫자: SF Mono, JetBrains Mono, Fira Code

---

## 기술 스택

### 핵심 프레임워크
- **Ink** (React for CLI) — TUI 렌더링. JSX → stdout. Flexbox 레이아웃.
- **@inkjs/ui** — 프리빌트 컴포넌트
- **TypeScript**

### 데이터 수집
- **토큰**: `~/.claude/projects/<hash>/sessions/` JSONL 파싱. chokidar 실시간 감시. 참고: ccusage, Claude-Code-Usage-Monitor
- **Git**: simple-git. branch/status/diffSummary/log. 3-5초 폴링.
- **프로젝트**: fast-glob → package 파싱 → 어노테이션 분류. 1회 스캔 후 캐싱.

### 의존성
```json
{
  "dependencies": {
    "ink": "^5.0.0",
    "react": "^18.0.0",
    "@inkjs/ui": "^2.0.0",
    "simple-git": "^3.25.0",
    "fast-glob": "^3.3.0",
    "chokidar": "^3.6.0",
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "@types/react": "^18.0.0",
    "typescript": "^5.5.0"
  }
}
```

---

## 프로젝트 구조

핵심 로직은 `packages/core`, 플러그인 래퍼는 `plugins/claude-code`에 분리.

```
claude-hud/
├── packages/
│   └── core/                        # 순수 로직 (플랫폼 무관)
│       ├── src/
│       │   ├── token-parser.ts
│       │   ├── cost-calculator.ts
│       │   ├── git-data.ts
│       │   ├── project-scanner.ts
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
│
├── plugins/
│   └── claude-code/                 # Claude Code 플러그인
│       ├── .claude-plugin/
│       │   └── plugin.json
│       ├── commands/
│       │   └── hud.md
│       ├── hooks/
│       │   ├── session-start.js
│       │   ├── stop.js
│       │   └── pre-tool-use.js
│       ├── skills/
│       │   ├── hud-dashboard.md
│       │   └── project-anatomy.md
│       └── agents/
│           └── project-analyzer.md
│
├── .claude-plugin/
│   └── marketplace.json
│
├── tui/                             # TUI 앱 (Ink)
│   ├── src/
│   │   ├── cli.tsx
│   │   ├── App.tsx
│   │   ├── theme.ts                 # 다크/라이트 팔레트
│   │   ├── components/
│   │   │   ├── StatusBar.tsx
│   │   │   ├── HudOverlay.tsx
│   │   │   ├── TokenPanel.tsx
│   │   │   ├── ProjectPanel.tsx
│   │   │   ├── GitPanel.tsx
│   │   │   ├── Bar.tsx
│   │   │   └── Sparkline.tsx
│   │   └── hooks/
│   │       ├── useTokenData.ts
│   │       ├── useGitData.ts
│   │       └── useProjectTree.ts
│   ├── package.json
│   └── tsconfig.json
│
├── package.json                     # 루트 (workspaces)
├── README.md
└── LICENSE
```

---

## 내부 엔진 — 참고 패턴

### OMC 참고
- 스마트 모델 라우팅 (Haiku/Opus 자동 분기 → 30-50% 절약)
- 스킬 auto-inject (trigger 키워드 기반, 필요한 것만 로드)
- 실행 레이어 구조 (Execution → Enhancement → Guarantee)

### OpenWolf 참고
- 프로젝트 anatomy (파일별 한 줄 요약 + 토큰 추정치)
- PreToolUse 훅 (파일 Read 전 설명 제공 → ~80% 토큰 절감)
- cerebrum.md (교정 사항 누적)

### claude-hud 적용
1. 프로젝트 anatomy 자동 생성 → HUD에 표시 + export
2. 컨텍스트 사용 시각화 → 어떤 파일이 로드되었는지 표시
3. 스마트 연관 파일 제안 → Controller ↔ Service ↔ Repository 자동 탐지

---

## 개발 로드맵

### Phase 1: MVP (1일)
1. monorepo 셋업
2. packages/core — 토큰 파서, Git 래퍼, 프로젝트 스캐너
3. tui/ — StatusBar + HudOverlay + 3탭
4. theme.ts — 다크/라이트 팔레트
5. 실시간 갱신 (chokidar, 폴링)

### Phase 2: 내부 엔진
- 프로젝트 anatomy 생성
- 컨텍스트 시각화
- 연관 파일 탐지
- PreToolUse 훅

### Phase 3: 플러그인 배포
- marketplace.json, plugin.json
- hooks (SessionStart, Stop, PreToolUse)
- /hud 커맨드
- GitHub push → `/plugin marketplace add`

### Phase 4: 커뮤니티
- README (GIF 데모, 영문)
- GitHub Actions CI
- Reddit, X 홍보
- Codex/Gemini CLI 래퍼 추가

---

## 배포

### Claude Code 플러그인 (확정)
```
/plugin marketplace add <username>/claude-hud
/plugin install claude-hud
```

### npx 병행
```bash
npx claude-hud
```

### 크로스 플랫폼 (나중에)
```
plugins/
├── claude-code/     # 확정
├── codex/           # 나중에
└── gemini/          # 나중에
```

---

## package.json

**루트:**
```json
{ "name": "claude-hud-monorepo", "private": true, "workspaces": ["packages/*", "tui"] }
```

**tui/package.json:**
```json
{
  "name": "claude-hud",
  "version": "0.1.0",
  "description": "Terminal HUD for Claude Code",
  "type": "module",
  "bin": { "claude-hud": "./dist/cli.js" },
  "scripts": { "build": "tsc", "dev": "tsc --watch", "prepublishOnly": "npm run build" },
  "keywords": ["claude", "claude-code", "hud", "tui", "terminal", "dashboard", "token"],
  "license": "MIT",
  "files": ["dist"]
}
```

---

## Ink 전환 참고

- `<div>` → `<Box>`, `<span>` → `<Text>`
- CSS flexbox → Ink Box props (flexDirection, justifyContent)
- useState, useEffect 그대로 사용
- `useInput` (Ink)으로 키보드 처리
- `useStdoutDimensions()`로 터미널 크기 감지
- 색상: `<Text color="#3182F6">` hex 직접 지정
- █░▁▂▃▄▅▆▇█ 블록 문자 터미널에서 그대로 렌더링

---

## 첫 번째 명령어

```bash
mkdir claude-hud && cd claude-hud
npm init -y
mkdir -p packages/core/src tui/src plugins/claude-code/.claude-plugin
mkdir -p plugins/claude-code/{commands,hooks,skills,agents} .claude-plugin

cd tui
npx create-ink-app --typescript
npm install simple-git fast-glob chokidar js-yaml
cd ..

cd packages/core && npm init -y && cd ../..
```

구현 순서: core → theme.ts → StatusBar → TokenPanel → ProjectPanel → GitPanel → hooks → plugin.json → marketplace.json → GitHub push

---

## 개발자 정보

- Java/Spring 백엔드, TypeScript/React 가능. 은행 파견 근무 중.
- 배포: Claude Code 플러그인 + npx 병행
- 컬러: 토스 블루 #3182F6, 다크/라이트 모드
- UI: 시각화는 의미 있는 곳만. 나머지 숫자. 과하지 않게.
- 참고: omc, OpenWolf 내부 패턴. HUD 시각성 + 실용성이 차별점.
