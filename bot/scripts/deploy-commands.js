// Deploy slash commands globally or to a single guild.
//
// Usage:
//   COMMAND_SCOPE=global node scripts/deploy-commands.js   # deploy to all servers
//   COMMAND_SCOPE=guild  node scripts/deploy-commands.js   # deploy to DISCORD_GUILD_ID only
//
// Before registering, existing commands in both scopes are fetched and compared
// against local command files. Stale commands (removed/renamed locally) are logged.
// The opposite scope is always cleared to prevent cross-scope duplicates:
//   - global deploy → guild commands cleared
//   - guild deploy  → global commands cleared

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
const localNames = new Set(commands.map(c => c.name));
console.log(`[DEPLOY] Loaded ${commands.length} command(s) from disk:`, commands.map(c => c.name).join(', ') || '(none)');
console.log('');

// ── Fetch existing commands from both scopes to detect stale entries ─────────
let existingGlobal = [];
let existingGuild = [];

try {
  existingGlobal = await rest.get(Routes.applicationCommands(appId));
  console.log(`[DEPLOY] Discord GLOBAL: ${existingGlobal.length} command(s) — ${existingGlobal.map(c => c.name).join(', ') || '(none)'}`);
} catch (e) {
  console.error('[DEPLOY] ⚠️  Could not fetch global commands:', e.message);
}

if (guildId) {
  try {
    existingGuild = await rest.get(Routes.applicationGuildCommands(appId, guildId));
    console.log(`[DEPLOY] Discord GUILD ${guildId}: ${existingGuild.length} command(s) — ${existingGuild.map(c => c.name).join(', ') || '(none)'}`);
  } catch (e) {
    console.error('[DEPLOY] ⚠️  Could not fetch guild commands:', e.message);
  }
}
console.log('');

// Identify and log stale commands in the target scope
const existingTarget = scope === 'global' ? existingGlobal : existingGuild;
const stale = existingTarget.filter(c => !localNames.has(c.name));
if (stale.length > 0) {
  console.log(`[DEPLOY] 🗑️  Removing ${stale.length} stale command(s) no longer in local files: ${stale.map(c => c.name).join(', ')}`);
  console.log('');
}

if (scope === 'global') {
  // ── Global deployment ──────────────────────────────────────────────────────
  // Clear guild commands first to avoid duplicates appearing in the main server.
  if (existingGuild.length > 0 && guildId) {
    try {
      console.log(`[DEPLOY] 🧹 Clearing ${existingGuild.length} guild command(s) from GUILD ${guildId} before global deploy...`);
      await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: [] });
      console.log('[DEPLOY] ✅ Guild commands cleared');
    } catch (e) {
      console.error('[DEPLOY] ⚠️  Could not clear guild commands:', e.message);
    }
    console.log('');
  }

  // Bulk overwrite global commands — replaces ALL existing global commands,
  // which automatically removes any stale entries (e.g. old /panel).
  console.log(`[DEPLOY] Deploying ${commands.length} command(s) GLOBALLY (all servers)...`);
  await rest.put(Routes.applicationCommands(appId), { body: commands });

  const verified = await rest.get(Routes.applicationCommands(appId));
  console.log(`[DEPLOY] ✅ GLOBAL commands registered (${verified.length}):`);
  verified.forEach(c => console.log('   •', c.name, `(id: ${c.id})`));
  console.log('');
  console.log('[DEPLOY] ℹ️  Global commands can take up to 1 hour to propagate to all servers.');

} else {
  // ── Guild-scoped deployment ────────────────────────────────────────────────
  // Clear global commands so old globally-registered commands (e.g. /panel)
  // don't persist alongside the guild-scoped ones.
  if (existingGlobal.length > 0) {
    try {
      console.log(`[DEPLOY] 🧹 Clearing ${existingGlobal.length} global command(s) before guild deploy...`);
      await rest.put(Routes.applicationCommands(appId), { body: [] });
      console.log('[DEPLOY] ✅ Global commands cleared');
    } catch (e) {
      console.error('[DEPLOY] ⚠️  Could not clear global commands:', e.message);
    }
    console.log('');
  }

  // Bulk overwrite guild commands — replaces ALL existing guild commands,
  // which automatically removes any stale entries.
  console.log(`[DEPLOY] Deploying ${commands.length} command(s) to GUILD ${guildId} only...`);
  await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: commands });

  const verified = await rest.get(Routes.applicationGuildCommands(appId, guildId));
  console.log(`[DEPLOY] ✅ GUILD commands registered in ${guildId} (${verified.length}):`);
  verified.forEach(c => console.log('   •', c.name, `(id: ${c.id})`));
  console.log('');
  console.log('[DEPLOY] ℹ️  Guild commands update instantly.');
}

console.log('═══════════════════════════════════════════════');
