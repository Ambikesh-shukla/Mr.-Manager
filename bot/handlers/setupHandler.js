import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  EmbedBuilder, ChannelType,
} from 'discord.js';
import { SetupSession } from '../storage/SetupSession.js';
import { TicketPanel } from '../storage/TicketPanel.js';
import { embed, Colors, errorEmbed, successEmbed } from '../utils/embeds.js';
import { isAdmin } from '../utils/permissions.js';
import { safeReply } from '../../utils/safeReply.js';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';

// ── Config Select Menu Options ────────────────────────────────────────────────
const MENU_OPTIONS = [
  { label: 'Set Title', value: 'title', description: 'The embed title shown on the panel', emoji: { name: '📝' } },
  { label: 'Set Description', value: 'description', description: 'The embed description text', emoji: { name: '📄' } },
  { label: 'Set Color', value: 'color', description: 'Embed accent color in hex (#5865F2)', emoji: { name: '🎨' } },
  { label: 'Set Footer', value: 'footer', description: 'Small text shown at the bottom', emoji: { name: '📋' } },
  { label: 'Set Logo URL', value: 'thumbnail', description: 'Small logo image in the top-right corner', emoji: { name: '🖼️' } },
  { label: 'Set Banner URL', value: 'banner', description: 'Large banner image (top or bottom)', emoji: { name: '🏞️' } },
  { label: 'Set Banner Position', value: 'bannerposition', description: 'Where to show the banner: top, bottom, or none', emoji: { name: '📐' } },
  { label: 'Set Ticket Name Format', value: 'nameformat', description: 'ticket-{username} / ticket-{number}', emoji: { name: '🏷️' } },
  { label: 'Set Cooldown (hours)', value: 'cooldown', description: 'Hours before user can open another ticket', emoji: { name: '⏰' } },
  { label: 'Set Max Tickets Per User', value: 'maxperuser', description: 'Max open tickets per user (0 = unlimited)', emoji: { name: '🔢' } },
  { label: 'Set Max Global Tickets', value: 'maxglobal', description: 'Max total open tickets (0 = unlimited)', emoji: { name: '🌐' } },
  { label: 'Set Open Message', value: 'openmessage', description: 'Message shown inside new ticket channel', emoji: { name: '💬' } },
  { label: 'Toggle Panel Type (button/dropdown)', value: 'toggletype', description: 'Switch between button and dropdown layout', emoji: { name: '🔘' } },
  { label: 'Toggle Modal Questions', value: 'togglemodal', description: 'Ask questions when ticket is opened', emoji: { name: '❓' } },
];

// ── Advanced-only options (shown under ⚙️ Advanced Settings) ──────────────────
// Derived from MENU_OPTIONS to avoid duplication
const ADVANCED_OPTION_VALUES = new Set(['nameformat', 'maxglobal', 'openmessage', 'toggletype', 'togglemodal']);
const ADVANCED_OPTIONS = MENU_OPTIONS.filter(o => ADVANCED_OPTION_VALUES.has(o.value));

// ── Default ticket types for Quick Setup ─────────────────────────────────────
const DEFAULT_TICKET_TYPES = () => [
  { id: randomUUID(), label: 'Support Ticket', emoji: '🎧', description: 'Get help from our support team', mode: 'button', questions: [] },
  { id: randomUUID(), label: 'Purchase Ticket', emoji: '🛒', description: 'Purchase a plan or service', mode: 'button', questions: [] },
  { id: randomUUID(), label: 'Bug Report', emoji: '🐛', description: 'Report a bug or issue', mode: 'button', questions: [] },
];

// ── Build the main setup embed ────────────────────────────────────────────────
function buildSetupEmbed(session) {
  const chanOrNone = (id) => id ? `<#${id}>` : '`Not set`';
  const roles = session.allowedRoles?.length > 0
    ? session.allowedRoles.map(r => `<@&${r}>`).join(', ')
    : '`Not set`';
  const types = session.ticketTypes?.length > 0
    ? session.ticketTypes.map(t => `${t.emoji ?? '🎫'} **${t.label}** *(${t.mode ?? 'button'})*`).join('\n')
    : '`None — a single Open Ticket button will be shown`';

  let color = Colors.primary;
  if (session.color) {
    try { color = parseInt(session.color.replace('#', ''), 16); } catch {}
  }

  return new EmbedBuilder()
    .setTitle('🎫 Ticket Panel Setup')
    .setDescription(
      'Use the **Configure** menu to set text fields.\n' +
      'Use the buttons below to set channels, roles, and ticket types.\n\u200b'
    )
    .setColor(color)
    .addFields(
      { name: '📝 Title', value: `\`${session.title || 'Not set'}\``, inline: true },
      { name: '🎨 Color', value: `\`${session.color || '#5865F2'}\``, inline: true },
      { name: '🔘 Layout', value: `\`${session.panelType}\` | Modal: \`${session.modalEnabled ? 'ON' : 'OFF'}\``, inline: true },
      { name: '📄 Description', value: session.description ? `\`${session.description.slice(0, 60)}${session.description.length > 60 ? '…' : ''}\`` : '`Not set`', inline: false },
      { name: '📁 Category', value: chanOrNone(session.supportCategory), inline: true },
      { name: '📋 Log Channel', value: chanOrNone(session.logChannel), inline: true },
      { name: '📝 Transcript', value: chanOrNone(session.transcriptChannel), inline: true },
      { name: '👥 Support Roles', value: roles, inline: false },
      { name: '⏰ Cooldown', value: session.cooldownHours > 0 ? `\`${session.cooldownHours}h\`` : '`Off`', inline: true },
      { name: '🔢 Max / User', value: `\`${session.maxPerUser || 'Unlimited'}\``, inline: true },
      { name: '🌐 Max Global', value: `\`${session.maxGlobal || 'Unlimited'}\``, inline: true },
      { name: `🎫 Ticket Types (${session.ticketTypes?.length ?? 0})`, value: types, inline: false },
    )
    .setFooter({ text: session._editingPanelId ? '✏️ Editing existing panel  •  Click ✅ Create Panel to save' : '🆕 New panel  •  Click ✅ Create Panel when ready' })
    .setTimestamp();
}

// ── Main Components ───────────────────────────────────────────────────────────
function buildMainComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('setup:menu')
        .setPlaceholder('⚙️  Configure text settings and toggles...')
        .addOptions(MENU_OPTIONS)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('setup:btn:category').setLabel('Category').setEmoji('📁').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('setup:btn:logchan').setLabel('Log Channel').setEmoji('📋').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('setup:btn:transcript').setLabel('Transcript').setEmoji('📝').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('setup:btn:roles').setLabel('Support Roles').setEmoji('👥').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('setup:btn:addtype').setLabel('Add Type').setEmoji('➕').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('setup:btn:types').setLabel('Manage Types').setEmoji('📋').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('setup:btn:removetype').setLabel('Remove Type').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('setup:btn:preview').setLabel('Preview').setEmoji('👁️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('setup:btn:create').setLabel('Create Panel').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('setup:btn:cancel').setLabel('Cancel').setEmoji('❌').setStyle(ButtonStyle.Danger),
    ),
  ];
}

// ── Channel Select Page ───────────────────────────────────────────────────────
function buildChanSelectComponents(field) {
  const meta = {
    category:     { label: 'Select Category Channel',          types: [ChannelType.GuildCategory] },
    logchan:      { label: 'Select Log Channel',               types: [ChannelType.GuildText] },
    transcript:   { label: 'Select Transcript Channel',        types: [ChannelType.GuildText] },
    post:         { label: 'Select where to post panel',       types: [ChannelType.GuildText] },
    qs_panel:     { label: 'Select panel channel (text)',      types: [ChannelType.GuildText] },
    qs_category:  { label: 'Select ticket category',           types: [ChannelType.GuildCategory] },
    qs_log:       { label: 'Select log channel (optional)',    types: [ChannelType.GuildText] },
    wz_category:  { label: 'Select ticket category',           types: [ChannelType.GuildCategory] },
    wz_log:       { label: 'Select log channel',               types: [ChannelType.GuildText] },
  };
  const m = meta[field] ?? { label: 'Select a channel', types: [ChannelType.GuildText] };
  return [
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`setup:chan:${field}`)
        .setPlaceholder(m.label)
        .addChannelTypes(...m.types)
        .setMinValues(1).setMaxValues(1)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('setup:btn:back').setLabel('Back').setEmoji('⬅️').setStyle(ButtonStyle.Secondary)
    ),
  ];
}

// ── Role Select Page ──────────────────────────────────────────────────────────
function buildRoleSelectComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId('setup:role:support')
        .setPlaceholder('Select support roles (select none to clear)')
        .setMinValues(0).setMaxValues(10)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('setup:btn:back').setLabel('Back').setEmoji('⬅️').setStyle(ButtonStyle.Secondary)
    ),
  ];
}

