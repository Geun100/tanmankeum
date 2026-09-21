# SOCAR Reference Design System

<!-- design-md:section experience -->
## 1. Experience

### Visual Theme & Atmosphere

SOCAR (쏘카) is Korea's dominant car-sharing platform, and its web surface reads exactly like the product it sells: clean, calm, gently confident — a service that wants to disappear out of the user's way the moment a car has to be reserved. The site opens on pure white, runs body text in **Pretendard** (the de-facto Korean web sans), and keeps the entire chrome in a soft cool-grey palette anchored by `#354153` for body text and `#e5e8ef` for borders. Nothing about the home page asks for attention except the action you came for: pick a time, pick a location, see a car.

The current SOCAR brand center frames the company around flexible, clear-and-bold, and expanding mobility, with "Lifetime Mobility" extending the brand beyond a single car-sharing task. Product web surfaces translate that posture into a restrained cool-grey interface and a directly observed action blue `#0078ff`. The brand center is a separate evidence surface: it loaded IBM Plex Sans KR, while the main product web used Pretendard.

What distinguishes SOCAR from other Korean transportation apps (Kakao Mobility's yellow, Tada's coral) is the **uniform 12–16px radius scale**. Search inputs round at 12px, search-row chips at 14px, content cards at 14–16px — a consistent, mid-rounded geometry that reads as friendly without tipping into consumer-app cuteness. Cards float on a single light shadow (`rgba(0,0,0,0.1) 0 4px 8px`), never the multi-layer chromatic stacks of fintech-grade UIs.

**Key characteristics:**

- Pretendard / PretendardVariable across the whole site — no custom typeface on web
- Body text in `#354153` instead of black — softens the page, signals "we are not a bank"
- Borders in `#e5e8ef` — a near-imperceptible cool grey
- Filled inputs use `#f2f3f8` background with `#b4bbcb` placeholder text
- 12px / 14px / 16px radius scale — consistent mid-roundness, no pill buttons in primary chrome
- Single-layer black shadows (`rgba(0,0,0,0.1) 0 4px 8px`) — restrained, never chromatic
- H1 26px / 700, H2 22px / 700, H3 16px / 600 — a tight, almost mobile-first heading scale even on desktop
- Footer in `#f5f5f5` — the only off-white surface; everything else is pure white
- SOCAR Blue reserved for the brand symbol and primary CTAs; web chrome itself is intentionally achromatic

### Principles

1. **Service over spectacle.** The reservation form is the hero. Anything else is below it.
2. **Achromatic chrome, branded action.** Only the primary CTA carries SOCAR Blue. Everything else is `#354153` text on white.
3. **Mobile-first sizing on every surface.** Hero headings cap at 26px even on desktop.
4. **Pretendard, not a custom face.**
5. **One shadow, one radius scale.** Cards use a single soft black shadow. Radii live on the 12 / 14 / 16 ladder. No pill experiments.
6. **Body text is `#354153`, not black.**
7. **Brand vocabulary is a service contract.** Every surface should make the core value felt, not just stated.

### Do's and Don'ts

**Do**
- Set all body and heading text in cool blue-grey `#354153` on pure white `#ffffff`, never true black
- Reserve the brand action color exclusively for the primary CTA, keeping the rest of the chrome achromatic
- Keep radii on the 12 / 14 / 16px ladder — 12px for inputs/buttons, 14px for chips/tiles, 16px for content cards
- Contain cards with a single soft shadow `rgba(0,0,0,0.1) 0px 4px 8px 0px` and let it act as the border
- Cap headings at the mobile-first scale (H1 26px/700, H2 22px/700, H3 16px/600) even on desktop
- Render confirmations (매칭 확정, 정산) as a dedicated single-column screen with one primary CTA, never a toast

