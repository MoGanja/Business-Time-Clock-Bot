const assert = require("assert");
const { open } = require("../src/db");
const { makeLogic, UserError } = require("../src/logic");
const T = require("../src/time");
const F = require("../src/format");

const tz = "America/New_York";
let pass = 0; const ok = (name, fn) => { fn(); pass++; console.log("  ok -", name); };

// ---- time ----
ok("week starts Monday 00:00 local (EDT)", () => {
  const wed = T.localToUtc(2026, 10, 28, tz, 15); // Wed Oct 28 3 PM
  assert.strictEqual(T.weekStart(wed, tz), Date.UTC(2026, 9, 26, 4, 0)); // Mon Oct 26 04:00Z
});
ok("week across DST end is 7 days + 1 hour", () => {
  const s = Date.UTC(2026, 9, 26, 4, 0);
  assert.strictEqual(T.weekEnd(s, tz), Date.UTC(2026, 10, 2, 5, 0)); // Mon Nov 2 05:00Z (EST)
});
ok("Sunday 11 PM belongs to the week that is ending", () => {
  const sun = T.localToUtc(2026, 11, 1, tz, 23, 30);
  assert.strictEqual(T.weekStart(sun, tz), Date.UTC(2026, 9, 26, 4, 0));
});
ok("parseWeek this/last/date", () => {
  const now = T.localToUtc(2026, 10, 28, tz, 12);
  assert.strictEqual(T.parseWeek("this", tz, now), Date.UTC(2026, 9, 26, 4, 0));
  assert.strictEqual(T.parseWeek("last", tz, now), Date.UTC(2026, 9, 19, 4, 0));
  assert.strictEqual(T.parseWeek("10-21-2026", tz, now), Date.UTC(2026, 9, 19, 4, 0));
  assert.strictEqual(T.parseWeek("2026-10-21", tz, now), Date.UTC(2026, 9, 19, 4, 0));
  assert.strictEqual(T.parseWeek("nonsense", tz, now), null);
});
ok("time parsing", () => {
  assert.deepStrictEqual(T.parseTime("6:30 PM"), { h: 18, mi: 30 });
  assert.deepStrictEqual(T.parseTime("12am"), { h: 0, mi: 0 });
  assert.deepStrictEqual(T.parseTime("18:05"), { h: 18, mi: 5 });
  assert.strictEqual(T.parseTime("25:00"), null);
  const r = T.parseDateTime("10-27-2026 6:00 PM", tz, 0);
  assert.strictEqual(r.ms, T.localToUtc(2026, 10, 27, tz, 18)); assert.ok(r.hadDate);
});
ok("formatting in local time", () => {
  const t = T.localToUtc(2026, 10, 27, tz, 18, 5);
  assert.strictEqual(T.fmtTime(t, tz), "6:05 PM"); assert.strictEqual(T.fmtDate(t, tz), "10-27-2026");
});

// ---- data ----
const db = open(":memory:"); const L = makeLogic(db); const G = "g1";
const throws = (fn, re) => assert.throws(fn, (e) => e instanceof UserError && re.test(e.message));
const at = (d, h, m = 0) => T.localToUtc(2026, 10, d, tz, h, m);