// ── Type List Select ──────────────────────────────────────────────────────────
function buildTypeListComponents(session, mode) {
  const types = session.ticketTypes ?? [];
  if (types.length === 0) return null;
  const selectId = mode === 'remove' ? 'setup:removeselect' : 'setup:typeselect';
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(selectId)
        .setPlaceholder(mode === 'remove' ? 'Select type to remove…' : 'Select type to edit…')
        .addOptions(types.map(t => ({
          label: `${t.emoji ? t.emoji + ' ' : ''}${t.label}`,
          value: t.id,
          description: (t.description ?? 'No description').slice(0, 50),
        })))
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('setup:btn:back').setLabel('Back').setEmoji('⬅️').setStyle(ButtonStyle.Secondary)
    ),
  ];
}

// ── Type Edit Buttons ─────────────────────────────────────────────────────────
function buildTypeEditComponents(typeId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`setup:btn:edittype:${typeId}`).setLabel('Edit This Type').setEmoji('✏️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('setup:btn:back').setLabel('Back').setEmoji('⬅️').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// ── NEW: Dashboard embed ──────────────────────────────────────────────────────
function buildDashboardEmbed(session) {
  const chanOrNone = (id) => id ? `<#${id}>` : '`Not set`';
  const roles = session.allowedRoles?.length > 0
    ? session.allowedRoles.map(r => `<@&${r}>`).join(', ')
    : '`Not set`';
  let color = Colors.primary;
  if (session.color) {
    try { color = parseInt(session.color.replace('#', ''), 16); } catch {}
  }

  return new EmbedBuilder()
    .setTitle('🎫 Ticket Panel Setup')
    .setDescription(
      '**Use the buttons below to configure your ticket panel.**\n' +
      '> ⚡ **Quick Setup** — Get everything set up in under a minute\n' +
      '> 🎨 **Customize** — Title, description, color & logo\n' +
      '> 🎫 **Ticket Types** — Add Support, Purchase, Bug Report etc.\n' +
      '> 📤 **Publish Panel** — Post the finished panel in a channel\n\u200b'
    )
    .setColor(color)
    .addFields(
      { name: '📝 Title', value: `\`${session.title || 'Support Tickets'}\``, inline: true },
      { name: '🎨 Color', value: `\`${session.color || '#5865F2'}\``, inline: true },
      { name: '🎫 Ticket Types', value: `\`${session.ticketTypes?.length ?? 0}\``, inline: true },
      { name: '👥 Support Roles', value: roles, inline: true },
      { name: '📋 Log Channel', value: chanOrNone(session.logChannel), inline: true },
      { name: '📁 Category', value: chanOrNone(session.supportCategory), inline: true },
      { name: '⏰ Cooldown', value: session.cooldownHours > 0 ? `\`${session.cooldownHours}h\`` : '`Off`', inline: true },
      { name: '🔢 Max / User', value: `\`${session.maxPerUser || 'Unlimited'}\``, inline: true },
      { name: '🔘 Layout', value: `\`${session.panelType}\``, inline: true },
    )
    .setFooter({ text: session._editingPanelId ? '✏️ Editing existing panel' : '🆕 New panel  •  Click 📤 Publish Panel when ready' })
    .setTimestamp();
}

// ── NEW: Dashboard components ─────────────────────────────────────────────────
function buildDashboardComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('setup:dash:quicksetup').setLabel('Quick Setup').setEmoji('⚡').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('setup:dash:customize').setLabel('Customize Panel').setEmoji('🎨').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('setup:dash:types').setLabel('Ticket Types').setEmoji('🎫').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('setup:dash:roles').setLabel('Support Roles').setEmoji('👥').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('setup:dash:logs').setLabel('Logs').setEmoji('📋').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('setup:dash:cooldown').setLabel('Cooldown').setEmoji('⏰').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('setup:dash:advanced').setLabel('Advanced').setEmoji('⚙️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('setup:dash:preview').setLabel('Preview').setEmoji('👁️').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('setup:dash:publish').setLabel('Publish Panel').setEmoji('📤').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('setup:dash:cancel').setLabel('Cancel').setEmoji('❌').setStyle(ButtonStyle.Danger),
    ),
  ];
}

// ── NEW: Customize sub-panel ──────────────────────────────────────────────────
function buildCustomizeEmbed(session) {
  let color = Colors.primary;
  if (session.color) {
    try { color = parseInt(session.color.replace('#', ''), 16); } catch {}
  }
  return new EmbedBuilder()
    .setTitle('🎨 Customize Panel')
    .setDescription('Set the look and feel of your ticket panel.')
    .setColor(color)
    .addFields(
      { name: '📝 Title', value: `\`${session.title || 'Support Tickets'}\``, inline: true },
      { name: '🎨 Color', value: `\`${session.color || '#5865F2'}\``, inline: true },
      { name: '📋 Footer', value: session.footer ? `\`${session.footer.slice(0, 60)}\`` : '`Not set`', inline: true },
      { name: '📄 Description', value: session.description ? `\`${session.description.slice(0, 80)}${session.description.length > 80 ? '…' : ''}\`` : '`Not set`', inline: false },
      { name: '🖼️ Logo URL', value: session.thumbnail ? '`Set ✅`' : '`Not set`', inline: true },
      { name: '🏞️ Banner URL', value: session.banner ? '`Set ✅`' : '`Not set`', inline: true },
      { name: '📐 Banner Position', value: `\`${session.bannerPosition || 'bottom'}\``, inline: true },
    )
    .setTimestamp();
}

function buildCustomizeComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('setup:dash:cust_title').setLabel('Title').setEmoji('📝').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('setup:dash:cust_desc').setLabel('Description').setEmoji('📄').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('setup:dash:cust_color').setLabel('Color').setEmoji('🎨').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('setup:dash:cust_footer').setLabel('Footer').setEmoji('📋').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('setup:dash:cust_logo').setLabel('Logo URL').setEmoji('🖼️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('setup:dash:cust_banner').setLabel('Banner URL').setEmoji('🏞️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('setup:dash:cust_bannerpos').setLabel('Banner Position').setEmoji('📐').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('setup:dash:back').setLabel('Back to Dashboard').setEmoji('⬅️').setStyle(ButtonStyle.Primary),
    ),
  ];
}

// ── NEW: Ticket Types sub-panel ───────────────────────────────────────────────
function buildTypesEmbed(session) {
  const types = session.ticketTypes ?? [];
  const typeList = types.length > 0
    ? types.map(t => `${t.emoji ?? '🎫'} **${t.label}** *(${t.mode ?? 'button'})*`).join('\n')
    : '*No ticket types yet.*\nAdd at least one type so users can choose what kind of ticket to open.';

  return new EmbedBuilder()
    .setTitle('🎫 Ticket Types')
    .setDescription('Manage the types of tickets users can open.\n\u200b')
    .setColor(Colors.primary)
    .addFields({ name: `Current Types (${types.length})`, value: typeList, inline: false })
    .setTimestamp();
}

function buildTypesComponents(session) {
  const hasTypes = (session.ticketTypes?.length ?? 0) > 0;
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('setup:dash:types_add').setLabel('Add Type').setEmoji('➕').setStyle(ButtonStyle.Success),
    ...(hasTypes ? [
      new ButtonBuilder().setCustomId('setup:dash:types_edit').setLabel('Edit Type').setEmoji('✏️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('setup:dash:types_remove').setLabel('Remove Type').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
    ] : []),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('setup:dash:back').setLabel('Back to Dashboard').setEmoji('⬅️').setStyle(ButtonStyle.Primary),
  );
  return [row1, row2];
}

// ── NEW: Cooldown modal (2-field) ─────────────────────────────────────────────
function buildCooldownModal(session) {
  const modal = new ModalBuilder().setCustomId('setup:modal:cooldown').setTitle('⏰ Cooldown Settings');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('maxperuser')
        .setLabel('Max open tickets per user (0 = unlimited)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setPlaceholder('1')
        .setMaxLength(4)
        .setValue(String(session.maxPerUser ?? 1))
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('cooldownhours')
        .setLabel('Cooldown hours after closing (0 = off)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setPlaceholder('0')
        .setMaxLength(4)
        .setValue(String(session.cooldownHours ?? 0))
    ),
  );
  return modal;
}

// ── NEW: QS role-select row ───────────────────────────────────────────────────
function buildQsRoleSelectComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId('setup:role:qs_support')
        .setPlaceholder('Select support roles…')
        .setMinValues(0).setMaxValues(10)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('setup:btn:back').setLabel('Back').setEmoji('⬅️').setStyle(ButtonStyle.Secondary)
    ),
  ];
}

