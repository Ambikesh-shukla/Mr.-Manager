import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
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

      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      }

      if (!interaction.channel.permissionsFor(interaction.guild.members.me).has(PermissionFlagsBits.ManageMessages)) {
        return interaction.editReply({ embeds: [errorEmbed('I need the **Manage Messages** permission to delete messages.')] });
      }

      try {
        const deleted = await interaction.channel.bulkDelete(amount, true);
        const skipped = amount - deleted.size;
        const description = skipped > 0
          ? `Deleted **${deleted.size}** message(s).\n-# ${skipped} message(s) were older than 14 days and could not be deleted.`
          : `Deleted **${deleted.size}** message(s).`;
        return interaction.editReply({ embeds: [successEmbed('Messages Purged', description)] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(`Failed to delete messages: ${err.message}`)] });
      }
    }
  },
};
