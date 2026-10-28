# Discord Time Clock Bot (standalone, no spreadsheet)

A time clock that lives entirely in Discord. Employees clock in and out with
commands or buttons, and the bot keeps all the hours in its own small database.
Managers set everything up with commands, so nothing is hard-coded.

## What it does

**Everyone**
| Command | What it does |
|---|---|
| `/clockin [business]` | Start a shift. If you only have access to one business, you can skip the name. |
| `/clockout [orders]` | End the shift and log the number of orders you completed. |
| `/myhours [week] [business]` | Your own hours and orders (only you see it). |
| `/whoson` | Who is clocked in right now. |
| `/leaderboard [business] [week]` | Top 5 by orders completed, then hours. |
| `/weekly [business] [week]` | Full per-employee totals for a week. |
| `/business list` | The businesses on this server. |

**Managers** (anyone with the Manage Server permission, or the manager role)
| Command | What it does |
|---|---|
| `/setup` | View settings. Set `timezone`, `manager_role`, `report_channel`. |
| `/business add / remove / rename / role` | Add or delete businesses, and choose which role can clock in at each. |
| `/shifts user [week]` | List someone's shifts with ID numbers. |
| `/shift edit / delete / forceout` | Fix times or orders, remove a shift, or clock out someone who forgot. |
| `/export [business] [week]` | Download a week as a CSV file (opens in Excel or Google Sheets). |
| `/panel` | Post **Clock In / Clock Out** buttons in a channel. |
| `/backup` | Download a copy of the database (Manage Server only). |

**Automatic:** every Monday at 1 AM (your time zone) the bot posts last week's
report, with a Top 5, in the report channel you choose.

**Weeks** run Monday to Sunday. Anywhere a command asks for a week you can type
`this`, `last`, or any date in that week like `10-19-2026`. Old weeks never
disappear, because everything stays in the database. A shift counts toward the
week it started in, so overnight shifts are handled correctly.

---

## Part 1 - Create the bot in Discord

1. Go to **https://discord.com/developers/applications** and click **New Application**.
2. On **General Information**, copy the **Application ID**. This is `CLIENT_ID`.
3. Click **Bot**, then **Reset Token**, and copy it. This is `DISCORD_TOKEN`.
   Treat it like a password. You do **not** need to turn on any Privileged Intents.
4. Click **OAuth2 > URL Generator**. Tick the scopes **bot** and **applications.commands**.
   Under Bot Permissions tick **View Channels**, **Send Messages** and **Embed Links**.
   Open the generated URL and add the bot to your server.
5. In Discord go to **User Settings > Advanced** and turn on **Developer Mode**.
   Right-click your server icon > **Copy Server ID**. This is `GUILD_ID`.

## Part 2 - Run the bot

You need **Node.js 20 or newer** if running it yourself.

**On your own computer (for testing):**
1. Copy `.env.example` to `.env` and fill in the three values.
2. Open a terminal in this folder and run `npm install`, then `npm start`.
3. You should see `Logged in as ... commands registered for your server.`

**Free hosting on Bot-Hosting.net (so it runs when your computer is off):**
Check their site for current terms. When last checked, the free plan needed a manual
renewal about every 4 days or the bot stopped.
1. Create an account and a free deployment with the **Node.js** runtime.
2. In the **File Manager**, upload everything in this folder **except** `node_modules`
   and `.env`: the `src` folder, `package.json`, and an empty `data` folder (create it if needed).
3. Add `DISCORD_TOKEN`, `CLIENT_ID` and `GUILD_ID` under **Environment Variables**.
4. Set the startup command to `npm start` (or set the main file to `src/index.js`).
5. In the **Console** run `npm install`, then **Start**.
6. Pick Node 20 or 22 if the host lets you choose a version.

**Back up your data.** All hours live in `data/timeclock.db`. Run `/backup` in Discord
now and then and keep the file. Free hosts can lose files.

## Part 3 - First-time setup in Discord

Run these in your server, as someone with Manage Server:
1. `/setup timezone:America/New_York` (use your own zone, such as America/Chicago.
   Vermont is Eastern, so America/New_York).
2. `/business add name:Diner role:@Diner-Staff` (the role is optional; without one,
   everyone can clock in there). Repeat for each business.
3. `/setup manager_role:@Managers` so your managers can use the manager commands.
4. `/setup report_channel:#weekly-reports` for the automatic Monday report.
5. In your clock-in channel, run `/panel` to post the buttons. Pin the message.
6. Have someone try `/clockin` and `/clockout orders:3`, then check `/weekly`.

## How access works

- **Per-business roles:** `/business role` makes a business clock-in only for one
  role, so employees of one business can't clock in at another.
- **Managers:** Manage Server permission, or the role set with `/setup manager_role`.
- **Employees need no setup.** The bot uses their Discord account, so there's no
  spelling-match problem. Names in reports are their server nicknames.
- To restrict *where* commands can be used, go to **Server Settings > Integrations**,
  choose the bot, and limit channels.

## Common fixes

| Problem | Fix |
|---|---|
| Commands don't show up | Check `CLIENT_ID` and `GUILD_ID`. Re-invite the bot with **applications.commands** ticked. Without `GUILD_ID`, global commands can take up to an hour. |
| "Only managers can use this" | Get Manage Server, or ask an admin to run `/setup manager_role`. |
| Someone forgot to clock out | `/shift forceout user:@them time:9:30 PM orders:5` |
| Wrong hours or orders | `/shifts user:@them` to find the ID, then `/shift edit id:12 clock_out:9:30 PM` |
| Times are hours off | `/setup timezone:` with the right zone name. |
| No weekly report | Set `/setup report_channel`, and make sure the bot can send messages and embeds there. The first report arrives the Monday after you set it. |
| `npm install` fails | Use Node 20 or 22. The database library needs a prebuilt file for your Node version. |

## Notes

- Times typed by hand need AM/PM (or 24-hour like `18:30`). Plain `6:00` means 6 AM.
- Removing a business hides it but keeps its shifts.
- The database file is private. Never share it, your `.env`, or your bot token.
- Written for personal use on one server. It stores data per server already, so
  it can grow into a public bot later (privacy policy, hosting and verification
  would then be needed).

## For the curious: files

| File | Job |
|---|---|
| `src/index.js` | Talks to Discord: commands, buttons, the Monday report |
| `src/commands.js` | The slash command definitions |
| `src/logic.js` | All the rules (clocking, totals, edits) with no Discord code |
| `src/db.js` | Creates the database tables |
| `src/time.js` | Time zones and week math |
| `src/format.js` | Tables, leaderboard text and CSV |
| `test/logic.test.js` | `npm test` checks the rules |
