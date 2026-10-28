require("dotenv").config();
const fs = require("fs"), path = require("path"), os = require("os");
const {
  Client, GatewayIntentBits, REST, Routes, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, AttachmentBuilder, PermissionFlagsBits, MessageFlags,
} = require("discord.js");
const { open } = require("./db");
const { makeLogic, UserError } = require("./logic");
const T = require("./time");
const F = require("./format");
const commands = require("./commands");

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
for (const [k, v] of Object.entries({ DISCORD_TOKEN, CLIENT_ID })) {
  if (!v) { console.error(`Missing ${k}. Set it in .env or your host's environment variables.`); process.exit(1); }
}
const dbFile = process.env.DB_PATH || path.join(__dirname, "..", "data", "timeclock.db");
fs.mkdirSync(path.dirname(dbFile), { recursive: true });
const db = open(dbFile);
const L = makeLogic(db);
const EPH = MessageFlags.Ephemeral;
const BLUE = 0x3a5f8a;

// ---------- permissions ----------
const hasRole = (member, id) =>
  !!id && !!member && (Array.isArray(member.roles) ? member.roles.includes(id) : member.roles.cache.has(id));
const isAdmin = (i) => !!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
const isManager = (i, g) => isAdmin(i) || hasRole(i.member, g.manager_role_id);
function requireManager(i, g) { if (!isManager(i, g)) throw new UserError("Only managers can use this. Ask for the manager role."); }
const canUse = (i, b) => !b.role_id || hasRole(i.member, b.role_id);

// ---------- small helpers ----------
function pickBusinesses(gid, name) {
  if (!name) return L.businesses(gid);
  const b = L.business(gid, name);
  if (!b) throw new UserError(`No business named "${name}". Use /business list.`);
  return [b];
}
function weekFrom(i, g) {
  const start = T.parseWeek(i.options.getString("week"), g.timezone);
  if (start == null) throw new UserError('I couldn\'t read that week. Use "this", "last", or a date like 10-19-2026.');
  return start;
}
function weekEmbed(biz, rows, start, tz, { full = true, top = false } = {}) {
  const e = new EmbedBuilder().setColor(BLUE).setTitle(`${biz.name} — Week of ${T.fmtDate(start, tz)}`);
  if (!rows.length) return e.setDescription("No completed shifts this week.");
  if (full) e.setDescription(F.table(rows));
  if (top || !full) e.addFields({ name: "🏆 Top 5", value: F.top5(rows) });
  return e;
}
async function reply(i, payload) {
  return i.deferred || i.replied ? i.followUp(payload) : i.reply(payload);
}
const eph = (content) => ({ content, flags: EPH });

function doClockIn(i, g, biz) {
  if (!canUse(i, biz)) throw new UserError(`You need the <@&${biz.role_id}> role to clock in at **${biz.name}**.`);
  const openShift = L.openShift(i.guildId, i.user.id);
  if (openShift) {
    const hrs = (Date.now() - openShift.clock_in) / 36e5;
    throw new UserError(`You're already clocked in at **${openShift.business_name}** (since ${T.fmtTime(openShift.clock_in, g.timezone)}). Use /clockout first.` +
      (hrs > 16 ? " That shift looks very long, so ask a manager to fix it." : ""));
  }
  const now = Date.now();
  L.clockIn(i.guildId, i.user.id, i.member.displayName, biz, now);
  return `✅ **${i.member.displayName}** clocked in at **${biz.name}** — ${T.fmtTime(now, g.timezone)}`;
}
function doClockOut(i, g, orders) {
  const s = L.clockOut(i.guildId, i.user.id, orders, Date.now());
  const hrs = (s.clock_out - s.clock_in) / 36e5;
  return `🛑 **${i.member.displayName}** clocked out of **${s.business_name}** at ${T.fmtTime(s.clock_out, g.timezone)}. Shift: **${hrs.toFixed(2)} hrs**, **${s.orders} orders**.`;
}

// ---------- client ----------
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async () => {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  try {
    if (GUILD_ID) await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    else await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log(`Logged in as ${client.user.tag}. ${commands.length} commands registered${GUILD_ID ? " for your server" : " globally (can take up to an hour to appear)"}.`);
  } catch (e) { console.error("Could not register commands:", e.message); }
  tickReports(); setInterval(tickReports, 60 * 1000);
});

