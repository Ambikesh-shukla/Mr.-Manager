import { WelcomeConfig } from '../storage/WelcomeConfig.js';
import { buildWelcomePayload } from '../utils/welcomeCard.js';
import { logger } from '../utils/logger.js';

export default {
  name: 'guildMemberAdd',
  once: false,
  async execute(member, client) {
    try {
      const cfg = WelcomeConfig.get(member.guild.id);
      const section = cfg.welcome;

      if (!section.enabled || !section.channelId) return;

      const channel = await member.guild.channels.fetch(section.channelId).catch(() => null);
      if (!channel?.isTextBased()) return;

      const payload = await buildWelcomePayload({ member, config: section, section: 'welcome' });
      await channel.send(payload);
    } catch (err) {
      logger.error(`guildMemberAdd welcome error [${member.guild.id}]: ${err.message}`, err);
    }
  },
};
