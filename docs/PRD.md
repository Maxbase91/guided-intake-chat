# Guided Intake Chat: Product Requirements

| | |
|---|---|
| Product | Guided Intake Chat, the procurement front door of a European bank (prototype) |
| Status | Working prototype on https://guided-intake-chat.vercel.app, behind an access code. It runs on test data. |
| Last updated | 14 October 2026 |
| Related | [Architecture](ARCHITECTURE.md) · [Design](DESIGN.md) · the in-app **How it works** panel (generated from the code) |

## 1. Problem

Colleagues who need to buy something rarely know the buying channel, which details procurement needs, or which risk
checks apply. Intake forms ask everything of everyone. Buyers then chase missing details for days, and simple purchases
wait behind sourcing work.

## 2. Goal

A colleague describes the need in plain words. The chat then:
1. finds the right **buying route** with fixed, auditable rules;
2. asks **only what that route needs**, one question at a time, each with an example;
3. classifies the request: Level 4 category, ICT service (DORA), outsourcing (EBA/GL/2019/02), data and access;
4. hands procurement a **service description** (or a short purchase request) and a **record** of everything captured.

The AI holds the conversation and writes the text. **It never decides the route, the classification or the checks.**

## 3. Users

| User | Needs |
|---|---|
| Requester (any colleague) | A fast, plain-language way to ask for something; no procurement vocabulary; small purchases done in minutes |
| Buyer (procurement) | Complete, consistent requests; the route and reason; what is still open |
| Risk, ICT and outsourcing reviewers | Early flags (data access, DORA ICT service, outsourcing, critical or important function) with the reasons behind them |
| Procurement owner (admin) | Thresholds, taxonomy, suppliers, frameworks and catalogue under control, not editable by requesters |

## 4. Scope

### 4.1 Buying routes, decided by rules in this order

| Route | When | What is asked |
|---|---|---|
| **Catalogue order**, fixed-price item | A catalogue item of the request's category is named, and the value fits its price | How many, when, where |
| **Catalogue order**, punch-out shop | A supplier's shop covers the request's Level 4 (florist, catering, office supplies, print, gifts, books, courier…), up to the shop's maximum order | Order value, when, where |
| **Contract call-off** | An active framework covers the request's Level 4. External workers go through the staffing framework | Scope, when, how long, value, data |
| **Low-value purchase** | Value ≤ €5,000; no catalogue entry or framework; not software or external workers; no technology service; no access to our data or systems; not an ongoing service over 12 months | What, how many (goods), value, what it is for, when, where, supplier, data access (services) |
| **New demand: business-led** | Value ≤ €50,000 | Short service description (three quotes) |
| **New demand: procurement-led** | Above €50,000 or value unknown | Full service description (RFP) |

The thresholds are set in the code by procurement (`CONFIG.thresholds`):
- low-value €5,000;
- business-led €50,000;
- material spend review €1,000,000;
- quality minimum 75;
- per-answer tip at 5/10.

Requesters cannot change them.

### 4.2 Questions

- **Ask only what is needed.** These are never asked unless the requester raises them:
  - cost centre, payment model, subcontracting, certifications;
  - service levels for one-off work, ownership of work, evaluation weights.
- **The kind of work sets the wording** (`kindOf`):
  - **product** (software, data): users and how many, must-haves;
  - **project:** sponsor, outcomes, success measures, steering;
  - **ongoing service:** who relies on it, service levels, governance;
  - **external workers:** role profile;
  - **goods:** item and quantity.
- **New demand runs in stages:** need → purpose and profile → scope → running the service → timing → budget and supplier
  → data and classification → check.
