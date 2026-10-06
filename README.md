# Guided Intake Chat

A conversational procurement intake prototype. The user describes a need in plain language. The AI asks only for what is missing and drafts a service description. Fixed rules then pick the buying channel: catalogue, contract call-off, P-card, quick quote, sourcing project or external workers.

All reference data (catalogue, contracts, preferred suppliers) is mock data. Use dummy requests only.

## How it is built

- `index.html` is the whole front end. No build step.
- `api/llm.js` is a Vercel serverless function. It holds the API key and forwards calls to Gemini or Groq. The key never reaches the browser.
- The buying channel is decided in the browser by deterministic rules. The AI never picks the channel.

## Deploy on Vercel

1. Import this repo in Vercel. Framework preset: **Other**. No build command.
2. Add environment variables under **Settings → Environment Variables**:
   - `GEMINI_API_KEY` (from https://aistudio.google.com/apikey), or `GROQ_API_KEY` (from https://console.groq.com/keys)
   - Optional: `ACCESS_CODE` to stop strangers using your key. Visitors are asked for it once.
   - Optional: `LLM_PROVIDER` (`gemini` or `groq`), `GEMINI_MODEL`, `GROQ_MODEL`
3. Redeploy so the variables take effect.

The page checks `/api/llm` on load. If the server has a key, it shows **AI on · Server**. Without one, it runs offline keyword rules.

## Run locally

Open `index.html` in a browser and paste a key into `CONFIG.keys` at the top of the script, or into **Settings**. Do not commit a key.

## Change the rules

Thresholds sit in `CONFIG.thresholds` and can also be changed live in **Settings**. Catalogue, contracts and preferred suppliers sit in section 2 of the script.
