// Content as data: question texts, category guidance and the reason texts of the rules come from the configuration,
// so procurement changes them on the admin page without a code change. Every suggestion says where it comes from.
const { test, expect } = require("@playwright/test");
const { openApp, start, idle, choices, choose, lastAssistant, say, downloadJSON, urlFor, answerUntilDone } = require("./helpers");

const DINNER = "An agency for a client dinner for 40 people, around 30k.";
async function published(request, change) {
  const cfg = await (await request.get(urlFor("offline").replace(/\/$/, "") + "/api/config")).json();
  change(cfg);
  return { ...cfg, version: 9, source: "database" };
}
// answers until the chat offers a suggestion; returns the question key and the message
async function untilSuggestion(page) {
  for (let i = 0; i < 20; i++) {
    await idle(page);
    if ((await choices(page).allInnerTexts()).includes("Use this suggestion")) return { key: await page.evaluate(() => S.lastAsked), text: await lastAssistant(page).innerText() };
    const chips = await choices(page).allInnerTexts();
    if (chips.length) await choose(page, chips[0]); else await say(page, "The client relationship team needs it for our top 40 clients; without it we lose a key touchpoint this year.");
  }
  throw new Error("no suggestion offered");
}

test("every suggestion names its source; the request records which suggestions were accepted and where they came from", async ({ page }) => {
  const errors = await openApp(page);
  await start(page, DINNER);
  const sg = await untilSuggestion(page);
  expect(sg.text).toContain("My suggestion, from your answers and the category guidance for Marketing and events:");
  await choose(page, "Use this suggestion");
  await answerUntilDone(page, []);
  const { data } = await downloadJSON(page, async () => { await page.locator("[data-act=more]").last().click(); await page.locator(".more [data-act=json]").last().click(); });
  expect(data.suggestion_sources).toMatchObject({ [sg.key]: "guidance" });
  expect(errors).toEqual([]);
});

test("a changed guidance text changes the suggestion; a changed question text changes what is asked", async ({ page, request }) => {
  const cfg = await published(request, (c) => {
    c.guidance.find((g) => g.key === "audience").texts.marketing = "our top 40 corporate clients and their relationship managers";
    c.questions.find((q) => q.key === "background").q = "Which client problem does this event solve, and what if it slips?";
  });
  await page.route("**/api/config", (r) => r.fulfill({ json: cfg }));
  const errors = await openApp(page);
  expect(await page.evaluate(() => [CAT_AUD.marketing, FACTS.background.q(S.f)])).toEqual(["our top 40 corporate clients and their relationship managers", "Which client problem does this event solve, and what if it slips?"]);
  await start(page, DINNER);
  await expect(page.locator("#msgs")).toContainText("Which client problem does this event solve, and what if it slips?");
  const sg = await untilSuggestion(page);
  expect(sg.text).toContain("Our top 40 corporate clients and their relationship managers");
  // a category without a text gets "any other category"; the defaults come back with the built-in configuration
  expect(await page.evaluate(() => { const c = structuredClone(DEFAULTS); delete c.guidance.find((g) => g.key === "audience").texts.marketing; applyConfig(c); const a = CAT_AUD.marketing || CAT_AUD._; applyConfig(DEFAULTS); return [a, FACTS.background.q(S.f)]; }))
    .toEqual(["the team that raised the need and the colleagues it serves", "What business problem does this solve? And what happens if it's delayed?"]);
  expect(errors).toEqual([]);
});

test("the reasons for catalogue, contract and business-led demand are rule texts with placeholders", async ({ page, request }) => {
  const cfg = await published(request, (c) => {
    const rule = (id) => c.rules.find((r) => r.id === id);
    rule("R01").rows[0].text = "Order {items} from the catalogue.";
    rule("R02").rows[0].text = "Ask {supplier} under the {contract}.";
    rule("R11").rows[5].text = "Business-led at {amount}: ask three suppliers.";
  });
  await page.route("**/api/config", (r) => r.fulfill({ json: cfg }));
  await openApp(page);
  const why = (t) => page.evaluate((x) => withExampleState(x, () => S.det.why), t);
  expect(await why("We need 15 laptops for new joiners in Frankfurt.")).toBe("Order Standard laptop 14\" from the catalogue.");
  expect(await why("Two Java developers as contractors for 9 months.")).toMatch(/^Ask .+ under the .+\.$/);
  expect(await why("A magician for the kids' Christmas party, about 600 euros")).toBe("Business-led at €600: ask three suppliers.");
  // the built-in texts are the ones the code had
  const builtin = await page.evaluate(() => { applyConfig(DEFAULTS); return withExampleState("We need 15 laptops for new joiners in Frankfurt.", () => S.det.why); });
  expect(builtin).toBe("Standard laptop 14\" is in the catalogue, so you can order directly at the agreed price.");
});
