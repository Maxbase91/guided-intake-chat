// Defects found in two live AI conversations on 12 October 2026 (HR system for 400k, KYC operations for 600k).
// The conversations use the offline rules; the rule tables run against the page's own functions.
const { test, expect } = require("@playwright/test");
const { openApp, say, choose, idle, lastAssistant, choices } = require("./helpers");

const KYC = "KYC periodic reviews for our corporate clients for 2 years, around 600k.";
const KYC_OFFSHORE = [
  [/cost in total/i, "About 600k"],
  [/business problem/i, "A backlog of overdue KYC reviews flagged by the regulator; if delayed we face supervisory action"],
  [/use today/i, "Temporary staff and spreadsheets"],
  [/exactly must the provider do/i, "Run periodic KYC reviews for 3,000 corporate clients and document each file"],
  [/When (do you need it|should it start)/i, "1 February 2027"],
  [/Where and how/i, "Remotely from their delivery centre in Krakow, Poland"],
  [/budget already approved/i, "Yes"],
  [/kind of data/i, "Client names, ownership structures and ID documents, stored in the EU"],
  [/where will that data/i, "In the EU"],
  [/bank does itself today/i, "We could realistically do it"],
  [/Which legal entity of the bank/i, "EU banking entity (Germany)"],
];

// answers until the check step is shown, without confirming it
async function toCheckStep(page) {
  await openApp(page);
  await say(page, KYC);
  for (let i = 0; i < 40; i++) {
    await idle(page);
    const q = await lastAssistant(page).innerText();
    if (/Here's what I've worked out/.test(q)) return q;
    const chips = await choices(page).allInnerTexts();
    if (chips.includes("Use this suggestion")) { await choose(page, "Use this suggestion"); continue; }
    const hit = KYC_OFFSHORE.find(([re]) => re.test(q));
    if (hit) await say(page, hit[1]);
    else if (chips.length) await choose(page, chips[0]);
    else throw new Error(`No scripted answer for question: ${q}`);
  }
  throw new Error("The check step was not reached");
}
const offshorePoint = (text) => (text.match(/(\d+)\. Work happens outside the entity's country/) || [])[1];

test.describe("check step corrections", () => {
  test("'point N is wrong, the work is not done outside the country' removes the offshoring point", async ({ page }) => {
    const n = offshorePoint(await toCheckStep(page));
    expect(n).toBeTruthy();
    await say(page, `Point ${n} is wrong, the work is not done outside the country. The UK is only where some of the users are.`);
    await expect(lastAssistant(page)).toContainText("Thanks, I've updated it.");
    await expect(lastAssistant(page)).not.toContainText("Work happens outside the entity's country");
    expect(await page.evaluate(() => S.f.offshore)).toBe(false);
  });

  test("'N is wrong' alone turns that yes/no point around", async ({ page }) => {
    const n = offshorePoint(await toCheckStep(page));
    await say(page, `${n} is wrong`);
    await expect(lastAssistant(page)).toContainText("Thanks, I've updated it.");
    expect(await page.evaluate(() => S.f.offshore)).toBe(false);
  });

  test("a reply that changes nothing is not answered with 'I've updated it'", async ({ page }) => {
    await toCheckStep(page);
    await say(page, "hmm, I am not sure about all of this");
    await expect(lastAssistant(page)).toContainText("I couldn't tell what to change");
    await expect(lastAssistant(page)).not.toContainText("I've updated it");
  });
});

test("a place is taken as the work location only when it is where the provider works", async ({ page }) => {
  await openApp(page);
  const got = await page.evaluate(() => ({
    audience: extractAll("Yes, and it's about 2,500 employees in Germany and the UK, with 12 people in HR and payroll", "audience_fn").location,
    users: extractAll("Payroll errors hit 2,500 employees in Germany and the UK every month", "background").location,
    work: extractAll("Remotely from their delivery centre in Krakow, Poland", "location").location,
    notOffshore: extractAll("Not offshore, the team works in Frankfurt", "location").offshore,
    offshore: extractAll("Offshore, from their centre in Manila", "location").offshore,
  }));
  expect(got.audience).toBeUndefined();
  expect(got.users).toBeUndefined();
  expect(got.work).toMatch(/Krakow/);
  expect(got.notOffshore).toBe(false);
  expect(got.offshore).toBe(true);
});

test("Level 4 stays under the buying category, and the confirmed one is the one in the record", async ({ page }) => {
  await openApp(page);
  const got = await page.evaluate(() => {
    S.msgs = [
      { role: "user", text: "A new HR system to replace our payroll tool." },
      { role: "user", text: "An on-premise payroll tool from 2009 plus spreadsheets. We have no developers who could build a replacement." },
      { role: "user", text: "Payroll for Germany and the UK, implementation, integration with SAP, data migration and testing" },
    ];
    Object.assign(S.f, { category: "software", demand_type: "software" });
    const top = classifyL4(S.f)[0];
    S.f.l4 = "L4-1202"; S.derived.l4 = "L4-1202";
    const fin = finalL4({ code: "L4-1201", match: 70, reason: "On-premise software" });
    return { topCat: top.cat, final: fin.code, note: fin.uncertainty, ict: ictType(S.f) };
  });
  expect(got.topCat).toBe("software");
  expect(got.final).toBe("L4-1202");
  expect(got.note).toContain("L4-1201");
  expect(got.ict).toBe("Cloud services: SaaS");
});

test("a named supplier is single source only when the requester wants that supplier alone", async ({ page }) => {
  await openApp(page);
  const CASES = {
    "We'd like to include Northwind KYC Services, they did a pilot for us": false,
    "Please invite Northwind KYC Services as one of the bidders": false,
    "Only Northwind KYC Services, nobody else knows our data": true,
    "We want to buy directly from Northwind KYC Services, no tender": true,
    "Northwind KYC Services, they built our current system": true,
  };
  const got = await page.evaluate((texts) => Object.fromEntries(texts.map((t) => {
    S.msgs = [{ role: "user", text: t }];
    return [t, soleSupplier({ supplier: "Northwind KYC Services", supplier_reason: /pilot|built|only/.test(t) ? t : null })];
  })), Object.keys(CASES));
  expect(got).toEqual(CASES);
});

test("dates are removed from description text without leaving fragments, and 'Marketing' is not a month", async ({ page }) => {
  await openApp(page);
  const CASES = {
    "The current payroll tool, dating from 2009, is end-of-life.": "The current payroll tool is end-of-life.",
    "Procedures are up to date as of March 2026.": "Procedures are up to date.",
    "Reports go to the Head of Marketing every week.": "Reports go to the Head of Marketing every week.",
    "It is used in Marketing and Sales teams.": "It is used in Marketing and Sales teams.",
    "The rules are documented and approved by 31 March 2026.": "The rules are documented and approved.",
  };
  const got = await page.evaluate((texts) => Object.fromEntries(texts.map((t) => [t, scrubText(t)])), Object.keys(CASES));
  expect(got).toEqual(CASES);
});

test("an AI suggestion given as an object shows its content, not its keys", async ({ page }) => {
  await openApp(page);
  const got = await page.evaluate(() => ({
    scope: tidySuggestion("scope_out", { exclusions: { risk_rating: "Final risk ratings stay with the bank", client_exit: "Decisions to exit clients stay with the bank" } }),
    quals: tidySuggestion("qualifications", { skills_experience_qualifications: { analysts: { minimum: "2+ years of corporate KYC experience" } } }),
    kpis: tidySuggestion("kpis_pack", { service_levels: "98% of reviews on time", kpis: "Quality pass rate above 95%" }),
    dated: tidySuggestion("deps_pack", "Our dependencies: KYC procedures documented and shared by 31 March 2026"),
  }));
  expect(got.scope).toBe("Final risk ratings stay with the bank; Decisions to exit clients stay with the bank");
  expect(got.quals).toBe("2+ years of corporate KYC experience");
  expect(got.kpis).toBe("Service levels: 98% of reviews on time\nKPIs: Quality pass rate above 95%");
  expect(got.dated).not.toMatch(/2026|March|…/);
});
