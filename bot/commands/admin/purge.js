import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { successEmbed, errorEmbed } from '../../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Bulk-delete messages in a channel')
    .addSubcommand(s => s
      .setName('all')
      .setDescription('Delete the last N messages in this channel (max 100)')
      .addIntegerOption(o => o
        .setName('amount')
        .setDescription('Number of messages to delete (1–100)')
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true)))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  defaultLevel: 'admin',

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'all') {
      const amount = interaction.options.getInteger('amount');

      if (!interaction.channel.permissionsFor(interaction.guild.members.me).has(PermissionFlagsBits.ManageMessages)) {
        return interaction.reply({ embeds: [errorEmbed('I need the **Manage Messages** permission to delete messages.')], flags: 64 });
      }

      await interaction.deferReply({ flags: 64 });

      try {
        const deleted = await interaction.channel.bulkDelete(amount, true);
        return interaction.editReply({
          embeds: [successEmbed('Messages Purged', `Deleted **${deleted.size}** message(s).${deleted.size < amount ? `\n-# ${amount - deleted.size} message(s) were older than 14 days and could not be deleted.` : ''}`)],
        });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(`Failed to delete messages: ${err.message}`)] });
      }
    }
  },
};
