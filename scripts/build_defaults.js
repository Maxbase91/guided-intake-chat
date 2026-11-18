#!/usr/bin/env node
// Builds the configuration from db/seed/*.json and writes it into index.html as the built-in defaults:
// the <script id="config-defaults" type="application/json"> block. The page uses these when it runs without a server
// or when the database cannot be reached; the database is seeded from the same files.
//
//   node scripts/build_defaults.js           write the block into index.html
//   node scripts/build_defaults.js --check   exit 1 if the block differs from the seed (run by the tests)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Engine = require("../engine.js");

const ROOT = path.join(__dirname, "..");
const SEED = path.join(ROOT, "db", "seed");
const HTML = path.join(ROOT, "index.html");
const OPEN = '<script id="config-defaults" type="application/json">';
const CLOSE = "</script>";

const read = (name) => JSON.parse(fs.readFileSync(path.join(SEED, `${name}.json`), "utf8"));

// the configuration document: the same shape the server publishes
function buildConfig() {
  const body = { params: read("params"), channels: read("channels"), categories: read("categories"), facts: read("facts"), rules: read("rules") };
  const checksum = crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 12);
  return { version: 0, source: "builtin", checksum, ...body };
}

// everything a published configuration must satisfy; returns a list of problems
function validateConfig(cfg) {
  const errors = [];
  const params = Object.fromEntries(cfg.params.map((p) => [p.key, p.value]));
  const registry = Object.fromEntries(cfg.facts.map((f) => [f.key, f]));
  cfg.params.forEach((p) => { if (typeof p.value !== "number" || !isFinite(p.value)) errors.push(`threshold ${p.key}: not a number`); });
  cfg.rules.forEach((rule) => {
    errors.push(...Engine.validateRule(rule, registry, params));
    Engine.runTests(rule, params).filter((t) => !t.ok).forEach((t) => errors.push(`${rule.id}: test "${t.name}" expects ${t.expect}, got ${t.got}`));
  });
  const ids = cfg.rules.map((r) => r.id);
  ids.filter((id, i) => ids.indexOf(id) !== i).forEach((id) => errors.push(`rule ${id} is defined twice`));
  return errors;
}

function block(cfg) {
  const lines = ["{", `"version":${cfg.version},"source":"builtin","checksum":"${cfg.checksum}",`];
  ["params", "channels", "categories", "facts", "rules"].forEach((k, i, a) => {
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
