# Guided Intake Chat: Architecture

| | |
|---|---|
| Last updated | 14 October 2026 |
| Related | [PRD](PRD.md) · [Design](DESIGN.md) · the in-app **How it works** panel, which documents every rule and prompt, and the in-app **Decision tree** for business readers; both are generated from the code |

## 1. Overview

```mermaid
flowchart LR
  U[Requester's browser<br/>index.html] -- "POST /api/llm<br/>(system prompt + messages, x-access-code)" --> F[Vercel function<br/>api/llm.js]
  F -- "1" --> G[Gemini]
  F -- "2" --> Q[Groq]
  F -- "3" --> M[Mistral]
  F -- "4" --> O[OpenRouter free models]
  U -. "no server or no quota:<br/>rules only" .-> U
```

There are two deployable parts:

| Part | Role |
|---|---|
| `index.html` | The whole application: screen, rules engine, conversation loop, prompts, outputs, reference data, the How it works specification and the Decision tree. No build step and no dependencies (Google Fonts only). |
| `api/llm.js` | A thin serverless proxy. It holds the AI keys, enforces the access code, tries the providers in order with cooldowns, and returns the model's text. It decides nothing about the request. |
| `vercel.json` | Gives the function 60 s and sets the response security headers. |

**Design rule: the rules decide, the AI talks.**
- The browser picks the route, the questions, the Level 4 category, the ICT and outsourcing flags, and every check,
  deterministically.
- The AI phrases questions, reads free-text answers into facts, suggests answers and writes the description.
- Everything the AI returns is screened before it is used (§5).

## 2. `index.html`

**Inline data:** one JSON block, `<script id="taxonomy-data" type="application/json">`, holding the Level 4 list,
suppliers, frameworks and catalogue (§7).

**One inline script with numbered sections:**

| # | Section | Contents |
|---|---|---|
| 1 | Configuration | `CONFIG`: provider mode, access code, `?ai=` test override, currency, `thresholds` (`lowValueMax`, `quickQuoteMax`, `materialityMin`, `qualityMin`, `answerTip`) |
| 2 | Reference data | `CATEGORIES` (20 buying categories with type and keywords), `L4`, `CONTRACTS`, `PREFERRED_L4`, `CATALOGUE` (from the data block), legal entities, rule sets (EBA/GL/2019/02, EBA/GL/2026/09) |
| 3 | Routes | `CHANNELS`, `FACTS` (every question: label, wording, example, choices), `requiredFor(route, f)`, `STAGES`, kind-of-work rules (`kindOf`, `isOngoing`) |
| 4 | State | One global `S`: messages, facts `S.f`, derived facts, route `S.det`, open questions `S.missing`, suggestions, quality, description `S.sd` |
| 5 | Rules engine | Category and Level 4 matching, `determine()` (route), `controlsFor()` (reviews), `nextSteps()`, ICT and outsourcing decision tree, answer checks (`findIssue`), dates, money, suppliers |
| 6 | AI client | `callLLM()` (POST to `/api/llm`, 58 s timeout, short retries on a fast 429), chat system prompt and state block |
| 7 | Conversation loop | `handleTurn()`: corrections, questions back, suggestion edits, the AI call or rules-only reading, screening, merging, checks, next question |
| 8 | Results | `determine`'s route card, `buildDoc()` (description or purchase request), quality score, submit and JSON payload |
| 9 | Render | Chat, cards, step bar, side panel, editor |
| 10 | How it works and Decision tree | `specModel()`: the specification built from the live constants and the exact prompts. `treeModel()`: the same rules as business decisions (yes/no ladders, the question → decision index, worked examples), with `treeFigure()` drawing the whole tree as one SVG picture (Mermaid in the download). Both open in `openPanel()` with Markdown download and print |
| 11 | Wiring | Event handlers, access gate, start-up |

## 3. A turn, step by step

```mermaid
sequenceDiagram
  participant R as Requester
  participant P as Page (rules)
  participant A as /api/llm (AI)
  R->>P: message
  P->>P: correction? question back? suggestion edit? side remark?
  alt rules can read it ("ok", a chip, "skip", a known correction)
    P->>P: read it without an AI call
  else
    P->>A: chat prompt + state (next items, examples, candidates)
    A-->>P: JSON {facts, reply, suggestion, corrections, assessment}
    P->>P: screen the AI's facts and suggestion (§5)
  end
  P->>P: merge facts, derive facts, refresh route, find issues
  P-->>R: check, or the next question (AI reply or rules wording) with chips
```

