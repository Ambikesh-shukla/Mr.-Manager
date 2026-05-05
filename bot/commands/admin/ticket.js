import {
  SlashCommandBuilder, PermissionFlagsBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { TicketPanel } from '../../storage/TicketPanel.js';
import { embed, Colors, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { isAdmin } from '../../utils/permissions.js';
import { startSetup } from '../../handlers/setupHandler.js';
import { logger } from '../../utils/logger.js';

// ── Build the outside-ticket help panel ────────────────────────────────────
function buildHelpPanel(panels, member) {
  const isAdminUser = isAdmin(member);

  if (panels.length === 0) {
    const e = new EmbedBuilder()
      .setTitle('🎫 Ticket System')
      .setColor(Colors.warning)
      .setDescription(
        isAdminUser
          ? 'No ticket panels configured yet.\nRun `/setup-ticket` to create one.'
          : 'No ticket panels are available right now. Please contact a staff member.'
      );
    return { embeds: [e], components: [] };
  }

  const fields = panels.slice(0, 10).map(p => ({
    name: `${p.emoji ?? '🎫'} ${p.title}`,
    value: [
      p.description ? p.description.slice(0, 80) + (p.description.length > 80 ? '…' : '') : '*No description*',
      p.panelChannel ? `Channel: <#${p.panelChannel}>` : '',
    ].filter(Boolean).join('\n'),
    inline: false,
  }));

  const e = new EmbedBuilder()
    .setTitle('🎫 Ticket Control Panel')
    .setColor(Colors.primary)
    .setDescription(
      'Use the buttons below for ticket management, or head to the ticket panel channel to open a ticket.\n\u200b'
    )
    .addFields(fields)
    .setTimestamp();

  const components = [];

  if (isAdminUser) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket:stats:guild').setLabel('Server Stats').setEmoji('📊').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('ticket:search:guild').setLabel('Search Tickets').setEmoji('🔍').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('ticket:blacklist:global').setLabel('Manage Blacklist').setEmoji('🚫').setStyle(ButtonStyle.Secondary)
      )
    );
  }

  return { embeds: [e], components };
}

export default {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Ticket system — open the dashboard or manage ticket panels')
    .addSubcommand(sc => sc
      .setName('open')
      .setDescription('Open the Ticket Control Panel dashboard')
    )
    .addSubcommand(sc => sc
      .setName('list')
      .setDescription('List all ticket panels in this server')
    )
    .addSubcommand(sc => sc
      .setName('edit')
      .setDescription('Open the interactive editor for an existing panel')
      .addStringOption(o => o.setName('panel_id').setDescription('Panel ID to edit').setRequired(true))
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
    ),

  defaultLevel: 'public',

  // per-subcommand access levels: open is public, panel management is admin-only
  subcommandDefaults: {
    open: 'public',
    list: 'admin',
    edit: 'admin',
    info: 'admin',
    delete: 'admin',
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand(false);

    // ── open / default: dashboard ──────────────────────────────────────────
    if (!sub || sub === 'open') {
      const panels = TicketPanel.forGuild(interaction.guild.id);
      const { embeds, components } = buildHelpPanel(panels, interaction.member);
      return interaction.reply({ embeds, components, flags: 64 });
    }

    // Admin-only subcommands below — enforce permission manually so the
    // public `open` subcommand above is still accessible to everyone.
    if (!isAdmin(interaction.member)) {
      return interaction.reply({ embeds: [errorEmbed('You need **Administrator** or **Manage Server** permission.')], flags: 64 });
    }

    // ── list ────────────────────────────────────────────────────────────────
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

    // ── edit ────────────────────────────────────────────────────────────────
    if (sub === 'edit') {
      const panelId = interaction.options.getString('panel_id');
      return startSetup(interaction, panelId);
    }

    // ── info ────────────────────────────────────────────────────────────────
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
            { name: 'Logo', value: panel.thumbnail ? '✅ Set' : '❌ None', inline: true },
            { name: 'Banner', value: panel.banner ? `✅ ${panel.bannerPosition ?? 'bottom'}` : '❌ None', inline: true },
            { name: `Ticket Types (${panel.ticketTypes?.length ?? 0})`, value: panel.ticketTypes?.map(t => `${t.emoji ?? '🎫'} ${t.label} *(${t.mode ?? 'button'})*`).join('\n') || 'None (single button)', inline: false },
            { name: 'Support Roles', value: panel.allowedRoles?.map(r => `<@&${r}>`).join(', ') || 'None', inline: false },
          ],
        })],
        flags: 64,
      });
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
