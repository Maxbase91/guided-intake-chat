// From a live AI test (October 2026): a front-office trading platform transformation that includes client onboarding and KYC.
// The platform is the subject (software), KYC operations only inform it; edits, data answers, suppliers and documents stay clean.
const { test, expect } = require("@playwright/test");
const { openApp, say, lastAssistant, mock } = require("./helpers");

const FIRST = "We need to transform our front office trading system, including the client onboarding and KYC process. Budget around 4 million over 3 years";

test("the trading platform is software, its domain is trading, and installed software is not assumed to be outsourcing", async ({ page }) => {
  const errors = await openApp(page);
  await say(page, FIRST);
  const got = await page.evaluate(() => ({ cat: S.f.category, kind: kindOf(S.f), domain: bankDomain(S.f).id, mh: FACTS.must_haves.ex(S.f),
    installed: inHouseFromText({ ...S.f, l4: "L4-1201" }), guessed: inHouseFromText({ ...S.f, l4: "L4-1202" }), saas: (() => { const m = S.msgs; S.msgs = [{ role: "user", text: "A new HR and payroll system as SaaS for 3 years" }]; const r = inHouseFromText({ ...BLANK_FACTS, category: "software", demand_type: "software" }); S.msgs = m; return r; })() }));
  expect(got).toEqual({ cat: "software", kind: "product", domain: "trading", installed: null, guessed: null, saas: true,
    mh: expect.stringContaining("real-time trade capture and position keeping") });
  // the existing head-noun rules still hold
  expect(await page.evaluate(() => ["A transaction monitoring system for AML", "Develop a new client onboarding app for our retail bank", "KYC periodic reviews for our corporate clients", "I need three business consultants for a target operating model transformation"]
    .map((t) => bestCategory(` ${t.toLowerCase()} `).id))).toEqual(["software", "it-services", "bpo", "consulting"]);
  expect(errors).toEqual([]);
});

test("the AI's category gives way to the subject named first (it said KYC operations)", async ({ page, request }) => {
  await openApp(page, { kind: "ai" });
  await mock(request, { nextChat: { facts: { category: "bpo", demand_type: "services", l4: "L4-2802" } } });
  await say(page, FIRST);
  expect(await page.evaluate(() => [S.f.category, S.f.l4 === "L4-2802"])).toEqual(["software", false]);
});

