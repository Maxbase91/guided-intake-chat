# Guided Intake Chat

A conversational procurement intake prototype. The user describes a need in plain language. Fixed rules pick one of three buying routes: catalogue, contract call-off (including external workers through the staffing contract) or new demand. New demand is business-led sourcing with three quotes up to €50,000 and procurement-led sourcing with an RFP above it and define exactly which details each route needs. The AI runs the conversation: one question at a time, with a concrete example, reading the answers. It never decides the route.

The chat runs in stages shown in a step bar at the top (Your need → Timing and place → Supplier and approval → Risk and data → Success criteria → Review). Only stages with open questions for the chosen route appear. When a stage is finished, a short recap card shows what was captured, and the side panel groups the details by stage.

Only what is really needed is asked. Sourcing, risk and contract details are asked only when relevant to the route and the answers so far. Cost centre, payment model, subcontracting, certifications, service levels, ownership of work and evaluation weights are not asked (they are picked up if the user mentions them).

Each answer is checked against what is already known: vague answers, a budget that doesn't fit the day rate and duration or the size of the work, a date in the past or tighter than the route's usual lead time, "no personal data" or "no technology service" when the context says otherwise, and "no impact if delayed" when the need is driven by an audit or regulation. Rules run first, and the AI can raise one further concern. A check shows as a short "Quick check" message; the user can correct the answer or keep it. Each detail is checked at most once and a conversation gets at most three checks. At the end an overall quality rating (Strong, Good, Fair, Needs work) with a score and the open points appears with the results and in the business requirements document.

## Two outputs: description and captured details

The **service description** says what is being bought and why, for senior stakeholder review: name, what it is, who it is for, the problem it solves, functions it supports, key capabilities, main benefits, what changes from today (and why external support is needed), how success is measured, and regulatory and control benefits. A section only appears when an answer backs it. Below the sections, the same description is written as one summary paragraph of at most 1,000 characters. It never contains amounts, dates, location, suppliers, budget approval, the buying route or risk answers: a code check removes these, even if the AI writes them.

Everything procurement needs is **captured separately** as a table: route, budget and approval, quantity, timing, location, supplier, personal data, ICT service (DORA) and outsourcing flags, impact if it doesn't go ahead. The business requirements document contains both.

Purpose questions (sourcing, quotes for services, external workers): "What problem does this solve, and for whom? And what happens if it's delayed?" and "What do you use today, and why can't it be done internally?". The AI records several details from one answer.

**ICT and outsourcing** follow a decision tree run by rules, not a picker. The technology question is asked only when the rules can't tell (for example consulting without any IT context); the DORA service type (from the 19 types of the register of information) is proposed from the description. The outsourcing question is asked only for an ongoing technology service. Both are shown as flags for review, never as a final classification.

All reference data (catalogue, contracts, preferred suppliers) is mock data. Use dummy requests only.

## How it is built

- `index.html` is the whole front end. No build step.
- `api/llm.js` is a Vercel serverless function. It holds the API keys and forwards calls to Gemini, Groq or Mistral. Keys never reach the browser.
- The buying channel is decided in the browser by deterministic rules. The AI never picks the channel.

## Deploy on Vercel

