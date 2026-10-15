# Guided Intake Chat

A conversational procurement intake for a European bank, built as a prototype. A colleague describes what they need in
plain words, and the chat:
- finds the buying route with fixed rules (catalogue, contract call-off, low-value purchase, or new demand with three
  quotes or an RFP);
- asks only what that route needs, one question at a time;
- lets the requester choose the Level 4 category from 2–3 candidates, then classifies the request (ICT service under
  DORA, outsourcing under EBA/GL/2019/02);
- hands procurement a service description, or a short purchase request, plus a record of everything captured.

The AI holds the conversation. It never decides the route or the classification.

Live at https://guided-intake-chat.vercel.app (access code required). **Dummy data only**: the AI runs on free provider
tiers.

## Documentation

| Document | Contents |
|---|---|
| [docs/PRD.md](docs/PRD.md) | Problem, users, scope, routes and thresholds, requirements, success measures, known gaps, next steps |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, the turn flow, AI calls and guardrails, classification, reference data, server, deployment |
| [docs/DESIGN.md](docs/DESIGN.md) | Principles, layout, components, visual language, voice, states, accessibility |
| **How it works** (link in the app) | The full specification generated from the code: every rule, question and exact prompt |
| **Decision tree** (link in the app) | The same rules for business readers: the whole tree as one picture, the yes/no ladders for the route and the checks, which question drives which decision, and worked examples. Generated from the code; downloads as Markdown (with a Mermaid diagram) or as an SVG picture |

## What is in this repository

| Path | Role |
|---|---|
| `index.html` | The whole application, with no build step. It includes the reference data (one JSON block), the How it works specification and the Decision tree |
| `api/llm.js` | Vercel serverless function. It holds the AI keys and the access code, and tries Gemini, Groq, Mistral and OpenRouter in turn |
| `vercel.json` | Function timeout (60 s) |
| `docs/` | Product, architecture and design documentation |

Tests, the local server, the mock providers, the data import script and the test data stay on the developer's machine.
They are not in Git (see [Architecture §10](docs/ARCHITECTURE.md#10-development-local-only)).

## Deploy

**Set up Vercel:**
- Push to `main`: Vercel deploys to production.
- Framework preset: "Other". No build command.

**Environment variables:**
- at least one of `GEMINI_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `OPENROUTER_API_KEY`;
- `ACCESS_CODE`;
- optional `LLM_PROVIDER` (which provider goes first) and `GEMINI_MODEL`, `GROQ_MODEL`, `MISTRAL_MODEL`,
  `OPENROUTER_MODEL`.

**Check providers:** `/api/llm?check=1` with the access code in the `x-access-code` header.

## Settings

The thresholds are in `CONFIG.thresholds` at the top of the script in `index.html`. They are set by procurement and
cannot be changed by requesters:

| Setting | Value |
|---|---|
| Low-value limit | €5,000 |
| Business-led sourcing limit | €50,000 |
| Material spend review | €1,000,000 |
| Quality minimum | 75 |
| Level 4 candidates shown from | 75% match (2–3 shown, the requester chooses) |
