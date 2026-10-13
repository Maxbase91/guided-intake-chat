// From a real new-demand result (October 2026): long AI texts, "( users globally)" left behind, a repeated sourcing text,
// record rows that never say anything, and a documents call that cost many tokens. The description is now lean.
const { test, expect } = require("@playwright/test");
const { openApp, say } = require("./helpers");

test("figures the requester never gave go with their brackets, and texts stay within their limits", async ({ page }) => {
  await openApp(page);
  const got = await page.evaluate(() => {
    const long = "Procurement teams (1,200 users globally), category managers (100+), Finance and Legal reviewers (300+), and Technology for system integration and support; managers overseeing spend categories and compliance; Information Security for access governance";
    const sug = tidySuggestion("audience_fn", `Target audience: ${long}\nSupported functions: Procurement (owns and drives adoption), Finance (approvals and spend controls), Legal (contract compliance), Technology (system hosting, integrations, and support), Information Security (role-based access, data encryption, and regulatory compliance)`);
    return {
      figures: [dropFigures("Procurement teams (1,200 users globally), category managers"), dropFigures("first-time-right rate improves 30%+ via policy checks")],
      clip: words(clipWords(long, 25)),
      sugLines: sug.split("\n").map((l) => words(l.replace(/^[^:]+:\s*/, ""))),
      reply: shortReply("Thanks for sharing that, it is really helpful to understand the context. Many banks of your size face the same challenge with fragmented intake. A clear front door usually reduces cycle times considerably and improves compliance. Who will use the platform, and roughly how many people?"),
      short: shortReply("Thanks. Who will use it?"),
    };
  });
  expect(got.figures).toEqual(["Procurement teams, category managers", "first-time-right rate improves via policy checks"]);
  expect(got.clip).toBeLessThanOrEqual(25);
  for (const n of got.sugLines) expect(n).toBeLessThanOrEqual(30);
  expect(got.reply).toBe("Thanks for sharing that, it is really helpful to understand the context. Who will use the platform, and roughly how many people?");
  expect(got.short).toBe("Thanks. Who will use it?");
});

test("the documents call asks only for the description, and the AI's long fields are cut", async ({ page }) => {
  await openApp(page);
  await say(page, "A new procurement intake platform for the whole bank, about 2 million");
  const got = await page.evaluate(() => {
    const sys = DOC_SYSTEM();
    const merged = mergeExec(offlineExec("a new procurement intake platform"), {
      audience: "Procurement teams across all regions, category managers, Finance and Legal reviewers, Technology for system integration and support, managers overseeing spend categories and compliance, and Information Security",
      capabilities: ["One intake form for every request type across the whole bank and all of its subsidiaries worldwide", "Approval routing", "Policy checks", "Supplier onboarding", "Contract templates", "Spend dashboards", "Audit trail"],
    });
    return { brd: /"brd"|"detail"|"compact"/.test(sys), limits: /at most 25 words/.test(sys), audience: words(merged.audience), caps: merged.capabilities.length, capWords: Math.max(...merged.capabilities.map(words)) };
  });
  expect(got).toEqual({ brd: false, limits: true, audience: expect.any(Number), caps: 5, capWords: expect.any(Number) });
  expect(got.audience).toBeLessThanOrEqual(25);
  expect(got.capWords).toBeLessThanOrEqual(12);
});

test("the record counts what the kind of purchase has, and shows materiality only when the review applies", async ({ page }) => {
  await openApp(page);
  await say(page, "A new procurement intake platform for the whole bank, about 2 million");
  const rows = () => page.evaluate(() => Object.fromEntries(intakeRecord()));
  const sw = await page.evaluate(() => { S.f.quantity = 50; S.f.value = 2000000; S.sd = S.sd || null; return Object.fromEntries(intakeRecord()); });
  expect(sw.Users).toBe("About 50");
  expect(sw.Quantity).toBeUndefined();
  expect(sw["Material spend review"]).toBe("Yes, the value is €1,000,000 or more");
  expect(Object.keys(sw)).not.toContain("Future rule set");
  expect(Object.keys(sw)).not.toContain("Checked by you");
  expect(Object.keys(sw)).not.toContain("Materiality");
  // a service has no quantity, and under €1m there is no materiality row
  const svc = await page.evaluate(() => { Object.assign(S.f, { category: "consulting", demand_type: "services", quantity: 3, value: 300000 }); return Object.fromEntries(intakeRecord()); });
  expect(svc.Quantity).toBeUndefined();
  expect(svc.Users).toBeUndefined();
  expect(svc["Material spend review"]).toBeUndefined();
  expect(Object.keys(await rows())).not.toContain("Quantity");
});
