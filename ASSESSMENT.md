# Assessment: Guided Intake Chat

Reviewed at commit `c4d3e98`, October 2026, and updated for commit `7baf311` (see the next section). The review covered three things: a read of `index.html`, `api/llm.js`, `vercel.json` and the README; running the app locally; and the automated test suite added with this assessment (`npm test`).

## Update: commit 7baf311 (outsourcing rework)

**What changed:**
- One group standard, EBA/GL/2019/02, now applies to every provisioning legal entity. The per-jurisdiction matrix (PRA, MAS, HKMA, APRA, OSFI, US guidance) is gone.
- The test runs in order: paragraph 28 exclusions, then ongoing or recurrent (paragraph 26), then "would or could realistically be performed by the bank" (paragraph 26). Critical or important function (paragraphs 29 to 31) is a separate flag.
- EBA/GL/2026/09 is shown as an indicative future result that never decides the outcome.
- "Legal entity" is renamed "Provisioning legal entity" throughout.

**Verdict: a clear improvement, with one defect to fix before anyone relies on the flag.**

**What works:**
- **No regressions:** the existing suite (18 API tests and 38 browser tests) passes on the new code.
- **Test order:** the steps are shown in the check step and in the document, and they match the guidelines. Checked against a 12-case rule table and a full KYC conversation (`tests/e2e/outsourcing.spec.js`).
- **Paragraph mapping:**
  - 28(a) statutory audit, 28(b) market information, 28(c) card schemes, 28(e) SWIFT, 28(f) correspondent banking and 28(g) cleaning and legal representation are all excluded correctly.
  - A one-off strategy review is now "not ongoing" instead of a wrongly cited paragraph 28 exclusion.
  - Ongoing KYC and payroll come out as "Outsourcing (likely)".
- **Future rule set reference:** checked against public sources. The EBA published the final report for EBA/GL/2026/09 on 18 September 2026; the application date is not set; it repeals EBA/GL/2019/02 once applicable; and it covers non-ICT services only.
- **Fewer stale dates:** the removed per-country "change watch" entries took most of the unverifiable dates with them (old finding 14).

**Defects introduced or exposed** (known-issue tests added):

| # | Finding | Where | Confirmed by |
| --- | --- | --- | --- |
| U1 (High) | **Mentioning past practice flips the result.** "We have never done this ourselves", "we don't do this today" or "we have always bought this in" make KYC, payroll or accounts payable "Not outsourcing (likely)". This contradicts paragraph 26 ("even if the institution has not performed this function in the past") and the commit's own intent. The in-house question is then skipped, the check step says "It's not work a bank would do itself", and once confirmed the document records "Checked by the requester: Yes, confirmed". Example: a €600k, 2-year offshore KYC service. | `inHouseFromText` (`index.html` 697 runs before 699) | Test |
| U2 (Medium) | **"No, but a bank could realistically do it" is read as no** in answer to the new question. | `readAnswer('in_house')` | Test |
| U3 (Medium, existing before this commit) | **The provisioning legal entity is the first list match anywhere in the text.** "Singapore branch … stored in the EU" becomes the EU entity, and that raises a false offshoring flag. | `entityFrom` (`index.html` 672) | Test |
| U4 (Medium, judgement) | **Paragraph 28(g) is applied by category, which is too broad:** <ul><li>A 3-year managed contract-review service counts as "legal advice or representation".</li><li>A managed WAN network counts as "telecom lines and utilities".</li><li>A provider-run compliance e-learning platform counts as a service "the bank would not otherwise perform".</li><li>Event services are cited as if paragraph 28(g) listed them.</li><li>Contingent labour appears under the "Excluded under paragraph 28" step although that paragraph does not cover it.</li></ul> Confirm the mapping with the outsourcing team. | `excludedType` | Run (rule probe) |
| U5 (Medium) | **ICT is judged too broadly in the future rule set.** Any ongoing service with the technology flag is "Out of scope: ICT service under DORA". The technology flag is derived broadly, so KYC operations (a non-ICT business process service) shows as out of scope of EBA/GL/2026/09. | `futureRule` | Run |
| U6 (Medium, design trade-off) | **Local rules are no longer prompted.** For non-EU entities, local requirements now appear only in the small print ("local requirements may add"). Nothing prompts the local notification duties (for example MAS, PRA or APRA material outsourcing or service-provider notifications). Suggest a "local add-on check" line in the record for non-EU entities. | `detailHTML`, `intakeRecord` | Code |

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
| End-to-end (`tests/e2e`, Playwright, Chromium) | 44 passed: 31 behaviour tests and 13 known-issue tests that fail as expected |
| Run time | About a minute. Needs no keys and no network. |

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
| 14 | **Compliance flags depend on AI extraction.** Any message can overwrite `personal_data`, `tech_service`, `in_house` or `value`. The output says "Not outsourcing" and has a disclaimer. Since 7baf311 the per-country matrix is gone and the one remaining future reference (EBA/GL/2026/09) is verified, but it will need updating once its application date is set. | `mergeFacts`, `RULESETS` | Code |

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

1. **Fix routing and the in-house derivation.**
   - Remove the past-practice phrases from `inHouseFromText` (U1). Only "a bank would not do this itself" should give no.
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
