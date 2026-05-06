import { REST, Routes } from 'discord.js';
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadLocalCommands() {
  const commands = [];
  const cmdDir = join(__dirname, '../commands');
  const folders = readdirSync(cmdDir);
  const seen = new Set();
  const duplicates = [];

  for (const folder of folders) {
    const files = readdirSync(join(cmdDir, folder)).filter(f => f.endsWith('.js'));
    for (const file of files) {
      try {
        const cmd = await import(`../commands/${folder}/${file}`);
        if (!cmd.default?.data) {
          console.error(`[REGISTER] ⚠️  ${folder}/${file} has no default.data export — skipping`);
          continue;
        }
        const json = cmd.default.data.toJSON();
        if (seen.has(json.name)) duplicates.push(json.name);
        seen.add(json.name);
        commands.push(json);
      } catch (err) {
        console.error(`[REGISTER] ❌ Failed to load ${folder}/${file}: ${err.message}`);
      }
    }
  }

  if (duplicates.length) {
    console.error(`[REGISTER] ❌ DUPLICATE command names detected: ${duplicates.join(', ')}`);
  }
  return commands;
}

export async function registerCommands({ forceClean = true } = {}) {
  const token = process.env.DISCORD_BOT_TOKEN;
  const appId = process.env.DISCORD_APPLICATION_ID;
  const guildId = process.env.DISCORD_GUILD_ID;
  // COMMAND_SCOPE controls deployment target; falls back to legacy GUILD_ID behaviour.
  const scope = (process.env.COMMAND_SCOPE || (guildId ? 'guild' : 'global')).toLowerCase();

  if (!token || !appId) {
    console.error('[REGISTER] Missing DISCORD_BOT_TOKEN or DISCORD_APPLICATION_ID');
    return 0;
  }
  if (scope !== 'global' && scope !== 'guild') {
    console.error('[REGISTER] COMMAND_SCOPE must be "global" or "guild". Got:', process.env.COMMAND_SCOPE);
    return 0;
  }
  if (scope === 'guild' && !guildId) {
    console.error('[REGISTER] COMMAND_SCOPE=guild requires DISCORD_GUILD_ID to be set');
    return 0;
  }

  console.log('═══════════════ COMMAND DEPLOY ═══════════════');
  console.log('[REGISTER] CLIENT_ID      :', appId);
  console.log('[REGISTER] GUILD_ID       :', guildId || '(not set)');
  console.log('[REGISTER] COMMAND_SCOPE  :', scope.toUpperCase());

  const commands = await loadLocalCommands();
  console.log(`[REGISTER] LOADED FROM FILES (${commands.length}):`);
  commands.forEach(c => console.log('   •', c.name));

  const rest = new REST().setToken(token);

  // ── Force-clean: wipe the opposite scope to prevent duplicates ────────────
  if (forceClean) {
    if (scope === 'global') {
      // Clear guild commands so they don't shadow the newly registered global ones.
      if (guildId) {
        try {
          const oldGuild = await rest.get(Routes.applicationGuildCommands(appId, guildId));
          console.log(`[REGISTER] Discord currently has ${oldGuild.length} GUILD command(s) in ${guildId}:`,
            oldGuild.map(c => c.name).join(', ') || '(none)');
          if (oldGuild.length > 0) {
            await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: [] });
            console.log('[REGISTER] 🧹 Cleared guild commands before global deploy');
          }
        } catch (e) {
          console.error('[REGISTER] Failed to inspect/clear guild commands:', e.message);
        }
      }
    } else {
      // Clear global commands so they don't shadow the guild-scoped ones.
      try {
        const oldGlobal = await rest.get(Routes.applicationCommands(appId));
        console.log(`[REGISTER] Discord currently has ${oldGlobal.length} GLOBAL command(s):`,
          oldGlobal.map(c => c.name).join(', ') || '(none)');
        if (oldGlobal.length > 0) {
          await rest.put(Routes.applicationCommands(appId), { body: [] });
          console.log('[REGISTER] 🧹 Cleared global commands (using GUILD scope instead)');
        }
      } catch (e) {
        console.error('[REGISTER] Failed to inspect/clear global commands:', e.message);
      }
    }
  }

  // ── Bulk overwrite (REPLACES everything in scope, no manual delete needed) ─
  if (scope === 'guild') {
    console.log(`[REGISTER] Bulk-overwriting GUILD ${guildId} with ${commands.length} commands...`);
    await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: commands });
  } else {
    console.log(`[REGISTER] Bulk-overwriting GLOBAL with ${commands.length} commands...`);
    await rest.put(Routes.applicationCommands(appId), { body: commands });
  }

  // ── Verify what Discord actually has now ─────────────────────────────────
  const verify = scope === 'guild'
    ? await rest.get(Routes.applicationGuildCommands(appId, guildId))
    : await rest.get(Routes.applicationCommands(appId));
  console.log(`[REGISTER] ✅ DISCORD NOW REPORTS (${verify.length}):`);
  verify.forEach(c => console.log('   •', c.name, '(id:', c.id + ')'));
  console.log('═══════════════════════════════════════════════');

  return verify.length;
}

// Allow direct execution: node handlers/registerCommands.js
if (process.argv[1].endsWith('registerCommands.js')) {
  import('dotenv').then(d => d.default.config()).catch(() => {});
  registerCommands().catch(console.error);
}