**Don't**
- Spread the brand action color across large background areas or general chrome
- Reuse the `#b4bbcb` placeholder/disabled grey for active text (fails WCAG AA, ~2.5:1)
- Introduce pill (9999px) or sharp-corner (0px) primary components, or multi-layer chromatic shadow stacks
- Add letter-spacing to Korean text
- Write generic error copy like "검색 결과가 없습니다" or "문제가 발생했습니다", or emoji on booking/payment/settlement surfaces

<!-- design-md:section foundations -->
## 2. Foundations

### Color Palette & Roles

**Primary (Brand)**
- Action Blue `#0078ff` — primary CTA fill, links that matter
- Pure White `#ffffff` — page background, card surface, header background

**Neutral Scale**
- Text Default `#354153` — all body text, all heading text, all nav links
- Text Secondary `#697383` — supporting copy
- Footer Grey `#f5f5f5` — footer background, the only sustained off-white
- Border Default `#e5e8ef` — card and tile borders
- Input Fill `#f2f3f8` — filled input / neutral button background
- Region Surface `#f9f9fb` — collection/list item background
- Placeholder / Disabled Text `#b4bbcb` — placeholder states, disabled button label

**Semantic slots (reasoned, not directly in source — apply sparingly)**
- Success / Confirmation: reserved for booking-success states inside the product flow
- Warning / Alert / Danger: reserved for in-app states (취소 경고, 노쇼 등); the marketing/home surfaces avoid semantic color entirely

### Motion & Easing

| Token | Value | Use |
|---|---|---|
| `motion-instant` | 0ms | Toggle states, selection commits |
| `motion-fast` | 150ms | Hover, focus, button press overlay |
| `motion-standard` | 240ms | Bottom-sheet rise, card expand, tab switch — the default |
| `motion-slow` | 360ms | Success/confirmation transition, the only screen that earns extra weight |

| Token | Curve | Use |
|---|---|---|
| `ease-enter` | `cubic-bezier(0.2, 0.0, 0.0, 1)` | Things arriving |
| `ease-exit` | `cubic-bezier(0.4, 0.0, 1, 1)` | Things leaving |
| `ease-standard` | `cubic-bezier(0.4, 0.0, 0.2, 1)` | Two-way transitions |

Card hover/press: shadow depth changes only (no translate, no scale). Under `prefers-reduced-motion: reduce`, all tokens collapse to instant.

<!-- design-md:section typography-assets -->
## 3. Typography & Assets

### Font Family
- Pretendard / PretendardVariable, loaded via CDN or self-hosted. No bespoke display face.

### Hierarchy

| Role | Size | Weight | Line Height | Color |
|------|------|--------|-------------|-------|
| H1 (hero) | 26px | 700 | 1.38 | `#354153` |
| H2 (section) | 22px | 700 | 1.36 | `#354153` |
| H3 (card title) | 16px | 600 | 1.50 | `#354153` |
| Nav link | 16px | 600 | normal | `#354153` |
| Body | 16px | 400 | normal | `#354153` |
| Button text (filled) | 14px | 600 | normal | white (active) / `#b4bbcb` (disabled) |
| Input value | 16px | 400 | normal | `#354153` |

### Principles
- Pretendard everywhere, weight 600–700 for headings, 400 for body
- Mobile-first scale — hero stays 26px even at desktop width
- Letter-spacing left at normal on Korean text
- Hierarchy separated by size and weight, never by a darker heading color

<!-- design-md:section components-states -->
## 4. Components & States

### Buttons
- **Primary CTA**: bg Action Blue `#0078ff`, text white, radius 12px, 14–16px/600, padding 12px 18px
- **Neutral/Search button**: bg `#f2f3f8`, text `#b4bbcb` when incomplete/disabled → swaps to primary treatment when valid, radius 12px, padding 12px 18px
- **Text link (nav)**: transparent bg, text `#354153`, 16px/600, no underline, no hover bg

### Cards & Containers
- **Content card**: bg white, no border, radius 16px, shadow `rgba(0,0,0,0.1) 0px 4px 8px 0px`
- **Tile / entry card**: bg white, border `1px solid #e5e8ef`, radius 14px, padding 20px
- **Chip**: bg white, border `1px solid #e5e8ef`, radius 14px, padding 0 12px, 16px/400

