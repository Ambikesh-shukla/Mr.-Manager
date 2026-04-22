import { GuildConfig } from '../storage/GuildConfig.js';
import { embed, Colors } from '../utils/embeds.js';

export default {
  name: 'guildMemberAdd',
  once: false,
  async execute(member) {
    const config = GuildConfig.get(member.guild.id);
    if (!config.welcomeEnabled || !config.welcomeChannel) return;
    try {
      const ch = await member.guild.channels.fetch(config.welcomeChannel);
      if (!ch) return;
      const msg = (config.welcomeMessage ?? 'Welcome {user} to {server}!')
        .replace('{user}', member.toString())
        .replace('{server}', member.guild.name)
        .replace('{username}', member.user.username)
        .replace('{count}', member.guild.memberCount);
      await ch.send({
        embeds: [embed({
          title: `👋 Welcome to ${member.guild.name}!`,
          description: msg,
          color: Colors.success,
          thumbnail: member.user.displayAvatarURL({ size: 128 }),
        })]
      });
    } catch {}
  },
};
