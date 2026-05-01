// Detect and remove duplicate Discord slash commands.
//
// "Duplicate" means the same command name is registered in more than one scope
// (global AND guild) at the same time, which causes Discord to show the command
// twice in the UI.  When DISCORD_GUILD_ID is set the guild-scoped version is
// kept and the global duplicate is removed.  When no guild ID is configured,
// any within-global duplicates (same name appearing more than once) are
// collapsed to a single entry via a bulk overwrite.
//
// Usage:
//   node scripts/fix_duplicate_slash_cmds.js               # uses env vars
//   node scripts/fix_duplicate_slash_cmds.js <guildId>     # override / add guild

import { REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
dotenv.config();

const token = process.env.DISCORD_BOT_TOKEN;
const appId = process.env.DISCORD_APPLICATION_ID;
const configuredGuild = process.env.DISCORD_GUILD_ID;
const extraGuild = process.argv[2];
const targetGuild = extraGuild || configuredGuild;

if (!token || !appId) {
  console.error('[FIX] Missing DISCORD_BOT_TOKEN or DISCORD_APPLICATION_ID');
  process.exit(1);
}

const rest = new REST().setToken(token);

async function fetchCommands(label, route) {
  try {
    const cmds = await rest.get(route);
    console.log(`[FIX] ${label}: ${cmds.length} command(s) — ${cmds.map(c => c.name).join(', ') || '(none)'}`);
    return cmds;
  } catch (e) {
    console.error(`[FIX] ${label}: failed to fetch — ${e.message}`);
    return [];
  }
}

async function overwrite(label, route, body) {
  try {
    await rest.put(route, { body });
    console.log(`[FIX] ${label}: overwritten with ${body.length} command(s) ✅`);
  } catch (e) {
    console.error(`[FIX] ${label}: overwrite failed — ${e.message}`);
  }
}

console.log('[FIX] CLIENT_ID :', appId);
console.log('[FIX] GUILD_ID  :', targetGuild || '(not set)');
console.log('');

const globalRoute = Routes.applicationCommands(appId);
const guildRoute = targetGuild ? Routes.applicationGuildCommands(appId, targetGuild) : null;

const globalCmds = await fetchCommands('GLOBAL', globalRoute);
const guildCmds = guildRoute ? await fetchCommands(`GUILD ${targetGuild}`, guildRoute) : [];

// Build name → command maps, keeping the last occurrence to deduplicate
// within-scope duplicates (Discord shouldn't produce these but handle it anyway).
const globalMap = new Map();
for (const cmd of globalCmds) globalMap.set(cmd.name, cmd);

const guildMap = new Map();
for (const cmd of guildCmds) guildMap.set(cmd.name, cmd);

const crossDupes = [...globalMap.keys()].filter(n => guildMap.has(n));

console.log('');

const hasCrossDupes = crossDupes.length > 0;
const hasGlobalWithinDupes = globalCmds.length > globalMap.size;
const hasGuildWithinDupes = guildCmds.length > guildMap.size;

if (!hasCrossDupes && !hasGlobalWithinDupes && !hasGuildWithinDupes) {
  console.log('[FIX] ✅ No duplicate commands detected. Nothing to do.');
  process.exit(0);
}

let fixed = false;

// Fix cross-scope duplicates and within-global duplicates in a single API call.
// Guild scope takes priority — strip any global commands that also exist in the guild.
// The deduplicated globalMap is used as the base so within-global dupes are also
// resolved in the same overwrite.
if (hasCrossDupes || hasGlobalWithinDupes) {
  const cleanedGlobal = [...globalMap.values()].filter(c => !guildMap.has(c.name));

  if (hasCrossDupes) {
    console.log(`[FIX] ⚠️  Cross-scope duplicates (exist in BOTH global and guild): ${crossDupes.join(', ')}`);
    console.log(`[FIX] Removing ${crossDupes.length} global command(s) that duplicate guild-scoped command(s)...`);
  }
  if (hasGlobalWithinDupes) {
    const withinCount = globalCmds.length - globalMap.size;
    console.log(`[FIX] ⚠️  ${withinCount} within-scope duplicate(s) in GLOBAL scope — deduplicating...`);
  }

  await overwrite('GLOBAL', globalRoute, cleanedGlobal);
  fixed = true;
}

// Report and fix within-scope duplicates in the guild scope.
if (hasGuildWithinDupes && guildRoute) {
  const withinCount = guildCmds.length - guildMap.size;
  console.log(`[FIX] ⚠️  ${withinCount} within-scope duplicate(s) in GUILD ${targetGuild} — deduplicating...`);
  await overwrite(`GUILD ${targetGuild}`, guildRoute, [...guildMap.values()]);
  fixed = true;
}

if (fixed) {
  console.log('\n[FIX] Done. Restart the bot if commands still appear incorrectly in Discord.');
}