// ---------- automatic Monday report ----------
async function tickReports() {
  for (const g of db.prepare("SELECT * FROM guilds WHERE report_channel_id IS NOT NULL").all()) {
    try {
      const now = Date.now(), cur = T.weekStart(now, g.timezone);
      if (now < cur + 36e5) continue;                         // not yet 1 AM Monday
      const prev = T.weekStart(cur - 12 * 36e5, g.timezone);
      if (g.last_report_week === prev) continue;              // already sent
      if (g.last_report_week == null) { L.updateGuild(g.guild_id, { last_report_week: prev }); continue; } // don't backfill
      const ch = await client.channels.fetch(g.report_channel_id).catch(() => null);
      if (!ch || !ch.send) continue;
      const end = cur;
      const embeds = L.businesses(g.guild_id).map((b) => weekEmbed(b, L.totals(g.guild_id, b.id, prev, end), prev, g.timezone, { full: true, top: true }));
      for (let n = 0; n < embeds.length; n += 10) {
        await ch.send({
          content: n === 0 ? `📊 **Weekly report — week of ${T.fmtDate(prev, g.timezone)}**` : undefined,
          embeds: embeds.slice(n, n + 10),
        });
      }
      L.updateGuild(g.guild_id, { last_report_week: prev });
    } catch (e) { console.error("Weekly report failed:", e.message); }
  }
}

// ---------- interactions ----------
client.on(Events.InteractionCreate, async (i) => {
  try {
    if (!i.guildId) return;
    if (i.isAutocomplete()) return await autocomplete(i);
    if (i.isChatInputCommand()) return await slash(i);
    if (i.isButton()) return await button(i);
    if (i.isStringSelectMenu()) return await select(i);
    if (i.isModalSubmit()) return await modal(i);
  } catch (err) {
    const msg = err instanceof UserError ? err.message : "Something went wrong. Try again, and tell the bot owner if it keeps happening.";
    if (!(err instanceof UserError)) console.error(err);
    try { await reply(i, eph(msg)); } catch {}
  }
});

async function autocomplete(i) {
  const q = i.options.getFocused().toLowerCase();
  let list = L.businesses(i.guildId);
  if (i.commandName === "clockin") list = list.filter((b) => canUse(i, b));
  await i.respond(list.filter((b) => b.name.toLowerCase().includes(q)).slice(0, 25).map((b) => ({ name: b.name, value: b.name })));
}

