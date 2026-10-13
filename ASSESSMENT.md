# Assessment: Guided Intake Chat

Reviewed at commit `c4d3e98`, October 2026, and updated for commit `7baf311` and the catalogue fix (see the next two sections). The review covered three things: a read of `index.html`, `api/llm.js`, `vercel.json` and the README; running the app locally; and the automated test suite added with this assessment (`npm test`).

## Update: live AI test run (new demand)

Two full new-demand conversations ran on the live site with the real providers: an HR and payroll system (€400k, software) and periodic KYC reviews (€600k, business process service). Gemini, Groq and Mistral all answered during the runs. The free tiers then ran out after about 57 calls. Everything below is fixed and covered by tests that fail on the previous code (`tests/e2e/live-ai-run.spec.js`, plus tests in `conversation.spec.js`, `ai-mode.spec.js` and `routes.spec.js`).

**Wrong facts in the record:**
- **Invented storage location:** the requester named the data only, and the AI recorded "stored in the bank's systems in the EU", copied from the question's example. The location follow-up now depends on the requester's own words. The AI's "storage location unknown" also no longer counts as a place, and the follow-up also fires when the AI fills in the data itself.
- **False offshoring:** "2,500 employees in Germany and the UK" became the work location, and offshoring was flagged. Places in audience, data or capability answers, or places describing people or data, no longer set the location. "Not offshore" is read as no. An explicit "no" wins everywhere (`isOffshore`).
- **Raw date reply:** the start date was stored as "Ok then 1 April 2027" after the timeline check, overwriting the AI's correct "1 April 2027".
- **Level 4 drifting across screens:** the initial category was SaaS, the check step showed "Application development and maintenance", and the record showed "Software licences (installed)". Level 4 is now chosen within the buying category, the confirmed value is the one in the record, and the AI's re-check only adds a note. The software ICT type follows Level 4.
- **"People 12" for software:** the HR team size was shown as headcount. That row is now for services and external workers only.
- **"Checked by you: Not yet"** appeared after the requester had confirmed.
- **AI amount as text (finding 5):** "€400k" from the AI was read as 400 and could drop a request below the RFP threshold.

**Conversation:**
- **Unapplied correction:** "Point 9 is wrong, the work is not done outside the country" got "Thanks, I've updated it" with nothing changed. Offshoring corrections and "point N is wrong" now apply. A reply that changes nothing gets "I couldn't tell what to change" instead.
- **Wrong single-source flag:** "We'd like to include Northwind" triggered "Single-source justification". Inclusion wording no longer does; "only", "directly" or "no tender" do.
- **Stuck at "Fair":** the quality score counted sections the route never asks (governance, reporting, change and escalation below €1M), so "Fair 64/100" could not be improved in the chat. Missing sections now cost points only when the route asks for them; risks always count.
- **8-minute spinner:** when every provider was at its limit, writing the documents retried for over 8 minutes. A slow 429 is no longer retried, and documents are built from the answers at once.

**Text:**
- **Scrubbing:** removing dates left "dating," and "documented and 2026". The scrubber also read "Mar" in "Marketing" as a month and deleted "of Marketing".
- **Mistral suggestions:** they showed raw keys ("exclusions: risk rating: …", "skills experience qualifications: analysts: minimum: …") and ended mid-sentence with "…".
- **Obligation verbs:** "The Service Provider shall deliver escalate red flags …" came from an incomplete verb list.
- **Wording:** "Northwind KYC Services's" and "Is 12 Oct 2026 (as soon as possible) a fixed deadline".

**Live re-test after the fix (same day):** a third conversation (managed payroll SaaS, €300k) ran on the live site. These were confirmed with real AI:
- no work location taken from where the employees are;
- Level 4 stayed SaaS through to the record;
- "Is that a fixed deadline" for ASAP, and "ok then 1 April 2027" stored as the date;
- no single-source flag for "please include";
- the data-location follow-up asked, and "in the EU" added to the answer;
- "5 is wrong" applied at the check step;
- "Checked by you: Confirmed";
- documents built from the answers within about 50 seconds when every provider was at its limit.

