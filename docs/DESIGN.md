# Guided Intake Chat: Design

| | |
|---|---|
| Last updated | 14 October 2026 |
| Related | [PRD](PRD.md) · [Architecture](ARCHITECTURE.md) |

## 1. Principles

1. **One question at a time, with an example.** Every question shows what a good answer looks like ("For example: …").
2. **Ask only what this request needs.** The route and the kind of work decide the questions. A small purchase gets 2–4
   questions, an RFP about 20.
3. **Accept in one tap.** Where a standard answer exists, the chat suggests one tailored to the request. "Use this
   suggestion" accepts it, or the requester edits it in words.
4. **Never block.** Every question can be skipped ("To be determined"). Corrections are welcome at any point. When the
   AI is unavailable, the chat carries on with standard questions.
5. **Say why.** The route card explains the route. Checks say what looks wrong. The check step lists what the rules
   worked out, in plain words.
6. **Plain words.** No procurement or regulatory jargon in questions. Abbreviations are written out. Internal field
   names never appear.
7. **Keep the description clean.** The service description says what and why. Amounts, dates, suppliers, the route and
   risk answers go into a separate record.

## 2. Layout

**Desktop:** two columns.

```
┌───────────────────────────── header ─────────────────────────────┐
│ G  Guided Intake · How it works            AI on · Mistral   New │
├──────────────────────────── step bar ────────────────────────────┤
│ ✓ Your need ── ✓ Purpose ── ● Scope ── ○ Timing ── ○ Check …     │
├────────────────────────────────────────┬─────────────────────────┤
│ chat                                   │ summary (side panel)    │
│  assistant message (types out)         │  route · Level 4 ✎      │
│  user message                          │  ✓ Your need  3 details │
│  cards (classification, recap, route,  │  ● Scope: open items    │
│   description, quality check)          │  …                      │
│  [chip] [chip] [Skip for now]          │                         │
│ ┌───────────────────────────────┐ (→)  │                         │
│ │ Describe what you need…       │      │                         │
└────────────────────────────────────────┴─────────────────────────┘
```

**Phone (≤ 900 px):**
- one column;
- the AI pill and tagline are hidden;
- a **Summary** button opens the side panel as an overlay, which closes with its Close button, Escape or a tap outside;
- the step bar collapses to numbered circles when there are more than four stages, and never scrolls sideways.

## 3. Components

| Component | Behaviour |
|---|---|
| **Header** | Logo, name, the **How it works** link, the AI pill and **New** |
| **AI pill** | "Offline rules", "AI on", or "AI on · Groq" once a provider has answered. Hovering shows the fallback order |
| **Access gate** | A full-screen code prompt, shown when the server requires it. It is remembered for the browser tab, and re-opens if the code stops working |
| **Welcome** | Short intro and example requests by path (new demand, catalogue, call-off, external workers) |
| **Step bar** | Only the stages this route needs. ✓ done, ● current, ○ to come |
| **Messages** | Assistant replies type out: short ones in about a second, long ones line by line in about two seconds. A click, typing or sending shows them in full. With "reduce motion", they appear at once |
| **Chips** | Answer buttons under the last question ("Yes", "Not sure", "Use this suggestion", "Skip for now"; for the category, one per candidate and "None of these"). They appear after the text has finished typing |
| **Classification card** | After the first message, before any other question: 2–3 Level 4 candidates as a numbered list. Each shows the name, code, match % (or "weaker match"), the Level 1 › 2 › 3 path, the reason and a **Choose** button. The first is marked **Suggested**. The chosen one gets "✓ Your choice" |
| **Stage recap** | When a stage is finished: a short card with what was captured |
| **Check step** | A numbered list of what the rules worked out and what it means (outsourcing result, reviews). "Yes, that's right" or a correction in words ("8 is wrong: …") |
| **Route card** | Route name, typical working days, value, **Why**, reviews and next steps. **More options** offers another route (with a justification) and a JSON download |
| **Description card** | Titled **Service description** or **Purchase request**. Text editable in place. Below it: **Captured for procurement** (the record), the **quality check**, **Looks right, submit** and **Copy** |
| **Quality check** | A rating badge (Strong, Good, Fair, Needs work), the score, and one **Still to clarify** list with each point once. An optional point appears only when it improves the description, with **Answer one more question** |
| **Side panel** | The captured details grouped by stage. Finished stages fold to one line; long answers fold to two lines. The pencil edits a detail in place. The category pencil opens a search over all Level 4 entries |
| **How it works** | A full-page specification generated from the code: rules, prompts (behind "Show full prompt"), questions per route, classification, quality, settings. **Download (.md)**, **Print**, Escape to close. It never contains what the requester typed |

## 4. Visual language

**Colour tokens** (CSS variables in `:root`):

| Token | Value | Use |
|---|---|---|
| `--navy` / `--navy-2` / `--navy-3` | #0f2147 / #1b3266 / #2c4a8a | Brand, headings, primary buttons |
| `--amber`, `--amber-soft`, `--amber-ink` | #f2a900, #fff4d6, #8a5d00 | Accent, current step, highlights |
| `--bg`, `--card`, `--line`, `--line-2` | #f5f6fa, #fff, #e4e7ef, #eef0f5 | Page, cards, borders |
| `--ink`, `--ink-2`, `--ink-3` | #141b2d, #4a5470, #7c859e | Text, secondary text, hints |
| `--ok` / `--warn` / `--bad` / `--info` (+ `-soft`) | #11845b / #b4570b / #b42318 / #2c4a8a | Checks, review flags, quality badges |

**Type and shape:**
- **Fonts:** Inter (400–700) for text and Inter Tight (600–700) for headings, from Google Fonts with system fallbacks.
- **Shape:** cards with soft borders and rounded corners; chips as pill buttons; one primary action per card.
- **Status colours:**
  - green: done or confirmed;
  - amber: current, or a review to note;
  - red: a warning, or a review that needs action;
  - blue: information.

## 5. Voice and content

**Questions:**
- Short, second person, one ask per message.
- An example follows in quotes.
- "Why do you need that?" gets the reason.

**Acknowledgements:**
- Brief ("Thanks.", "Okay, noted.").
- They never repeat the answer back at length.
- A reply longer than about 45 words is cut to its first sentence and the question.

**Suggestions:**
- One label per line ("Acceptance criteria: …"), at most 4 points and 30 words per line.
- They use only figures the requester gave, or the standard figures of the app's own draft.

**Checks:**
- Start with "Just to check:" and name the issue.
- They offer to keep the answer ("Yes, that's the total").

**Never shown:**
- internal field names;
- raw AI output;
- amounts or suppliers inside the description;
- a category the rules only guessed, presented as if it were certain.

## 6. States

| State | What the requester sees |
|---|---|
| AI working | Typing dots; input disabled |
| AI unavailable or out of quota | A short note ("The AI has reached its usage limit, so I'm using standard questions for now"). The conversation continues on the rules |
| Access code needed or changed | The gate, with "The access code has changed or expired. Please enter it again." |
| Description built without AI | A note, and a **Write it with AI again** chip (new demand and call-offs only) |
| Submitted | "Submitted. Request REQ-… goes to …"; the submit button becomes "Submitted as REQ-…" |

## 7. Accessibility

**Supported:**
- reduce motion;
- keyboard sending (Enter; Shift+Enter for a new line);
- Escape closes the How it works panel and the phone summary;
- labelled access-code field;
- colour is never the only signal (icons and words go with each status).

**To do:**
- a live region (`role="log"`) for new messages;
- focus handling in the side-panel editor and the How it works panel;
- a visible label for the message input.
