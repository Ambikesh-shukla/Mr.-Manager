// Deploy slash commands globally or to a single guild.
//
// Usage:
//   COMMAND_SCOPE=global node scripts/deploy-commands.js   # deploy to all servers
//   COMMAND_SCOPE=guild  node scripts/deploy-commands.js   # deploy to DISCORD_GUILD_ID only
//
// When deploying globally for the first time, any existing guild-scoped commands
// registered under DISCORD_GUILD_ID are automatically cleared to prevent duplicates.

import { REST, Routes } from 'discord.js';
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

const token  = process.env.DISCORD_BOT_TOKEN;
const appId  = process.env.DISCORD_APPLICATION_ID;
const guildId = process.env.DISCORD_GUILD_ID;
const scope  = (process.env.COMMAND_SCOPE || 'global').toLowerCase();

// ── Validate ─────────────────────────────────────────────────────────────────
if (!token || !appId) {
  console.error('[DEPLOY] ❌ Missing DISCORD_BOT_TOKEN or DISCORD_APPLICATION_ID');
  process.exit(1);
}
if (scope !== 'global' && scope !== 'guild') {
  console.error('[DEPLOY] ❌ COMMAND_SCOPE must be "global" or "guild". Got:', scope);
  process.exit(1);
}
if (scope === 'guild' && !guildId) {
  console.error('[DEPLOY] ❌ COMMAND_SCOPE=guild requires DISCORD_GUILD_ID to be set');
  process.exit(1);
}

// ── Load command definitions from disk ───────────────────────────────────────
async function loadLocalCommands() {
  const commands = [];
  const cmdDir = join(__dirname, '../commands');
  const seen = new Set();
  const duplicates = [];

  for (const folder of readdirSync(cmdDir)) {
    for (const file of readdirSync(join(cmdDir, folder)).filter(f => f.endsWith('.js'))) {
      try {
        const mod = await import(`../commands/${folder}/${file}`);
        if (!mod.default?.data) {
          console.warn(`[DEPLOY] ⚠️  ${folder}/${file} has no default.data export — skipping`);
          continue;
        }
        const json = mod.default.data.toJSON();
        if (seen.has(json.name)) duplicates.push(json.name);
        seen.add(json.name);
        commands.push(json);
      } catch (err) {
        console.error(`[DEPLOY] ❌ Failed to load ${folder}/${file}: ${err.message}`);
      }
    }
  }

  if (duplicates.length) {
    console.error('[DEPLOY] ❌ Duplicate command names detected:', duplicates.join(', '));
    console.error('[DEPLOY] Fix duplicate command names before deploying.');
    process.exit(1);
  }
  return commands;
}

// ── Main ─────────────────────────────────────────────────────────────────────
const rest = new REST().setToken(token);

console.log('═══════════════ COMMAND DEPLOY ═══════════════');
console.log('[DEPLOY] APPLICATION_ID :', appId);
console.log('[DEPLOY] GUILD_ID       :', guildId || '(not set)');
console.log('[DEPLOY] COMMAND_SCOPE  :', scope.toUpperCase());
console.log('');

const commands = await loadLocalCommands();
console.log(`[DEPLOY] Loaded ${commands.length} command(s) from disk:`, commands.map(c => c.name).join(', ') || '(none)');
console.log('');

if (scope === 'global') {
  // ── Global deployment ──────────────────────────────────────────────────────
  // Clear guild commands first to avoid duplicates appearing in the main server.
  if (guildId) {
    try {
      const guildCmds = await rest.get(Routes.applicationGuildCommands(appId, guildId));
      if (guildCmds.length > 0) {
        console.log(`[DEPLOY] 🧹 Clearing ${guildCmds.length} guild command(s) from GUILD ${guildId} before global deploy...`);
        await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: [] });
        console.log('[DEPLOY] ✅ Guild commands cleared');
      } else {
        console.log(`[DEPLOY] ℹ️  No guild commands to clear in GUILD ${guildId}`);
      }
    } catch (e) {
      console.error('[DEPLOY] ⚠️  Could not clear guild commands:', e.message);
    }
    console.log('');
  }

  console.log(`[DEPLOY] Deploying ${commands.length} command(s) GLOBALLY (all servers)...`);
  await rest.put(Routes.applicationCommands(appId), { body: commands });

  const verified = await rest.get(Routes.applicationCommands(appId));
  console.log(`[DEPLOY] ✅ GLOBAL commands registered (${verified.length}):`);
  verified.forEach(c => console.log('   •', c.name, `(id: ${c.id})`));
  console.log('');
  console.log('[DEPLOY] ℹ️  Global commands can take up to 1 hour to propagate to all servers.');

} else {
  // ── Guild-scoped deployment ────────────────────────────────────────────────
  console.log(`[DEPLOY] Deploying ${commands.length} command(s) to GUILD ${guildId} only...`);
  await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: commands });

  const verified = await rest.get(Routes.applicationGuildCommands(appId, guildId));
  console.log(`[DEPLOY] ✅ GUILD commands registered in ${guildId} (${verified.length}):`);
  verified.forEach(c => console.log('   •', c.name, `(id: ${c.id})`));
  console.log('');
  console.log('[DEPLOY] ℹ️  Guild commands update instantly.');
}

console.log('═══════════════════════════════════════════════');