test("suggestion edits, accepted suggestions, data answers, suppliers and the description from the trading run", async ({ page }) => {
  await openApp(page);
  await say(page, FIRST);
  const got = await page.evaluate(() => {
    const r = {};
    const vp = "Unique selling points: integrated trading and KYC; real-time client data\nKey benefits: faster client onboarding; reduced manual errors; flexible capacity for peaks\nRegulatory / governance benefits: clear audit trail";
    r.addDrop = editSuggestion(vp, "drop the capacity for peaks and add replacing an unsupported platform and a real-time risk view, rest is fine");
    r.first = editSuggestion("Changes to our onboarding systems; Final risk-rating decisions; Exit decisions for clients", "replace the first one with migration of trade history older than 5 years, rest is fine");
    r.dropLast = editSuggestion("A; B; C", "drop the last one");
    // an accepted suggestion replaces what the AI had saved for its lines
    S.suggest.acceptance_pack = "Acceptance criteria: 98% of trades processed automatically; onboarding reduced to 5 days\nReview and sign-off: Head of Front Office signs off";
    S.f.acceptance = "98% of trades processed automatically; onboarding reduced to 5 days; 99% of KYC files pass quality checks";
    applySuggestion("acceptance_pack", "ok");
    r.acc = S.f.acceptance;
    r.flat = normFact("data_details", { types: ["client names", "ID documents"], storage: { murex: "Frankfurt", saas: "US" } });
    r.tidy = tidySuggestion("audience_fn", "Target audience: traders, relationship managers, onboarding analysts (≈ users)\nSupported functions: Front Office; no overdue periodic reviews27");
    r.users = screenAIFacts({ users: "340" }, "audience_fn", "about 300 traders and sales people plus 40 onboarding analysts");
    S.msgs.push({ role: "assistant", text: "Anything else I should know?", ask: "other_risks" });
    r.inflated = screenAIFacts({ other_risks: "Regulatory expectation to clear the onboarding backlog by mid-2027; transition risk from unsupported legacy system; data residency constraints for a US-hosted SaaS option; dependency on Murex and Calypso" }, "other_risks", "the regulator expects the onboarding backlog cleared by mid 2027");
    r.aboutSupplier = [replyAsksAbout("supplier", "Got it. Any other risks you'd flag, like regulatory or operational ones?"), replyAsksAbout("supplier", "Thanks. Do you already have a supplier in mind?")];
    S.f.supplier = "Murex, Calypso, or a SaaS player";
    r.names = supplierNames(S.f.supplier);
    r.asksWhy = requiredFor("sourcing", S.f).includes("supplier_reason");
    r.np = controlsFor("sourcing", null).find((c) => c[1] === "Non-preferred supplier")[2];
    S.f.entity = "EU"; S.f.data_details = "client names, ID documents; stored in Frankfurt for Murex or Calypso, in the US for the SaaS option";
    r.transfer = bankChecks(S.f).some((c) => c[1] === "Data transfer check");
    S.f.scope_out = "Migration of trade history older than 5 years";
    r.sugKnows = suggestUser("deps_pack").includes("Migration of trade history older than 5 years");
    Object.assign(S.f, { users: "Traders, sales and onboarding analysts", must_haves: "real-time trade capture and risk, KYC status visible before the first trade, integration with our booking and screening systems" });
    const ex = offlineExec("to transform our front office trading system, including the client onboarding and KYC process");
    r.headline = ex.headline.split(". ")[0];
    r.caps = ex.capabilities;
    return r;
  });
  expect(got.addDrop).toBe("Unique selling points: integrated trading and KYC; real-time client data\nKey benefits: faster client onboarding; reduced manual errors; replacing an unsupported platform; a real-time risk view\nRegulatory / governance benefits: clear audit trail");
  expect(got.first).toBe("migration of trade history older than 5 years; Final risk-rating decisions; Exit decisions for clients");
  expect(got.dropLast).toBe("A; B");
  expect(got.acc).toBe("98% of trades processed automatically; onboarding reduced to 5 days");
  expect(got.flat).not.toContain("[object Object]");
  expect(got.flat).toContain("Frankfurt");
  expect(got.tidy).toBe("Target audience: traders, relationship managers, onboarding analysts\nSupported functions: Front Office; no overdue periodic reviews");
  expect(got.users).toEqual({});
  expect(got.inflated).toEqual({});
  expect(got.aboutSupplier).toEqual([false, true]);
  expect(got.names).toEqual(["Murex", "Calypso"]);
  expect(got.asksWhy).toBe(false);
  expect(got.np).toBe("Murex and Calypso are not preferred suppliers for this category.");
  expect(got.transfer).toBe(true);
  expect(got.sugKnows).toBe(true);
  expect(got.headline).toMatch(/^It enables traders, sales and onboarding analysts to transform its front office trading system, including the client onboarding and KYC process\.?$/);
  expect(got.caps).toEqual(["Real-time trade capture and risk", "KYC status visible before the first trade", "Integration with our booking and screening systems"]);
});

test("'yes, their standard licence terms and an online SLA' keeps which documents", async ({ page, request }) => {
  await openApp(page, { kind: "ai" });
  await say(page, FIRST);
  await page.evaluate(() => { S.f.supplier = "Murex"; refresh(); S.lastAsked = "supplier_terms"; });
  await mock(request, { nextChat: { facts: { supplier_terms: "Yes" } } });
  await say(page, "yes, their standard licence terms and an online SLA document");
  expect(await page.evaluate(() => S.f.supplier_terms)).toBe("Their standard licence terms and an online SLA document");
});