// ── NEW: Wizard role-select row (Step 6) ──────────────────────────────────────
function buildWizardRoleSelectComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId('setup:role:wz_support')
        .setPlaceholder('Select support role(s)…')
        .setMinValues(0).setMaxValues(10)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('setup:wizard:cancel').setLabel('Cancel Setup').setEmoji('❌').setStyle(ButtonStyle.Danger)
    ),
  ];
}

// ── Refresh main panel (now shows new dashboard) ──────────────────────────────
async function refreshPanel(interaction, session) {
  const payload = { embeds: [buildDashboardEmbed(session)], components: buildDashboardComponents() };
  if (interaction.isMessageComponent()) return interaction.update(payload);
  return interaction.reply({ ...payload, flags: 64 });
}

// ── Wizard entry embed (simple 4-button screen for /setup-ticket) ─────────────
function buildWizardEmbed(session) {
  let color = Colors.primary;
  if (session.color) {
    try { color = parseInt(session.color.replace('#', ''), 16); } catch {}
  }
  const typeCount = session.ticketTypes?.length ?? 0;
  const roles = session.allowedRoles?.length > 0
    ? `${session.allowedRoles.length} role(s) set`
    : 'Not set';

  return new EmbedBuilder()
    .setTitle('🎫 Ticket Setup Wizard')
    .setDescription(
      'Start the setup to create a new ticket panel step by step.\n\n' +
      '> ⚡ **Start Setup** — guided step-by-step wizard\n' +
      '> 📤 **Publish Ticket** — post the panel in a channel\n' +
      '> 👁️ **Preview** — preview how the panel will look\n' +
      '> ❌ **Cancel** — discard and exit\n\u200b'
    )
    .setColor(color)
    .addFields(
      { name: '📝 Title', value: `\`${session.title || 'Support Tickets'}\``, inline: true },
      { name: '🎨 Color', value: `\`${session.color || '#5865F2'}\``, inline: true },
      { name: '🎫 Ticket Types', value: `\`${typeCount}\``, inline: true },
      { name: '👥 Support Roles', value: `\`${roles}\``, inline: true },
      { name: '📋 Log Channel', value: session.logChannel ? `<#${session.logChannel}>` : '`Not set`', inline: true },
      { name: '📁 Category', value: session.supportCategory ? `<#${session.supportCategory}>` : '`Not set`', inline: true },
    )
    .setFooter({ text: 'Admin-only • Run /setup-ticket any time to return here' })
    .setTimestamp();
}

function buildWizardComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('setup:wizard:start').setLabel('Start Setup').setEmoji('⚡').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('setup:wizard:publish').setLabel('Publish Ticket').setEmoji('📤').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('setup:wizard:preview').setLabel('Preview').setEmoji('👁️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('setup:wizard:cancel').setLabel('Cancel').setEmoji('❌').setStyle(ButtonStyle.Danger),
    ),
  ];
}

// ── Cancel row shown during message-collector wait ────────────────────────────
const CANCEL_ROW = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('setup:wizard:cancel').setLabel('Cancel Setup').setEmoji('❌').setStyle(ButtonStyle.Danger)
);

// ── Parse cooldown string (e.g. "1h", "30m", "0") → hours (number) ───────────
function parseCooldown(str) {
  const s = str.trim().toLowerCase();
  if (s === '0' || s === 'none' || s === 'off' || s === 'no') return 0;
  const match = s.match(/^(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)$/);
  if (!match) return null;
  const num = parseFloat(match[1]);
  const unit = match[2];
  if (unit.startsWith('m')) return Math.round((num / 60) * 100) / 100;
  return num;
}

// ── Wizard step embeds / components ──────────────────────────────────────────
function wizardStep3Embed() {
  return new EmbedBuilder()
    .setTitle('🔘 Step 3/8 — Panel Style')
    .setDescription(
      '**How should users choose their ticket type?**\n\n' +
      '> 🔘 **Button Mode** — Each type appears as a clickable button\n' +
      '> 📋 **Dropdown Mode** — All types shown in a dropdown menu\n\u200b'
    )
    .setColor(Colors.primary)
    .setTimestamp();
}

function wizardStep3Components() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('setup:wizard:style:button').setLabel('Button Mode').setEmoji('🔘').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('setup:wizard:style:dropdown').setLabel('Dropdown Mode').setEmoji('📋').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('setup:wizard:cancel').setLabel('Cancel').setEmoji('❌').setStyle(ButtonStyle.Danger),
    ),
  ];
}

function wizardStep4Embed(session) {
  const types = session.ticketTypes ?? [];
  const typeList = types.length > 0
    ? types.map(t => `${t.emoji ?? '🎫'} **${t.label}** *(${t.mode ?? 'button'})*`).join('\n')
    : '*No types yet. Click **Add Default Types** to start.*';
  return new EmbedBuilder()
    .setTitle('🎫 Step 4/8 — Ticket Types')
    .setDescription(
      '**What types of tickets can users open?**\n\n' +
      'Add the default Support/Purchase/Bug types, or add your own.\n' +
      'When done, click **Next →** to continue.\n\u200b'
    )
    .setColor(Colors.primary)
    .addFields({ name: `Current Types (${types.length})`, value: typeList, inline: false })
    .setTimestamp();
}

function wizardStep4Components(hasTypes) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('setup:wizard:types:defaults').setLabel('Add Default Types').setEmoji('📦').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('setup:wizard:types:add').setLabel('Add Custom Type').setEmoji('➕').setStyle(ButtonStyle.Primary),
      ...(hasTypes ? [new ButtonBuilder().setCustomId('setup:wizard:types:done').setLabel('Next →').setEmoji('▶️').setStyle(ButtonStyle.Success)] : []),
      new ButtonBuilder().setCustomId('setup:wizard:cancel').setLabel('Cancel').setEmoji('❌').setStyle(ButtonStyle.Danger),
    ),
  ];
}

function buildAddTypeModal() {
  const modal = new ModalBuilder().setCustomId('setup:modal:addtype').setTitle('Add Ticket Type');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('label').setLabel('Type Name').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Purchase, Support, Bug Report…').setMaxLength(30)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('emoji').setLabel('Emoji').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('🛒').setMaxLength(8)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Short Description (shown in dropdown)').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('Open a ticket to purchase a plan').setMaxLength(100)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('mode').setLabel('Mode: button or dropdown').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('button').setMaxLength(8)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('questions').setLabel('Modal Questions (one per line, max 5)').setStyle(TextInputStyle.Paragraph).setRequired(false).setPlaceholder('What is your username?\nWhich plan interests you?').setMaxLength(500)),
  );
  return modal;
}

function buildEditTypeModal(session, typeId) {
  const t = session.ticketTypes.find(x => x.id === typeId);
  if (!t) return buildAddTypeModal();
  const modal = new ModalBuilder().setCustomId(`setup:modal:edittype:${typeId}`).setTitle('Edit Ticket Type');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('label').setLabel('Type Name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(30).setValue(t.label ?? '')),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('emoji').setLabel('Emoji').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(8).setValue(t.emoji ?? '')),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Short Description').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100).setValue(t.description ?? '')),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('mode').setLabel('Mode: button or dropdown').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(8).setValue(t.mode ?? 'button')),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('questions').setLabel('Modal Questions (one per line, max 5)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500).setValue(t.questions?.map(q => q.label).join('\n') ?? '')),
  );
  return modal;
}

function parseTypeFromModal(interaction) {
  const label = interaction.fields.getTextInputValue('label').trim();
  const emoji = interaction.fields.getTextInputValue('emoji').trim() || null;
  const description = interaction.fields.getTextInputValue('description').trim() || null;
  const modeRaw = interaction.fields.getTextInputValue('mode').trim().toLowerCase();
  const mode = ['button', 'dropdown'].includes(modeRaw) ? modeRaw : 'button';
  const questionsText = interaction.fields.getTextInputValue('questions').trim();
  const questions = questionsText
    ? questionsText.split('\n').filter(Boolean).slice(0, 5).map((q, i) => ({
        id: `q${i + 1}`, label: q.slice(0, 45), required: true,
        long: q.length > 60, placeholder: '',
      }))
    : [];
  return { label, emoji, description, mode, questions };
}

