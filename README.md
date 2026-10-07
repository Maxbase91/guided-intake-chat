# Guided Intake Chat

A conversational procurement intake prototype. The user describes a need in plain language. Fixed rules pick one of seven buying routes (catalogue, card purchase, contract call-off, contract renewal, quick quote, sourcing project, external workers) and define exactly which details each route needs. The AI runs the conversation: one question at a time, with a concrete example, reading the answers. It never decides the route.

Sourcing, risk and contract details (background, acceptance criteria, payment model, service levels, ownership of work, data details, criticality, subcontracting, supplier requirements, current provider, evaluation priority, budget approval, cost centre) are asked only when relevant to the route and the answers so far. Details given up front are picked out of any message (by the AI, with a rule-based reader as backup), so a detailed first message skips the questions it already answers. At the end the chat produces two outputs: a holistic service description summary and a full business requirements document (requirements table with priorities, scope, milestones, risk and compliance, commercial terms, evaluation weights, stakeholders, approvals, captured details and the conversation). The document can be edited, printed or saved as PDF, and downloaded as Word or JSON.

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
