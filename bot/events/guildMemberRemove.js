import { WelcomeConfig } from '../storage/WelcomeConfig.js';
import { buildWelcomePayload } from '../utils/welcomeCard.js';
import { logger } from '../utils/logger.js';
import { FEATURE_BOT_PERMISSIONS, getMissingBotPermissions } from '../utils/permissions.js';

export default {
  name: 'guildMemberRemove',
  once: false,
  async execute(member, client) {
    try {
      const cfg = WelcomeConfig.get(member.guild.id);
      const section = cfg.goodbye;

      if (!section.enabled || !section.channelId) return;

      const channel = await member.guild.channels.fetch(section.channelId).catch(() => null);
      if (!channel?.isTextBased()) return;
      const missing = getMissingBotPermissions(channel, FEATURE_BOT_PERMISSIONS.welcomeGoodbye);
      if (missing.length > 0) {
        logger.warn(`Skipping goodbye message in guild ${member.guild.id}: missing permissions (${missing.join(', ')})`);
        return;
      }

      const payload = await buildWelcomePayload({ member, config: section, section: 'goodbye' });
      await channel.send(payload);
    } catch (err) {
      logger.error(`guildMemberRemove goodbye error [${member.guild.id}]: ${err.message}`, err);
    }
  },
};
