# Assessment: Guided Intake Chat

Reviewed at commit `c4d3e98`, October 2026. The review covered three things: a read of `index.html`, `api/llm.js`, `vercel.json` and the README; running the app locally; and the automated test suite added with this assessment (`npm test`).

## Verdict

**Demo-ready, not pilot-ready.** All five buying routes work end to end, offline and with AI. The conversation features the README promises also work: corrections, checks, skipping, the improvement round and the outputs. When the AI fails, the app falls back to standard questions cleanly. Escaping of user and AI text is careful throughout.

Three things block real users:

1. **The rules engine can send ordinary bank requests down the wrong route.** It matches keywords inside other words and does not check the value against the catalogue price. A €400k SaaS tool becomes a stationery catalogue order.
2. **The server is an open LLM proxy unless `ACCESS_CODE` is set**, and the code can be guessed quickly.
3. **Real intake data would go to free LLM tiers**, and the page never warns about it.

## Test results

| Suite | Result |
| --- | --- |
| API (`tests/api`, node:test) | 18 passed, 1 known bug recorded as `todo` |
| End-to-end (`tests/e2e`, Playwright, Chromium) | 38 passed: 28 behaviour tests and 10 known-issue tests that fail as expected |
| Run time | About 50 seconds. Needs no keys and no network. |

**Covered:**
- **Routes:** the five routes (catalogue, contract call-off, external workers, new demand under and over €50,000).
- **Conversation:**
  - corrections in words, unclear corrections and side-panel edits that cross the €50,000 threshold;
  - off-topic answers, a date in the past and skipping a question;
  - Rules thresholds, route override with justification, the improvement round and submitting below the threshold;
  - inline edits.
- **Outputs:** JSON and Word downloads.
- **AI mode** (through the real `api/llm.js`):
  - the provider label;
  - Gemini → Groq fallback;
  - every provider down;
  - leaked field names are removed;
  - the AI's off-topic check;
  - the AI toggle and `?ai=`.
- **Access and layout:** the access-code gate and the phone layout.

**Not covered:**
- **Real LLM output quality.** That needs real keys. Run the app with `GEMINI_API_KEY=... npm start` and walk through the five examples on the welcome screen.
- **Browsers other than Chromium.**

## Findings

Each finding says how it was confirmed:
- **Test:** reproduced by an automated test (see `tests/e2e/known-issues.spec.js` or `tests/api/llm.test.js`).
- **Run:** seen while running the app.
- **Code:** read in the code, not run.

### Critical

