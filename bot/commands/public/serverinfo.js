import { SlashCommandBuilder } from 'discord.js';
import { embed, Colors } from '../../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Show information about this server'),

  defaultLevel: 'public',

  async execute(interaction) {
    const guild = interaction.guild;
    await guild.fetch();
    const owner = await guild.fetchOwner();
    const channels = guild.channels.cache;
    const roles = guild.roles.cache.size - 1;
    const bots = guild.members.cache.filter(m => m.user.bot).size;

    await interaction.reply({
      embeds: [embed({
        title: guild.name,
        thumbnail: guild.iconURL({ size: 256 }),
        color: Colors.primary,
        fields: [
          { name: '👑 Owner', value: owner.toString(), inline: true },
          { name: '🆔 Server ID', value: guild.id, inline: true },
          { name: '📅 Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
          { name: '👥 Members', value: `${guild.memberCount} total | ${bots} bots`, inline: true },
          { name: '📢 Channels', value: `${channels.size} total`, inline: true },
          { name: '🎨 Roles', value: String(roles), inline: true },
          { name: '🔰 Boost Level', value: `Level ${guild.premiumTier}`, inline: true },
          { name: '💎 Boosts', value: String(guild.premiumSubscriptionCount ?? 0), inline: true },
          { name: '🌍 Locale', value: guild.preferredLocale, inline: true },
        ],
        footer: `${guild.memberCount} members`,
      })],
    });
  },
};
