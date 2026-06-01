# BlurtForum — Vite + Vue 3 + TypeScript

A decentralised community forum powered by the [Blurt blockchain](https://blurt.blog).

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Vue 3 (Composition API, `<script setup>`) |
| Language | TypeScript (strict mode) |
| Build tool | Vite |
| Styling | Plain CSS (original `style.css` — unchanged) |
| Blockchain client | `@beblurt/dblurt` (loaded from CDN) |
| Markdown | `marked` + `DOMPurify` |
| Crypto | `crypto-js` |

## Project structure

```
src/
├── main.ts                  # App entry point
├── style.css                # All styles (unchanged from original)
├── env.d.ts                 # Vite + CDN global type declarations
├── App.vue                  # Root component — full Vue template
├── types/
│   └── index.ts             # Shared TypeScript types
├── modules/
│   ├── auth.ts              # PIN-based key encryption (AuthService)
│   ├── community.ts         # Community list & subscription (BFCommunity)
│   ├── parser.ts            # Markdown + media embedding (Parser)
│   ├── player.ts            # Audio/video PiP player (BFPlayer)
│   ├── utils.ts             # Date, permlink, payout helpers (BFUtils)
│   ├── translations.ts      # i18n facade
│   ├── translations.raw.ts  # Raw translation strings (en / pl / eo)
│   └── whalevault.ts        # WhaleVault extension interface + polyfill
└── composables/
    └── useApp.ts            # Main app logic (all of app.js, typed)
```

## Local development

```bash
npm install
npm run dev        # Vite dev server at http://localhost:5173
```

## Build

```bash
npm run build      # type-check + production build → dist/
npm run preview    # serve dist/ locally
```

## GitHub Pages deployment

The workflow at `.github/workflows/deploy.yml` handles everything automatically.

### One-time setup

1. Go to **Settings → Pages** and set **Source** to **GitHub Actions**.
2. *(Project sites only)* The workflow auto-detects the repo name and sets `VITE_BASE`
   to `/<repo-name>/`. If you use a **custom domain** or a **user/org site** (served at `/`),
   add a repository **Variable** named `VITE_BASE` with value `/`.

### Workflow summary

| Trigger | Steps |
|---------|-------|
| Push to `main` | `npm ci` → type-check → Vite build → deploy to Pages |
| Manual (Actions tab) | Same via "Run workflow" button |