| # | Finding | Where | Confirmed by |
| --- | --- | --- | --- |
| 1 | **The catalogue route is picked by substring keyword matches, and the value is ignored.** "A SaaS tool to track travel expenses for 400k" → "Stationery bundle is in our catalogue" ("pens" in "expenses"). "Transaction monitoring system for AML, 400k" and "Sanctions screening service, 300k" → "27\" monitor". The intake then asks two catalogue questions and closes. | `catalogueMatches`, `CATALOGUE`/`CATEGORIES` keywords (`index.html` ~314–319, 565–580) | Test |
| 2 | **Intake data goes to free LLM tiers with no notice.** The full conversation is sent to Gemini, Groq or Mistral (the README notes that Mistral's free plan may train on requests). The welcome screen does not say "dummy data only". | `index.html` ~2554, 2636 | Code |

### High

| # | Finding | Where | Confirmed by |
| --- | --- | --- | --- |
| 3 | **Without `ACCESS_CODE` the server is an open LLM proxy.** The browser sends the whole system prompt, and there is no per-client rate limit, so anyone with the URL can use the keys or exhaust the quota. | `api/llm.js` 311–322 | Code |
| 4 | **The access code can be guessed quickly.** Only `?verify` waits 700 ms. A wrong code on POST is refused at once. The comparison is not timing-safe. `?code=` puts the code in logs and browser history. | `api/llm.js` 268–274, 311 | Code (POST 401 checked in a test) |
| 5 | **An amount the AI returns as text is read wrongly.** "€400k" becomes 400, so a €400k request drops to business-led quotes. `parseMoney` already handles this but is not used here. | `normFact` (`index.html` ~1449–1460) | Test |
| 6 | **On a phone, the Summary panel can't be closed.** It covers 92% of the screen, including the Summary button, and has no close button, backdrop or Escape key. The user has to reload. | CSS `index.html` 200; toggle 3008 | Test |
| 7 | **Wrong-kind answers are stored without a check in offline mode.** "About 400k" to "Is the budget already approved?" is stored as "No". "No supplier in mind" to "What must it be able to do?" is stored as must-haves (8/10). A location given as deliverables produces "The supplier will deliver." in the description. | `offlineRead` / `readAnswer` | Test and run |

### Medium

| # | Finding | Where | Confirmed by |
| --- | --- | --- | --- |
| 8 | **Answers can be taken as document edits.** Once a description exists, any message containing "summary", "description" or "document" is treated as an edit, including answers in the improvement round. | `handleTurn` (`index.html` 1250) | Test |
| 9 | **Requesters can change the route thresholds under Rules.** Raising the €50,000 threshold turns an RFP into business-led quotes, and only the "why" text records it. | Settings (`index.html` 2967–2994) | Test |
| 10 | **`?ai=<provider>` can be set by anyone with the link.** A shared link forces one provider (for example Mistral's free plan) for the whole conversation. | `index.html` 286; `api/llm.js` 327 | Test |
| 11 | **Server state is shared between requests.** `IGNORE_COOLDOWN` is a module variable, so a POST that arrives during a `?check` ignores cooldowns. The deadline is only checked between calls, so one request can run past the 60 s function limit. | `api/llm.js` 61, 140, 205, 276 | Code |
| 12 | **Groq JSON-mode fallback is unreachable for "not supported" errors.** The first retry branch keeps JSON mode on and fails, so the model is skipped. | `callGroq` (`api/llm.js` 143–147) | Test (`todo`) |
| 13 | **Accessibility basics are missing.** The input has no label. The message list has no `aria-live`/`role="log"`. The drawers have no dialog role, focus trap or Escape key. Each render rebuilds the whole chat with `innerHTML`. | `index.html` 260–263, 2643, 2858, 2962 | Code |
| 14 | **Compliance flags depend on AI extraction, and the regulatory matrix is mock data.** Any message can overwrite `personal_data`, `tech_service` or `value`. The output says "Not outsourcing" and has a disclaimer. The hard-coded framework dates will go out of date. | `mergeFacts`, `FRAMEWORKS` | Code |

### Low

| # | Finding | Confirmed by |
| --- | --- | --- |
| 15 | **Acronyms lose their capitals in generated text:** "fits it hardware", "It provides hR operations", "External java developer". | Test and run |
| 16 | **A closing remark after the results gets a misleading reply.** "thanks" gets an answer score and "Updated. Here are the revised service description and route." although nothing changed. | Test |
| 17 | **The second off-topic answer is shown as "Answer quality 8/10" with "That helps."** It is correctly stored as "To be determined", but the feedback contradicts that. | Run |
| 18 | **The improvement round asks the start date again** when the timeline is only partial, instead of asking for the missing end date or duration. The result card above drops the date while the round runs. | Run |
| 19 | **The browser-key Gemini path puts the key in the URL** (`?key=`). The server sends it in a header. | Code |
| 20 | **The mock contract CTR-7120 expires on 30 November 2026**, so demo requests in that category will switch to new demand. There are no security headers (CSP, frame-ancestors). | Code |

## Maintainability

- **One large file:** a 324 KB `index.html` holds a 2,756-line inline script. Its ~178 top-level functions all change one global `S`, and some lines exceed 1,800 characters.
- **Lint:** ESLint finds no errors and 8 unused declarations.
- **Before this assessment:** there were no tests, `package.json` or CI.
- **Mixed concerns:**
  - mock reference data sits in the code;
  - the scoring weights are inline numbers;
  - the Gemini call is written twice (browser and server).

## Recommendations, in order

1. **Fix routing.**
   - Match keywords as whole words.
   - Offer the catalogue only for goods, and only when the value fits the catalogue price.
   - Run AI-returned amounts through `parseMoney`.
   - Remove `test.fail()` from the matching tests in `known-issues.spec.js` once fixed.
2. **Lock down the server.**
   - Require `ACCESS_CODE` and send it as a header only, compared with `timingSafeEqual`.
   - Add a per-IP rate limit, for example Vercel WAF or Upstash.
   - Build the system prompt on the server.
   - Drop `?ai=` and `?check=mistral` in production.
3. **Before any pilot:**
   - Show a "dummy data only" banner.
   - Move to paid LLM endpoints with no data retention.
   - Make thresholds admin-only.
   - Never let the AI weaken a compliance flag without the user confirming it.
4. **Fix the phone panel and the accessibility basics.**
5. **Start splitting the file.** Move the rules engine (`determine`, `parseMoney`, `normFact`, matching) into a module with unit tests, then the reference data.
6. **Run `npm test` in CI** (GitHub Actions) on every push.
