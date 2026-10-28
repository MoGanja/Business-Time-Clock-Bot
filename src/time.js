// Time zone + week helpers. No libraries: uses the built-in Intl API.
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function lp(ms, tz) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", weekday: "short", year: "numeric", month: "numeric",
    day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
  });
  const o = {};
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second, dow: DAYS.indexOf(o.weekday) };
}
function offsetMs(ms, tz) {
  const p = lp(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}
// Local wall-clock time in tz -> UTC milliseconds (handles daylight saving)
function localToUtc(y, m, d, tz, h = 0, mi = 0) {
  const t = Date.UTC(y, m - 1, d, h, mi);
  const u = t - offsetMs(t, tz);
  return t - offsetMs(u, tz);
}
function validTz(tz) { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } }

// Monday 00:00 (local) of the week containing ms
function weekStart(ms, tz) {
  const p = lp(ms, tz);
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d - p.dow));
  return localToUtc(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), tz);
}
function weekEnd(start, tz) { return weekStart(start + 7 * 864e5 + 12 * 36e5, tz); }

function valid(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? { y, m, d } : null;
}
function parseDate(s) {
  let m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2}|\d{4})$/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return valid(y, +m[1], +m[2]); }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  return null;
}
function parseTime(s) {
  const m = s.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(a|p|am|pm)?$/i);
  if (!m) return null;
  let h = +m[1]; const mi = +(m[2] || 0); const ap = (m[3] || "").toLowerCase()[0];
  if (mi > 59) return null;
  if (ap) { if (h < 1 || h > 12) return null; if (ap === "p" && h < 12) h += 12; if (ap === "a" && h === 12) h = 0; }
  else if (h > 23) return null;
  return { h, mi };
}
// "this" | "last" | a date -> start of that week (UTC ms), or null if unreadable
function parseWeek(input, tz, now = Date.now()) {
  const s = (input || "").trim().toLowerCase();
  const cur = weekStart(now, tz);
  if (!s || s === "this") return cur;
  if (s === "last") return weekStart(cur - 12 * 36e5, tz);
  const d = parseDate(s);
  if (!d) return null;
  return weekStart(localToUtc(d.y, d.m, d.d, tz, 12), tz);
}
// "10-27-2026 6:30 PM" or just "6:30 PM" (uses baseMs's date). Returns UTC ms or null.
function parseDateTime(str, tz, baseMs) {
  const parts = str.trim().split(/\s+/);
  let date, timeStr = str.trim(), hadDate = false;
  if (/^\d+[-\/.]\d+[-\/.]\d+$/.test(parts[0])) {
    date = parseDate(parts[0]); if (!date) return null;
    timeStr = parts.slice(1).join(" "); hadDate = true;
  } else { const p = lp(baseMs, tz); date = { y: p.y, m: p.m, d: p.d }; }
  const t = parseTime(timeStr); if (!t) return null;
  return { ms: localToUtc(date.y, date.m, date.d, tz, t.h, t.mi), hadDate };
}

const fmtDate = (ms, tz) => { const p = lp(ms, tz); return `${p.m}-${p.d}-${p.y}`; };
const fmtTime = (ms, tz) => new Date(ms).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
const fmtDateTime = (ms, tz) => `${fmtDate(ms, tz)} ${fmtTime(ms, tz)}`;

module.exports = { weekStart, weekEnd, parseWeek, parseDateTime, parseDate, parseTime, validTz, localToUtc, fmtDate, fmtTime, fmtDateTime };
