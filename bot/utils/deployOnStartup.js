// Auto-deploys slash commands once on bot startup.
// Respects COMMAND_SCOPE=global (default) or COMMAND_SCOPE=guild.
// Called from the boot() sequence in bot/index.js.
//
// Accepts an optional `preloadedCommands` array (JSON objects already collected
// by loadCommands) so that the deployed set exactly mirrors the runtime set.
// If omitted it falls back to scanning the filesystem itself (legacy path).

import { REST, Routes } from 'discord.js';
import { readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function scanLocalCommands() {
  const commands = [];
  const cmdDir = join(__dirname, '../commands');
  logger.info(`[DEPLOY] Scanning commands root: ${cmdDir}`);
  const seen = new Set();
  const duplicates = new Set();

  for (const entry of readdirSync(cmdDir)) {
    const folderPath = join(cmdDir, entry);
    if (!statSync(folderPath).isDirectory()) continue;
    logger.info(`[DEPLOY] Scanning folder: ${folderPath}`);

    for (const file of readdirSync(folderPath).filter(f => f.endsWith('.js'))) {
      const filePath = join(folderPath, file);
      try {
        const mod = await import(`../commands/${entry}/${file}`);
        if (!mod.default?.data) {
          logger.warn(`[DEPLOY] Skipped ${filePath} — no default.data export`);
          continue;
        }
        const json = mod.default.data.toJSON();
        logger.info(`[DEPLOY] Loaded command "${json.name}" from ${filePath}`);
        if (seen.has(json.name)) duplicates.add(json.name);
        seen.add(json.name);
        commands.push(json);
      } catch (err) {
        logger.warn(`[DEPLOY] Could not load ${filePath}: ${err.message}`);
      }
    }
  }

  if (duplicates.size) {
    throw new Error(`[DEPLOY] Duplicate command names detected: ${[...duplicates].join(', ')}. Fix before deploying.`);
  }
  return commands;
}

/**
 * Deploys slash commands to Discord on startup.
 *
 * @param {Object[]|null} preloadedCommands  Command JSON objects already
 *   collected by loadCommands().  When provided the filesystem scan is skipped
 *   and the deployed set is guaranteed to match the runtime set exactly.
 */
export async function deployOnStartup(preloadedCommands = null) {
  const token   = process.env.DISCORD_BOT_TOKEN;
  const appId   = process.env.DISCORD_APPLICATION_ID;
  const guildId = process.env.DISCORD_GUILD_ID;
  const scope   = (process.env.COMMAND_SCOPE || 'global').toLowerCase();

  if (!token || !appId) {
    logger.warn('[DEPLOY] Skipping command deployment: DISCORD_BOT_TOKEN or DISCORD_APPLICATION_ID not set');
    return;
  }
  if (scope !== 'global' && scope !== 'guild') {
    logger.warn(`[DEPLOY] Skipping command deployment: COMMAND_SCOPE must be "global" or "guild", got "${scope}"`);
    return;
  }
  if (scope === 'guild' && !guildId) {
    logger.warn('[DEPLOY] Skipping command deployment: COMMAND_SCOPE=guild requires DISCORD_GUILD_ID');
    return;
  }

  logger.info(`[DEPLOY] COMMAND_SCOPE=${scope.toUpperCase()}`);

  let commands;
  if (preloadedCommands) {
    commands = preloadedCommands;
    logger.info(`[DEPLOY] Using ${commands.length} pre-loaded runtime command(s) — no filesystem re-scan needed`);
  } else {
    commands = await scanLocalCommands();
  }

  const localNames = new Set(commands.map(c => c.name));
  logger.info(`[DEPLOY] Commands to deploy (${commands.length}): ${commands.map(c => c.name).join(', ') || '(none)'}`);

  const rest = new REST().setToken(token);

  // ── Fetch existing commands from both scopes to detect stale entries ────────
  let existingGlobal = [];
  let existingGuild = [];

  try {
    existingGlobal = await rest.get(Routes.applicationCommands(appId));
    logger.info(`[DEPLOY] Discord GLOBAL: ${existingGlobal.length} command(s) — ${existingGlobal.map(c => c.name).join(', ') || '(none)'}`);
  } catch (err) {
    logger.warn(`[DEPLOY] Could not fetch global commands: ${err.message}`);
  }

  if (guildId) {
    try {
      existingGuild = await rest.get(Routes.applicationGuildCommands(appId, guildId));
      logger.info(`[DEPLOY] Discord GUILD ${guildId}: ${existingGuild.length} command(s) — ${existingGuild.map(c => c.name).join(', ') || '(none)'}`);
    } catch (err) {
      logger.warn(`[DEPLOY] Could not fetch guild commands: ${err.message}`);
    }
  }

  // Identify and log stale commands in the target scope
  const existingTarget = scope === 'global' ? existingGlobal : existingGuild;
  const stale = existingTarget.filter(c => !localNames.has(c.name));
  if (stale.length > 0) {
    logger.info(`[DEPLOY] Removing ${stale.length} stale command(s) no longer in runtime: ${stale.map(c => c.name).join(', ')}`);
  }

  if (scope === 'global') {
    // Clear guild-scoped commands to prevent them from shadowing the global ones.
    if (existingGuild.length > 0 && guildId) {
      try {
        logger.info(`[DEPLOY] Clearing ${existingGuild.length} guild command(s) from guild ${guildId} before global deploy...`);
        await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: [] });
        logger.info('[DEPLOY] Guild commands cleared');
      } catch (err) {
        logger.warn(`[DEPLOY] Could not clear guild commands: ${err.message}`);
      }
    }

    // Bulk overwrite global commands — replaces ALL existing global commands,
    // which automatically removes any stale entries (e.g. old /panel).
    const deployed = await rest.put(Routes.applicationCommands(appId), { body: commands });
    logger.success(`[DEPLOY] ${deployed.length} command(s) deployed GLOBALLY (all servers). Global commands may take up to 1 hour to propagate.`);

  } else {
    // Clear global commands so old globally-registered commands (e.g. /panel)
    // don't persist alongside the guild-scoped ones.
    if (existingGlobal.length > 0) {
      try {
        logger.info(`[DEPLOY] Clearing ${existingGlobal.length} global command(s) before guild deploy...`);
        await rest.put(Routes.applicationCommands(appId), { body: [] });
        logger.info('[DEPLOY] Global commands cleared');
      } catch (err) {
        logger.warn(`[DEPLOY] Could not clear global commands: ${err.message}`);
      }
    }

    // Bulk overwrite guild commands — replaces ALL existing guild commands,
    // which automatically removes any stale entries.
    const deployed = await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: commands });
    logger.success(`[DEPLOY] ${deployed.length} command(s) deployed to GUILD ${guildId}. Guild commands update instantly.`);
  }

  // ── Verify: confirm deployed names match what was loaded at runtime ──────────
  const verify = scope === 'guild'
    ? await rest.get(Routes.applicationGuildCommands(appId, guildId))
    : await rest.get(Routes.applicationCommands(appId));

  const deployedNames  = new Set(verify.map(c => c.name));
  const missingFromDC  = commands.filter(c => !deployedNames.has(c.name)).map(c => c.name);
  const extraInDC      = verify.filter(c => !localNames.has(c.name)).map(c => c.name);

  logger.info(`[DEPLOY] ✅ Discord now reports ${verify.length} command(s): ${verify.map(c => `${c.name}(${c.id})`).join(', ') || '(none)'}`);
  if (missingFromDC.length)  logger.error(`[DEPLOY] ⚠️  Commands loaded at runtime but MISSING from Discord: ${missingFromDC.join(', ')}`);
  if (extraInDC.length)      logger.error(`[DEPLOY] ⚠️  Commands present in Discord but NOT in runtime: ${extraInDC.join(', ')}`);
  if (missingFromDC.length || extraInDC.length) {
    throw new Error(`[DEPLOY] Runtime commands do not match deployed commands. Missing from Discord: [${missingFromDC.join(', ')}]. Extra in Discord: [${extraInDC.join(', ')}].`);
  }
  logger.success('[DEPLOY] Runtime commands exactly match deployed commands ✓');
}