// ── Build the actual live panel components (posted in channel) ────────────────
export function buildPostedPanelComponents(panel) {
  const types = panel.ticketTypes ?? [];

  if (panel.panelType === 'dropdown' && types.length > 0) {
    return [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`panelselect:${panel.id}`)
          .setPlaceholder(panel.dropdownPlaceholder ?? 'Choose a ticket type…')
          .addOptions(types.map(t => ({
            label: `${t.emoji ? t.emoji + ' ' : ''}${t.label}`,
            value: t.id,
            description: t.description?.slice(0, 50) ?? undefined,
          })))
      ),
    ];
  }

  if (types.length > 0) {
    const rows = [];
    for (let i = 0; i < types.length && rows.length < 4; i += 5) {
      const batch = types.slice(i, i + 5);
      rows.push(new ActionRowBuilder().addComponents(
        batch.map(t => new ButtonBuilder()
          .setCustomId(`panel:open:${panel.id}:${t.id}`)
          .setLabel(`${t.emoji ? t.emoji + ' ' : ''}${t.label}`)
          .setStyle(ButtonStyle.Primary)
        )
      ));
    }
    return rows;
  }

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`panel:open:${panel.id}`).setLabel('🎫 Open Ticket').setStyle(ButtonStyle.Primary)
    ),
  ];
}

// ── Build the actual live panel embed(s) (supports top/bottom/none banner) ─────
function buildPreviewEmbeds(session) {
  let color = Colors.primary;
  if (session.color) {
    try { color = parseInt(session.color.replace('#', ''), 16); } catch {}
  }
  const panelEmbed = new EmbedBuilder()
    .setTitle(session.title || 'Support Tickets')
    .setDescription(session.description || 'Open a ticket below.')
    .setColor(color)
    .setTimestamp();
  if (session.footer) panelEmbed.setFooter({ text: session.footer });
  try { if (session.thumbnail) panelEmbed.setThumbnail(session.thumbnail); } catch {}

  const bannerPos = session.bannerPosition ?? 'bottom';

  if (session.banner && bannerPos === 'top') {
    // Send a banner embed before the panel embed
    const bannerEmbed = new EmbedBuilder().setImage(session.banner).setColor(color);
    return [bannerEmbed, panelEmbed];
  }

  if (session.banner && bannerPos === 'bottom') {
    try { panelEmbed.setImage(session.banner); } catch {}
  }

  // bannerPos === 'none' or no banner: no image
  return [panelEmbed];
}


function buildPreviewComponents(session) {
  const types = session.ticketTypes ?? [];
  if (session.panelType === 'dropdown' && types.length > 0) {
    return [new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('noop:previewselect')
        .setPlaceholder('Choose a ticket type…')
        .addOptions(types.map(t => ({ label: `${t.emoji ? t.emoji + ' ' : ''}${t.label}`, value: t.id, description: t.description?.slice(0, 50) })))
        .setDisabled(true)
    )];
  }
  if (types.length > 0) {
    return [new ActionRowBuilder().addComponents(
      types.slice(0, 5).map(t => new ButtonBuilder()
        .setCustomId(`noop:preview:${t.id}`)
        .setLabel(`${t.emoji ? t.emoji + ' ' : ''}${t.label}`)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true)
      )
    )];
  }
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('noop:preview').setLabel('🎫 Open Ticket').setStyle(ButtonStyle.Primary).setDisabled(true)
  )];
}

// ── Finalize: create/update panel in DB and post in channel ───────────────────
async function finalizePanel(interaction, session, channelId) {
  await interaction.deferUpdate();
  try {
    const guild = interaction.guild;
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) {
      return interaction.followUp({ embeds: [errorEmbed('Invalid channel selected. Please pick a text channel.')], flags: 64 });
    }

    const panelData = {
      title: session.title,
      description: session.description,
      color: session.color,
      footer: session.footer,
      thumbnail: session.thumbnail,
      banner: session.banner,
      bannerPosition: session.bannerPosition ?? 'bottom',
      namingFormat: session.namingFormat,
      supportCategory: session.supportCategory,
      logChannel: session.logChannel,
      transcriptChannel: session.transcriptChannel,
      allowedRoles: session.allowedRoles ?? [],
      pingRoles: session.pingRoles ?? [],
      cooldownHours: session.cooldownHours,
      maxPerUser: session.maxPerUser,
      maxGlobal: session.maxGlobal,
      modalEnabled: session.modalEnabled,
      panelType: session.panelType,
      openMessage: session.openMessage,
      ticketTypes: session.ticketTypes ?? [],
      panelChannel: channelId,
    };

    let panel;
    const isEdit = !!session._editingPanelId;

    if (isEdit) {
      panel = TicketPanel.update(session._editingPanelId, panelData);
      if (panel?.messageId) {
        try {
          const oldMsg = await channel.messages.fetch(panel.messageId);
          const updatedEmbeds = buildPreviewEmbeds(session);
          await oldMsg.edit({ embeds: updatedEmbeds, components: buildPostedPanelComponents(panel) });
          SetupSession.delete(guild.id, interaction.user.id);
          return interaction.editReply({ embeds: [successEmbed('Panel Updated', `Panel updated in <#${channelId}>`)], components: [] });
        } catch {}
      }
    } else {
      panel = TicketPanel.create(guild.id, panelData);
    }

    const panelEmbeds = buildPreviewEmbeds(session);
    const panelComponents = buildPostedPanelComponents(panel);
    const msg = await channel.send({ embeds: panelEmbeds, components: panelComponents });
    TicketPanel.update(panel.id, { messageId: msg.id });

    SetupSession.delete(guild.id, interaction.user.id);
    logger.info(`Panel ${isEdit ? 'updated' : 'created'}: ${panel.id} in guild ${guild.id}`);

    await interaction.editReply({
      embeds: [successEmbed(isEdit ? 'Panel Updated!' : 'Panel Created!', `Your ticket panel is live in <#${channelId}>.\n**Panel ID:** \`${panel.id}\`\n\nUsers can now click the panel to open tickets.`)],
      components: [],
    });
  } catch (err) {
    logger.error('Failed to finalize panel', err);
    await interaction.followUp({ embeds: [errorEmbed('Failed to create panel. Check bot permissions in that channel.')], flags: 64 });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTED HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

export async function startSetup(interaction, existingPanelId = null) {
  if (!isAdmin(interaction.member)) {
    return safeReply(interaction, { embeds: [errorEmbed('You need **Administrator** or **Manage Server** permission.')], flags: 64 });
  }

  let session;
  if (existingPanelId) {
    // Editing an existing panel → show the full dashboard
    const panel = TicketPanel.get(existingPanelId);
    if (!panel || panel.guildId !== interaction.guild.id) {
      return safeReply(interaction, { embeds: [errorEmbed('Panel not found.')], flags: 64 });
    }
    session = SetupSession.fromPanel(interaction.guild.id, interaction.user.id, panel);
    return safeReply(interaction, {
      embeds: [buildDashboardEmbed(session)],
      components: buildDashboardComponents(),
      flags: 64,
    });
  } else {
    // New panel → show the beginner-friendly wizard entry screen
    session = SetupSession.get(interaction.guild.id, interaction.user.id)
      ?? SetupSession.create(interaction.guild.id, interaction.user.id);
    return safeReply(interaction, {
      embeds: [buildWizardEmbed(session)],
      components: buildWizardComponents(),
      flags: 64,
    });
  }
}

// ── String select menu ────────────────────────────────────────────────────────
export async function handleSetupMenu(interaction) {
  const session = SetupSession.get(interaction.guild.id, interaction.user.id);
  if (!session) return interaction.reply({ embeds: [errorEmbed('Setup session expired. Run `/setup-ticket` again.')], flags: 64 });

  const value = interaction.values[0];

  if (value === 'toggletype') {
    SetupSession.update(interaction.guild.id, interaction.user.id, {
      panelType: session.panelType === 'button' ? 'dropdown' : 'button',
    });
    return refreshPanel(interaction, SetupSession.get(interaction.guild.id, interaction.user.id));
  }

  if (value === 'togglemodal') {
    SetupSession.update(interaction.guild.id, interaction.user.id, { modalEnabled: !session.modalEnabled });
    return refreshPanel(interaction, SetupSession.get(interaction.guild.id, interaction.user.id));
  }

  const fieldConfig = {
    title:         { label: 'Panel Title',                         placeholder: 'Support Tickets',                     current: session.title,               max: 100 },
    description:   { label: 'Panel Description',                   placeholder: 'Click below to open a ticket.',       current: session.description,         max: 4000, long: true },
    color:         { label: 'Embed Color (hex)',                    placeholder: '#5865F2',                             current: session.color,               max: 7 },
    footer:        { label: 'Footer Text',                          placeholder: 'Response time: within 24 hours',     current: session.footer,              max: 200 },
    thumbnail:     { label: 'Logo URL (top-right image)',           placeholder: 'https://example.com/logo.png',        current: session.thumbnail,           max: 500 },
    banner:        { label: 'Banner URL (large image)',             placeholder: 'https://example.com/banner.png',     current: session.banner,              max: 500 },
    bannerposition:{ label: 'Banner Position (top/bottom/none)',    placeholder: 'bottom',                              current: session.bannerPosition,      max: 6 },
    nameformat:    { label: 'Ticket Name Format',                   placeholder: 'ticket-{username} or ticket-{number}', current: session.namingFormat,      max: 50 },
    cooldown:      { label: 'Cooldown Hours (0 = off)',             placeholder: '0',                                   current: String(session.cooldownHours), max: 4 },
    maxperuser:    { label: 'Max Tickets Per User (0 = unlimited)', placeholder: '1',                                   current: String(session.maxPerUser),    max: 4 },
    maxglobal:     { label: 'Max Global Tickets (0 = unlimited)',   placeholder: '0',                                   current: String(session.maxGlobal),     max: 4 },
    openmessage:   { label: 'Ticket Open Message',                  placeholder: 'Support will be with you shortly!',  current: session.openMessage,         max: 500, long: true },
  };

  const cfg = fieldConfig[value];
  if (!cfg) return interaction.deferUpdate();

  const modal = new ModalBuilder().setCustomId(`setup:modal:${value}`).setTitle(cfg.label.slice(0, 45));
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('value')
        .setLabel(cfg.label.slice(0, 45))
        .setStyle(cfg.long ? TextInputStyle.Paragraph : TextInputStyle.Short)
        .setRequired(false)
        .setPlaceholder(cfg.placeholder)
        .setMaxLength(cfg.max)
        .setValue(cfg.current ?? '')
    )
  );
  await interaction.showModal(modal);
}

