// Divisions and checks (phase 5). New demand asks for the division; the configuration says per division which
// ownership questions its vendor office needs (R required, C conditional, - not asked). Two checks run for every
// division: a service the bank does not buy from third parties (R07) and a country that needs a review (R08). The
// lists and the applicability are data, edited on the admin page.
const { test, expect } = require("@playwright/test");
const { openApp, start, idle, choices, choose, say, lastAssistant, downloadJSON, urlFor } = require("./helpers");

const DINNER = "An agency for a client dinner for 40 people, around 30k.";
// answers every question (first chip, else a sentence), choosing the division given; returns the keys asked in order
async function run(page, division) {
  const asked = [];
  for (let i = 0; i < 40; i++) {
    await idle(page);
    if (await page.locator("[data-act=submit]").count()) return asked;
    const k = await page.evaluate(() => S.lastAsked); asked.push(k);
    const chips = await choices(page).allInnerTexts();
    if (k === "division") await choose(page, division);
    else if (chips.includes("Use this suggestion")) await choose(page, "Use this suggestion");
    else if (chips.length) await choose(page, chips[0]);
    else await say(page, "The client relationship team needs it for our top clients; without it we lose a key touchpoint.");
  }
  throw new Error("did not finish");
}
const decide = (page, facts, text) => page.evaluate(([f, t]) => {
  S.msgs = [{ role: "user", text: t }];
  S.f = { ...BLANK_FACTS, category: "consulting", demand_type: "services", decline_contract: true, value: 60000, ...f };
  const d = determine();
  return { route: d.route, controls: d.controls.map((c) => [c[1], c[2]]), rules: d.rules.filter((r) => ["R07", "R08"].includes(r.rule)).map((r) => r.outcome), division: d.division };
}, [facts, text]);

test("new demand asks the division, then the questions that division's vendor office needs", async ({ page }) => {
  const errors = await openApp(page);
  await start(page, DINNER);
  const corp = await run(page, "Corporate banking");
  expect(corp).toEqual(expect.arrayContaining(["division", "demand_owner", "sponsor", "spend_type"]));
  expect(corp.indexOf("division")).toBeLessThan(corp.indexOf("demand_owner"));
  await expect(page.locator("#side")).toContainText("Corporate banking");
  const { data } = await downloadJSON(page, async () => { await page.locator("[data-act=more]").last().click(); await page.locator(".more [data-act=json]").last().click(); });
  expect(data.facts).toMatchObject({ division: "corporate", demand_owner: "I am", sponsor: "My head of department", spend_type: "run" });
  expect(data.intake_record["Vendor office"]).toBe("Corporate banking vendor office");
  expect(data.decision.division).toEqual({ id: "corporate", name: "Corporate banking", vendor_office: "Corporate banking vendor office" });

  // private banking: no spend type (the checklist marks it not applicable)
  await page.click("#newBtn");
  await start(page, DINNER);
  const priv = await run(page, "Private banking");
  expect(priv).toEqual(expect.arrayContaining(["division", "demand_owner", "sponsor"]));
  expect(priv).not.toContain("spend_type");
  expect(errors).toEqual([]);
});

test("catalogue orders, existing contracts and small purchases are not asked for the division", async ({ page }) => {
  await openApp(page);
  const req = (t) => page.evaluate((x) => withExampleState(x, () => [S.det.route, S.req.filter((k) => ["division", "demand_owner", "sponsor", "spend_type"].includes(k))]), t);
  expect(await req("We need 15 laptops for new joiners in Frankfurt.")).toEqual(["catalogue", []]);
  expect(await req("Two Java developers as contractors for 9 months.")).toEqual(["contract", []]);
  expect(await req("A magician for the kids' Christmas party, about 600 euros")).toEqual(["simple", []]);
  expect((await req(DINNER))[1]).toEqual(["division", "demand_owner", "sponsor", "spend_type"]);
});

test("a service the bank does not buy and a country that needs a review are flagged, naming the vendor office", async ({ page }) => {
  await openApp(page);
  const lobby = await decide(page, { division: "investment" }, "a firm to do lobbying on the new capital rules");
  expect(lobby.rules).toEqual(["prohibited", "clear"]);
  expect(lobby.controls[0]).toEqual(["Prohibited service check", "This looks like lobbying or political contributions, which the bank does not buy from third parties. The Investment banking vendor office and Compliance review it before anything else happens."]);
  const moscow = await decide(page, { location: "remotely from Moscow" }, "a team to test our trading app");
  expect(moscow.rules).toEqual(["clear", "review"]);
  expect(moscow.controls[0]).toEqual(["Country review", "Part of this involves Russia, so the vendor office reviews it before sourcing starts."]);
  const clear = await decide(page, {}, "a team to test our trading app from Lisbon");
  expect(clear.rules).toEqual(["clear", "clear"]);
  expect(clear.controls.map((c) => c[0])).not.toContain("Country review");
  // the catalogue is not checked
  expect(await page.evaluate(() => withExampleState("We need 15 laptops for new joiners in Frankfurt.", () => S.det.rules.map((r) => r.rule)))).toEqual(["R01", "R02", "R19"]);
});

test("the lists and the applicability are configuration: changing them changes what is asked and flagged", async ({ page, request }) => {
  const cfg = await (await request.get(urlFor("offline").replace(/\/$/, "") + "/api/config")).json();
  cfg.lists.find((l) => l.key === "prohibited_services").items.push({ name: "fortune telling", keywords: ["astrolog*", "fortune tell*"] });
  cfg.questions.find((q) => q.key === "sponsor").applies.corporate = "-";
  cfg.divisions.find((d) => d.id === "corporate").vendor_office = "CB office";
  await page.route("**/api/config", (r) => r.fulfill({ json: { ...cfg, version: 11, source: "database" } }));
  await openApp(page);
  const astro = await decide(page, { division: "corporate" }, "an astrologer for our team event");
  expect(astro.controls[0]).toEqual(["Prohibited service check", "This looks like fortune telling, which the bank does not buy from third parties. The CB office and Compliance review it before anything else happens."]);
  expect(await page.evaluate((t) => withExampleState(t, () => { S.f.division = "corporate"; refresh(); return S.req.filter((k) => ["division", "demand_owner", "sponsor", "spend_type"].includes(k)); }), DINNER))
    .toEqual(["division", "demand_owner", "spend_type"]);
});

test("the header links to the admin page when the page has its server; How it works and the Decision tree describe rules, divisions and checks", async ({ page }) => {
  const errors = await openApp(page);
  await expect(page.locator("#adminLink")).toBeVisible();
  await expect(page.locator("#adminLink")).toHaveAttribute("href", "admin.html");
  await page.click("#howBtn");
  const how = page.locator("#specPaper");
  for (const t of ["Rules as data", "Admin page", "Decision log", "R07 Prohibited services", "R08 Country review", "Ownership questions by division", "Corporate banking vendor office", "Suggestions name their source", "Countries that need a vendor office review"])
    await expect(how).toContainText(t);
  await page.keyboard.press("Escape");
  await page.click("#treeBtn");
  const tree = page.locator("#specPaper");
  for (const t of ["set by procurement on the admin page", "Prohibited service check", "Country review", "Which division is this for?"]) await expect(tree).toContainText(t);
  const svg = await page.locator("#specPaper svg").first().evaluate((el) => ({ h: el.getAttribute("height"), text: el.textContent }));
  expect(svg.h).toBe("1688");
  expect(svg.text).toContain("Prohibited service check");
  expect(svg.text).toContain("Country review");
  expect(errors).toEqual([]);
});