`refresh()` re-runs on every turn:
1. `deriveFacts()`: hosting, in-house, entity, Level 4, purpose and so on;
2. `determine()`: the route;
3. `requiredFor()`: the questions;
4. ordering by stage into `S.missing`.

A change of category, value or supplier therefore re-routes on the spot.

## 4. AI calls

| Call | When | Gets | Returns |
|---|---|---|---|
| A. Chat turn | A typed answer that the rules can't read alone | System prompt (role, rules, fact keys, about 20 Level 4 candidates on the first message, after "None of these" and at the check step, catalogue entries of the category), last 6 messages cut to 400 characters, state block | JSON: facts (on the first message also `l4`, `l4_terms`, `l4_alt`), reply, asking, choices, suggestion, corrections, answers_question, assessment |
| B. Suggestion | A suggestion item with no usable suggestion from A | The question, known facts, the rules' standard draft | One suggestion string, one "Label: …" line per bundle line |
| C. Documents | New demand or call-off, once all details are in | Conversation, facts, category, ICT and outsourcing results, route, up to 5 Level 4 candidates | Description fields (hard word limits), the Level 4 re-check (new demand), up to 2 quality remarks |
| D. Document change | "Make it shorter" once a description exists | The current description and the request | The updated description |

There is no AI call for catalogue orders and low-value purchases: the purchase request is built from the answers.

Typical new-demand conversation: about 15 requests and 40k input tokens. The prompt size doesn't depend on the size of
the Level 4 list.

## 5. Guardrails on AI output

| Guard | Where | What it does |
|---|---|---|
| Fact screening | `screenAIFacts()` | Placeholders only for the question asked; classification flags only at the check step; free text kept only if at least half its words were said by the requester; no budget changes or deadlines invented in passing |
| Number grounding | `groundSuggestion()`, `mergeExec()`, `numTokens()` | A figure must be the requester's, with the same unit ("6 months" ≠ "3 months"), or come from the app's standard draft. Otherwise the point or sentence goes. The requester's own answer for a line comes first |
| Length | `fitLine`, `clipWords`, `shortReply`, `execLimits` | Suggestion lines 30 words; replies over 45 words cut to the first sentence and the question; description fields 12–25 words; headline and executive text within the route's limits |
| Wording | `scrubText`, `cleanReply`, `dropFigures` | No amounts, dates, places, suppliers or route in the description; no internal field names in replies; no markdown; no leftover brackets from removed figures |
| Category consistency | `mergeFacts`, `offlineRead`, `handleTurn` | The AI's Level 4 sets the category. A category named at the start of the request overrules it only when the AI's entry fits the words far worse. A pick that matches neither the request nor the AI's own `l4_terms` gives way to the entry those terms find. A later category change in the facts counts only when the requester's words name it; a reply claiming a dropped change is not shown |
| Edits | `editSuggestion()` | "Drop…", "replace…", "add … as a KPI" are applied by the app, not the model |

## 6. Classification

**Category and Level 4** (`bestCategory`, `scoreL4`, `classifyL4`, `l4Shortlist`):
1. **Category keywords:** whole words. A keyword in the subject of the request (before "for", "to", "with", "including"…)
   wins.
2. **Level 4 scoring:** an index built once at load.
   - Words are weighted by where they appear: name and search terms 3, Level 3 group 2, Level 2 group and description 1.
   - Each weight is multiplied by its rarity across the list (IDF).
   - In the request, subject words count double, words after "including" a quarter, and a whole search phrase scores a
     bonus. Catch-all "(other)" entries count three quarters.
   - Known supplier names are removed before scoring ("Lakeshore Advisory" is no advisory request). Stems keep a final
     "ss" and are cut to 7 letters before a final "e" goes, so "process" meets "processes" and "improve" "improvement".
3. **A misleading category keyword** ("agency" in "temps through an agency") gives way when the best Level 4 across the
   whole list scores clearly higher (×1.25, or ×1.5 against a keyword in the subject).
