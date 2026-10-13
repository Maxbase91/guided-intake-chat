# Lessons

## Never append a `//` comment inside a one-line statement (2026-10, twice)
Much of `index.html` is dense one-line code. Appending `// note` in the middle of a line comments out the rest
of the statement (once the wiring handlers, once `}).filter(Boolean)` in `entityFrom`), and the page fails to load.
**Rule:** put a comment only at the very end of a complete line, or on its own line. After every scripted edit of
`index.html`, run the syntax check (`new Function(...)` over the `<script>` blocks) before running tests.

## Cutting code between two markers (October 2026)
- Removing "10. SETTINGS" up to the "12. WIRING" marker also removed section 11 (How it works), which sat in between.
- Rule: before deleting a range by start and end markers, list every section header between them (`grep -n "^   [0-9]*\. "`), and check the diff stat for the expected number of lines.
