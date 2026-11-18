# Guided Intake Chat

Conversational procurement intake prototype for a European bank. A requester describes a need; fixed rules pick the
buying route and the DORA / outsourcing classification, and an LLM only holds the conversation and drafts text.
Dummy data only.

## Stack
- `index.html`: the app (vanilla JS, inline CSS and script, reference data and the built-in configuration as JSON blocks). No build step.
- `engine.js`: the decision-table engine, loaded by the page with a script tag and by Node with `require`.
- `db/seed/*.json`: thresholds, channels, category cards, facts, rules (decision tables with their test cases and
  reason texts), question texts and category guidance, divisions and the review lists (test data, not the bank's).
  `node scripts/build_defaults.js` writes them into the `config-defaults` block of `index.html`; run it after every seed change.
- `api/llm.js`: Vercel Node serverless function (CommonJS). LLM proxy: Gemini → Groq → Mistral → OpenRouter `:free`.
- `vercel.json`: function timeout (60 s) and security headers.
- `admin.html` + `admin.js`: the admin page (draft, test, publish). `api/admin.js`: its endpoint, behind `ADMIN_CODE`.
- `api/config.js`, `api/decisions.js`: the published configuration and the decision log (`api/_lib/`: shared helpers,
  the store, the seed). `db/migrations/*.sql`: the schema.
- One dependency is deployed: `pg` (Postgres driver).

## What is in Git
`.gitignore` is an allow-list: the app (`index.html`, `engine.js`, `admin.html`, `admin.js`, `db/`, `api/`, `vercel.json`, `.vercelignore`,
`.env.example`), docs (`README.md`, `CLAUDE.md`, `docs/`,
`LICENSE`, `NOTICE`) and what runs the tests from a fresh clone (`tests/`, `scripts/dev-server.js`,
`scripts/mock-providers.js`, `scripts/import_taxonomy.py`, `scripts/build_defaults.js`, `scripts/db-migrate.js`, `scripts/db-seed.js`, `package.json`, `package-lock.json`, `playwright.config.js`,
`.github/`). Test data (`data/`), task notes (`tasks/`) and test output stay local (docs/ARCHITECTURE.md §10).
A new tracked file needs a `!/path` line in `.gitignore`. Test data in tracked files must be synthetic: no real
access codes, keys or personal data.

## Commands
- `npm ci` and `npx playwright install chromium` once.
- `npm start`: local server on port 3000 (`scripts/dev-server.js`, runs every `api/<name>.js` like Vercel).
  Without `DATABASE_URL` it serves the seed from memory.
- `npm run db:migrate`, `npm run db:seed`: schema and first configuration, against `DATABASE_URL_UNPOOLED` from the
  environment or `.env`. Ask the owner before running either against Neon.
- `npm run start:mock`: same with mock providers (no keys, no network).
- `npm run test:api`: `node:test` tests for the functions, the engine and the seed. With `TEST_DATABASE_URL` set the
  store tests also run against that Postgres (it is wiped: never point it at Neon).
- `npm run test:e2e`: Playwright against four local servers (ports 4310–4313, mock providers; 4313 is the admin
  server, whose published configuration the admin tests change).
  If the pinned browser is missing, set `CHROMIUM_PATH` to an installed Chromium/headless shell.
- `npm test`: both. No lint, typecheck or build step exists.
- `scripts/verify.sh` — runs the CI checks locally; runs automatically on `git push`. It starts a throwaway Postgres
  in Docker (Docker Desktop must be running) and uses an installed Chromium when the pinned one is missing.
- CI (`.github/workflows/ci.yml`) runs both on every push to `main` and every PR, mocks only.
- After a scripted edit of `index.html`, syntax-check its `<script>` blocks before testing (see `tasks/lessons.md`).

## Repo map
- `index.html` sections: 1 Configuration (`CONFIG`) … 9 Render … 11 Wiring (access gate, start-up).
  Thresholds, channel names, category flags and the routing rules (R01, R02, R11, R19) are data: change them in
  `db/seed/`, not in the script. `applyConfig()` fills the constants; `determine()` runs the rules through `Engine`.
  "How it works" (`specModel()`) and "Decision tree" (`treeModel()` / `treeFigure()`) are generated from the code:
  update them when route, check or quality logic changes.
- `api/llm.js`: `GET /api/llm` (config, no secrets), `?verify=1` (access code), `?check=1` (live provider check, needs
  code), `POST /api/llm` (`{system, history}`).
- `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/DESIGN.md`.

## Env vars (Vercel; names only)
`GEMINI_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `OPENROUTER_API_KEY` (at least one), `ACCESS_CODE`,
optional `LLM_PROVIDER`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `GROQ_MODEL`, `MISTRAL_MODEL`, `OPENROUTER_MODEL`,
`RATE_LIMIT_PER_MIN` (default 30 POST per IP/min), `CHECK_LIMIT_PER_MIN` (default 5),
`DATABASE_URL`, `DATABASE_URL_UNPOOLED` (Neon, set by the Vercel integration), `ADMIN_CODE` (admin page),
optional `CONFIG_LIMIT_PER_MIN` (default 300), `DECISIONS_LIMIT_PER_MIN` (default 10). `.env.example` lists them.

## Deploy
Push to `main` → Vercel production (project `guided-intake-chat`, preset "Other", no build command).
Never run `vercel deploy` manually and never change Vercel settings from an agent.

## Guardrails
- Free provider tiers only; never configure a paid model or provider (owner rule).
- Keep `ADMIN_CODE` set and private: it lets its holder change the rules for everyone. Never weaken `sanitize()` or
  the publish check, and build admin content with DOM nodes and `textContent`, never `innerHTML`.
- Keep `ACCESS_CODE` set in production: without it `/api/llm` is an open LLM relay on the owner's keys.
- Model output is rendered only through `esc()` / `md()` (escape first). Never interpolate model or user text into
  `innerHTML` without them.
- Tests run only against mock providers; live AI checks happen on the deployed page.
- Keep the two-line authorship watermark at the top of `index.html` and `api/llm.js`, plus LICENSE and NOTICE.
- No secrets in tracked files; keys live only in Vercel env vars.