// ── Button handler ────────────────────────────────────────────────────────────
export async function handleSetupButton(interaction, action) {
  const session = SetupSession.get(interaction.guild.id, interaction.user.id);
  if (!session) return interaction.reply({ embeds: [errorEmbed('Setup session expired. Run `/setup-ticket` again.')], flags: 64 });

  if (action === 'category' || action === 'logchan' || action === 'transcript') {
    const labels = { category: 'Support Category', logchan: 'Log Channel', transcript: 'Transcript Channel' };
    return interaction.update({
      embeds: [embed({ title: `📁 Set ${labels[action]}`, description: `Select the **${labels[action]}** using the menu below.`, color: Colors.primary, timestamp: false })],
      components: buildChanSelectComponents(action),
    });
  }

  if (action === 'roles') {
    return interaction.update({
      embeds: [embed({ title: '👥 Set Support Roles', description: 'Select the roles that can view and manage tickets.\nSelect **0 roles** to clear.', color: Colors.primary, timestamp: false })],
      components: buildRoleSelectComponents(),
    });
  }

  if (action === 'addtype') return interaction.showModal(buildAddTypeModal());

  if (action === 'types') {
    const comps = buildTypeListComponents(session, 'manage');
    if (!comps) return interaction.reply({ embeds: [errorEmbed('No ticket types yet. Use **➕ Add Type** first.')], flags: 64 });
    return interaction.update({
      embeds: [embed({ title: '📋 Manage Ticket Types', description: 'Select a type to edit it.', color: Colors.primary, timestamp: false })],
      components: comps,
    });
  }

  if (action === 'removetype') {
    const comps = buildTypeListComponents(session, 'remove');
    if (!comps) return interaction.reply({ embeds: [errorEmbed('No ticket types to remove.')], flags: 64 });
    return interaction.update({
      embeds: [embed({ title: '🗑️ Remove Ticket Type', description: 'Select a type to permanently remove it.', color: Colors.error, timestamp: false })],
      components: comps,
    });
  }

  if (action === 'back') return refreshPanel(interaction, session);

  if (action === 'preview') {
    const btnPreviewEmbeds = buildPreviewEmbeds(session);
    return interaction.reply({
      embeds: [
        embed({ title: '👁️ Panel Preview', description: 'This is exactly how your panel will look when posted:', color: Colors.info, timestamp: false }),
        ...btnPreviewEmbeds,
      ],
      components: buildPreviewComponents(session),
      flags: 64,
    });
  }

  if (action === 'create') {
    return interaction.update({
      embeds: [embed({ title: '📤 Post Ticket Panel', description: 'Select the channel where the ticket panel will be posted.', color: Colors.success, timestamp: false })],
      components: buildChanSelectComponents('post'),
    });
  }

  if (action === 'cancel') {
    SetupSession.delete(interaction.guild.id, interaction.user.id);
    return interaction.update({
      embeds: [embed({ title: '❌ Setup Cancelled', description: 'Panel setup cancelled. No changes were saved.', color: Colors.error, timestamp: false })],
      components: [],
    });
  }

  if (action.startsWith('edittype:')) {
    const typeId = action.slice('edittype:'.length);
    return interaction.showModal(buildEditTypeModal(session, typeId));
  }

  return interaction.deferUpdate();
}

// ── Modal submissions ─────────────────────────────────────────────────────────
export async function handleSetupModal(interaction, field) {
  let session = SetupSession.get(interaction.guild.id, interaction.user.id);
  if (!session) return interaction.reply({ embeds: [errorEmbed('Setup session expired. Run `/setup-ticket` again.')], flags: 64 });

  if (field === 'addtype') {
    const typeData = parseTypeFromModal(interaction);
    if (!typeData.label) return interaction.reply({ embeds: [errorEmbed('Type name is required.')], flags: 64 });
    SetupSession.update(interaction.guild.id, interaction.user.id, {
      ticketTypes: [...(session.ticketTypes ?? []), { id: randomUUID(), ...typeData }],
    });
    session = SetupSession.get(interaction.guild.id, interaction.user.id);
    // If we are in the wizard flow (step 4), show wizard step 4 embed
    if (session._wizardStep === 'types') {
      return interaction.reply({ embeds: [wizardStep4Embed(session)], components: wizardStep4Components(true), flags: 64 });
    }
    return interaction.reply({ embeds: [buildTypesEmbed(session)], components: buildTypesComponents(session), flags: 64 });
  }

  if (field.startsWith('edittype:')) {
    const typeId = field.slice('edittype:'.length);
    const typeData = parseTypeFromModal(interaction);
    SetupSession.update(interaction.guild.id, interaction.user.id, {
      ticketTypes: (session.ticketTypes ?? []).map(t => t.id === typeId ? { ...t, ...typeData } : t),
    });
    session = SetupSession.get(interaction.guild.id, interaction.user.id);
    return interaction.reply({ embeds: [buildTypesEmbed(session)], components: buildTypesComponents(session), flags: 64 });
  }

  // ── Cooldown modal (2-field) ──────────────────────────────────────────────
  // Handled separately so users can set both limits in one focused modal
  if (field === 'cooldown') {
    const maxPerUser = Math.max(0, parseInt(interaction.fields.getTextInputValue('maxperuser') || '0', 10) || 0);
    const cooldownHours = Math.max(0, parseInt(interaction.fields.getTextInputValue('cooldownhours') || '0', 10) || 0);
    SetupSession.update(interaction.guild.id, interaction.user.id, { maxPerUser, cooldownHours });
    session = SetupSession.get(interaction.guild.id, interaction.user.id);
    return interaction.reply({ embeds: [buildDashboardEmbed(session)], components: buildDashboardComponents(), flags: 64 });
  }

  const value = interaction.fields.getTextInputValue('value')?.trim() ?? '';

  const numericMap = { maxperuser: 'maxPerUser', maxglobal: 'maxGlobal' };
  const textMap = { title: 'title', description: 'description', color: 'color', footer: 'footer', thumbnail: 'thumbnail', banner: 'banner', bannerposition: 'bannerPosition', nameformat: 'namingFormat', openmessage: 'openMessage' };

  if (numericMap[field] !== undefined) {
    SetupSession.update(interaction.guild.id, interaction.user.id, { [numericMap[field]]: Math.max(0, parseInt(value) || 0) });
  } else if (textMap[field]) {
    if (field === 'color' && value && !/^#[0-9A-Fa-f]{6}$/.test(value)) {
      return interaction.reply({ embeds: [errorEmbed('Invalid hex color. Format: `#5865F2`')], flags: 64 });
    }
    if (field === 'bannerposition') {
      const pos = value.toLowerCase();
      const valid = ['top', 'bottom', 'none'];
      SetupSession.update(interaction.guild.id, interaction.user.id, { bannerPosition: valid.includes(pos) ? pos : 'bottom' });
    } else {
      // Preserve Unicode styled text exactly as entered — no normalization
      SetupSession.update(interaction.guild.id, interaction.user.id, { [textMap[field]]: value });
    }
  }

  session = SetupSession.get(interaction.guild.id, interaction.user.id);
  // After customise modals, return to the customize sub-panel for smooth UX
  const customizeFields = ['title', 'description', 'color', 'footer', 'thumbnail', 'banner', 'bannerposition'];
  if (customizeFields.includes(field)) {
    return interaction.reply({ embeds: [buildCustomizeEmbed(session)], components: buildCustomizeComponents(), flags: 64 });
  }
  await interaction.reply({ embeds: [buildDashboardEmbed(session)], components: buildDashboardComponents(), flags: 64 });
}

