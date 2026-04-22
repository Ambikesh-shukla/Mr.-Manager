import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { GuildConfig } from '../../storage/GuildConfig.js';
import { embed, successEmbed, errorEmbed, Colors } from '../../utils/embeds.js';
import { assertPermission } from '../../utils/permissions.js';

export default {
  data: new SlashCommandBuilder()
    .setName('suggest')
    .setDescription('Suggestion system')
    .addSubcommand(s => s.setName('submit')
      .setDescription('Submit a suggestion')
      .addStringOption(o => o.setName('suggestion').setDescription('Your suggestion').setRequired(true)))
    .addSubcommand(s => s.setName('config')
      .setDescription('Set the suggestion channel (admin only)')
      .addChannelOption(o => o.setName('channel').setDescription('Suggestion channel').setRequired(true))),

  defaultLevel: 'public',
  subcommandDefaults: { submit: 'public', config: 'admin' },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'config') {
      if (!await assertPermission(interaction, 'suggest', 'admin')) return;
      const ch = interaction.options.getChannel('channel');
      GuildConfig.update(interaction.guild.id, { suggestionChannel: ch.id });
      return interaction.reply({ embeds: [successEmbed('Configured', `Suggestion channel set to <#${ch.id}>.`)], flags: 64 });
    }

    const config = GuildConfig.get(interaction.guild.id);
    if (!config.suggestionChannel) {
      return interaction.reply({ embeds: [errorEmbed('Suggestion channel not configured. Ask an admin to use `/suggest config`.')], flags: 64 });
    }

    const text = interaction.options.getString('suggestion');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('suggest:up').setLabel('👍 Upvote').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('suggest:down').setLabel('👎 Downvote').setStyle(ButtonStyle.Danger),
    );

    try {
      const ch = await interaction.guild.channels.fetch(config.suggestionChannel);
      await ch?.send({
        embeds: [embed({
          title: '💡 New Suggestion',
          description: text,
          color: Colors.primary,
          fields: [{ name: 'Suggested by', value: `${interaction.user} (${interaction.user.tag})`, inline: true }],
          footer: 'React below to vote',
        })],
        components: [row],
      });
      return interaction.reply({ embeds: [successEmbed('Suggestion Submitted', 'Your suggestion has been posted!')], flags: 64 });
    } catch {
      return interaction.reply({ embeds: [errorEmbed('Failed to post suggestion.')], flags: 64 });
    }
  },
};
