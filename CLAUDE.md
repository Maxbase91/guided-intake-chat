# Guided Intake Chat

Conversational procurement intake prototype for a European bank. A requester describes a need; fixed rules pick the
buying route and the DORA / outsourcing classification, and an LLM only holds the conversation and drafts text.
Dummy data only.

## Stack
- `index.html`: the whole app (vanilla JS, inline CSS and script, reference data as one JSON block). No build step.
- `api/llm.js`: Vercel Node serverless function (CommonJS). LLM proxy: Gemini → Groq → Mistral → OpenRouter `:free`.
- `vercel.json`: function timeout (60 s) and security headers.
- No dependencies are deployed.

## What is in Git (deliberate, do not change)
`.gitignore` is an allow-list: only `.gitignore`, `CLAUDE.md`, `index.html`, `api/`, `vercel.json`, `README.md`,
`LICENSE`, `NOTICE`, `docs/` are tracked. Tests, `scripts/` (local server, mock providers, taxonomy import),
`package.json`, test data and `tasks/` stay on the developer machine (docs/ARCHITECTURE.md §10).
A new tracked file needs a `!/path` line in `.gitignore`. Never commit the local-only files.

## Commands (local only, need the untracked package.json)
- `npm start`: local server on port 3000 (`scripts/dev-server.js`, runs `api/llm.js` like Vercel).
- `npm run start:mock`: same with mock providers (no keys, no network).
- `npm run test:api`: `node:test` tests for `api/llm.js`.
- `npm run test:e2e`: Playwright against three local servers (ports 4310–4312, mock providers).
  If the pinned browser is missing, set `CHROMIUM_PATH` to an installed Chromium/headless shell.
- `npm test`: both. No lint, typecheck or build step exists.
- After a scripted edit of `index.html`, syntax-check its `<script>` blocks before testing (see `tasks/lessons.md`).

## Repo map
- `index.html` sections: 1 Configuration (`CONFIG`, thresholds) … 9 Render … 11 Wiring (access gate, start-up).
  "How it works" (`specModel()`) and "Decision tree" (`treeModel()` / `treeFigure()`) are generated from the code:
  update them when route, check or quality logic changes.
- `api/llm.js`: `GET /api/llm` (config, no secrets), `?verify=1` (access code), `?check=1` (live provider check, needs
  code), `POST /api/llm` (`{system, history}`).
- `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/DESIGN.md`.

## Env vars (Vercel; names only)
`GEMINI_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `OPENROUTER_API_KEY` (at least one), `ACCESS_CODE`,
optional `LLM_PROVIDER`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `GROQ_MODEL`, `MISTRAL_MODEL`, `OPENROUTER_MODEL`.

## Deploy
Push to `main` → Vercel production (project `guided-intake-chat`, preset "Other", no build command).
Never run `vercel deploy` manually and never change Vercel settings from an agent.

## Guardrails
- Free provider tiers only; never configure a paid model or provider (owner rule).
- Keep `ACCESS_CODE` set in production: without it `/api/llm` is an open LLM relay on the owner's keys.
- Model output is rendered only through `esc()` / `md()` (escape first). Never interpolate model or user text into
  `innerHTML` without them.
- Tests run only against mock providers; live AI checks happen on the deployed page.
- Keep the two-line authorship watermark at the top of `index.html` and `api/llm.js`, plus LICENSE and NOTICE.
- No secrets in tracked files; keys live only in Vercel env vars.
