import { readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Loads all slash commands from the commands directory into client.commands.
 * Returns the command JSON array so deployOnStartup can deploy the exact same
 * set without re-scanning the filesystem.
 *
 * @param {import('discord.js').Client} client
 * @returns {Promise<Object[]>} Array of command JSON objects ready for the Discord API.
 */
export async function loadCommands(client) {
  client.commands = new Map();
  const cmdDir = join(__dirname, '../commands');
  logger.info(`[COMMANDS] Scanning commands root: ${cmdDir}`);

  const commandJsons = [];
  const seen = new Map(); // name -> filePath (for duplicate detection)
  const duplicates = [];

  for (const entry of readdirSync(cmdDir)) {
    const folderPath = join(cmdDir, entry);
    if (!statSync(folderPath).isDirectory()) continue;

    logger.info(`[COMMANDS] Scanning folder: ${folderPath}`);

    const files = readdirSync(folderPath).filter(f => f.endsWith('.js'));
    for (const file of files) {
      const filePath = join(folderPath, file);
      try {
        const cmd = await import(`../commands/${entry}/${file}`);
        if (cmd.default?.data && cmd.default?.execute) {
          const name = cmd.default.data.name;
          logger.info(`[COMMANDS] Loaded command "${name}" from ${filePath}`);
          logger.info(`Loaded command: ${name}`);

          if (seen.has(name)) {
            duplicates.push({ name, first: seen.get(name), second: filePath });
            logger.error(`[COMMANDS] DUPLICATE command name "${name}" — already loaded from ${seen.get(name)}, also found in ${filePath}`);
          } else {
            seen.set(name, filePath);
            client.commands.set(name, cmd.default);
            commandJsons.push(cmd.default.data.toJSON());
          }
        } else {
          logger.warn(`[COMMANDS] Skipped ${filePath} — missing default.data or default.execute`);
        }
      } catch (e) {
        logger.error(`[COMMANDS] Failed to load ${filePath}`, e);
      }
    }
  }

  if (duplicates.length > 0) {
    logger.error(`[COMMANDS] ${duplicates.length} duplicate command name(s) detected — duplicates were NOT registered.`);
  }

  logger.success(`[COMMANDS] Loaded ${client.commands.size} command(s): ${[...client.commands.keys()].join(', ') || '(none)'}`);
  return commandJsons;
}
