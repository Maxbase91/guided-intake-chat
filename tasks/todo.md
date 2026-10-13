# Scale to ~400 Level 4 categories (plan: ~/.claude/plans/can-you-based-on-refactored-panda.md)

- [x] Test taxonomy CSVs (5 authors) in data/taxonomy-test (395 entries, 183 suppliers, 40 frameworks)
- [x] scripts/import_taxonomy.py → JSON block in index.html
- [x] 4 new rule themes (utilities, fin-infra, travel, insurance)
- [x] Weighted scorer, classifyL4, l4Shortlist, shortlist in the AI prompt, consistent category/L4, l4_terms
- [x] Order-dependent lookups, ✎ editor search, How it works per theme
- [x] preferredFor / contracts per L4, supplier matching compiled once
- [x] Remove the Rules button and drawer; 401 re-opens the gate
- [x] OpenRouter provider (api/llm.js, mocks, tests)
- [x] Benchmark fixture (separate author) + tests/e2e/l4-scale.spec.js
- [x] Full suite green (151 e2e, 21 API), docs (README, ASSESSMENT, How it works)
- [x] Deploy, verify production, live AI benchmark, docs/l4-recognition-report.md (AI section)