It found three more defects, now fixed:
- the AI took "in the EU" (the data answer) as the work location;
- "EU" became "eU" in the sourcing text: acronyms lost their capitals, finding 15, fixed with one shared `lcFirst`;
- 2,500 software users appeared as "2,500 × managed payroll SaaS".

**Not changed (judgement calls for the outsourcing team):**
- the ICT type "technology advice" for a KYC operations provider using its own case tool (see U5);
- "Outsourcing (likely)" for a software purchase described as replacing an on-premise tool.

## Update: per-answer scores removed, two defects from a test conversation fixed

A test conversation in AI mode (two Java contractors, €40k) showed scores that looked random. Here is where each one came from:
- **1/10 for "Offshore or another country":** the AI judged a *different* question (system access) off-topic. The app accepted that and said "That doesn't seem to answer my question", asked the system-access question, and still recorded the location.
- **6/10 for "next week":** the tight-timeline check counted as an answer defect.
- **8/10 for "It can move":** a fixed value for any reply to a check.
- **10/10 for "bank data":** the AI's own number, although where the data is stored was not answered.
- **9/10 for "Yes, use it":** the AI's own number, which overrides the rule that gives a clear yes 10.

**Changes:**
- **Scores:** "Answer quality N/10" is no longer shown under answers. The overall quality check and its "To improve" list stay. The internal score only decides whether to offer one tip for a thin new-demand answer (`answerTip`).
- **Off-topic:** the AI's off-topic verdict counts only for the question just asked.
- **Day rate:** an answer of €5,000 or more to "day rate or total budget?" is a total budget (`rateIsTotal`). It is no longer printed as "Day rate 40000" in the record, as "Day rate not above 40000 per person" in the requirements document, or as the rate in the commercial terms.
- **Tests:** an AI-mode test for the wrong-question verdict and a contractor conversation with "40k". Both fail on the previous code with exactly the symptoms above.
- **Data location:** "bank data" was accepted for "what data, and where is it stored?". Now one follow-up asks where (`saysWhere`), and a short reply is added to the answer: "bank data, stored in the EU". "Not sure" keeps the answer, and the quality check lists "where the data is stored is not given".
- **Data in the record:** in the contractor flow only system access is asked, so the record dropped the data details entirely. The "Data and system access" row now shows whenever there is access.
- **Relative dates:** "next week", "ASAP" and "next month" are stored as the date they stood for: "19 Oct 2026 (next week)" (`datedWhen`). Answers with a number or a month stay as given.

## Update: category ties fixed (finding 21)

- **Ties:** two categories with the same number of keywords no longer go to whichever is listed first (IT hardware). The category named last in the head of the first message wins: the words before "for", "to", "with", "that" or a comma (`bestCategory`). "Software to manage our laptop fleet" is software, "a transaction monitoring system" is software and "laptops for the software team" is IT hardware.
- **Verbs:** a goods keyword right after "to" no longer counts ("a tool to monitor alerts", "a service to screen clients").
- **Keyword:** the business process keyword "sanctions screening" is now "sanctions", so "a service to screen clients against sanctions lists" is a business process service. Before, it fell through to the consulting fallback and was offered the consulting framework.
- **Tests:** the known-issue test is a regular test now, plus a 9-case category rule table in `routes.spec.js`.

## Update: catalogue matching fixed (finding 1)

- **Whole words:** catalogue and category keywords now match whole words, plurals included (`kwHit`). "pens" no longer matches inside "expenses", "monitor" inside "monitoring", or "screen" inside "screening". A trailing `*` marks the few keywords that are deliberate stems (`consult*`, `develop*`, `telecom*`, …).
- **Demand type:** catalogue items carry a type. Hardware and office items are offered only for goods, and the licence only for software.
- **Value:** the catalogue is offered only when the value fits the catalogue price (`catalogueFits`). That means at most twice price × quantity, or, with no quantity yet, no more than the business-led sourcing threshold. "A tool to monitor sanctions alerts, 400k" is no monitor order.
- **Effect on categories:** a sanctions screening service is now "Business process services" instead of "IT hardware". It no longer gets "a purchase of goods, out of scope" in the outsourcing check.
- **Tests:** the three known-issue tests are regular tests in `tests/e2e/routes.spec.js`, plus a keyword rule table, a value-fit rule table and two conversations.
- **Found while fixing (finding 21, since fixed):** category ties went to the first category in the list, so "Software to manage our laptop fleet, 20k" was classed as IT hardware and offered a laptop.

