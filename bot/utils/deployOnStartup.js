// Auto-deploys slash commands once on bot startup.
// Respects COMMAND_SCOPE=global (default) or COMMAND_SCOPE=guild.
// Called from the boot() sequence in bot/index.js.

import { REST, Routes } from 'discord.js';
import { readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadLocalCommands() {
  const commands = [];
  const cmdDir = join(__dirname, '../commands');
  const seen = new Set();
  const duplicates = new Set();

  for (const entry of readdirSync(cmdDir)) {
    const entryPath = join(cmdDir, entry);
    if (!statSync(entryPath).isDirectory()) continue;

    for (const file of readdirSync(entryPath).filter(f => f.endsWith('.js'))) {
      try {
        const mod = await import(`../commands/${entry}/${file}`);
        if (!mod.default?.data) continue;
        const json = mod.default.data.toJSON();
        if (seen.has(json.name)) duplicates.add(json.name);
        seen.add(json.name);
        commands.push(json);
      } catch (err) {
        logger.warn(`[DEPLOY] Could not load ${entry}/${file}: ${err.message}`);
      }
    }
  }

  if (duplicates.size) {
    throw new Error(`[DEPLOY] Duplicate command names detected: ${[...duplicates].join(', ')}. Fix before deploying.`);
  }
  return commands;
}

export async function deployOnStartup() {
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

  const commands = await loadLocalCommands();
  const localNames = new Set(commands.map(c => c.name));
  logger.info(`[DEPLOY] Loaded ${commands.length} command(s): ${commands.map(c => c.name).join(', ') || '(none)'}`);

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
    logger.info(`[DEPLOY] Removing ${stale.length} stale command(s) no longer in local files: ${stale.map(c => c.name).join(', ')}`);
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
}

