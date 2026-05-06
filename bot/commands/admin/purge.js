import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { successEmbed, errorEmbed } from '../../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Bulk delete messages from this channel')
    .addSubcommand(sub =>
      sub
        .setName('all')
        .setDescription('Delete a number of recent messages')
        .addIntegerOption(opt =>
          opt
            .setName('count')
            .setDescription('Number of messages to delete (1–100)')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(100),
        ),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  defaultLevel: 'staff',

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'all') {
      const count = interaction.options.getInteger('count');

      // Defer ephemerally so we have time to fetch & delete
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      // Fetch messages (up to 100 per Discord limit)
      let messages;
      try {
        messages = await interaction.channel.messages.fetch({ limit: count });
      } catch {
        return interaction.editReply({ embeds: [errorEmbed('Failed to fetch messages.')] });
      }

      // Separate recent (<= 14 days) from old (> 14 days)
      const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
      const recent = messages.filter(m => !m.pinned && m.createdTimestamp > cutoff);
      const old    = messages.filter(m => !m.pinned && m.createdTimestamp <= cutoff);

      let deleted = 0;

      // Bulk delete recent messages
      if (recent.size > 0) {
        try {
          const bulkDeleted = await interaction.channel.bulkDelete(recent, true);
          deleted += bulkDeleted.size;
        } catch {
          return interaction.editReply({ embeds: [errorEmbed('Bulk delete failed. Make sure I have **Manage Messages** permission.')] });
        }
      }

      // Delete old messages one-by-one (they cannot be bulk-deleted)
      for (const [, msg] of old) {
        try {
          await msg.delete();
          deleted++;
        } catch {
          // Skip messages that can't be deleted (already gone, permissions, etc.)
        }
      }

      const pinned = messages.size - recent.size - old.size; // pinned messages skipped
      const pinnedNote = pinned > 0 ? ` (${pinned} pinned message${pinned > 1 ? 's' : ''} skipped)` : '';

      const reply = await interaction.editReply({
        embeds: [successEmbed('Messages Purged', `Deleted **${deleted}** message${deleted !== 1 ? 's' : ''}${pinnedNote}.`)],
      });

      // Auto-delete the success reply after 5 seconds
      setTimeout(() => {
        interaction.deleteReply().catch(() => {});
      }, 5_000);
    }
  },
};
