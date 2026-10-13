# Lessons

## Never append a `//` comment inside a one-line statement (2026-10, twice)
Much of `index.html` is dense one-line code. Appending `// note` in the middle of a line comments out the rest
of the statement (once the wiring handlers, once `}).filter(Boolean)` in `entityFrom`), and the page fails to load.
**Rule:** put a comment only at the very end of a complete line, or on its own line. After every scripted edit of
`index.html`, run the syntax check (`new Function(...)` over the `<script>` blocks) before running tests.
