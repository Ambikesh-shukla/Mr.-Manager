import { SlashCommandBuilder } from 'discord.js';
import { Afk } from '../../storage/Afk.js';
import { successEmbed, errorEmbed, embed, Colors } from '../../utils/embeds.js';

function relativeTime(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default {
  data: new SlashCommandBuilder()
    .setName('afk')
    .setDescription('AFK status — let people know you are away')
    .addSubcommand(s => s.setName('set')
      .setDescription('Mark yourself as AFK')
      .addStringOption(o => o.setName('reason').setDescription('Why are you away?').setRequired(false)))
    .addSubcommand(s => s.setName('remove')
      .setDescription('Remove your AFK status'))
    .addSubcommand(s => s.setName('status')
      .setDescription('Check AFK status of a user')
      .addUserOption(o => o.setName('user').setDescription('User to check').setRequired(false))),

  defaultLevel: 'public',

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'set') {
      const reason = interaction.options.getString('reason') ?? 'AFK';
      Afk.set(guildId, interaction.user.id, reason);
      return interaction.reply({
        embeds: [successEmbed('AFK Set', `You are now AFK: **${reason}**\nI'll let people know if they ping you.`)],
        flags: 64,
      });
    }

    if (sub === 'remove') {
      const existing = Afk.get(guildId, interaction.user.id);
      if (!existing) {
        return interaction.reply({ embeds: [errorEmbed('You are not AFK.')], flags: 64 });
      }
      Afk.remove(guildId, interaction.user.id);
      return interaction.reply({
        embeds: [successEmbed('AFK Removed', `Welcome back! You were AFK for **${relativeTime(existing.since)}**.`)],
        flags: 64,
      });
    }

    if (sub === 'status') {
      const user = interaction.options.getUser('user') ?? interaction.user;
      const data = Afk.get(guildId, user.id);
      if (!data) {
        return interaction.reply({
          embeds: [embed({ description: `<@${user.id}> is **not AFK**.`, color: Colors.info, timestamp: false })],
          flags: 64,
        });
      }
      return interaction.reply({
        embeds: [embed({
          title: '💤 AFK Status',
          description: `<@${user.id}> is AFK: **${data.reason}**\n\u200b\nSince: ${relativeTime(data.since)}`,
          color: Colors.warning,
          timestamp: false,
        })],
        flags: 64,
      });
    }
  },
};
