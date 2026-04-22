import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function loadCommands(client) {
  client.commands = new Map();
  const cmdDir = join(__dirname, '../commands');
  const folders = readdirSync(cmdDir);

  for (const folder of folders) {
    const files = readdirSync(join(cmdDir, folder)).filter(f => f.endsWith('.js'));
    for (const file of files) {
      try {
        const cmd = await import(`../commands/${folder}/${file}`);
        if (cmd.default?.data && cmd.default?.execute) {
          client.commands.set(cmd.default.data.name, cmd.default);
          logger.info(`Loaded command: ${cmd.default.data.name}`);
        }
      } catch (e) {
        logger.error(`Failed to load command ${file}`, e);
      }
    }
  }

  logger.success(`Loaded ${client.commands.size} commands`);
}