## Update: commit 7baf311 (outsourcing rework)

**The fixes:**
- **U1:** only an explicit "a bank would not do this" gives no; past practice is ignored, as paragraph 26 requires.
- **U2:** "could" wins over a leading "no". Past practice alone ("never done it") is recorded as "not sure", which leaves the outsourcing result to be determined.
- **U3:** the entity named with "branch", "entity", "office" or "bank" wins, otherwise the first place mentioned. Where data is stored and where the provider sits no longer count. When nothing names an entity, the question is asked.

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

**Defects introduced or exposed.** U1–U3 are fixed on this branch and guarded by tests in `tests/e2e/outsourcing.spec.js`:

| # | Finding | Where | Confirmed by |
| --- | --- | --- | --- |
| U1 (High), **fixed** | **Mentioning past practice flips the result.** "We have never done this ourselves", "we don't do this today" or "we have always bought this in" make KYC, payroll or accounts payable "Not outsourcing (likely)". This contradicts paragraph 26 ("even if the institution has not performed this function in the past") and the commit's own intent. The in-house question is then skipped, the check step says "It's not work a bank would do itself", and once confirmed the document records "Checked by the requester: Yes, confirmed". Example: a €600k, 2-year offshore KYC service. | `inHouseFromText` (`index.html` 697 runs before 699) | Test |
| U2 (Medium), **fixed** | **"No, but a bank could realistically do it" is read as no** in answer to the new question. | `readAnswer('in_house')` | Test |
| U3 (Medium, existing before this commit), **fixed** | **The provisioning legal entity is the first list match anywhere in the text.** "Singapore branch … stored in the EU" becomes the EU entity, and that raises a false offshoring flag. | `entityFrom` (`index.html` 672) | Test |
| U4 (Medium, judgement) | **Paragraph 28(g) is applied by category, which is too broad:** <ul><li>A 3-year managed contract-review service counts as "legal advice or representation".</li><li>A managed WAN network counts as "telecom lines and utilities".</li><li>A provider-run compliance e-learning platform counts as a service "the bank would not otherwise perform".</li><li>Event services are cited as if paragraph 28(g) listed them.</li><li>Contingent labour appears under the "Excluded under paragraph 28" step although that paragraph does not cover it.</li></ul> Confirm the mapping with the outsourcing team. | `excludedType` | Run (rule probe) |
| U5 (Medium) | **ICT is judged too broadly in the future rule set.** Any ongoing service with the technology flag is "Out of scope: ICT service under DORA". The technology flag is derived broadly, so KYC operations (a non-ICT business process service) shows as out of scope of EBA/GL/2026/09. | `futureRule` | Run |
| U6 (Medium, design trade-off) | **Local rules are no longer prompted.** For non-EU entities, local requirements now appear only in the small print ("local requirements may add"). Nothing prompts the local notification duties (for example MAS, PRA or APRA material outsourcing or service-provider notifications). Suggest a "local add-on check" line in the record for non-EU entities. | `detailHTML`, `intakeRecord` | Code |

## Verdict

**Demo-ready, not pilot-ready.** All five buying routes work end to end, offline and with AI. The conversation features the README promises also work: corrections, checks, skipping, the improvement round and the outputs. When the AI fails, the app falls back to standard questions cleanly. Escaping of user and AI text is careful throughout.

Three things blocked real users. The first is now fixed:

1. **Fixed: the rules engine could send ordinary bank requests down the wrong route.** It matched keywords inside other words and did not check the value against the catalogue price. A €400k SaaS tool became a stationery catalogue order.
2. **The server is an open LLM proxy unless `ACCESS_CODE` is set**, and the code can be guessed quickly.
3. **Real intake data would go to free LLM tiers**, and the page never warns about it.

