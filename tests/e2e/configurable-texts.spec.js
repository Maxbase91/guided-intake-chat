// Next steps, word limits, answer-check limits, quality weights, answer buttons, legal entities, operations domains and
// welcome examples come from the configuration. With the seed the page says exactly what the code said before.
const { test, expect } = require("@playwright/test");
const { openApp } = require("./helpers");

// nextSteps() as it was written in the code before it became data: the seed must give the same texts
const OLD_NEXT_STEPS = `(route, cat, ctr) => { const f=S.f;
  switch(route){
    case "catalogue": return cat.length && cat[0].kind==="shop"
      ? [\`Open the \${cat[0].name.toLowerCase()} (\${cat[0].supplier}) from the catalogue and add what you need, up to \${money(cat[0].max_order)}.\`, \`Delivery to \${f.location||"your office"}\${known(f.needed_by)?\`, needed \${f.needed_by}\`:""}.\`, "Submit the basket. It goes to your budget owner for approval."]
      : [\`Add \${cat.map(i=>i.name).join(" and ")} to your basket\${known(f.quantity)?\` (\${f.quantity})\`:""}.\`, \`Delivery to \${f.location||"your office"}\${known(f.needed_by)?\`, needed \${f.needed_by}\`:""}.\`, "Submit. Standard items go straight through."];
    case "simple":  return [\`Get one quote\${hasSupplier(f)?\` from \${f.supplier}\`:preferredFor(f).length?\`, ideally from \${someNames(preferredFor(f))}\`:""}.\`, "Raise a purchase order with the quote attached, or pay with your corporate card where the card policy allows.", "When it arrives, confirm receipt so the invoice can be paid."];
    case "contract":  return f.demand_type==="contingent_labour"
      ? [\`The role profile goes to \${ctr.supplier} under \${ctr.id}.\`, "They shortlist candidates for you to interview.", "Onboarding and system access follow after selection."]
      : [\`A call-off is raised against \${ctr.id} with \${ctr.supplier}.\`, "The scope of work from this conversation is attached.", "The contract owner confirms, then the order goes out."];
    case "business":     return [\`You ask at least 3 suppliers for a quote\${preferredFor(f).length?\`, ideally including \${someNames(preferredFor(f))}\`:""}, using the service description.\`, "Procurement checks the quotes and the supplier before you choose.", "The purchase request is raised with the chosen quote attached."];
    case "procurement":  return ["Submit. A procurement-led sourcing project is created with the service description attached.", "A buyer contacts you within 2 working days to plan the RFP and the evaluation team.", "Risk, ICT and supplier checks run in parallel with the RFP."];
  }
  return []; }`;

const REQUESTS = [
  ["catalogue", "We need 15 laptops for new joiners in Frankfurt, needed by 1 December."],
  ["catalogue", "Flowers for a colleague's farewell, about 80 euros"],
  ["simple", "Repair of the coffee machine in our Munich office, about 800 euros."],
  ["contract", "More support from Lakeshore Advisory for our operations team."],
  ["contract", "Two Java developers as contractors for 9 months."],
  ["business", "An agency for a client dinner for 40 people, around 30k."],
  ["procurement", "A new HR system to replace our payroll tool, about 800k."],
];

test("the next steps from the configuration are the texts the code wrote, for every channel and variant", async ({ page }) => {
  const errors = await openApp(page);
  const got = await page.evaluate(([reqs, old]) => {
    const before = eval(old);
    return reqs.map(([, text]) => withExampleState(text, () => ({ route: S.det.route, now: S.det.steps, before: before(S.det.route, S.det.catalogue, S.det.contract) })));
  }, [REQUESTS, OLD_NEXT_STEPS]);
  expect(got.map((g) => g.route)).toEqual(REQUESTS.map(([r]) => r));
  for (const g of got) expect(g.now).toEqual(g.before);
  expect(new Set(got.map((g) => g.now[0])).size).toBe(REQUESTS.length);   // every variant is covered
  expect(errors).toEqual([]);
});

test("limits, weights, answer buttons, entities, domains and examples are read from the configuration", async ({ page }) => {
  const errors = await openApp(page);
  const got = await page.evaluate(() => {
    const base = { limits: [CONFIG.thresholds.headMax, CONFIG.thresholds.execMaxProc], quality: [QUALITY.warn, QUALITY.floor, QUALITY.bands[0][0]], entities: ENTITIES.map((e) => e.id), domains: DOMAINS.length, tries: TRIES.length };
    const cfg = structuredClone(DEFAULTS);
    cfg.params.find((p) => p.key === "headMax").value = 55;
    cfg.params.find((p) => p.key === "qualityWarn").value = 20;
    cfg.questions.find((q) => q.key === "pricing_model").choices = ["Fixed price", "Per deliverable"];
    cfg.entities.find((e) => e.id === "EU").keywords.push("lisbon");
    cfg.domains.find((d) => d.id === "voice").keywords.push("dictaphone");
    cfg.examples = cfg.examples.slice(0, 3);
    cfg.next_steps.find((n) => n.key === "procurement").steps[1] = "A buyer contacts you within 1 working day.";
    applyConfig({ ...cfg, version: 99, source: "database" });
    const after = { ...withExampleState("A new HR system to replace our payroll tool, about 800k.", () => ({ limit: execLimits().head, step: S.det.steps[1] })),
      business: withExampleState("An agency for a client dinner for 40 people, around 30k.", () => execLimits().head) };
    const res = { base, after, warn: QUALITY.warn, choices: FACTS.pricing_model.choices, lisbon: ENTITIES.find((e) => e.re.test("our office in Lisbon")).id,
      us: [ENTITIES.find((e) => e.abbr && e.abbr.test("for the US entity")).id, ENTITIES.some((e) => e.re.test("tell us more") || (e.abbr && e.abbr.test("tell us more")))],
      voice: withExampleState("Dictaphones for our trading floor, about 20k.", () => (bankDomain(S.f) || {}).id), tries: TRIES.length, entityButtons: FACTS.entity.choices() };
    applyConfig(DEFAULTS);
    return res;
  });
  expect(got.base).toMatchObject({ limits: [70, 250], quality: [15, 35, 90], entities: ["EU", "UK", "SG", "HK", "US", "AU", "CA"], domains: 11, tries: 9 });
  expect(got.after).toEqual({ limit: 100, step: "A buyer contacts you within 1 working day.", business: 55 });   // procurement-led keeps its own limit
  expect([got.warn, got.choices, got.lisbon, got.us, got.voice, got.tries]).toEqual([20, ["Fixed price", "Per deliverable"], "EU", ["US", false], "voice", 3]);
  expect(got.entityButtons).toEqual(["UK banking entity (London)", "EU banking entity (Germany)", "US entity (New York)", "Another entity"]);
  expect(errors).toEqual([]);
});
