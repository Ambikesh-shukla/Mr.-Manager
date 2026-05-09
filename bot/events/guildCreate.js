import { ensureGuildCredits } from '../../utils/credits.js';
import { logger } from '../utils/logger.js';

export default {
  name: 'guildCreate',
  once: false,
  async execute(guild) {
    try {
      await ensureGuildCredits(guild.id);
      logger.info(`[BILLING] Initialized default credits for new guild ${guild.id}`);
    } catch (err) {
      logger.warn(`[BILLING] Failed to initialize credits for guild ${guild.id}`, err);
    }
  },
};
