import {
  SlashCommandBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { TicketPanel } from '../../storage/TicketPanel.js';
import { Colors } from '../../utils/embeds.js';
import { isAdmin } from '../../utils/permissions.js';

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
    .setDescription('Open the Ticket Control Panel — manage tickets or view available panels'),

  defaultLevel: 'public',

  async execute(interaction) {
    const panels = TicketPanel.forGuild(interaction.guild.id);
    const { embeds, components } = buildHelpPanel(panels, interaction.member);
    return interaction.reply({ embeds, components, flags: 64 });
  },
};