// ── Channel select ────────────────────────────────────────────────────────────
export async function handleSetupChanSelect(interaction, field) {
  const session = SetupSession.get(interaction.guild.id, interaction.user.id);
  if (!session) return interaction.reply({ embeds: [errorEmbed('Setup session expired.')], flags: 64 });

  const channelId = interaction.values[0];

  // ── Standard post (publish) ──────────────────────────────────────────────
  if (field === 'post') return finalizePanel(interaction, session, channelId);

  // ── Wizard: Step 5 — category ─────────────────────────────────────────────
  if (field === 'wz_category') {
    SetupSession.update(interaction.guild.id, interaction.user.id, { supportCategory: channelId, _wizardStep: 'role' });
    return interaction.update({
      embeds: [embed({
        title: '👥 Step 6/8 — Support Role',
        description: 'Select the **role that can view and manage tickets**.\n*(Staff who should be able to see and respond to ticket channels.)*',
        color: Colors.primary, timestamp: false,
      })],
      components: buildWizardRoleSelectComponents(),
    });
  }

  // ── Wizard: Step 7 — log channel ──────────────────────────────────────────
  if (field === 'wz_log') {
    SetupSession.update(interaction.guild.id, interaction.user.id, {
      logChannel: channelId,
      _wizardStep: 'cooldown',
      _wizardChannelId: interaction.channelId,
      _webhook: interaction.webhook,
      _wizardPromptMsgId: null,
    });
    await interaction.update({
      embeds: [embed({
        title: '⏰ Step 8/8 — Cooldown',
        description:
          '**How long must users wait after closing a ticket before opening a new one?**\n\n' +
          '> Type `0` or `off` for no cooldown\n' +
          '> Type `1h`, `2h`, `30m`, etc. for a specific cooldown\n\n' +
          '⏳ *Type your answer in this channel (2 minute timeout)*',
        color: Colors.primary, timestamp: false,
      })],
      components: [CANCEL_ROW()],
    });
    // Send visible prompt in channel
    try {
      const promptMsg = await interaction.channel.send({
        content: `${interaction.member} ⏰ Type the **cooldown duration** below (e.g. \`0\`, \`1h\`, \`30m\`):`,
        allowedMentions: { parse: [] },
      });
      SetupSession.update(interaction.guild.id, interaction.user.id, { _wizardPromptMsgId: promptMsg.id });
    } catch {}
    return;
  }

  // ── Quick Setup steps ─────────────────────────────────────────────────────
  if (field === 'qs_panel') {
    SetupSession.update(interaction.guild.id, interaction.user.id, { _qsPanelChannel: channelId });
    return interaction.update({
      embeds: [embed({
        title: '⚡ Quick Setup — Step 2 of 4',
        description: 'Select the **ticket category** where ticket channels will be created.\n*(You can create a new category in Discord first if needed.)*',
        color: Colors.success, timestamp: false,
      })],
      components: buildChanSelectComponents('qs_category'),
    });
  }

  if (field === 'qs_category') {
    SetupSession.update(interaction.guild.id, interaction.user.id, { supportCategory: channelId });
    return interaction.update({
      embeds: [embed({
        title: '⚡ Quick Setup — Step 3 of 4',
        description: 'Select the **support role** that can view and manage tickets.\n*(Staff who should be able to see ticket channels.)*',
        color: Colors.success, timestamp: false,
      })],
      components: buildQsRoleSelectComponents(),
    });
  }

  if (field === 'qs_log') {
    SetupSession.update(interaction.guild.id, interaction.user.id, { logChannel: channelId });
    const updated = SetupSession.get(interaction.guild.id, interaction.user.id);
    // Add default ticket types if none configured yet
    if (!updated.ticketTypes || updated.ticketTypes.length === 0) {
      SetupSession.update(interaction.guild.id, interaction.user.id, { ticketTypes: DEFAULT_TICKET_TYPES() });
    }
    const finalSession = SetupSession.get(interaction.guild.id, interaction.user.id);
    return finalizePanel(interaction, finalSession, finalSession._qsPanelChannel);
  }

  // ── Standard field updates ────────────────────────────────────────────────
  const fieldMap = { category: 'supportCategory', logchan: 'logChannel', transcript: 'transcriptChannel' };
  if (fieldMap[field]) {
    SetupSession.update(interaction.guild.id, interaction.user.id, { [fieldMap[field]]: channelId });
  }

  const updated = SetupSession.get(interaction.guild.id, interaction.user.id);
  return interaction.update({ embeds: [buildDashboardEmbed(updated)], components: buildDashboardComponents() });
}

// ── Role select ───────────────────────────────────────────────────────────────
export async function handleSetupRoleSelect(interaction) {
  const session = SetupSession.get(interaction.guild.id, interaction.user.id);
  if (!session) return interaction.reply({ embeds: [errorEmbed('Setup session expired.')], flags: 64 });

  const parts = interaction.customId.split(':');
  const field = parts[2]; // 'support', 'qs_support', or 'wz_support'

  SetupSession.update(interaction.guild.id, interaction.user.id, { allowedRoles: interaction.values });

  // ── Wizard step 6 → step 7 ────────────────────────────────────────────────
  if (field === 'wz_support') {
    SetupSession.update(interaction.guild.id, interaction.user.id, { _wizardStep: 'log' });
    return interaction.update({
      embeds: [embed({
        title: '📋 Step 7/8 — Log Channel',
        description: 'Select the **channel where ticket activity will be logged**.\n*(Ticket opens, closes, and transcripts go here.)*',
        color: Colors.primary, timestamp: false,
      })],
      components: buildChanSelectComponents('wz_log'),
    });
  }

  // ── Quick Setup step 3 → step 4 ──────────────────────────────────────────
  if (field === 'qs_support') {
    return interaction.update({
      embeds: [embed({
        title: '⚡ Quick Setup — Step 4 of 4',
        description: 'Almost done! Select the **log channel** where ticket activity will be recorded.\n*(All opens, closes, and transcripts go here.)*',
        color: Colors.success, timestamp: false,
      })],
      components: buildChanSelectComponents('qs_log'),
    });
  }

  const updated = SetupSession.get(interaction.guild.id, interaction.user.id);
  return interaction.update({ embeds: [buildDashboardEmbed(updated)], components: buildDashboardComponents() });
}

// ── Type manage select (edit flow) ────────────────────────────────────────────
export async function handleSetupTypeSelect(interaction) {
  const session = SetupSession.get(interaction.guild.id, interaction.user.id);
  if (!session) return interaction.reply({ embeds: [errorEmbed('Setup session expired.')], flags: 64 });

  const typeId = interaction.values[0];
  const t = session.ticketTypes.find(x => x.id === typeId);
  if (!t) return refreshPanel(interaction, session);

  return interaction.update({
    embeds: [embed({
      title: `✏️ ${t.emoji ?? '🎫'} ${t.label}`,
      color: Colors.primary, timestamp: false,
      fields: [
        { name: 'Mode', value: `\`${t.mode ?? 'button'}\``, inline: true },
        { name: 'Emoji', value: t.emoji ?? 'None', inline: true },
        { name: 'Modal Questions', value: t.questions?.length > 0 ? t.questions.map(q => `• ${q.label}`).join('\n') : 'None', inline: false },
        { name: 'Description', value: t.description ?? 'None', inline: false },
      ],
    })],
    components: buildTypeEditComponents(typeId),
  });
}

// ── Type remove select ────────────────────────────────────────────────────────
export async function handleSetupRemoveSelect(interaction) {
  const session = SetupSession.get(interaction.guild.id, interaction.user.id);
  if (!session) return interaction.reply({ embeds: [errorEmbed('Setup session expired.')], flags: 64 });

  const typeId = interaction.values[0];
  const updated = SetupSession.update(interaction.guild.id, interaction.user.id, {
    ticketTypes: session.ticketTypes.filter(t => t.id !== typeId),
  });
  return interaction.update({ embeds: [buildTypesEmbed(updated)], components: buildTypesComponents(updated) });
}

// ═══════════════════════════════════════════════════════════════════════════════
// NEW: Dashboard button handler (setup:dash:*)
// ═══════════════════════════════════════════════════════════════════════════════