## Test results

| Suite | Result |
| --- | --- |
| API (`tests/api`, node:test) | 18 passed, 1 known bug recorded as `todo` |
| End-to-end (`tests/e2e`, Playwright, Chromium) | 127 passed: 123 behaviour tests and 4 known-issue tests that fail as expected |
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
- **Real LLM output quality.** That needs real keys. Run the app with `GEMINI_API_KEY=... npm start` and walk through the examples on the welcome screen (six new-demand cases, one per other route).
- **Browsers other than Chromium.**

## Findings

Each finding says how it was confirmed:
- **Test:** reproduced by an automated test (see `tests/e2e/known-issues.spec.js` or `tests/api/llm.test.js`).
- **Run:** seen while running the app.
- **Code:** read in the code, not run.

### Critical

| # | Finding | Where | Confirmed by |
| --- | --- | --- | --- |
| 1, **fixed** | **The catalogue route is picked by substring keyword matches, and the value is ignored.** "A SaaS tool to track travel expenses for 400k" → "Stationery bundle is in our catalogue" ("pens" in "expenses"). "Transaction monitoring system for AML, 400k" and "Sanctions screening service, 300k" → "27\" monitor". The intake then asks two catalogue questions and closes. | `catalogueMatches`, `CATALOGUE`/`CATEGORIES` keywords (`index.html` ~314–319, 565–580) | Test |
| 2 | **Intake data goes to free LLM tiers with no notice.** The full conversation is sent to Gemini, Groq or Mistral (the README notes that Mistral's free plan may train on requests). The welcome screen does not say "dummy data only". | `index.html` ~2554, 2636 | Code |

### High

| # | Finding | Where | Confirmed by |
| --- | --- | --- | --- |
| 3 | **Without `ACCESS_CODE` the server is an open LLM proxy.** The browser sends the whole system prompt, and there is no per-client rate limit, so anyone with the URL can use the keys or exhaust the quota. | `api/llm.js` 311–322 | Code |
| 4 | **The access code can be guessed quickly.** Only `?verify` waits 700 ms. A wrong code on POST is refused at once. The comparison is not timing-safe. `?code=` puts the code in logs and browser history. | `api/llm.js` 268–274, 311 | Code (POST 401 checked in a test) |
| 5, **fixed** | **An amount the AI returns as text is read wrongly.** "€400k" becomes 400, so a €400k request drops to business-led quotes. `parseMoney` already handles this but is not used here. | `normFact` (`index.html` ~1449–1460) | Test |
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
| 21, **fixed** | **Category ties go to the first category in the list.** With one keyword each, IT hardware wins, so "Software to manage our laptop fleet, 20k" is classed as goods and offered a laptop from the catalogue. "A dashboard tool to monitor sanctions alerts" and "a service to screen clients" are also classed as IT hardware. Their 300k–400k budgets now keep them off the catalogue, but the outsourcing check still treats them as goods. | `offlineRead` category scoring, `catFromText` | Test |

### Low

| # | Finding | Confirmed by |
| --- | --- | --- |
| 15, **fixed** | **Acronyms lose their capitals in generated text:** "fits it hardware", "It provides hR operations", "External java developer". | Test and run |
| 16 | **A closing remark after the results gets a misleading reply.** "thanks" gets "Updated. Here are the revised service description and route." although nothing changed. | Test |
| 17, **partly fixed** | **The second off-topic answer is shown as "Answer quality 8/10" with "That helps."** It is correctly stored as "To be determined", but the feedback contradicts that. The score is no longer shown; the "That helps." reply is unchanged. | Run |
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
   - Done: match keywords as whole words.
   - Done: offer the catalogue only for the item's own demand type, and only when the value fits the catalogue price.
   - Done: run AI-returned amounts through `parseMoney`.
   - Done: the matching tests moved from `known-issues.spec.js` to `routes.spec.js`.
   - Done: break category ties on the head noun of the request, not list order (finding 21).
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
