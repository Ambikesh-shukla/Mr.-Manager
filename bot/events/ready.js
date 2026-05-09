import { ActivityType } from 'discord.js';
import { logger } from '../utils/logger.js';
import { registerCommands } from '../handlers/registerCommands.js';
import { primeInviteSnapshotsForClient } from '../utils/inviteTracker.js';
import { ensureGuildCredits } from '../../utils/credits.js';

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

    const guildIds = [...client.guilds.cache.keys()];
    for (const guildId of guildIds) {
      try {
        await ensureGuildCredits(guildId);
      } catch (err) {
        logger.warn(`[BILLING] Failed to initialize default credits for guild ${guildId}`, err);
      }
    }

    await primeInviteSnapshotsForClient(client);
  },
};