export async function handleSetupDashButton(interaction, action) {
  const session = SetupSession.get(interaction.guild.id, interaction.user.id);
  if (!session) {
    return interaction.reply({ embeds: [errorEmbed('Setup session expired. Run `/setup-ticket` again.')], flags: 64 });
  }

  // ── Back to main dashboard ──────────────────────────────────────────────────
  if (action === 'back') {
    return interaction.update({ embeds: [buildDashboardEmbed(session)], components: buildDashboardComponents() });
  }

  // ── Cancel ──────────────────────────────────────────────────────────────────
  if (action === 'cancel') {
    SetupSession.delete(interaction.guild.id, interaction.user.id);
    return interaction.update({
      embeds: [embed({ title: '❌ Setup Cancelled', description: 'Panel setup cancelled. No changes were saved.', color: Colors.error, timestamp: false })],
      components: [],
    });
  }

  // ── Quick Setup ─────────────────────────────────────────────────────────────
  if (action === 'quicksetup') {
    return interaction.update({
      embeds: [embed({
        title: '⚡ Quick Setup — Step 1 of 4',
        description: "**Welcome to Quick Setup!**\nYou'll answer 4 simple questions and your ticket panel will be ready.\n\nFirst, select the **channel where the ticket panel will be posted** (a text channel visible to your members).",
        color: Colors.success, timestamp: false,
      })],
      components: buildChanSelectComponents('qs_panel'),
    });
  }

  // ── Customize Panel ─────────────────────────────────────────────────────────
  if (action === 'customize') {
    return interaction.update({
      embeds: [buildCustomizeEmbed(session)],
      components: buildCustomizeComponents(),
    });
  }

  // ── Customize field modals ─────────────────────────────────────────────────
  const customizeModalMap = {
    cust_title:  { field: 'title',       label: 'Panel Title',                placeholder: 'Support Tickets',                   current: session.title,          max: 100 },
    cust_desc:   { field: 'description', label: 'Panel Description',          placeholder: 'Click below to open a ticket.',     current: session.description,    max: 4000, long: true },
    cust_color:  { field: 'color',       label: 'Embed Color (hex)',           placeholder: '#5865F2',                           current: session.color,          max: 7 },
    cust_logo:   { field: 'thumbnail',   label: 'Logo URL (top-right image)', placeholder: 'https://example.com/logo.png',      current: session.thumbnail,      max: 500 },
    cust_banner: { field: 'banner',      label: 'Banner URL (large image)',   placeholder: 'https://example.com/banner.png',    current: session.banner,         max: 500 },
    cust_footer: { field: 'footer',      label: 'Footer Text',                placeholder: 'Response time: within 24 hours',   current: session.footer,         max: 200 },
  };
  if (customizeModalMap[action]) {
    const cfg = customizeModalMap[action];
    const modal = new ModalBuilder().setCustomId(`setup:modal:${cfg.field}`).setTitle(cfg.label.slice(0, 45));
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('value')
          .setLabel(cfg.label.slice(0, 45))
          .setStyle(cfg.long ? TextInputStyle.Paragraph : TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder(cfg.placeholder)
          .setMaxLength(cfg.max)
          .setValue(cfg.current ?? '')
      )
    );
    return interaction.showModal(modal);
  }

  // ── Banner Position selector ─────────────────────────────────────────────────
  if (action === 'cust_bannerpos') {
    const current = session.bannerPosition ?? 'bottom';
    // Cycle through positions: bottom → top → none → bottom
    const next = current === 'bottom' ? 'top' : current === 'top' ? 'none' : 'bottom';
    SetupSession.update(interaction.guild.id, interaction.user.id, { bannerPosition: next });
    const updated = SetupSession.get(interaction.guild.id, interaction.user.id);
    return interaction.update({ embeds: [buildCustomizeEmbed(updated)], components: buildCustomizeComponents() });
  }

  // ── Ticket Types ────────────────────────────────────────────────────────────
  if (action === 'types') {
    return interaction.update({ embeds: [buildTypesEmbed(session)], components: buildTypesComponents(session) });
  }

  if (action === 'types_add') {
    return interaction.showModal(buildAddTypeModal());
  }

  if (action === 'types_edit') {
    const comps = buildTypeListComponents(session, 'manage');
    if (!comps) return interaction.reply({ embeds: [errorEmbed('No ticket types yet. Use **➕ Add Type** first.')], flags: 64 });
    return interaction.update({
      embeds: [embed({ title: '✏️ Edit Ticket Type', description: 'Select a type to edit it.', color: Colors.primary, timestamp: false })],
      components: comps,
    });
  }

  if (action === 'types_remove') {
    const comps = buildTypeListComponents(session, 'remove');
    if (!comps) return interaction.reply({ embeds: [errorEmbed('No ticket types to remove.')], flags: 64 });
    return interaction.update({
      embeds: [embed({ title: '🗑️ Remove Ticket Type', description: 'Select a type to permanently remove it.', color: Colors.error, timestamp: false })],
      components: comps,
    });
  }

  // ── Support Roles ───────────────────────────────────────────────────────────
  if (action === 'roles') {
    return interaction.update({
      embeds: [embed({ title: '👥 Support Roles', description: 'Select the roles that can view and manage tickets.\nSelect **0 roles** to clear all roles.', color: Colors.primary, timestamp: false })],
      components: buildRoleSelectComponents(),
    });
  }

  // ── Logs ────────────────────────────────────────────────────────────────────
  if (action === 'logs') {
    return interaction.update({
      embeds: [embed({ title: '📋 Log Channel', description: 'Select the channel where ticket activity (opens, closes, transcripts) will be logged.', color: Colors.primary, timestamp: false })],
      components: buildChanSelectComponents('logchan'),
    });
  }

  // ── Cooldown ────────────────────────────────────────────────────────────────
  if (action === 'cooldown') {
    return interaction.showModal(buildCooldownModal(session));
  }

  // ── Advanced Settings ───────────────────────────────────────────────────────
  if (action === 'advanced') {
    return interaction.update({
      embeds: [embed({
        title: '⚙️ Advanced Settings',
        description: 'These settings are optional and mostly for power users.\nUse the menu below to configure advanced options.',
        color: Colors.primary, timestamp: false,
        fields: [
          { name: '🏷️ Ticket Name Format', value: `\`${session.namingFormat ?? 'ticket-{username}'}\``, inline: true },
          { name: '🌐 Max Global Tickets', value: `\`${session.maxGlobal || 'Unlimited'}\``, inline: true },
          { name: '❓ Modal Questions', value: session.modalEnabled ? '`ON`' : '`OFF`', inline: true },
          { name: '🔘 Layout', value: `\`${session.panelType}\``, inline: true },
          { name: '📝 Transcript Channel', value: session.transcriptChannel ? `<#${session.transcriptChannel}>` : '`Not set`', inline: true },
        ],
      })],
      components: [
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('setup:menu')
            .setPlaceholder('⚙️ Configure advanced settings…')
            .addOptions(ADVANCED_OPTIONS)
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('setup:btn:transcript').setLabel('Transcript Channel').setEmoji('📝').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('setup:dash:back').setLabel('Back to Dashboard').setEmoji('⬅️').setStyle(ButtonStyle.Primary),
        ),
      ],
    });
  }

  // ── Preview ─────────────────────────────────────────────────────────────────
  if (action === 'preview') {
    const dashPreviewEmbeds = buildPreviewEmbeds(session);
    return interaction.reply({
      embeds: [
        embed({ title: '👁️ Panel Preview', description: 'This is exactly how your panel will look when posted:', color: Colors.info, timestamp: false }),
        ...dashPreviewEmbeds,
      ],
      components: buildPreviewComponents(session),
      flags: 64,
    });
  }

  // ── Publish Panel ───────────────────────────────────────────────────────────
  if (action === 'publish') {
    return interaction.update({
      embeds: [embed({ title: '📤 Publish Panel', description: 'Select the channel where the ticket panel will be posted.\nUsers will click buttons in this channel to open tickets.', color: Colors.success, timestamp: false })],
      components: buildChanSelectComponents('post'),
    });
  }

  return interaction.deferUpdate();
}

// ═══════════════════════════════════════════════════════════════════════════════
// NEW: Wizard button handler (setup:wizard:*)
// ═══════════════════════════════════════════════════════════════════════════════

