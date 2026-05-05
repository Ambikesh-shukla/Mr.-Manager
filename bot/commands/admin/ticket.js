import {
  SlashCommandBuilder,
} from 'discord.js';
import { TicketPanel } from '../../storage/TicketPanel.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { isAdmin } from '../../utils/permissions.js';
import { startSetup } from '../../handlers/setupHandler.js';
import { logger } from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Manage ticket panels')
    .addSubcommand(sc => sc
      .setName('edit')
      .setDescription('Open the interactive editor for an existing panel')
      .addStringOption(o => o.setName('panel_id').setDescription('Panel ID to edit').setRequired(true))
    )
    .addSubcommand(sc => sc
      .setName('delete')
      .setDescription('Delete a ticket panel')
      .addStringOption(o => o.setName('panel_id').setDescription('Panel ID').setRequired(true))
    ),

  defaultLevel: 'admin',

  subcommandDefaults: {
    edit: 'admin',
    delete: 'admin',
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand(false);

    if (!isAdmin(interaction.member)) {
      return interaction.reply({ embeds: [errorEmbed('You need **Administrator** or **Manage Server** permission.')], flags: 64 });
    }

    // ── edit ────────────────────────────────────────────────────────────────
    if (sub === 'edit') {
      const panelId = interaction.options.getString('panel_id');
      return startSetup(interaction, panelId);
    }

    // ── delete ───────────────────────────────────────────────────────────────
    if (sub === 'delete') {
      const panelId = interaction.options.getString('panel_id');
      const panel = TicketPanel.get(panelId);
      if (!panel || panel.guildId !== interaction.guild.id) {
        return interaction.reply({ embeds: [errorEmbed('Panel not found.')], flags: 64 });
      }

      if (panel.panelChannel && panel.messageId) {
        try {
          const ch = await interaction.guild.channels.fetch(panel.panelChannel);
          const msg = await ch?.messages?.fetch(panel.messageId);
          await msg?.delete();
        } catch (err) {
          logger.warn('Failed to delete old panel message', err);
        }
      }

      TicketPanel.delete(panelId);
      await interaction.reply({
        embeds: [successEmbed('Panel Deleted', `Panel **${panel.title}** has been deleted.\nThe panel message has been removed from the channel.`)],
        flags: 64,
      });
    }
  },
};
