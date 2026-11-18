# ADR 0001: Rules and configuration as data, in Postgres

| | |
|---|---|
| Status | Accepted |
| Date | 18 November 2026 |

## Context
The routing rules, thresholds and channel names were code in `index.html`. Procurement could not change them without a
developer, and nothing recorded which rule had decided a request. The prototype should show that the business
maintains the rules and that every decision can be traced.

## Decision
- **Rules are decision tables.** A rule is ordered rows of conditions on named facts; the first row that holds gives
  the outcome. `engine.js` evaluates, validates and tests them, in the page and on the server.
- **The configuration is one document** (`params`, `channels`, `categories`, `facts`, `rules`). `db/seed/*.json` is its
  starting state. The page carries it as built-in defaults, so it runs without a server.
- **Postgres (Neon, free tier) holds the published versions.** `config_versions` keeps every published document and is
  never changed; `config_draft` is the working copy for the admin page. The documents are `jsonb`, not one table per
  part: the page reads the configuration whole, a publish is one row, and the admin page validates the whole document
  with the same engine before it publishes.
- **The decision log** (`decisions`) stores the rule, the row, the outcome, the configuration version and the typed
  facts. It never stores text the requester wrote, names or the IP address.
- **Fallback order in the page:** the server's published version, the last copy this browser received, the built-in
  defaults. A running conversation keeps the configuration it started with.
- **Driver:** `pg`. It talks to Neon and to a local Postgres alike, so the tests run against the same code path.

## Consequences
- One runtime dependency is deployed (`pg`); the page loads a second file (`engine.js`).
- A changed threshold, flag or rule row changes outcomes without a deployment once the admin page exists.
- The built-in defaults and `db/seed` must match; a test fails when they differ (`scripts/build_defaults.js --check`).
- What stays code: text matching, Level 4 classification, the outsourcing tree, the question conditions, questions
  worded from the request, the operations-domain guidance, prompts and document templates. Question texts that are the
  same for every request and the category guidance are data (added 18 November 2026; a document saved before that gets
  them from the seed).
- The thresholds are readable in the page source and the repository. The access code protects the AI calls, the
  configuration endpoint and the decision log, not the page file.
- Neon's free tier sleeps when idle: the first read after a pause can take a second or two, which is why the page
  waits at most 2.5 s and then uses its last copy.
