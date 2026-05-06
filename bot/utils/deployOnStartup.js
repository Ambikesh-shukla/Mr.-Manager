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
  logger.info(`[DEPLOY] Loaded ${commands.length} command(s): ${commands.map(c => c.name).join(', ') || '(none)'}`);

  const rest = new REST().setToken(token);

  if (scope === 'global') {
    // Clear any guild-scoped commands first to avoid duplicates in the home guild.
    if (guildId) {
      try {
        const guildCmds = await rest.get(Routes.applicationGuildCommands(appId, guildId));
        if (guildCmds.length > 0) {
          logger.info(`[DEPLOY] Clearing ${guildCmds.length} guild command(s) from guild ${guildId} before global deploy...`);
          await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: [] });
          logger.info('[DEPLOY] Guild commands cleared');
        }
      } catch (err) {
        logger.warn(`[DEPLOY] Could not clear guild commands: ${err.message}`);
      }
    }

    const deployed = await rest.put(Routes.applicationCommands(appId), { body: commands });
    logger.success(`[DEPLOY] ${deployed.length} command(s) deployed GLOBALLY (all servers). Global commands may take up to 1 hour to propagate.`);

  } else {
    const deployed = await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: commands });
    logger.success(`[DEPLOY] ${deployed.length} command(s) deployed to GUILD ${guildId}. Guild commands update instantly.`);
  }
}

