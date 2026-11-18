#!/usr/bin/env node
// Builds the configuration from db/seed/*.json and writes it into index.html as the built-in defaults:
// the <script id="config-defaults" type="application/json"> block. The page uses these when it runs without a server
// or when the database cannot be reached; the database is seeded from the same files.
//
//   node scripts/build_defaults.js           write the block into index.html
//   node scripts/build_defaults.js --check   exit 1 if the block differs from the seed (run by the tests)
const fs = require("fs");
const path = require("path");
const { PARTS, buildConfig, validateConfig } = require("../api/_lib/seed.js");

const ROOT = path.join(__dirname, "..");
const HTML = path.join(ROOT, "index.html");
const OPEN = '<script id="config-defaults" type="application/json">';
const CLOSE = "</script>";

function block(cfg) {
  const lines = ["{", `"version":${cfg.version},"source":"builtin","checksum":"${cfg.checksum}",`];
  PARTS.forEach((k, i, a) => {
    lines.push(`"${k}":[`, cfg[k].map((x) => JSON.stringify(x)).join(",\n"), `]${i < a.length - 1 ? "," : ""}`);
  });
  lines.push("}");
  return lines.join("\n").replace(/<\//g, "<\\/");   // the block must not end the script tag
}

function main() {
  const check = process.argv.includes("--check");
  const cfg = buildConfig();
  const errors = validateConfig(cfg);
  if (errors.length) { console.error("The seed is not valid:\n  " + errors.join("\n  ")); process.exit(1); }
  const html = fs.readFileSync(HTML, "utf8");
  const a = html.indexOf(OPEN);
  if (a < 0) { console.error(`index.html has no ${OPEN} block`); process.exit(1); }
  const b = html.indexOf(CLOSE, a);
  const next = html.slice(0, a + OPEN.length) + "\n" + block(cfg) + "\n" + html.slice(b);
  if (next === html) { console.log(`config-defaults: up to date (${cfg.checksum})`); return; }
  if (check) { console.error("index.html: the config-defaults block differs from db/seed. Run: node scripts/build_defaults.js"); process.exit(1); }
  fs.writeFileSync(HTML, next);
  console.log(`config-defaults: written (${cfg.checksum})`);
}

if (require.main === module) main();
module.exports = { buildConfig, validateConfig };
