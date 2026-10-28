const { SlashCommandBuilder, InteractionContextType, ChannelType } = require("discord.js");

const guildOnly = (b) => b.setContexts(InteractionContextType.Guild);
const weekOpt = (o) => o.setName("week").setDescription('"this", "last", or any date in that week, e.g. 10-19-2026');
const bizOpt = (o, required = false) => o.setName("business").setDescription("Which business").setAutocomplete(true).setRequired(required);

module.exports = [
  guildOnly(new SlashCommandBuilder().setName("setup").setDescription("Manager: view or change server settings")
    .addStringOption((o) => o.setName("timezone").setDescription("e.g. America/New_York, America/Chicago, America/Los_Angeles, Europe/London"))
    .addRoleOption((o) => o.setName("manager_role").setDescription("Role that can use manager commands (needs Manage Server to change)"))
    .addChannelOption((o) => o.setName("report_channel").setDescription("Channel for the automatic Monday weekly report").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addBooleanOption((o) => o.setName("stop_reports").setDescription("Turn off the automatic weekly report"))),

  guildOnly(new SlashCommandBuilder().setName("business").setDescription("Manage your businesses")
    .addSubcommand((s) => s.setName("add").setDescription("Manager: add a business")
      .addStringOption((o) => o.setName("name").setDescription("Business name").setRequired(true).setMaxLength(40))
      .addRoleOption((o) => o.setName("role").setDescription("Only people with this role can clock in here (optional)")))
    .addSubcommand((s) => s.setName("remove").setDescription("Manager: remove a business (history is kept)")
      .addStringOption((o) => bizOpt(o, true)))
    .addSubcommand((s) => s.setName("rename").setDescription("Manager: rename a business")
      .addStringOption((o) => bizOpt(o, true))
      .addStringOption((o) => o.setName("new_name").setDescription("New name").setRequired(true).setMaxLength(40)))
    .addSubcommand((s) => s.setName("role").setDescription("Manager: set or clear the role required to clock in")
      .addStringOption((o) => bizOpt(o, true))
      .addRoleOption((o) => o.setName("role").setDescription("Leave empty to let everyone clock in")))
    .addSubcommand((s) => s.setName("list").setDescription("Show all businesses"))),

  guildOnly(new SlashCommandBuilder().setName("clockin").setDescription("Start your shift")
    .addStringOption((o) => bizOpt(o))),
  guildOnly(new SlashCommandBuilder().setName("clockout").setDescription("End your shift and log your orders")
    .addIntegerOption((o) => o.setName("orders").setDescription("Orders you completed this shift").setMinValue(0).setMaxValue(100000))),
  guildOnly(new SlashCommandBuilder().setName("myhours").setDescription("Your hours and orders (only you see this)")
    .addStringOption(weekOpt).addStringOption((o) => bizOpt(o))),
  guildOnly(new SlashCommandBuilder().setName("whoson").setDescription("See who is clocked in right now")),
  guildOnly(new SlashCommandBuilder().setName("leaderboard").setDescription("Top 5 performers (most orders, then hours)")
    .addStringOption((o) => bizOpt(o)).addStringOption(weekOpt)),
  guildOnly(new SlashCommandBuilder().setName("weekly").setDescription("Full weekly totals for every employee")
    .addStringOption((o) => bizOpt(o)).addStringOption(weekOpt)),

  guildOnly(new SlashCommandBuilder().setName("shifts").setDescription("Manager: list one person's shifts (with IDs for editing)")
    .addUserOption((o) => o.setName("user").setDescription("Employee").setRequired(true))
    .addStringOption(weekOpt).addStringOption((o) => bizOpt(o))),
  guildOnly(new SlashCommandBuilder().setName("shift").setDescription("Manager: fix mistakes")
    .addSubcommand((s) => s.setName("edit").setDescription("Change a shift's times or orders")
      .addIntegerOption((o) => o.setName("id").setDescription("Shift ID from /shifts").setRequired(true).setMinValue(1))
      .addStringOption((o) => o.setName("clock_in").setDescription('e.g. "6:00 PM" or "10-27-2026 6:00 PM"'))
      .addStringOption((o) => o.setName("clock_out").setDescription('e.g. "9:30 PM" or "10-27-2026 9:30 PM"'))
      .addIntegerOption((o) => o.setName("orders").setDescription("Orders completed").setMinValue(0)))
    .addSubcommand((s) => s.setName("delete").setDescription("Delete a shift")
      .addIntegerOption((o) => o.setName("id").setDescription("Shift ID from /shifts").setRequired(true).setMinValue(1)))
    .addSubcommand((s) => s.setName("forceout").setDescription("Clock someone out who forgot")
      .addUserOption((o) => o.setName("user").setDescription("Employee").setRequired(true))
      .addIntegerOption((o) => o.setName("orders").setDescription("Orders completed").setMinValue(0))
      .addStringOption((o) => o.setName("time").setDescription('Clock-out time, e.g. "9:30 PM" (default: now)')))),

  guildOnly(new SlashCommandBuilder().setName("export").setDescription("Manager: download a week as a CSV file")
    .addStringOption(weekOpt).addStringOption((o) => bizOpt(o))),
  guildOnly(new SlashCommandBuilder().setName("panel").setDescription("Manager: post Clock In / Clock Out buttons in this channel")),
  guildOnly(new SlashCommandBuilder().setName("backup").setDescription("Manage Server: download a backup of the database")),
  guildOnly(new SlashCommandBuilder().setName("help").setDescription("How to use this bot")),
].map((c) => c.toJSON());