4. **A confident Level 4 stays settled** for the conversation, so a framework can't flip the route halfway. A weak one is
   refined as answers come in.
5. **With AI,** about 20 candidates (the closest across the list plus the rules' picks) go into the first prompt. The
   model also returns `l4_terms`, the item in a category list's words ("ERP implementation" for "S4 HANA Roll Out"),
   which the app looks up in the whole list. That entry is used when no candidate fits, or when the pick shares no word
   with the model's own terms and no search term with the request (the shortlist had no good candidate).
6. **Weak evidence never decides a category.** A Level 4 match without a search term needs two or more shared words to
   set or overrule a category ("Roll" alone is no roll-up banner, "Windows" alone no window cleaning), and it never
   overrules the AI's category. "Roll out" and "rollout" are one word, as are "S/4HANA" and "S4HANA".
7. **Category corrections at any point** ("it's not software, it's consulting", "it's more consulting support") are read
   by the rules and change the category, the Level 4 and the questions. In answer to an open question the app asks
   first. A category change the model files among the facts is applied only when the requester's own words name that
   category; otherwise it is dropped and the model's reply is not shown.
8. **The requester chooses the Level 4 first** (`l4Candidates`, `selectL4`, `askL4Pick`, `readL4Pick`). After the first
   message, every route asks `l4_pick` before anything else, in the app's own words (never the model's).
   - Candidates: the entry the app works with, marked Suggested; the model's alternatives (`l4_alt`); the closest
     entries across the whole list.
   - A rules alternative's % is damped by √(its score ÷ the best score), so a far weaker entry can't look like a 78%
     match.
   - Every candidate at `CONFIG.thresholds.l4Match` (75%) or more is shown, up to 3, and at least 2. The area's
     "(other)" entry is added when nothing else shares a word.
   - Answers: a button, "the second one", a code or a name. "None of these" asks for a few words, rebuilds the
     candidates from them (with AI, the model picks again from a shortlist for those words), and leaves out the
     rejected ones. Two answers that are no choice keep the first.
   - Checks on the first message wait until the choice is made, and the route news comes with the first question after
     it.

**Recognition benchmark** (realistic test data, 60 requests written without seeing the descriptions):

| | Result |
|---|---|
| Rules: right category | 87% |
| Rules: right Level 4 | 73% |
| Right entry among the AI's candidates | 93% |
| Live with AI (32 requests) | 78% |

The misses are paraphrases with no shared words, and close neighbours.

**ICT (DORA) and outsourcing** (`techFromRules`, `ictType`, `outsourcing`, `inHouseFromText`, `excludedType`):
- Rules first; a question only when the rules can't tell.
- The software hosting answer decides SaaS (outsourcing likely) against installed licences (not outsourcing, still an
  ICT service).

## 7. Reference data

The Level 4 list, suppliers, frameworks and catalogue live in the JSON block of `index.html`:

```json
{ "version": "test-2026-10",
  "l4": [{ "code": "L4-1206", "name": "…", "l1": "…", "l2": "…", "l3": "…", "theme": "software", "desc": "…", "kw": ["…"] }],
  "suppliers": [{ "name": "…", "preferred_l4": ["L4-…"] }],
  "contracts": [{ "id": "CTR-…", "supplier": "…", "title": "…", "l4": ["L4-…"], "expires": "YYYY-MM-DD", "remaining": 0 }],
  "catalogue": [{ "id": "CAT-…", "kind": "item|shop", "name": "…", "supplier": "…", "l4": "L4-…", "price": 0, "max_order": 0, "unit": "…", "kw": ["…"] }] }
```

**The block is written by a local import script** from CSV exports, one or more files per kind:
- `l4*.csv`, `suppliers*.csv`, `contracts*.csv`, `catalogue*.csv`;
- optional `theme-map.csv`.

**The script validates before it writes:**
- codes unique;
- each Level 4 in one of the 20 buying categories;
- every reference resolves;
- every shop has a maximum order.

It refuses to write if anything fails. `theme` must be a `CATEGORIES` id, because the category decides the questions and
the outsourcing test.

**Current data:** realistic test data (396 Level 4 entries, 184 suppliers, 40 frameworks, 84 catalogue entries
including 25 shops). The legal entities in section 2 of the script are mock data.

