// Four buying channels and the who-leads rule (November 2026). The channels are catalogue, existing contract, business-led
// demand and procurement-led demand. Who leads new demand follows the annual value: under €100,000 the division, from
// €500,000 procurement, in between the Category Manager decides (procurement in mandatory categories).
const { test, expect } = require("@playwright/test");
const { openApp, start, downloadJSON, answerUntilDone } = require("./helpers");

// a request with no catalogue item and no framework in play, so the who-leads rule decides
const lead = (page, facts, text = "translation of our annual report") => page.evaluate(([f, t]) => {
  S.msgs = [{ role: "user", text: t }];
  S.f = { ...BLANK_FACTS, category: "consulting", demand_type: "services", decline_contract: true, ...f };
  const d = determine(), L = whoLeads(S.f);
  return { route: d.route, channel: d.channel, row: L.row, status: L.status, annual: L.annual, form: L.form, why: d.why, controls: d.controls.map((c) => c[1]) };
}, [facts, text]);

test("there are four buying channels and four routes; €800 is business-led demand like any other amount", async ({ page }) => {
  const errors = await openApp(page);
  const got = await page.evaluate(() => ({ keys: Object.keys(CHANNELS), names: Object.values(CHANNELS).map((c) => c.name), routes: ROUTES }));
  expect(got.keys).toEqual(["catalogue", "contract", "business", "procurement"]);
  expect(got.names).toEqual(["Catalogue order", "Existing contract", "Business-led demand", "Procurement-led demand"]);
  expect(got.routes).toEqual(got.keys);
  const small = await lead(page, { value: 800 });
  expect([small.route, small.channel, small.row]).toEqual(["business", "business", "division"]);
  expect(small.controls).toEqual(expect.arrayContaining(["Three quotes", "No splitting"]));
  expect(errors).toEqual([]);
});

test("the thresholds are inclusive: €100,000 and €500,000 a year", async ({ page }) => {
  await openApp(page);
  const rows = [];
  for (const value of [99999, 100000, 499999, 500000]) { const r = await lead(page, { value }); rows.push([value, r.row, r.route]); }
  expect(rows).toEqual([
    [99999, "division", "business"],
    [100000, "cm_decides", "procurement"],
    [499999, "cm_decides", "procurement"],
    [500000, "lead_threshold", "procurement"],
  ]);
});

test("under €100,000 the division leads with three quotes and no sourcing request form", async ({ page }) => {
  await openApp(page);
  const r = await lead(page, { value: 60000 });
  expect([r.channel, r.status, r.form]).toEqual(["business", "decided", false]);
  expect(r.why).toMatch(/under the €100,000 threshold, so your division leads the sourcing/);
  expect(r.why).toMatch(/No sourcing request form is needed/);
  expect(r.controls).toEqual(expect.arrayContaining(["Three quotes", "No splitting"]));
  expect(r.controls).not.toContain("Sourcing request form");
});

test("between the thresholds the Category Manager decides; a mandatory category goes to procurement", async ({ page }) => {
  await openApp(page);
  const open = await lead(page, { value: 250000 });
  expect([open.channel, open.row, open.status, open.form]).toEqual(["procurement", "cm_decides", "pending_category_manager", true]);
  expect(open.why).toMatch(/between €100,000 and €500,000, so the Category Manager decides whether procurement leads/);
  expect(open.controls).toEqual(expect.arrayContaining(["Approval to source", "Category Manager decision", "Sourcing request form"]));
  await page.evaluate(() => { catById("consulting").cm = true; });
  const mandatory = await lead(page, { value: 250000 });
  expect([mandatory.row, mandatory.status]).toEqual(["cm_mandatory", "decided"]);
  expect(mandatory.controls).not.toContain("Category Manager decision");
  // below the lower threshold the flag changes nothing
  expect((await lead(page, { value: 60000 })).row).toBe("division");
});

test("the thresholds use the annual value: the total divided by the years of the term", async ({ page }) => {
  await openApp(page);
  const threeYears = await lead(page, { value: 600000, duration: "3 years" });
  expect([threeYears.annual, threeYears.row]).toEqual([200000, "cm_decides"]);
  expect(threeYears.why).toContain("€200,000 a year (€600,000 over the full term)");
  const small = await lead(page, { value: 240000, duration: "3 years" });
  expect([small.annual, small.row, small.route]).toEqual([80000, "division", "business"]);
  // a term of a year or less, or no term yet: the stated figure counts as annual
  expect((await lead(page, { value: 120000, duration: "6 months" })).annual).toBe(120000);
  expect((await lead(page, { value: 120000 })).annual).toBe(120000);
});

test("an unknown value is procurement-led and marked as pending until a figure is given", async ({ page }) => {
  await openApp(page);
  const r = await lead(page, {});
  expect([r.channel, r.row, r.status]).toEqual(["procurement", "pending_value", "pending_value"]);
  expect(r.why).toMatch(/The value is not known yet, so I assume procurement-led demand until it is/);
});

test("a market data renewal goes to procurement through the renewals calendar; an extension follows the thresholds", async ({ page }) => {
  await openApp(page);
  const md = { category: "market-data", wants_renewal: true, value: 60000 };
  const renewal = await lead(page, md, "we want to renew our ESG ratings data feed");
  expect([renewal.channel, renewal.row, renewal.form]).toEqual(["procurement", "renewal", false]);
  expect(renewal.why).toMatch(/renewals calendar, so procurement leads it and no sourcing request form is needed/);
  expect(renewal.controls).not.toContain("Sourcing request form");
  const extension = await lead(page, md, "we want to extend our ESG ratings data feed by six months");
  expect([extension.row, extension.route]).toEqual(["division", "business"]);
  // a renewal in another category follows the thresholds too
  expect((await lead(page, { wants_renewal: true, value: 60000 }, "we want to renew the translation service")).row).toBe("division");
});

test("the request records the channel and who leads, and the generated documents name four channels", async ({ page }) => {
  const errors = await openApp(page);
  await start(page, "An agency for a client dinner for 40 people, around 30k.");
  await answerUntilDone(page, []);
  const { data } = await downloadJSON(page, async () => { await page.locator("[data-act=more]").last().click(); await page.locator(".more [data-act=json]").last().click(); });
  expect(data.decision).toMatchObject({ route: "business", channel: "business", lead: { lead: "division", row: "division", annual: 30000 } });
  expect(await page.locator("#ovr option").allInnerTexts()).toEqual(["Keep Business-led demand", "Catalogue order", "Existing contract", "Procurement-led demand"]);
  for (const btn of ["#treeBtn", "#howBtn"]) {
    await page.click(btn);
    const text = await page.locator("#specPaper").innerText();
    for (const name of ["Catalogue order", "Existing contract", "Business-led demand", "Procurement-led demand", "€100,000", "€500,000"]) expect(text).toContain(name);
    expect(text).not.toMatch(/Low-value purchase|New demand: |Contract call-off/);
    await page.keyboard.press("Escape");
  }
  expect(errors).toEqual([]);
});