ok("settings default and update", () => {
  assert.strictEqual(L.guild(G).timezone, "America/New_York");
  L.updateGuild(G, { timezone: "America/Chicago" }); assert.strictEqual(L.guild(G).timezone, "America/Chicago");
  L.updateGuild(G, { timezone: tz });
});
let diner, customs;
ok("add / duplicate / list businesses", () => {
  diner = L.addBusiness(G, "Diner", "role1"); customs = L.addBusiness(G, "Customs", null);
  throws(() => L.addBusiness(G, "diner", null), /already exists/);
  assert.strictEqual(L.businesses(G).length, 2);
  assert.strictEqual(L.business(G, "DINER").id, diner.id);
});
ok("clock in/out math", () => {
  L.clockIn(G, "u1", "Ann", diner, at(26, 18));
  throws(() => L.clockIn(G, "u1", "Ann", customs, at(26, 19)), /already clocked in/);
  const s = L.clockOut(G, "u1", 4, at(26, 21, 30));
  assert.strictEqual((s.clock_out - s.clock_in) / 36e5, 3.5);
  throws(() => L.clockOut(G, "u1", 0, at(26, 22)), /not clocked in/);
});
ok("overnight shift counted in the week it started", () => {
  L.clockIn(G, "u2", "Bo", diner, at(1, 22) + 0);                    // Sun Nov 1? (month=10 => Oct) use Oct 1
  L.clockOut(G, "u2", 2, at(2, 2));                                  // 4 hours across midnight
  const rows = L.totals(G, diner.id, at(1, 0), at(8, 0));
  assert.strictEqual(rows[0].hours, 4);
});
ok("totals sorted by jobs then hours; leaderboard", () => {
  L.clockIn(G, "u3", "Cy", diner, at(27, 10)); L.clockOut(G, "u3", 4, at(27, 12)); // ties Ann on jobs, fewer hours
  L.clockIn(G, "u4", "Di", diner, at(27, 10)); L.clockOut(G, "u4", 9, at(27, 11));
  const start = Date.UTC(2026, 9, 26, 4), end = T.weekEnd(start, tz);
  const rows = L.totals(G, diner.id, start, end);
  assert.deepStrictEqual(rows.map((r) => r.name), ["Di", "Ann", "Cy"]);
  assert.ok(F.top5(rows).includes("🥇"));
  assert.ok(F.table(rows).includes("TOTAL"));
});
ok("other business and other week stay separate", () => {
  const start = Date.UTC(2026, 9, 26, 4), end = T.weekEnd(start, tz);
  assert.strictEqual(L.totals(G, customs.id, start, end).length, 0);
  assert.strictEqual(L.totals(G, diner.id, T.weekStart(at(19, 12), tz), start).length, 0);
});
ok("open shifts listed and not counted in totals", () => {
  L.clockIn(G, "u5", "Ed", diner, at(28, 9));
  assert.strictEqual(L.openShifts(G).length, 1);
  const start = Date.UTC(2026, 9, 26, 4);
  assert.ok(!L.totals(G, diner.id, start, T.weekEnd(start, tz)).some((r) => r.name === "Ed"));
});
ok("manager edits, deletes, and validation", () => {
  const s = L.shiftsList(G, { uid: "u3", start: at(26, 0), end: at(30, 0) })[0];
  const e = L.editShift(G, s.id, { clock_out: s.clock_in + 3 * 36e5, orders: 6 });
  assert.strictEqual(e.orders, 6); assert.strictEqual(e.edited, 1);
  throws(() => L.editShift(G, s.id, { clock_out: s.clock_in - 1 }), /after clock-in/);
  L.deleteShift(G, s.id); throws(() => L.getShift(G, s.id) || (() => { throw new UserError("No shift"); })(), /No shift/);
});
ok("remove business blocked while clocked in, keeps history otherwise", () => {
  throws(() => L.removeBusiness(G, "Diner"), /still clocked in/);
  L.clockOut(G, "u5", 0, at(28, 12));
  L.removeBusiness(G, "Diner");
  assert.strictEqual(L.businesses(G).length, 1);
  L.addBusiness(G, "Diner", null);                       // name can be reused
  assert.strictEqual(L.businesses(G).length, 2);
});
ok("rename, role, csv", () => {
  L.renameBusiness(G, "Customs", "Customs Shop"); assert.ok(L.business(G, "customs shop"));
  L.setBusinessRole(G, "Customs Shop", "r9"); assert.strictEqual(L.business(G, "Customs Shop").role_id, "r9");
  const rows = L.shiftsList(G, { start: at(1, 0), end: at(30, 0) });
  const csv = F.csv(rows, tz); assert.ok(csv.startsWith("Date,Employee,Business")); assert.ok(csv.split("\n").length > 2);
});
console.log(`\n${pass} checks passed`);
