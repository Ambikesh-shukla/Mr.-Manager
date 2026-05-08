import { ActivityType } from 'discord.js';
import { logger } from '../utils/logger.js';
import { registerCommands } from '../handlers/registerCommands.js';
import { primeInviteSnapshotsForClient } from '../utils/inviteTracker.js';

export default {
  name: 'clientReady',
  once: true,
  async execute(client) {
    logger.success(`Logged in as ${client.user.tag}`);
    client.user.setActivity('Minecraft Server Support 🎮', { type: ActivityType.Watching });

    // Auto-register slash commands on every startup so "command not found" is impossible
    try {
      const count = await registerCommands();
      logger.info(`Slash commands deployed: ${count} registered globally`);
    } catch (err) {
      logger.error('Failed to register slash commands on startup', err);
    }

    await primeInviteSnapshotsForClient(client);
  },
};
