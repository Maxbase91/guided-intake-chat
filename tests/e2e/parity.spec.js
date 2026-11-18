// The decision tables (db/seed/rules.json, run by engine.js) must decide exactly as the routing code did before it
// became data. determineLegacy() is that code, kept for this comparison; both run on the same facts and must agree on
// the route, the channel, who leads, the reason, the controls and the next steps.
const { test, expect } = require("@playwright/test");
const { openApp } = require("./helpers");
const benchmark = require("../fixtures/l4-benchmark.json");

// runs in the page: compares both paths for the current S.f / S.msgs and returns a difference, or null
const COMPARE = `(() => {
  const pick = d => d && ({ route: d.route, channel: d.channel, lead: d.lead && { lead: d.lead.lead, row: d.lead.row, status: d.lead.status, annual: d.lead.annual, form: d.lead.form },
    why: d.why, controls: d.controls.map(c => c[1]), steps: d.steps, cat: d.catalogue.map(i => i.id), ctr: d.contract && d.contract.id });
  const a = JSON.stringify(pick(determine())), b = JSON.stringify(pick(determineLegacy()));
  return a === b ? null : { tables: a, code: b };
})()`;

test("a grid of categories, values and answers: the tables decide as the code did", async ({ page }) => {
  const errors = await openApp(page);
  const got = await page.evaluate((compare) => {
    const values = [null, 80, 800, 4900, 5000, 5100, 30000, 99999, 100000, 250000, 499999, 500000, 2500000];
    const variants = [
      [{}, "we need this for our team"], [{ decline_contract: true }, "we need this for our team"], [{ duration: "3 years" }, "a service for three years"],
      [{ duration: "6 months", decline_contract: true }, "a project"], [{ wants_renewal: true }, "we want to renew this"], [{ wants_renewal: true, decline_contract: true }, "we want to extend this by a year"],
      [{ personal_data: true }, "the provider sees client data"], [{ tech_service: true, decline_contract: true }, "a cloud platform run for us"], [{ supplier: "Lakeshore Advisory" }, "more support from Lakeshore Advisory"],
      [{ value_is_estimate: true, decline_contract: true }, "roughly, not sure"], [{ quantity: "15" }, "15 laptops for new joiners"], [{}, "flowers for the reception"],
    ];
    let n = 0; const diffs = [];
    const run = (label) => { n++; const d = eval(compare); if (d && diffs.length < 5) diffs.push({ label, ...d }); };
    for (const c of CATEGORIES) for (const value of values) for (const [extra, text] of variants) {
      S.msgs = [{ role: "user", text }]; S.catGuess = null; S.derived = {};
      S.f = { ...BLANK_FACTS, category: c.id, demand_type: c.type, value, ...extra };
      run(`${c.id} ${value} ${JSON.stringify(extra)}`);
    }
    // a mandatory category, and thresholds other than the defaults
    const base = { ...CONFIG.thresholds };
    for (const [cm, change] of [[true, {}], [false, { formMin: 20000, leadMin: 60000 }], [true, { simpleMax: 1000, formMin: 50000 }]]) {
      CATEGORIES.forEach((c) => { c.cm = cm; }); Object.assign(CONFIG.thresholds, change);
      for (const c of CATEGORIES.slice(0, 8)) for (const value of values) {
        S.msgs = [{ role: "user", text: "we need this" }]; S.f = { ...BLANK_FACTS, category: c.id, demand_type: c.type, value, decline_contract: true };
        run(`cm=${cm} ${JSON.stringify(change)} ${c.id} ${value}`);
      }
      Object.assign(CONFIG.thresholds, base);
    }
    CATEGORIES.forEach((c) => { c.cm = false; });
    return { n, diffs };
  }, COMPARE);
  expect(got.diffs).toEqual([]);
  expect(got.n).toBeGreaterThan(3000);
  expect(errors).toEqual([]);
});

test("the welcome examples and the benchmark requests: the tables decide as the code did", async ({ page }) => {
  const errors = await openApp(page);
  const got = await page.evaluate(([compare, texts]) => {
    const all = [...TRIES.map((x) => x[2]), LOWVALUE_EX, ...texts], diffs = []; let routed = 0;
    for (const text of all) withExampleState(text, () => { if (!S.det) return; routed++; const d = eval(compare); if (d && diffs.length < 5) diffs.push({ text, ...d }); });
    return { n: all.length, routed, diffs };
  }, [COMPARE, benchmark.map((b) => b.text)]);
  expect(got.diffs).toEqual([]);
  expect(got.routed).toBeGreaterThan(got.n * 0.8);
  expect(errors).toEqual([]);
});

test("the request records the rule rows that decided and the configuration it ran on", async ({ page }) => {
  await openApp(page);
  const got = await page.evaluate(() => withExampleState("An agency for a client dinner for 40 people, around 30k.", () => ({ rules: S.det.rules, cfg: { ...CFG }, defaults: DEFAULTS.checksum })));
  expect(got.rules).toEqual([{ rule: "R01", row: 3, outcome: "not_covered" }, { rule: "R02", row: 2, outcome: "not_covered" }, { rule: "R11", row: 6, outcome: "division" }, { rule: "R19", row: 4, outcome: "business" }]);
  expect(got.cfg).toEqual({ version: 0, source: "builtin", checksum: got.defaults });
});

test("changing a rule row changes the outcome without touching the code", async ({ page }) => {
  await openApp(page);
  const got = await page.evaluate(() => {
    const cfg = structuredClone(DEFAULTS), route = () => withExampleState("An agency for a client dinner for 40 people, around 30k.", () => [S.det.route, S.det.lead.row]);
    const before = route();
    // the Category Manager now decides from 20,000 a year
    cfg.params.find((p) => p.key === "formMin").value = 20000; applyConfig(cfg);
    const lower = route();
    // and marketing becomes a mandatory category
    cfg.categories.find((c) => c.id === "marketing").cm_mandatory = true; applyConfig(cfg);
    const mandatory = route();
    applyConfig(DEFAULTS);
    return { before, lower, mandatory, after: route() };
  });
  expect(got).toEqual({ before: ["business", "division"], lower: ["procurement", "cm_decides"], mandatory: ["procurement", "cm_mandatory"], after: ["business", "division"] });
});
