# Level 4 recognition at ~400 categories

October 2026. Test data: 395 Level 4 entries for a European bank, with Level 1–3 parents and a description each, in 20
buying categories. It has 183 fictional suppliers (preferred per Level 4) and 40 frameworks (`data/taxonomy-test`).

## Would 400 categories break the app?

Before this change, partly:

| Area | With 22 entries | With ~400, unchanged code |
|---|---|---|
| AI prompt on the first message and at the check step | the whole list, ~250 tokens | the whole list, ~4,000 tokens per call. That hits per-minute limits on free tiers (Groq) and uses up the daily quota much faster. |
| Category editor in the summary | a dropdown | a 400-option dropdown |
| How it works | one row per entry | 400 rows |
| Defaults after a category change | the first entry in the list | the same, which is now usually wrong |
| Matching | substring keywords | noisy: common words decide among 40 similar entries per category |

Now:

- **The AI never gets the whole list.** It gets about 20 candidates: the closest entries across all 395, plus the rules' own picks.
- **The editor is a search box**, and How it works shows counts per category.
- **Defaults use the scorer.**
- **Matching weighs rare words and the subject of the request.**

## Token use (one full new-demand conversation, mock providers, same answers)

| | Before (22 entries) | Now (395 entries) |
|---|---|---|
| AI requests | 15 | 15 |
| Input tokens, whole conversation | ~40k | ~41k |
| First chat turn | ~3,560 tokens | ~3,700 tokens |
| Candidate line in the prompt | whole list | 1,740 characters (the whole list would be 15,029) |

Matching takes about 0.1 ms per request and building the shortlist about 1 ms (`tests/e2e/l4-scale.spec.js`).

## Recognition without AI (the rules), 60 realistic requests

The requests in `tests/fixtures/l4-benchmark.json` were written by someone who saw only the entry names and their groups,
not the descriptions or search terms. 32 of them are hard cases with a near neighbour.

| Measure | Result |
|---|---|
| Right category (theme) | 87% |
| Right Level 4, first pick | 73% |
| Right Level 4 among the rules' top 3 | 77% |
| Right Level 4 in the AI's shortlist | 93% |

**What the rules still get wrong:**
- **Close neighbours:**
  - peripherals vs laptops when docking stations are mentioned;
  - analyst research vs investment research;
  - automated clearing house vs CCP clearing fees;
  - BI software vs BI development;
  - GPU capacity vs general cloud capacity.
- **Paraphrases that share no word with any entry:**
  - "documents need to go to Milan by tomorrow" (courier);
  - "main partner of the city marathon" (sponsorship);
  - "move 15 years of loan history onto the new core platform" (data migration);
  - "chatbot on top of GPT" (generative AI software).

  These four are the 7% missing from the shortlist. With AI, the model names the item in a category list's words
  (`l4_terms`, for example "courier delivery"), and the app looks those up in the whole list.

## Recognition with AI (live)

To be measured on the live site (first message only, the AI's Level 4 against the expected one); see below.
