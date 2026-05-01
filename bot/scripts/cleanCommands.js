// Force-clean ALL Discord slash commands for this bot.
// Removes both GLOBAL and GUILD-scoped commands. Use when you need a fresh slate.
//
// Usage:
//   node scripts/cleanCommands.js               # cleans global + the configured guild
//   node scripts/cleanCommands.js <guildId>     # also cleans an additional guild

import { REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
dotenv.config();

const token = process.env.DISCORD_BOT_TOKEN;
const appId = process.env.DISCORD_APPLICATION_ID;
const configuredGuild = process.env.DISCORD_GUILD_ID;
const extraGuild = process.argv[2];

if (!token || !appId) {
  console.error('Missing DISCORD_BOT_TOKEN or DISCORD_APPLICATION_ID');
  process.exit(1);
}

const rest = new REST().setToken(token);

async function clearScope(label, route) {
  try {
    const before = await rest.get(route);
    console.log(`[CLEAN] ${label}: found ${before.length} command(s) — ${before.map(c => c.name).join(', ') || '(none)'}`);
    await rest.put(route, { body: [] });
    const after = await rest.get(route);
    console.log(`[CLEAN] ${label}: now ${after.length} command(s) ✅`);
  } catch (e) {
    console.error(`[CLEAN] ${label}: ${e.message}`);
  }
}

console.log('CLIENT_ID:', appId);
console.log('GUILD_ID :', configuredGuild || '(not set)');
console.log('');

await clearScope('GLOBAL', Routes.applicationCommands(appId));
if (configuredGuild) await clearScope(`GUILD ${configuredGuild}`, Routes.applicationGuildCommands(appId, configuredGuild));
if (extraGuild) await clearScope(`GUILD ${extraGuild}`, Routes.applicationGuildCommands(appId, extraGuild));

console.log('\n[CLEAN] Done. Restart the bot to redeploy the current command set.');