- **Suggested answers** for the profile, scope and service points can be accepted in one tap, edited in words ("drop
  the second one", "add … as a KPI") or skipped.
- **Software:** "who hosts and runs it?" is asked unless the request already says.
- **Check step:** everything the rules worked out is shown in plain words. The requester confirms or corrects it.

### 4.3 Classification

- **Level 4 category.** The list has about 400 entries with Level 1–3 parents and descriptions, and every entry belongs
  to one of 20 buying categories (themes). The category decides the questions and the outsourcing test.
  - The rules pick the Level 4 entry.
  - With AI, the model chooses from about 20 candidates.
  - The requester can change it at the check step or by searching in the summary.
- **ICT service (DORA):** whether technology is involved, and the DORA service type proposed from the description (SaaS,
  licensing, infrastructure…).
- **Outsourcing (group standard EBA/GL/2019/02):**
  - exclusions under paragraph 28;
  - recurrent or ongoing performance (paragraph 26);
  - work the bank would or could realistically perform itself (paragraph 26).

  A critical or important function (paragraphs 29–31) is a separate flag. The legal entity is captured for the contract
  but doesn't change the test. EBA/GL/2026/09 is final but has no application date yet. It is not shown, and 2019/02
  applies until it does.
- **Review flags:**
  - data protection;
  - ICT review;
  - outsourcing assessment;
  - critical or important function;
  - access review;
  - offshoring;
  - material spend review (≥ €1m);
  - non-preferred supplier;
  - single-source justification;
  - bank checks: auditor independence, instructed through Legal, gifts and hospitality, data licence, record keeping,
    data transfer.

### 4.4 Outputs

| Route | Output |
|---|---|
| New demand | **Executive service description**: headline, executive description, summary table. It never contains amounts, dates, places, suppliers, the route or risk answers |
| Catalogue, low-value | **Purchase request**: short summary, no AI call |
| Call-off | Short description |
| All | **Captured for procurement** record, route card with reason, reviews and next steps, quality check ("Still to clarify"), JSON payload on submit |

**Switched off for now, to save tokens:**
- the detailed service description (25 sections);
- the business requirements document;
- the sourcing request text.

They are still built from the answers (no AI) and travel in the JSON payload.

### 4.5 Conversation behaviour

- **Corrections at any point:** "the budget is 600k, not 400k". The app re-runs the route and the questions and says
  what changed.
- **Questions back are answered:** "why do you need that?", "what would you suggest?", pushback on the route.
- **Side remarks are kept out of the answer** ("btw…").
- **Answers are checked for:**
  - vague answers;
  - dates in the past or too tight for the route;
  - budgets that don't fit the work;
  - "no data" or "no technology" against the context;
  - off-topic answers.

  At most one check per detail and three per conversation.
- **When AI is off, out of quota or slow,** the rules ask standard questions. Nothing blocks.

### 4.6 AI safeguards (the AI is not trusted with facts)

- **AI-proposed facts are screened.**
  - Placeholders ("unknown") and classification flags are only accepted where the conversation allows.
  - Free text is kept only when half its words are the requester's.
- **Figures must be the requester's**, with the same unit, or from the app's own standard draft. This applies to
  suggestions and to the description. Points or sentences with invented figures are dropped.
- **Length limits:**
  - suggestion lines 30 words;
  - chat replies over 45 words are cut to the first sentence and the question;
  - description fields have word limits.
- **The rules always win:** route, thresholds, classification, and the category named at the start of a request (unless
  the AI's Level 4 fits clearly better).

## 5. Non-functional requirements

| Area | Requirement | Today |
|---|---|---|
| Cost | Run on free AI tiers for testing | About 15 AI requests and 40k input tokens per full new-demand conversation. Small purchases need about 3 requests |
| Resilience | Several providers, automatic fallback, offline rules | Gemini → Groq → Mistral → OpenRouter; rules-only fallback |
| Latency | A turn should feel conversational | 2–20 s per AI turn depending on the provider. Replies type out; the rules answer instantly |
| Privacy | No real data in a prototype on free tiers | Access code; keys only on the server. **Dummy data only** |
| Scale | ~400 Level 4 entries, hundreds of suppliers | Prompt size independent of list size; matching < 1 ms |
| Auditability | Every route and flag explainable | The route card states the reason; How it works documents every rule and prompt, generated from the code |

## 6. Success measures

| Measure | Current (test data) |
|---|---|
| Right Level 4, rules only (60 realistic requests) | 73% (category 87%) |
| Right Level 4 with AI (32 live requests) | 78% |
| Right entry among the AI's candidates | 88–93% |
| Questions for a small purchase | 2 (catalogue shop) to 4 (low-value) |
| Tokens per new-demand conversation | ~40k input |

## 7. Known gaps and risks

**Security and pilot readiness**
- **The AI sees the conversation on free provider tiers.** Use dummy data only. Before a pilot, move to paid endpoints
  with no data retention and show a "dummy data only" notice.
- **The server is protected only by an access code.**
  - Add a per-client rate limit.
  - Compare the code in constant time.
  - Build the system prompt on the server.
  - Drop `?ai=` and `?check=` in production.
- **No security headers** (CSP, frame-ancestors).

**Behaviour**
- **Rule extraction without AI** can store an answer of the wrong kind for some questions. The budget approval is
  already guarded.
- **AI text can still change meaning without changing a number.** Suggestions are proposals the requester accepts or
  edits.
- **Level 4 recognition misses paraphrases** that share no words with any entry ("documents to Milan by tomorrow" =
  courier). Remedy: semantic search with a free embedding model.
- **Compliance flags come from answers.** They are flags for review, never final determinations.
- **Accessibility basics are incomplete:**
  - the message list has no live region;
  - the editor has no focus management.

**Data**
- The Level 4 list, suppliers, frameworks and catalogue are **realistic test data**; the legal entities are mock data.
  The real lists are loaded with the import script (see [Architecture](ARCHITECTURE.md#7-reference-data)).

## 8. Next steps

1. Import the real Level 4 list, suppliers, frameworks and catalogue.
2. Lock down the server (rate limit, server-side prompts, no testing overrides in production) and add a dummy-data notice.
3. Add semantic search for Level 4 recognition, if paraphrase misses matter in the real data.
4. Accessibility: a live region for messages, focus handling in the editor and panels.
5. Decide whether to switch the detailed service description back on for RFPs (costs tokens) or keep it rules-built.
