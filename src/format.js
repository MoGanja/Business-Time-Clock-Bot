const T = require("./time");
const pad = (s, n) => { s = String(s); return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length); };
const padL = (s, n) => { s = String(s); return " ".repeat(Math.max(0, n - s.length)) + s; };
const clean = (s) => String(s).replace(/`/g, "'");

function table(rows, { limit = 40, totals = true } = {}) {
  let t = pad("#", 3) + pad("Name", 16) + padL("Jobs", 6) + padL("Hours", 8) + "\n";
  rows.slice(0, limit).forEach((r, i) => {
    t += pad(i + 1, 3) + pad(clean(r.name), 16) + padL(r.jobs || 0, 6) + padL((r.hours || 0).toFixed(2), 8) + "\n";
  });
  if (rows.length > limit) t += `...and ${rows.length - limit} more\n`;
  if (totals) {
    const j = rows.reduce((a, r) => a + (r.jobs || 0), 0), h = rows.reduce((a, r) => a + (r.hours || 0), 0);
    t += pad("", 3) + pad("TOTAL", 16) + padL(j, 6) + padL(h.toFixed(2), 8) + "\n";
  }
  return "```\n" + t + "```";
}
const MEDALS = ["🥇", "🥈", "🥉", "4.", "5."];
function top5(rows) {
  return rows.slice(0, 5).map((r, i) => `${MEDALS[i]} **${clean(r.name)}** — ${r.jobs || 0} jobs, ${(r.hours || 0).toFixed(2)} hrs`).join("\n");
}
function shiftLine(s, tz) {
  const out = s.clock_out ? T.fmtTime(s.clock_out, tz) : "…still on";
  const hrs = s.clock_out ? ` · ${((s.clock_out - s.clock_in) / 36e5).toFixed(2)}h` : "";
  return `#${s.id} · ${T.fmtDate(s.clock_in, tz)} · ${T.fmtTime(s.clock_in, tz)}–${out}${hrs} · ${s.orders} orders${s.edited ? " ✎" : ""}`;
}
const csvCell = (v) => { v = String(v ?? ""); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
function csv(shifts, tz) {
  const head = ["Date", "Employee", "Business", "Clock In", "Clock Out", "Hours", "Orders"];
  const lines = shifts.map((s) => [
    T.fmtDate(s.clock_in, tz), s.name, s.business_name, T.fmtTime(s.clock_in, tz),
    s.clock_out ? T.fmtTime(s.clock_out, tz) : "", s.clock_out ? ((s.clock_out - s.clock_in) / 36e5).toFixed(2) : "", s.orders,
  ].map(csvCell).join(","));
  return [head.join(","), ...lines].join("\n");
}
module.exports = { table, top5, shiftLine, csv, clean };
