import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function loadEvents(client) {
  const evDir = join(__dirname, '../events');
  const files = readdirSync(evDir).filter(f => f.endsWith('.js'));
  for (const file of files) {
    try {
      const event = await import(`../events/${file}`);
      const e = event.default;
      if (e.once) {
        client.once(e.name, (...args) => e.execute(...args, client));
      } else {
        client.on(e.name, (...args) => e.execute(...args, client));
      }
      logger.info(`Loaded event: ${e.name}`);
    } catch (err) {
      logger.error(`Failed to load event ${file}`, err);
    }
  }
}