## 8. Server: `api/llm.js`

| Endpoint | Purpose |
|---|---|
| `GET /api/llm` | Which providers are configured, and whether an access code is required (no secrets) |
| `GET /api/llm?verify=1` | Checks the access code (header `x-access-code`) |
| `GET /api/llm?check=1` | Live check of every provider (needs the code) |
| `POST /api/llm` | `{system, history}`, returns `{text, provider, model}` or an error `{error, quota, retryAfter, attempts}` |

**Provider chain:**
- Gemini (main, then lite model) → Groq (rotates up to 6 models) → Mistral (rotates small models) → OpenRouter (free
  `:free` models).
- A model at its limit cools down for the time the provider asks.
- 25 s per call, 55 s per request, with a JSON-mode fallback for models that refuse it.
- `x-force-provider` (from `?ai=`) is a testing aid.

**Environment variables:**
- keys: `GEMINI_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `OPENROUTER_API_KEY`;
- `ACCESS_CODE`;
- optional `LLM_PROVIDER` and per-provider `*_MODEL`;
- optional `RATE_LIMIT_PER_MIN` (default 30) and `CHECK_LIMIT_PER_MIN` (default 5); `0` turns a limit off.

**Rate limit:** per IP (`x-real-ip` / `x-forwarded-for`, set by Vercel) in fixed one-minute windows, held in the warm
instance's memory (lost on a cold start, not shared between instances). `POST` and `?check` have separate budgets;
`GET /api/llm` and `?verify` are not limited. Over the limit: `429` with a `Retry-After` header and
`{error, code: "rate_limited", quota: false, retryAfter}`; the page waits and retries once when the wait is short.

**Access code:** compared in constant time; every wrong code (`verify`, `check` or `POST`) is answered after a 700 ms
delay to slow down guessing. Without `ACCESS_CODE` the function is open to anyone.

**Security headers** (`vercel.json`, all paths): `X-Content-Type-Options: nosniff`, `Referrer-Policy:
strict-origin-when-cross-origin`, a `Permissions-Policy` that turns off camera, microphone, geolocation and payment, and
a minimal `Content-Security-Policy` (`base-uri 'none'; object-src 'none'`). There is no script CSP, because the app is
one page with inline script and styles, and no frame restriction, so the page can still be embedded.

Keys never reach the browser. A page opened from a file runs the rules only.

## 9. Deployment

- GitHub `main` is deployed to production by Vercel (project `guided-intake-chat`). Framework preset "Other"; no build
  command.
- **To check a deploy:** compare the live `index.html` with the committed one.
- **What is in Git** (`.gitignore` is an allowlist): what runs the app, its documentation, and what runs the tests:
  - `index.html`, `api/llm.js`, `vercel.json`;
  - `README.md`, `CLAUDE.md` (agent guide), `docs/`;
  - `tests/`, `scripts/dev-server.js`, `scripts/mock-providers.js`, `scripts/import_taxonomy.py`, `package.json`,
    `package-lock.json`, `playwright.config.js`, `.github/workflows/ci.yml`.
- **CI:** GitHub Actions runs `npm run test:api` and `npm run test:e2e` on every push to `main` and every pull request,
  with mock providers only (no keys). Vercel deploys independently of CI.

## 10. Development

In Git, so a fresh clone can run everything (`npm ci`, `npx playwright install chromium`, `npm test`):
- **tests:** Playwright end-to-end and `node:test` API tests, with mock providers and a fixed clock;
- **a local server** that runs the function the way Vercel does, and the mock providers;
- **the data import script** (`scripts/import_taxonomy.py`, Python 3 standard library only).

Local only (not in Git): the test data the taxonomy was imported from (`data/`), task notes (`tasks/`), test output.

**Run locally:**
- `npm start` serves `index.html` and `/api/llm` on port 3000;
- `npm run start:mock` uses fake providers;
- `npm test` runs all tests (about a minute, no keys or network).

**Working rules:**
- Run the full test suite before every push.
- After every scripted edit of `index.html`, run a syntax check over its script block.
- When route, check or quality logic changes, update `specModel()` (How it works) and `treeModel()` / `treeFigure()`
  (Decision tree). Functions they describe carry a `described in How it works` or `described in … the Decision tree`
  comment.
