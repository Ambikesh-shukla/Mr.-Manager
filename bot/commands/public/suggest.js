import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { GuildConfig } from '../../storage/GuildConfig.js';
import { Suggestion } from '../../storage/Suggestion.js';
import { embed, successEmbed, errorEmbed, Colors } from '../../utils/embeds.js';
import { randomUUID } from 'crypto';

export default {
  data: new SlashCommandBuilder()
    .setName('suggest')
    .setDescription('Suggestion system')
    .addSubcommand(s => s.setName('submit')
      .setDescription('Submit a suggestion')
      .addStringOption(o => o.setName('suggestion').setDescription('Your suggestion').setRequired(true))),

  defaultLevel: 'public',

  async execute(interaction) {
    const text = interaction.options.getString('suggestion');
    const config = GuildConfig.get(interaction.guild.id);

    const suggestionId = randomUUID();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`suggest:up:${suggestionId}`).setLabel('👍 Upvote (0)').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`suggest:down:${suggestionId}`).setLabel('👎 Downvote (0)').setStyle(ButtonStyle.Danger),
    );

    const targetCh = config.suggestionChannel
      ? (await interaction.guild.channels.fetch(config.suggestionChannel).catch(() => null)) ?? interaction.channel
      : interaction.channel;

    try {
      const msg = await targetCh.send({
        embeds: [embed({
          title: '💡 New Suggestion',
          description: text,
          color: Colors.primary,
          fields: [{ name: 'Suggested by', value: `${interaction.user} (${interaction.user.tag})`, inline: true }],
          footer: 'React below to vote',
        })],
        components: [row],
      });

      Suggestion.create({
        id: suggestionId,
        guildId: interaction.guild.id,
        channelId: targetCh.id,
        messageId: msg.id,
        text,
        submitterId: interaction.user.id,
      });

      return interaction.reply({ embeds: [successEmbed('Suggestion Submitted', 'Your suggestion has been posted!')], flags: 64 });
    } catch {
      return interaction.reply({ embeds: [errorEmbed('Failed to post suggestion.')], flags: 64 });
    }
  },
};
