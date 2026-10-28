// All data rules live here (no Discord code), so they can be tested on their own.
class UserError extends Error {}

function makeLogic(db) {
  const q = (s) => db.prepare(s);
  const L = {};

  // ---- server settings ----
  L.guild = (id) => {
    q("INSERT OR IGNORE INTO guilds(guild_id) VALUES(?)").run(id);
    return q("SELECT * FROM guilds WHERE guild_id=?").get(id);
  };
  L.updateGuild = (id, fields) => {
    L.guild(id);
    for (const [k, v] of Object.entries(fields)) {
      if (!["timezone", "manager_role_id", "report_channel_id", "last_report_week"].includes(k)) continue;
      q(`UPDATE guilds SET ${k}=? WHERE guild_id=?`).run(v, id);
    }
  };

  // ---- businesses ----
  L.businesses = (gid) => q("SELECT * FROM businesses WHERE guild_id=? AND active=1 ORDER BY name COLLATE NOCASE").all(gid);
  L.business = (gid, name) => q("SELECT * FROM businesses WHERE guild_id=? AND active=1 AND name=? COLLATE NOCASE").get(gid, String(name).trim());
  L.addBusiness = (gid, name, roleId) => {
    name = String(name).trim();
    if (!name) throw new UserError("Give the business a name.");
    if (name.length > 40) throw new UserError("Business names can be up to 40 characters.");
    if (L.business(gid, name)) throw new UserError(`**${name}** already exists.`);
    if (L.businesses(gid).length >= 25) throw new UserError("You can have up to 25 businesses.");
    q("INSERT INTO businesses(guild_id,name,role_id) VALUES(?,?,?)").run(gid, name, roleId || null);
    return L.business(gid, name);
  };
  L.removeBusiness = (gid, name) => {
    const b = L.business(gid, name);
    if (!b) throw new UserError(`No business named "${name}".`);
    if (q("SELECT 1 FROM shifts WHERE business_id=? AND clock_out IS NULL").get(b.id))
      throw new UserError(`Someone is still clocked in at **${b.name}**. Clock them out first (/shift forceout).`);
    q("UPDATE businesses SET active=0 WHERE id=?").run(b.id); // history is kept
    return b;
  };
  L.renameBusiness = (gid, name, newName) => {
    const b = L.business(gid, name);
    if (!b) throw new UserError(`No business named "${name}".`);
    newName = String(newName).trim();
    if (!newName || newName.length > 40) throw new UserError("New name must be 1-40 characters.");
    const clash = L.business(gid, newName);
    if (clash && clash.id !== b.id) throw new UserError(`**${newName}** already exists.`);
    q("UPDATE businesses SET name=? WHERE id=?").run(newName, b.id);
    return { ...b, name: newName };
  };
  L.setBusinessRole = (gid, name, roleId) => {
    const b = L.business(gid, name);
    if (!b) throw new UserError(`No business named "${name}".`);
    q("UPDATE businesses SET role_id=? WHERE id=?").run(roleId || null, b.id);
    return b;
  };

  // ---- clocking ----
  L.upsertUser = (gid, uid, name) =>
    q("INSERT INTO users(guild_id,user_id,display_name) VALUES(?,?,?) ON CONFLICT(guild_id,user_id) DO UPDATE SET display_name=excluded.display_name").run(gid, uid, name);
  L.openShift = (gid, uid) =>
    q(`SELECT s.*, b.name AS business_name FROM shifts s JOIN businesses b ON b.id=s.business_id
       WHERE s.guild_id=? AND s.user_id=? AND s.clock_out IS NULL ORDER BY s.clock_in DESC LIMIT 1`).get(gid, uid);
  L.openShifts = (gid) =>
    q(`SELECT s.*, b.name AS business_name, COALESCE(u.display_name,s.user_id) AS name
       FROM shifts s JOIN businesses b ON b.id=s.business_id
       LEFT JOIN users u ON u.guild_id=s.guild_id AND u.user_id=s.user_id
       WHERE s.guild_id=? AND s.clock_out IS NULL ORDER BY s.clock_in`).all(gid);
  L.clockIn = (gid, uid, displayName, biz, now) => {
    if (L.openShift(gid, uid)) throw new UserError("You're already clocked in. Use /clockout first.");
    L.upsertUser(gid, uid, displayName);
    const r = q("INSERT INTO shifts(guild_id,business_id,user_id,clock_in) VALUES(?,?,?,?)").run(gid, biz.id, uid, now);
    return r.lastInsertRowid;
  };
  L.clockOut = (gid, uid, orders, now) => {
    const open = L.openShift(gid, uid);
    if (!open) throw new UserError("You're not clocked in. Use /clockin first.");
    orders = Math.max(0, Math.min(100000, Math.floor(Number(orders) || 0)));
    q("UPDATE shifts SET clock_out=?, orders=? WHERE id=?").run(now, orders, open.id);
    return { ...open, clock_out: now, orders };
  };

  // ---- reporting ----
  L.totals = (gid, bizId, start, end) =>
    q(`SELECT s.user_id, COALESCE(u.display_name,s.user_id) AS name, COUNT(*) AS shifts,
              SUM(s.orders) AS jobs, SUM((s.clock_out-s.clock_in)/3600000.0) AS hours
       FROM shifts s LEFT JOIN users u ON u.guild_id=s.guild_id AND u.user_id=s.user_id
       WHERE s.guild_id=? AND s.business_id=? AND s.clock_out IS NOT NULL AND s.clock_in>=? AND s.clock_in<?
       GROUP BY s.user_id ORDER BY jobs DESC, hours DESC, name`).all(gid, bizId, start, end);
  L.userTotals = (gid, uid, start, end) =>
    q(`SELECT b.name AS business, COUNT(*) AS shifts, SUM(s.orders) AS jobs, SUM((s.clock_out-s.clock_in)/3600000.0) AS hours
       FROM shifts s JOIN businesses b ON b.id=s.business_id
       WHERE s.guild_id=? AND s.user_id=? AND s.clock_out IS NOT NULL AND s.clock_in>=? AND s.clock_in<?
       GROUP BY b.id ORDER BY b.name COLLATE NOCASE`).all(gid, uid, start, end);
  L.shiftsList = (gid, { bizId = null, uid = null, start, end }) =>
    q(`SELECT s.*, b.name AS business_name, COALESCE(u.display_name,s.user_id) AS name
       FROM shifts s JOIN businesses b ON b.id=s.business_id
       LEFT JOIN users u ON u.guild_id=s.guild_id AND u.user_id=s.user_id
       WHERE s.guild_id=? AND s.clock_in>=? AND s.clock_in<?
         AND (? IS NULL OR s.business_id=?) AND (? IS NULL OR s.user_id=?)
       ORDER BY s.clock_in`).all(gid, start, end, bizId, bizId, uid, uid);

  // ---- manager fixes ----
  L.getShift = (gid, id) =>
    q(`SELECT s.*, b.name AS business_name, COALESCE(u.display_name,s.user_id) AS name
       FROM shifts s JOIN businesses b ON b.id=s.business_id
       LEFT JOIN users u ON u.guild_id=s.guild_id AND u.user_id=s.user_id
       WHERE s.guild_id=? AND s.id=?`).get(gid, id);
  L.editShift = (gid, id, { clock_in, clock_out, orders }) => {
    const s = L.getShift(gid, id);
    if (!s) throw new UserError(`No shift with ID ${id}.`);
    const ci = clock_in ?? s.clock_in;
    const co = clock_out === undefined ? s.clock_out : clock_out;
    if (co != null && co <= ci) throw new UserError("Clock-out must be after clock-in.");
    const o = orders == null ? s.orders : Math.max(0, Math.floor(orders));
    q("UPDATE shifts SET clock_in=?, clock_out=?, orders=?, edited=1 WHERE id=?").run(ci, co, o, id);
    return L.getShift(gid, id);
  };
  L.deleteShift = (gid, id) => {
    const s = L.getShift(gid, id);
    if (!s) throw new UserError(`No shift with ID ${id}.`);
    q("DELETE FROM shifts WHERE id=?").run(id);
    return s;
  };
  return L;
}
module.exports = { makeLogic, UserError };
