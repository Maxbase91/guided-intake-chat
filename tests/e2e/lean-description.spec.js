// From a real new-demand result (October 2026): long AI texts, "( users globally)" left behind, a repeated sourcing text,
// record rows that never say anything, and a documents call that cost many tokens. The description is now lean.
const { test, expect } = require("@playwright/test");
const { openApp, say, start } = require("./helpers");

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
  await start(page, "A new procurement intake platform for the whole bank, about 2 million");
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

test("the record counts what the kind of purchase has, and lists no materiality or spend review rows", async ({ page }) => {
  await openApp(page);
  await start(page, "A new procurement intake platform for the whole bank, about 2 million");
  const rows = () => page.evaluate(() => Object.fromEntries(intakeRecord()));
  const sw = await page.evaluate(() => { S.f.quantity = 50; S.f.value = 2000000; S.sd = S.sd || null; return Object.fromEntries(intakeRecord()); });
  expect(sw.Users).toBe("About 50");
  expect(sw.Quantity).toBeUndefined();
  // the spend review at €1m or more is listed with the reviews on the route card, not again in the record
  expect(sw["Material spend review"]).toBeUndefined();
  expect(await page.evaluate(() => S.det.controls.map((c) => c[1]))).toContain("Material spend review");
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

// the live run with Mistral (October 2026): figures the requester never said, "**" around the name, kpis cut to fragments,
// "3" as the duration and the estimate listed twice
test("numbers in the AI's description must be the requester's; the duration keeps its unit; a point counts once", async ({ page }) => {
  await openApp(page);
  await start(page, "We need a procurement intake platform for the whole bank, about 2 million over 3 years");
  const got = await page.evaluate(() => {
    S.msgs.push({ role: "user", text: "Requests come in by email and Excel and approvals take three weeks; if delayed, the audit finding stays open" },
      { role: "user", text: "one intake form, approval routing, Ariba and SAP integration, single sign-on; it works if 90% of requests go through it within 6 months" });
    const ai = {
      headline: "A single platform to streamline procurement requests, replacing email and spreadsheets. Used by procurement, finance and operations teams, it cuts approval delays from three weeks to two days, reduces manual work and ensures audit-ready tracking. The platform integrates with Ariba and SAP, supports single sign-on and replaces fragmented intake methods with one standardised process.",
      exec: "Procurement requests arrive via email and Excel, creating delays that leave an open audit finding. The **Procurement Intake Platform** consolidates intake into one digital form, automates approval routing and integrates with Ariba and SAP. This reduces approval times from 21 days to seven or fewer. Success means 90% of requests go through the platform within 6 months, with every request logged and traceable for the auditors and the business owners alike.",
      benefits: ["Reduces approval cycle time from 21 days to ≤7 days", "Cuts manual work and lost requests", "Ensures audit-ready tracking"],
      kpis: ["90% of requests through the platform within 6 months", "<5% manual overrides per quarter"],
    };
    const m = mergeExec(offlineExec("a procurement intake platform"), ai);
    const r = { m, duration: normFact("duration", "3") };
    S.quality = { rating: "Good", score: 85, complete: 100, points: [{ lvl: "info", text: "The budget of €2,000,000 is an estimate." }] };
    S.sd = S.sd || { desc: {}, detail: { open_points: [] } }; S.sd.detail = { open_points: ["Value: €2,000,000 is an estimate.", "Service level failure consequences: to be agreed in sourcing"] };
    r.qual = qualityHTML().replace(/<[^>]+>/g, "\n").split("\n").map((x) => x.trim()).filter(Boolean);
    return r;
  });
  expect(got.m.headline).not.toMatch(/two days/);
  expect(got.m.headline).toContain("integrates with Ariba and SAP");   // the sentence with the invented figure goes; the rest stays
  expect(got.m.exec).not.toMatch(/21 days|seven or fewer|\*\*/);
  expect(got.m.exec).toContain("Success means 90% of requests go through the platform");   // (timing is never part of the description)
  expect(got.m.benefits).toEqual(["Cuts manual work and lost requests", "Ensures audit-ready tracking"]);
  expect(got.m.kpis).toEqual(["90% of requests through the platform within 6 months"]);
  expect(got.duration).toBe("3 years");
  expect(got.qual.filter((x) => /estimate/.test(x))).toHaveLength(1);
});

// the same live run: Mistral's acceptance suggestion turned "within 6 months" into "within 3 months" and added figures nobody gave
test("a suggestion keeps only the requester's figures and the standard draft's; a figure with another unit is not theirs", async ({ page }) => {
  await openApp(page);
  await start(page, "We need a procurement intake platform for the whole bank, about 2 million over 3 years");
  const got = await page.evaluate(() => {
    S.msgs.push({ role: "user", text: "one intake form, approval routing, Ariba and SAP integration, single sign-on; it works if 90% of requests go through it within 6 months" });
    const mistral = "Acceptance criteria: 90% of procurement requests processed via the platform within 3 months (vs. 6-month target) with <5% manual overrides per quarter; Ariba and SAP integration tested for 100% approval routing accuracy; 90% of requests go through the platform within 6 months\nReview and sign-off: Procurement Head reviews UAT results within 7 working days; Finance Director signs off on financial controls";
    const draft = offlineSuggest("acceptance_pack");
    return { out: groundSuggestion("acceptance_pack", mistral), draft, plain: groundSuggestion("audience_fn", "Target audience: requesters across the bank and procurement analysts\nSupported functions: Procurement and Finance") };
  });
  const [acc, rev] = got.out.split("\n");
  expect(acc).toBe("Acceptance criteria: 90% of requests go through the platform within 6 months");
  expect(rev).toBe("Review and sign-off: Finance Director signs off on financial controls");
  expect(got.out).not.toMatch(/3 months|<5%|100%|7 working days/);
  expect(got.plain).toBe("Target audience: requesters across the bank and procurement analysts\nSupported functions: Procurement and Finance");
  // a line left without points takes the standard draft's line, figures and all
  const onlyInvented = await page.evaluate(() => groundSuggestion("acceptance_pack", "Acceptance criteria: 99.9% of requests routed correctly within 2 days\nReview and sign-off: Head of Procurement signs off"));
  expect(onlyInvented.split("\n")[0]).toBe(`Acceptance criteria: ${got.draft.split("\n")[0].replace(/^[^:]+:\s*/, "")}`);
});

test("what the requester already said for a suggestion line comes first when the AI's points lost it", async ({ page }) => {
  await openApp(page);
  await start(page, "We need a procurement intake platform for the whole bank, about 2 million over 3 years");
  const out = await page.evaluate(() => {
    S.msgs.push({ role: "user", text: "one intake form and single sign-on; it works if 90% of requests go through it within 6 months" });
    S.f.acceptance = "90% of requests go through it within 6 months";
    // the live suggestion: every point had a figure nobody gave
    return groundSuggestion("acceptance_pack", "Acceptance criteria: 90% of procurement requests processed within 3 months with <5% manual overrides; 100% approval routing accuracy\nReview and sign-off: Finance approves budget and compliance integration within 5 working days");
  });
  expect(out.split("\n")[0]).toBe("Acceptance criteria: 90% of requests go through it within 6 months");
});