async function slash(i) {
  const g = L.guild(i.guildId), tz = g.timezone, name = i.commandName;

  if (name === "help") {
    return i.reply({ flags: EPH, embeds: [new EmbedBuilder().setColor(BLUE).setTitle("Time Clock").setDescription(
      "**Everyone**\n`/clockin` · `/clockout orders:5` · `/myhours` · `/whoson` · `/leaderboard` · `/weekly` · `/business list`\n\n" +
      "**Managers**\n`/setup` · `/business add|remove|rename|role` · `/shifts` · `/shift edit|delete|forceout` · `/export` · `/panel` · `/backup`\n\n" +
      "Weeks run Monday to Sunday. Anywhere it asks for a week, type `this`, `last`, or a date like `10-19-2026`.")] });
  }

  if (name === "setup") {
    requireManager(i, g);
    const tzIn = i.options.getString("timezone"), role = i.options.getRole("manager_role"),
      ch = i.options.getChannel("report_channel"), stop = i.options.getBoolean("stop_reports");
    const changes = [];
    if (tzIn) {
      if (!T.validTz(tzIn)) throw new UserError('That time zone isn\'t valid. Use a name like "America/New_York" (Vermont, Eastern time).');
      L.updateGuild(i.guildId, { timezone: tzIn }); changes.push(`Time zone → **${tzIn}**`);
    }
    if (role) {
      if (!isAdmin(i)) throw new UserError("Only someone with Manage Server can change the manager role.");
      L.updateGuild(i.guildId, { manager_role_id: role.id }); changes.push(`Manager role → ${role}`);
    }
    if (ch) { L.updateGuild(i.guildId, { report_channel_id: ch.id, last_report_week: null }); changes.push(`Weekly report channel → ${ch}`); }
    if (stop) { L.updateGuild(i.guildId, { report_channel_id: null }); changes.push("Automatic weekly report turned **off**"); }
    const cur = L.guild(i.guildId);
    const lines = [
      `Time zone: **${cur.timezone}**`,
      `Manager role: ${cur.manager_role_id ? `<@&${cur.manager_role_id}>` : "none (anyone with Manage Server)"}`,
      `Weekly report channel: ${cur.report_channel_id ? `<#${cur.report_channel_id}>` : "off"}`,
      `Businesses: ${L.businesses(i.guildId).map((b) => b.name).join(", ") || "none yet. Add one with /business add"}`,
    ];
    return i.reply({ flags: EPH, content: (changes.length ? `Saved:\n${changes.join("\n")}\n\n` : "") + "**Current settings**\n" + lines.join("\n") });
  }

  if (name === "business") {
    const sub = i.options.getSubcommand();
    if (sub === "list") {
      const list = L.businesses(i.guildId);
      if (!list.length) return i.reply(eph("No businesses yet. A manager can add one with `/business add`."));
      return i.reply({ flags: EPH, content: list.map((b) => `• **${b.name}**${b.role_id ? ` — role: <@&${b.role_id}>` : " — open to everyone"}`).join("\n") });
    }
    requireManager(i, g);
    if (sub === "add") {
      const b = L.addBusiness(i.guildId, i.options.getString("name"), i.options.getRole("role")?.id);
      return i.reply(`➕ Added business **${b.name}**${b.role_id ? ` (clock-in role: <@&${b.role_id}>)` : ""}.`);
    }
    if (sub === "remove") {
      const b = L.removeBusiness(i.guildId, i.options.getString("business"));
      return i.reply(`🗑️ Removed **${b.name}**. Its past shifts are kept in the database.`);
    }
    if (sub === "rename") {
      const b = L.renameBusiness(i.guildId, i.options.getString("business"), i.options.getString("new_name"));
      return i.reply(`✏️ Renamed to **${b.name}**.`);
    }
    if (sub === "role") {
      const role = i.options.getRole("role");
      const b = L.setBusinessRole(i.guildId, i.options.getString("business"), role?.id);
      return i.reply(role ? `🔒 Only ${role} can clock in at **${b.name}** now.` : `🔓 Anyone can clock in at **${b.name}** now.`);
    }
  }

  if (name === "clockin") {
    const wanted = i.options.getString("business");
    let biz;
    if (wanted) {
      biz = L.business(i.guildId, wanted);
      if (!biz) throw new UserError(`No business named "${wanted}". Use /business list.`);
    } else {
      const options = L.businesses(i.guildId).filter((b) => canUse(i, b));
      if (!options.length) throw new UserError("No business is available to you. Ask a manager to add one or give you its role.");
      if (options.length > 1) throw new UserError(`Pick a business: ${options.map((b) => `**${b.name}**`).join(", ")}`);
      biz = options[0];
    }
    return i.reply(doClockIn(i, g, biz));
  }

  if (name === "clockout") return i.reply(doClockOut(i, g, i.options.getInteger("orders") ?? 0));

  if (name === "myhours") {
    const start = weekFrom(i, g), end = T.weekEnd(start, tz);
    const bizName = i.options.getString("business");
    const onlyBiz = bizName ? pickBusinesses(i.guildId, bizName)[0].name : null;
    let rows = L.userTotals(i.guildId, i.user.id, start, end);
    if (onlyBiz) rows = rows.filter((r) => r.business.toLowerCase() === onlyBiz.toLowerCase());
    const hrs = rows.reduce((a, r) => a + r.hours, 0), jobs = rows.reduce((a, r) => a + r.jobs, 0);
    const open = L.openShift(i.guildId, i.user.id);
    const body = rows.length
      ? rows.map((r) => `**${r.business}** — ${r.hours.toFixed(2)} hrs · ${r.jobs} orders (${r.shifts} shift${r.shifts === 1 ? "" : "s"})`).join("\n") + `\n\n**Total: ${hrs.toFixed(2)} hrs · ${jobs} orders**`
      : "No completed shifts that week.";
    return i.reply(eph(`📊 **Your week of ${T.fmtDate(start, tz)}**\n${body}` + (open ? `\n\n🟢 Currently clocked in at **${open.business_name}** since ${T.fmtTime(open.clock_in, tz)}.` : "")));
  }

  if (name === "whoson") {
    const on = L.openShifts(i.guildId);
    if (!on.length) return i.reply(eph("Nobody is clocked in right now."));
    const lines = on.map((s) => {
      const h = (Date.now() - s.clock_in) / 36e5;
      return `🟢 **${F.clean(s.name)}** — ${s.business_name} since ${T.fmtTime(s.clock_in, tz)} (${h.toFixed(1)}h)${h > 16 ? " ⚠️ very long" : ""}`;
    });
    return i.reply(lines.join("\n"));
  }

  if (name === "leaderboard" || name === "weekly") {
    const start = weekFrom(i, g), end = T.weekEnd(start, tz);
    const list = pickBusinesses(i.guildId, i.options.getString("business"));
    if (!list.length) throw new UserError("No businesses yet. A manager can add one with /business add.");
    const embeds = list.map((b) => weekEmbed(b, L.totals(i.guildId, b.id, start, end), start, tz, name === "weekly" ? { full: true } : { full: false }));
    await i.reply({ embeds: embeds.slice(0, 10) });
    for (let n = 10; n < embeds.length; n += 10) await i.followUp({ embeds: embeds.slice(n, n + 10) });
    return;
  }

  if (name === "shifts") {
    requireManager(i, g);
    const start = weekFrom(i, g), end = T.weekEnd(start, tz);
    const bizName = i.options.getString("business");
    const bizId = bizName ? pickBusinesses(i.guildId, bizName)[0].id : null;
    const user = i.options.getUser("user");
    const rows = L.shiftsList(i.guildId, { bizId, uid: user.id, start, end });
    if (!rows.length) return i.reply(eph(`No shifts for **${user.displayName ?? user.username}** that week.`));
    const lines = rows.slice(0, 40).map((s) => `${F.shiftLine(s, tz)} · ${s.business_name}`);
    return i.reply(eph(`**${F.clean(rows[0].name)} — week of ${T.fmtDate(start, tz)}**\n${lines.join("\n")}${rows.length > 40 ? `\n…and ${rows.length - 40} more` : ""}\n\nFix one with \`/shift edit id:<number>\`.`));
  }

  if (name === "shift") {
    requireManager(i, g);
    const sub = i.options.getSubcommand();
    if (sub === "delete") {
      const s = L.deleteShift(i.guildId, i.options.getInteger("id"));
      return i.reply(eph(`🗑️ Deleted shift #${s.id} (${F.clean(s.name)}, ${s.business_name}, ${T.fmtDate(s.clock_in, tz)}).`));
    }
    if (sub === "edit") {
      const id = i.options.getInteger("id"), s = L.getShift(i.guildId, id);
      if (!s) throw new UserError(`No shift with ID ${id}.`);
      const patch = {};
      const ci = i.options.getString("clock_in"), co = i.options.getString("clock_out"), ord = i.options.getInteger("orders");
      if (ci) { const r = T.parseDateTime(ci, tz, s.clock_in); if (!r) throw new UserError('Couldn\'t read clock_in. Try "6:00 PM" or "10-27-2026 6:00 PM".'); patch.clock_in = r.ms; }
      if (co) {
        const base = patch.clock_in ?? s.clock_in;
        const r = T.parseDateTime(co, tz, base); if (!r) throw new UserError('Couldn\'t read clock_out. Try "9:30 PM" or "10-27-2026 9:30 PM".');
        patch.clock_out = !r.hadDate && r.ms <= base ? r.ms + 864e5 : r.ms; // overnight shift
      }
      if (ord != null) patch.orders = ord;
      if (!Object.keys(patch).length) throw new UserError("Nothing to change. Fill in clock_in, clock_out or orders.");
      const u = L.editShift(i.guildId, id, patch);
      return i.reply(eph(`✏️ Updated: ${F.shiftLine(u, tz)} · ${F.clean(u.name)}, ${u.business_name}`));
    }
    if (sub === "forceout") {
      const user = i.options.getUser("user");
      const open = L.openShift(i.guildId, user.id);
      if (!open) throw new UserError("That person isn't clocked in.");
      let at = Date.now();
      const t = i.options.getString("time");
      if (t) {
        const r = T.parseDateTime(t, tz, open.clock_in); if (!r) throw new UserError('Couldn\'t read that time. Try "9:30 PM".');
        at = !r.hadDate && r.ms <= open.clock_in ? r.ms + 864e5 : r.ms;
        if (at <= open.clock_in) throw new UserError("Clock-out must be after clock-in.");
      }
      const s = L.clockOut(i.guildId, user.id, i.options.getInteger("orders") ?? 0, at);
      return i.reply(`🛑 **${F.clean(open.name ?? user.username)}** was clocked out by a manager at ${T.fmtTime(at, tz)} (${((at - s.clock_in) / 36e5).toFixed(2)} hrs, ${s.orders} orders).`);
    }
  }

  if (name === "export") {
    requireManager(i, g);
    const start = weekFrom(i, g), end = T.weekEnd(start, tz);
    const bizName = i.options.getString("business");
    const bizId = bizName ? pickBusinesses(i.guildId, bizName)[0].id : null;
    const rows = L.shiftsList(i.guildId, { bizId, start, end });
    if (!rows.length) throw new UserError("No shifts that week.");
    const file = new AttachmentBuilder(Buffer.from(F.csv(rows, tz), "utf8"), { name: `timeclock-${T.fmtDate(start, tz)}.csv` });
    return i.reply({ flags: EPH, content: `Week of ${T.fmtDate(start, tz)}: ${rows.length} shifts.`, files: [file] });
  }

  if (name === "panel") {
    requireManager(i, g);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("ci").setLabel("Clock In").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("co").setLabel("Clock Out").setStyle(ButtonStyle.Danger));
    return i.reply({ content: "⏱️ **Time Clock** — press a button to clock in or out.", components: [row] });
  }

  if (name === "backup") {
    if (!isAdmin(i)) throw new UserError("Only someone with Manage Server can download a backup.");
    await i.deferReply({ flags: EPH });
    const tmp = path.join(os.tmpdir(), `timeclock-backup-${Date.now()}.db`);
    await db.backup(tmp);
    await i.editReply({ content: "Database backup. Keep it private; it contains your employees' hours.", files: [new AttachmentBuilder(tmp, { name: "timeclock-backup.db" })] });
    fs.unlink(tmp, () => {});
  }
}