export async function handleWizardButton(interaction, action) {
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  let session = SetupSession.get(guildId, userId);
  if (!session) {
    return interaction.reply({ embeds: [errorEmbed('Setup session expired. Run `/setup-ticket` again.')], flags: 64 });
  }

  // ── Cancel ──────────────────────────────────────────────────────────────────
  if (action === 'cancel') {
    // Clean up any pending prompt message
    if (session._wizardPromptMsgId && interaction.channel) {
      try {
        const promptMsg = await interaction.channel.messages.fetch(session._wizardPromptMsgId).catch(() => null);
        await promptMsg?.delete().catch(() => {});
      } catch {}
    }
    SetupSession.delete(guildId, userId);
    return interaction.update({
      embeds: [embed({ title: '❌ Setup Cancelled', description: 'Panel setup cancelled. No changes were saved.', color: Colors.error, timestamp: false })],
      components: [],
    });
  }

  // ── Preview ──────────────────────────────────────────────────────────────────
  if (action === 'preview') {
    const wizardPreviewEmbeds = buildPreviewEmbeds(session);
    return interaction.reply({
      embeds: [
        embed({ title: '👁️ Panel Preview', description: 'This is exactly how your panel will look when posted:', color: Colors.info, timestamp: false }),
        ...wizardPreviewEmbeds,
      ],
      components: buildPreviewComponents(session),
      flags: 64,
    });
  }

  // ── Publish ──────────────────────────────────────────────────────────────────
  if (action === 'publish') {
    // Add default ticket types if none configured
    if (!session.ticketTypes || session.ticketTypes.length === 0) {
      SetupSession.update(guildId, userId, { ticketTypes: DEFAULT_TICKET_TYPES() });
    }
    return interaction.update({
      embeds: [embed({ title: '📤 Publish Ticket Panel', description: 'Select the channel where the ticket panel will be posted.\nUsers will click buttons in this channel to open tickets.', color: Colors.success, timestamp: false })],
      components: buildChanSelectComponents('post'),
    });
  }

  // ── Start Setup Wizard ───────────────────────────────────────────────────────
  if (action === 'start') {
    // Store webhook for updating wizard message during message-collector steps
    SetupSession.update(guildId, userId, {
      _wizardStep: 'title',
      _wizardChannelId: interaction.channelId,
      _webhook: interaction.webhook,
      _wizardPromptMsgId: null,
    });

    await interaction.update({
      embeds: [new EmbedBuilder()
        .setTitle('📝 Step 1/8 — Panel Title')
        .setDescription(
          '**What should the ticket panel be called?**\n\n' +
          '> Examples: `Support Tickets`, `Help Desk`, `Customer Support`\n\n' +
          '⏳ *Type your answer in this channel (2 minute timeout)*'
        )
        .setColor(Colors.primary)
        .setTimestamp()],
      components: [CANCEL_ROW()],
    });

    // Send visible prompt in channel so admin knows where to type
    try {
      const promptMsg = await interaction.channel.send({
        content: `${interaction.member} 📝 Please type the **ticket panel title** below:`,
        allowedMentions: { parse: [] },
      });
      SetupSession.update(guildId, userId, { _wizardPromptMsgId: promptMsg.id });
    } catch {}
    return;
  }

  // ── Style choice (step 3) ────────────────────────────────────────────────────
  if (action === 'style:button' || action === 'style:dropdown') {
    const style = action === 'style:dropdown' ? 'dropdown' : 'button';
    SetupSession.update(guildId, userId, { panelType: style, _wizardStep: 'types' });
    session = SetupSession.get(guildId, userId);
    return interaction.update({
      embeds: [wizardStep4Embed(session)],
      components: wizardStep4Components((session.ticketTypes?.length ?? 0) > 0),
    });
  }

  // ── Types: add defaults ──────────────────────────────────────────────────────
  if (action === 'types:defaults') {
    const existing = session.ticketTypes ?? [];
    if (existing.length === 0) {
      SetupSession.update(guildId, userId, { ticketTypes: DEFAULT_TICKET_TYPES() });
    }
    session = SetupSession.get(guildId, userId);
    return interaction.update({
      embeds: [wizardStep4Embed(session)],
      components: wizardStep4Components(true),
    });
  }

  // ── Types: add custom ────────────────────────────────────────────────────────
  if (action === 'types:add') {
    return interaction.showModal(buildAddTypeModal());
  }

  // ── Types: done → step 5 category ───────────────────────────────────────────
  if (action === 'types:done') {
    SetupSession.update(guildId, userId, { _wizardStep: 'category' });
    return interaction.update({
      embeds: [embed({
        title: '📁 Step 5/8 — Ticket Category',
        description:
          'Select the **category where ticket channels will be created**.\n\n' +
          '*Tip: Create a "Tickets" category in Discord first if you don\'t have one.*',
        color: Colors.primary, timestamp: false,
      })],
      components: buildChanSelectComponents('wz_category'),
    });
  }

  return interaction.deferUpdate();
}

// ═══════════════════════════════════════════════════════════════════════════════
// NEW: Wizard message handler (called from messageCreate)
// ═══════════════════════════════════════════════════════════════════════════════

export async function handleWizardMessage(message, session) {
  const guildId = session.guildId;
  const userId = session.userId;

  // Delete user's message to keep channel clean
  await message.delete().catch(() => {});

  // Delete the bot's prompt message
  if (session._wizardPromptMsgId) {
    try {
      const promptMsg = await message.channel.messages.fetch(session._wizardPromptMsgId).catch(() => null);
      await promptMsg?.delete().catch(() => {});
    } catch {}
  }

  const step = session._wizardStep;
  const value = message.content.trim();
  const webhook = session._webhook;

  // Helper to update the ephemeral wizard message via stored webhook
  async function updateWizard(embedObj, compsArray) {
    if (!webhook) return;
    try {
      await webhook.editMessage('@original', { embeds: [embedObj], components: compsArray });
    } catch (err) {
      logger.warn('Failed to update wizard message via webhook', err);
    }
  }

  if (step === 'title') {
    const title = (value.slice(0, 100) || 'Support Tickets');
    SetupSession.update(guildId, userId, {
      title,
      _wizardStep: 'description',
      _wizardPromptMsgId: null,
    });

    await updateWizard(
      new EmbedBuilder()
        .setTitle('📄 Step 2/8 — Panel Description')
        .setDescription(
          '**What description should appear on the ticket panel?**\n\n' +
          '> Example: `Click below to open a support ticket. Our team will assist you shortly.`\n\n' +
          '⏳ *Type your answer in this channel (2 minute timeout)*'
        )
        .setColor(Colors.primary)
        .setTimestamp(),
      [CANCEL_ROW()],
    );

    try {
      const promptMsg = await message.channel.send({
        content: `${message.member} 📄 Please type the **ticket panel description** below:`,
        allowedMentions: { parse: [] },
      });
      SetupSession.update(guildId, userId, { _wizardPromptMsgId: promptMsg.id });
    } catch {}
    return;
  }

  if (step === 'description') {
    const description = value.slice(0, 1000) || 'Click below to open a support ticket.';
    SetupSession.update(guildId, userId, {
      description,
      _wizardStep: 'style',
      _wizardPromptMsgId: null,
    });

    await updateWizard(wizardStep3Embed(), wizardStep3Components());
    return;
  }

  if (step === 'cooldown') {
    const parsed = parseCooldown(value);
    if (parsed === null) {
      // Invalid format — re-send prompt
      try {
        const promptMsg = await message.channel.send({
          content: `${message.member} ⚠️ Invalid cooldown format. Type \`0\`, \`1h\`, \`30m\`, etc.:`,
          allowedMentions: { parse: [] },
        });
        SetupSession.update(guildId, userId, { _wizardPromptMsgId: promptMsg.id });
      } catch {}
      return;
    }

    SetupSession.update(guildId, userId, {
      cooldownHours: parsed,
      _wizardStep: 'preview',
      _wizardPromptMsgId: null,
    });

    const updated = SetupSession.get(guildId, userId);

    // Add default ticket types if none configured yet
    if (!updated.ticketTypes || updated.ticketTypes.length === 0) {
      SetupSession.update(guildId, userId, { ticketTypes: DEFAULT_TICKET_TYPES() });
    }

    const finalSession = SetupSession.get(guildId, userId);
    await updateWizard(
      new EmbedBuilder()
        .setTitle('✅ Step 9/8 — Review & Publish')
        .setDescription(
          '**All settings are configured! Review the preview below.**\n\n' +
          '> Click **Publish Ticket** to post your ticket panel.\n' +
          '> Click **Preview** to see what the panel will look like.\n\u200b'
        )
        .setColor(Colors.success)
        .addFields(
          { name: '📝 Title', value: `\`${finalSession.title}\``, inline: true },
          { name: '🔘 Layout', value: `\`${finalSession.panelType}\``, inline: true },
          { name: '🎫 Types', value: `\`${finalSession.ticketTypes?.length ?? 0}\``, inline: true },
          { name: '📁 Category', value: finalSession.supportCategory ? `<#${finalSession.supportCategory}>` : '`Not set`', inline: true },
          { name: '👥 Roles', value: finalSession.allowedRoles?.length > 0 ? `\`${finalSession.allowedRoles.length} role(s)\`` : '`Not set`', inline: true },
          { name: '📋 Log', value: finalSession.logChannel ? `<#${finalSession.logChannel}>` : '`Not set`', inline: true },
          { name: '⏰ Cooldown', value: finalSession.cooldownHours > 0 ? `\`${finalSession.cooldownHours}h\`` : '`Off`', inline: true },
        )
        .setTimestamp(),
      buildWizardComponents(),
    );
  }
}