### Inputs
- bg white (bordered) or `#f2f3f8` (filled/borderless), radius 12–14px, text 16px/400 `#354153`, placeholder `#b4bbcb`, padding 12px 18px

### Navigation (Header)
- bg white, no bottom border (page padding does the separation), links 16px/600 `#354153`

### Footer
- bg `#f5f5f5`, text 16px/400, padding 30px

### States
| State | Treatment |
|---|---|
| Empty | One plain Korean sentence in `#354153`, one secondary action link, no illustration |
| Loading (first paint) | Skeleton blocks at `#e5e8ef` over white, exact card geometry preserved |
| Loading (submit) | Inline spinner inside the primary CTA, button width unchanged |
| Error (validation) | Inline below the field, one sentence describing what's invalid and what's valid |
| Error (server) | Banner/modal, one-sentence cause, one retry CTA |
| Success (money/confirmation events) | Dedicated single-column screen, one primary CTA ("확인"), never a toast |
| Success (small action) | Brief 3s toast, dark bg, white text, no emoji |
| Disabled | Neutral fill `#f2f3f8` + `#b4bbcb` label, geometry stable |

<!-- design-md:section layout-platforms -->
## 5. Layout & Platforms

### Spacing
Cluster at 12px / 18px / 20px / 30px (8–4 hybrid, not strict 8-multiple). Card padding 20px. Input padding 12px 18px.

### Border Radius Scale
- 12px — inputs, buttons, smallest interactive surfaces
- 14px — chips, tiles
- 16px — content cards
- No pill (9999px), no sharp-corner (0px) primary components

### Whitespace Philosophy
- Calm chrome, busy form — the densest UI (the actual task) gets the least ornament around it
- Sections separated by spacing and heading shifts, not colored bands or rules
- The shadow is the border on content cards — no double-framing

<!-- design-md:section content-locales -->
## 6. Content & Locales

### Voice & Tone
Calm Korean, short declarative sentences, zero hedging. Service-confirmation register, not marketing register. Imperative verb-form CTAs (예약하기, 확인, 찾기) — never vague English borrowings.

**Forbidden**: "혁신적인", exclamation marks on routine CTAs, emoji on transactional surfaces (신청/확정/정산), generic "오류가 발생했습니다" without a cause+action.

### Accessibility
- Body `#354153` on white ≈ 9.4:1 (AAA)
- Placeholder `#b4bbcb` on white ≈ 2.5:1 — placeholder/disabled only, never active text
- Touch targets clear 44×44px via 12px 18px padding + 14–16px line-height
- Korean as primary script, Pretendard covers full glyph set

## Application to 탄만큼

이 문서는 SOCAR 공개 웹 표면에서 역추출한 레퍼런스 디자인 시스템이다. "탄만큼"(택시팟 서비스) 프로토타입에 그대로 이식할 때:
- Action Blue `#0078ff`를 기존 `--primary`(인디고 계열) 대신 액센트로 사용 — 참가하기/팟등록/확정 등 핵심 CTA에만
- `--ink` 계열을 `#354153`으로, 배경은 순백 `#ffffff` 기본
- 카드/칩/버튼 radius를 12/14/16 스케일로 통일 (기존 20px 카드radius 등은 16px로 조정)
- 카드 테두리 대신 단일 그림자(`rgba(0,0,0,0.1) 0 4px 8px`)로 컨테인
- 헤딩 스케일을 모바일퍼스트 26/22/16으로 재조정
- 정산/확정 같은 금전·확정 이벤트는 토스트 아님, 전용 단일컬럼 화면 유지(이미 그렇게 되어있음, 유지)
- 다크모드는 이 프로젝트에서 이미 스코프 밖으로 뺀 상태 — SOCAR 시스템도 라이트 전용이라 자연스럽게 일치
