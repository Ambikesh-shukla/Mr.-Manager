import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { TicketPanel } from '../../storage/TicketPanel.js';
import { embed, Colors, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { isAdmin } from '../../utils/permissions.js';
import { startSetup } from '../../handlers/setupHandler.js';
import { logger } from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Ticket panel management')
    .addSubcommand(sc => sc
      .setName('edit')
      .setDescription('Open the interactive editor for an existing panel')
      .addStringOption(o => o.setName('panel_id').setDescription('Panel ID to edit').setRequired(true))
    )
    .addSubcommand(sc => sc
      .setName('list')
      .setDescription('List all ticket panels in this server')
    )
    .addSubcommand(sc => sc
      .setName('info')
      .setDescription('View detailed settings for a panel')
      .addStringOption(o => o.setName('panel_id').setDescription('Panel ID').setRequired(true))
    )
    .addSubcommand(sc => sc
      .setName('delete')
      .setDescription('Delete a ticket panel')
      .addStringOption(o => o.setName('panel_id').setDescription('Panel ID').setRequired(true))
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  defaultLevel: 'admin',

  async execute(interaction) {
    if (!isAdmin(interaction.member)) {
      return interaction.reply({ embeds: [errorEmbed('You need **Administrator** or **Manage Server** permission.')], flags: 64 });
    }
    const sub = interaction.options.getSubcommand();

    // ── edit ──────────────────────────────────────────────────────────────────
    if (sub === 'edit') {
      const panelId = interaction.options.getString('panel_id');
      return startSetup(interaction, panelId);
    }

    // ── list ──────────────────────────────────────────────────────────────────
    if (sub === 'list') {
      const panels = TicketPanel.forGuild(interaction.guild.id);
      if (panels.length === 0) {
        return interaction.reply({
          embeds: [embed({ title: '🎫 No Panels', description: 'No ticket panels found.\nUse `/setup-ticket` to create one!', color: Colors.warning })],
          flags: 64,
        });
      }
      return interaction.reply({
        embeds: [embed({
          title: `🎫 Ticket Panels (${panels.length})`,
          color: Colors.info,
          fields: panels.map(p => ({
            name: `${p.emoji ?? '🎫'} ${p.title}`,
            value: [
              `**ID:** \`${p.id}\``,
              `**Channel:** ${p.panelChannel ? `<#${p.panelChannel}>` : 'Not posted'}`,
              `**Type:** ${p.panelType} | **Types:** ${p.ticketTypes?.length ?? 0}`,
              `**Log:** ${p.logChannel ? `<#${p.logChannel}>` : 'None'} | **Cooldown:** ${p.cooldownHours > 0 ? `${p.cooldownHours}h` : 'Off'}`,
            ].join('\n'),
            inline: false,
          })),
        })],
        flags: 64,
      });
    }

    // ── info ──────────────────────────────────────────────────────────────────
    if (sub === 'info') {
      const panelId = interaction.options.getString('panel_id');
      const panel = TicketPanel.get(panelId);
      if (!panel || panel.guildId !== interaction.guild.id) {
        return interaction.reply({ embeds: [errorEmbed('Panel not found.')], flags: 64 });
      }
      return interaction.reply({
        embeds: [embed({
          title: `⚙️ Panel: ${panel.title}`,
          color: Colors.info,
          fields: [
            { name: 'ID', value: `\`${panel.id}\``, inline: false },
            { name: 'Type', value: panel.panelType, inline: true },
            { name: 'Channel', value: panel.panelChannel ? `<#${panel.panelChannel}>` : 'Not set', inline: true },
            { name: 'Category', value: panel.supportCategory ? `<#${panel.supportCategory}>` : 'None', inline: true },
            { name: 'Log Channel', value: panel.logChannel ? `<#${panel.logChannel}>` : 'None', inline: true },
            { name: 'Transcript Ch.', value: panel.transcriptChannel ? `<#${panel.transcriptChannel}>` : 'None', inline: true },
            { name: 'Ticket Name', value: `\`${panel.namingFormat}\``, inline: true },
            { name: 'Max / User', value: String(panel.maxPerUser || 'Unlimited'), inline: true },
            { name: 'Cooldown', value: panel.cooldownHours > 0 ? `${panel.cooldownHours}h` : 'Off', inline: true },
            { name: 'Modal', value: panel.modalEnabled ? '✅' : '❌', inline: true },
            { name: 'Claim', value: panel.claimEnabled ? '✅' : '❌', inline: true },
            { name: 'Transcript', value: panel.transcriptEnabled ? '✅' : '❌', inline: true },
            { name: 'Reopen', value: panel.reopenEnabled ? '✅' : '❌', inline: true },
            { name: `Ticket Types (${panel.ticketTypes?.length ?? 0})`, value: panel.ticketTypes?.map(t => `${t.emoji ?? '🎫'} ${t.label} *(${t.mode ?? 'button'})*`).join('\n') || 'None (single button)', inline: false },
            { name: 'Support Roles', value: panel.allowedRoles?.map(r => `<@&${r}>`).join(', ') || 'None', inline: false },
          ],
        })],
        flags: 64,
      });
    }

    // ── delete ────────────────────────────────────────────────────────────────
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
