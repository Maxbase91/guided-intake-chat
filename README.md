# Guided Intake Chat

A conversational procurement intake prototype. The user describes a need in plain language. Fixed rules pick one of seven buying routes (catalogue, card purchase, contract call-off, contract renewal, quick quote, sourcing project, external workers) and define exactly which details each route needs. The AI runs the conversation: one question at a time, with a concrete example, reading the answers. It never decides the route.

The chat runs in stages shown in a step bar at the top (Your need → Timing and place → Supplier and approval → Risk and data → Success criteria → Review). Only stages with open questions for the chosen route appear. When a stage is finished, a short recap card shows what was captured, and the side panel groups the details by stage.

Only what is really needed is asked. Sourcing, risk and contract details are asked only when relevant to the route and the answers so far. Cost centre, payment model, subcontracting, certifications, service levels, ownership of work and evaluation weights are not asked (they are picked up if the user mentions them).

Each answer is checked against what is already known: vague answers, a budget that doesn't fit the day rate and duration or the size of the work, a date in the past or tighter than the route's usual lead time, "no personal data" or "no technology service" when the context says otherwise, and "no impact if delayed" when the need is driven by an audit or regulation. Rules run first, and the AI can raise one further concern. A check shows as a short "Quick check" message; the user can correct the answer or keep it. Each detail is checked at most once and a conversation gets at most three checks. At the end an overall quality rating (Strong, Good, Fair, Needs work) with a score and the open points appears with the results and in the business requirements document.

## Two outputs: description and captured details

The **service description** says what is being bought and why, for senior stakeholder review: name, what it is, who it is for, the problem it solves, functions it supports, key capabilities, main benefits, what changes from today (and why external support is needed), how success is measured, and regulatory and control benefits. A section only appears when an answer backs it. It never contains amounts, dates, location, suppliers, budget approval, the buying route or risk answers: a code check removes these, even if the AI writes them.

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