1. Import this repo in Vercel. Framework preset: **Other**. No build command.
2. Add environment variables under **Settings → Environment Variables**:
   - Any of `GEMINI_API_KEY` (https://aistudio.google.com/apikey), `GROQ_API_KEY` (https://console.groq.com/keys), `MISTRAL_API_KEY` (https://console.mistral.ai, free Experiment plan; it may use requests for training, so dummy data only)
   - Optional: `ACCESS_CODE` to stop strangers using your key. Visitors are asked for it once.
   - Optional: `LLM_PROVIDER` (`gemini`, `groq` or `mistral`, which goes first), `GEMINI_MODEL`, `GROQ_MODEL`, `MISTRAL_MODEL` (if missing or unavailable, the best available model is picked automatically)
   - Check all providers at `/api/llm?check=1&code=YOUR_ACCESS_CODE` (shows each model and the Groq rotation)

Default order: Gemini, then Groq, then Mistral. When a model hits its limit the server moves to the next one and rotates across several Groq and Mistral models (their limits apply per model). If everything is briefly limited, the page waits the few seconds the provider asks for and retries once, then falls back to rule-based questions.
3. Redeploy so the variables take effect.

The page checks `/api/llm` on load. If the server has a key, the pill shows **AI on**, and after the first answer it names the provider that actually replied (Gemini, Groq or Mistral). Hover over it to see the fallback order. Without a key, it runs offline keyword rules.

## Run locally

Open `index.html` in a browser and paste a key into `CONFIG.keys` at the top of the script, or into the **Rules** panel (key fields only appear when no server is found). Do not commit a key.

## Change the rules

Thresholds sit in `CONFIG.thresholds` and can also be changed live in the **Rules** panel. Catalogue, contracts and preferred suppliers sit in section 2 of the script.

## Answer checks against nonsense and repeats

An answer that has nothing to do with the question (a recipe, a joke) is caught by rules and by the AI, and the question is asked again once. If the second answer is still unrelated, the detail is recorded as not given and listed as an open point; it never reaches the description. One answer can fill several details (for example the problem, who it is for, today's solution and the impact of delay), and nothing the user already said is asked again. Chat replies never show internal field names or values.

## Quality thresholds and improvement round

Two thresholds sit in `CONFIG.thresholds` and in the **Rules** panel:

- **Per-answer tip** (`answerTip`, default 5): when an answer for new demand scores 5/10 or less (for example KPIs or acceptance without any number), the chat gives one specific tip with an example and asks for a bit more. "Keep it as is" keeps the answer and notes it for the buyer; anything else is added to the answer. At most once per question and three times per conversation.
- **Minimum quality** (`qualityMin`, default 75 = Good): when the finished new-demand request scores below it, the chat says so after the route card, lists the points that would strengthen it (skipped or thin answers, weak sections) and offers to go through them. Afterwards the description is rebuilt and the new rating is shown. "Submit anyway" stays available; the submission, the payload and the document record that it was submitted below the threshold.

The score: 100, minus 15 per warning (skipped detail, unusable answer, kept despite a check), minus 5 per note, minus half the share of missing details, minus 3 per partial section and 8 per risk section in the detailed description (at most 30). Floor 35. Strong ≥ 90, Good ≥ 75, Fair ≥ 55, otherwise Needs work.

## Executive service description (new demand)

New demand gets the format of an executive service description: a headline (name, tagline and 50–100 words), an executive description of 150–250 words and a service summary table (service name, target audience, supported functions, business problem solved, key capabilities, key benefits, unique selling points, KPIs / success measures, regulatory / governance benefits). Business-led demand gets the same parts, shorter. Catalogue orders and call-offs keep a short description.

For the profile points (audience, functions, benefits, unique selling points, KPIs, regulatory benefits) the chat suggests an answer tailored to the request; the user accepts it in one tap or changes it. Above the threshold each point is a separate question, below it they are bundled into one. Each answer gets a small score (for example "Answer quality 9/10").

## New demand: guided service description (front door + sourcing intake)

New demand combines the front door with a tiered version of a detailed service-description intake:

1. **Your need**: what, value, duration, and whether technology is involved (only if the rules can't tell). The first message is classified against a Level 4 category list (mock) with match % and reasoning. Software is not asked "how many users or licences" up front: the chat asks who will use it and roughly how many people together with the audience ("not sure yet" is fine), and the licence count and pricing model are listed as points to confirm with suppliers. Catalogue orders still ask the count first.
2. **Purpose and profile**: problem and impact of delay, audience and functions (suggested), today's solution and why external, unique selling points, benefits and regulatory benefits (suggested).
3. **Scope and deliverables**: what the provider does (played back as "The Service Provider shall…"), out of scope (suggested), acceptance and sign-off (suggested), staff qualifications, volumes.
4. **Running the service** (ongoing services): service levels and KPIs, support model and tools (technology only), governance, reporting, change and escalation (suggested standard pack).
5. **Timing and delivery**, 6. **Budget and supplier** (plus supplier standard terms if a supplier is named).
7. **Data and classification**: data, system, money and account access; legal entity, technology and "done by our teams today" only when unclear; dependencies and assumptions; anything else.
8. **Check**: everything the rules worked out (category, entity, ongoing or one-off, done in-house, technology, possible critical or important function, access, offshoring) is shown in plain words with what it means. The user confirms or corrects it in their own words.

Below the threshold (business-led) the same flow is lighter. Any question can be skipped ("To be determined").

**Outsourcing** is determined per legal entity: entity → regulator → instrument → that instrument's test → confirmed facts → result with reasons. The rule matrix (EBA/GL/2019/02, PRA SS2/21, MAS Notice 658, HKMA SA-2, APRA CPS 230, OSFI B-10, US Interagency Guidance 2023) and the change watch are data in the code and must be replaced with the organisation's own entity-to-regulator matrix. Results are flags for the outsourcing review, never final determinations. ICT (DORA) is a separate flag.

**Outputs** for new demand: executive service description; detailed service description (25 sections); structured sourcing input attributes; materiality and governance input summary (materiality always "to be determined"); compact sourcing request text; quality check by section; final Level 4 validation.

All entities, categories and suppliers in the code are mock data.