// ---------- buttons, menus, modals ----------
async function button(i) {
  const g = L.guild(i.guildId);
  if (i.customId === "ci") {
    const options = L.businesses(i.guildId).filter((b) => canUse(i, b));
    if (!options.length) throw new UserError("No business is available to you. Ask a manager.");
    if (options.length === 1) return i.reply(doClockIn(i, g, options[0]));
    const menu = new StringSelectMenuBuilder().setCustomId("ci_pick").setPlaceholder("Where are you working?")
      .addOptions(options.slice(0, 25).map((b) => ({ label: b.name, value: String(b.id) })));
    return i.reply({ flags: EPH, content: "Pick a business to clock in:", components: [new ActionRowBuilder().addComponents(menu)] });
  }
  if (i.customId === "co") {
    if (!L.openShift(i.guildId, i.user.id)) throw new UserError("You're not clocked in.");
    const modal = new ModalBuilder().setCustomId("co_modal").setTitle("Clock Out").addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("orders").setLabel("Orders completed this shift")
        .setStyle(TextInputStyle.Short).setPlaceholder("0").setRequired(false).setMaxLength(6)));
    return i.showModal(modal);
  }
}
async function select(i) {
  if (i.customId !== "ci_pick") return;
  const g = L.guild(i.guildId);
  const biz = L.businesses(i.guildId).find((b) => String(b.id) === i.values[0]);
  if (!biz) throw new UserError("That business no longer exists.");
  return i.update({ content: doClockIn(i, g, biz), components: [] });
}
async function modal(i) {
  if (i.customId !== "co_modal") return;
  const g = L.guild(i.guildId);
  const n = parseInt(i.fields.getTextInputValue("orders"), 10);
  return i.reply(doClockOut(i, g, Number.isFinite(n) ? n : 0));
}

process.on("unhandledRejection", (e) => console.error("Unhandled:", e));
client.login(DISCORD_TOKEN);
