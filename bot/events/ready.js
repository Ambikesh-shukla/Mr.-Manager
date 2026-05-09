import { ActivityType } from 'discord.js';
import { logger } from '../utils/logger.js';
import { registerCommands } from '../handlers/registerCommands.js';
import { primeInviteSnapshotsForClient } from '../utils/inviteTracker.js';
import { ensureGuildCredits } from '../../utils/credits.js';

const INIT_GUILD_BATCH_SIZE = 10;

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
    for (let i = 0; i < guildIds.length; i += INIT_GUILD_BATCH_SIZE) {
      const batch = guildIds.slice(i, i + INIT_GUILD_BATCH_SIZE);
      const results = await Promise.allSettled(batch.map(async (guildId) => {
        await ensureGuildCredits(guildId);
      }));

      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const guildId = batch[index];
          logger.warn(`[BILLING] Failed to initialize default credits for guild ${guildId}`, result.reason);
        }
      });
    }

    await primeInviteSnapshotsForClient(client);
  },
};
