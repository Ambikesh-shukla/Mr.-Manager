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
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';

// ── Config Select Menu Options ────────────────────────────────────────────────
const MENU_OPTIONS = [
  { label: 'Set Title', value: 'title', description: 'The embed title shown on the panel', emoji: { name: '📝' } },
  { label: 'Set Description', value: 'description', description: 'The embed description text', emoji: { name: '📄' } },
  { label: 'Set Color', value: 'color', description: 'Embed accent color in hex (#5865F2)', emoji: { name: '🎨' } },
  { label: 'Set Footer', value: 'footer', description: 'Small text shown at the bottom', emoji: { name: '📋' } },
  { label: 'Set Thumbnail URL', value: 'thumbnail', description: 'Small image in the top-right corner', emoji: { name: '🖼️' } },
  { label: 'Set Banner URL', value: 'banner', description: 'Large image below the description', emoji: { name: '🏞️' } },
  { label: 'Set Ticket Name Format', value: 'nameformat', description: 'ticket-{username} / ticket-{number}', emoji: { name: '🏷️' } },
  { label: 'Set Cooldown (hours)', value: 'cooldown', description: 'Hours before user can open another ticket', emoji: { name: '⏰' } },
  { label: 'Set Max Tickets Per User', value: 'maxperuser', description: 'Max open tickets per user (0 = unlimited)', emoji: { name: '🔢' } },
  { label: 'Set Max Global Tickets', value: 'maxglobal', description: 'Max total open tickets (0 = unlimited)', emoji: { name: '🌐' } },
  { label: 'Set Open Message', value: 'openmessage', description: 'Message shown inside new ticket channel', emoji: { name: '💬' } },
  { label: 'Toggle Panel Type (button/dropdown)', value: 'toggletype', description: 'Switch between button and dropdown layout', emoji: { name: '🔘' } },
  { label: 'Toggle Modal Questions', value: 'togglemodal', description: 'Ask questions when ticket is opened', emoji: { name: '❓' } },
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
    category:   { label: 'Select Category Channel',     types: [ChannelType.GuildCategory] },
    logchan:    { label: 'Select Log Channel',           types: [ChannelType.GuildText] },
    transcript: { label: 'Select Transcript Channel',   types: [ChannelType.GuildText] },
    post:       { label: 'Select where to post panel',  types: [ChannelType.GuildText] },
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

// ── Refresh main panel ────────────────────────────────────────────────────────
async function refreshPanel(interaction, session) {
  const payload = { embeds: [buildSetupEmbed(session)], components: buildMainComponents() };
  if (interaction.isMessageComponent()) return interaction.update(payload);
  return interaction.reply({ ...payload, flags: 64 });
}

// ── Add/Edit Type Modals ──────────────────────────────────────────────────────
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

// ── Build preview embed (same as the live panel) ──────────────────────────────
function buildPreviewEmbed(session) {
  let color = Colors.primary;
  if (session.color) {
    try { color = parseInt(session.color.replace('#', ''), 16); } catch {}
  }
  const e = new EmbedBuilder()
    .setTitle(session.title || 'Support Tickets')
    .setDescription(session.description || 'Open a ticket below.')
    .setColor(color)
    .setTimestamp();
  if (session.footer) e.setFooter({ text: session.footer });
  try { if (session.thumbnail) e.setThumbnail(session.thumbnail); } catch {}
  try { if (session.banner) e.setImage(session.banner); } catch {}
  return e;
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
          await oldMsg.edit({ embeds: [buildPreviewEmbed(session)], components: buildPostedPanelComponents(panel) });
          SetupSession.delete(guild.id, interaction.user.id);
          return interaction.editReply({ embeds: [successEmbed('Panel Updated', `Panel updated in <#${channelId}>`), buildPreviewEmbed(session)], components: [] });
        } catch {}
      }
    } else {
      panel = TicketPanel.create(guild.id, panelData);
    }

    const panelEmbed = buildPreviewEmbed(session);
    const panelComponents = buildPostedPanelComponents(panel);
    const msg = await channel.send({ embeds: [panelEmbed], components: panelComponents });
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
    return interaction.reply({ embeds: [errorEmbed('You need **Administrator** or **Manage Server** permission.')], flags: 64 });
  }

  let session;
  if (existingPanelId) {
    const panel = TicketPanel.get(existingPanelId);
    if (!panel || panel.guildId !== interaction.guild.id) {
      return interaction.reply({ embeds: [errorEmbed('Panel not found.')], flags: 64 });
    }
    session = SetupSession.fromPanel(interaction.guild.id, interaction.user.id, panel);
  } else {
    session = SetupSession.create(interaction.guild.id, interaction.user.id);
  }

  await interaction.reply({
    embeds: [buildSetupEmbed(session)],
    components: buildMainComponents(),
    flags: 64,
  });
}

// ── String select menu ────────────────────────────────────────────────────────
export async function handleSetupMenu(interaction) {
  const session = SetupSession.get(interaction.guild.id, interaction.user.id);
  if (!session) return interaction.reply({ embeds: [errorEmbed('Setup session expired. Run `/panel create` again.')], flags: 64 });

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
    title:       { label: 'Panel Title',                       placeholder: 'Support Tickets',                     current: session.title,          max: 100 },
    description: { label: 'Panel Description',                 placeholder: 'Click below to open a ticket.',       current: session.description,    max: 4000, long: true },
    color:       { label: 'Embed Color (hex)',                  placeholder: '#5865F2',                             current: session.color,          max: 7 },
    footer:      { label: 'Footer Text',                        placeholder: 'Response time: within 24 hours',     current: session.footer,         max: 200 },
    thumbnail:   { label: 'Thumbnail URL (top-right image)',    placeholder: 'https://example.com/icon.png',        current: session.thumbnail,      max: 500 },
    banner:      { label: 'Banner URL (large image)',           placeholder: 'https://example.com/banner.png',     current: session.banner,         max: 500 },
    nameformat:  { label: 'Ticket Name Format',                 placeholder: 'ticket-{username} or ticket-{number}', current: session.namingFormat, max: 50 },
    cooldown:    { label: 'Cooldown Hours (0 = off)',           placeholder: '0',                                   current: String(session.cooldownHours), max: 4 },
    maxperuser:  { label: 'Max Tickets Per User (0 = unlimited)', placeholder: '1',                                current: String(session.maxPerUser),    max: 4 },
    maxglobal:   { label: 'Max Global Tickets (0 = unlimited)', placeholder: '0',                                   current: String(session.maxGlobal),     max: 4 },
    openmessage: { label: 'Ticket Open Message',                placeholder: 'Support will be with you shortly!',  current: session.openMessage,    max: 500, long: true },
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
  if (!session) return interaction.reply({ embeds: [errorEmbed('Setup session expired. Run `/panel create` again.')], flags: 64 });

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
    return interaction.reply({
      embeds: [
        embed({ title: '👁️ Panel Preview', description: 'This is exactly how your panel will look when posted:', color: Colors.info, timestamp: false }),
        buildPreviewEmbed(session),
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
  if (!session) return interaction.reply({ embeds: [errorEmbed('Setup session expired. Run `/panel create` again.')], flags: 64 });

  if (field === 'addtype') {
    const typeData = parseTypeFromModal(interaction);
    if (!typeData.label) return interaction.reply({ embeds: [errorEmbed('Type name is required.')], flags: 64 });
    SetupSession.update(interaction.guild.id, interaction.user.id, {
      ticketTypes: [...(session.ticketTypes ?? []), { id: randomUUID(), ...typeData }],
    });
    session = SetupSession.get(interaction.guild.id, interaction.user.id);
    return interaction.reply({ embeds: [buildSetupEmbed(session)], components: buildMainComponents(), flags: 64 });
  }

  if (field.startsWith('edittype:')) {
    const typeId = field.slice('edittype:'.length);
    const typeData = parseTypeFromModal(interaction);
    SetupSession.update(interaction.guild.id, interaction.user.id, {
      ticketTypes: (session.ticketTypes ?? []).map(t => t.id === typeId ? { ...t, ...typeData } : t),
    });
    session = SetupSession.get(interaction.guild.id, interaction.user.id);
    return interaction.reply({ embeds: [buildSetupEmbed(session)], components: buildMainComponents(), flags: 64 });
  }

  const value = interaction.fields.getTextInputValue('value')?.trim() ?? '';

  const numericMap = { cooldown: 'cooldownHours', maxperuser: 'maxPerUser', maxglobal: 'maxGlobal' };
  const textMap = { title: 'title', description: 'description', color: 'color', footer: 'footer', thumbnail: 'thumbnail', banner: 'banner', nameformat: 'namingFormat', openmessage: 'openMessage' };

  if (numericMap[field] !== undefined) {
    SetupSession.update(interaction.guild.id, interaction.user.id, { [numericMap[field]]: Math.max(0, parseInt(value) || 0) });
  } else if (textMap[field]) {
    if (field === 'color' && value && !/^#[0-9A-Fa-f]{6}$/.test(value)) {
      return interaction.reply({ embeds: [errorEmbed('Invalid hex color. Format: `#5865F2`')], flags: 64 });
    }
    SetupSession.update(interaction.guild.id, interaction.user.id, { [textMap[field]]: value });
  }

  session = SetupSession.get(interaction.guild.id, interaction.user.id);
  await interaction.reply({ embeds: [buildSetupEmbed(session)], components: buildMainComponents(), flags: 64 });
}

// ── Channel select ────────────────────────────────────────────────────────────
export async function handleSetupChanSelect(interaction, field) {
  const session = SetupSession.get(interaction.guild.id, interaction.user.id);
  if (!session) return interaction.reply({ embeds: [errorEmbed('Setup session expired.')], flags: 64 });

  const channelId = interaction.values[0];

  if (field === 'post') return finalizePanel(interaction, session, channelId);

  const fieldMap = { category: 'supportCategory', logchan: 'logChannel', transcript: 'transcriptChannel' };
  if (fieldMap[field]) {
    SetupSession.update(interaction.guild.id, interaction.user.id, { [fieldMap[field]]: channelId });
  }

  const updated = SetupSession.get(interaction.guild.id, interaction.user.id);
  return interaction.update({ embeds: [buildSetupEmbed(updated)], components: buildMainComponents() });
}

// ── Role select ───────────────────────────────────────────────────────────────
export async function handleSetupRoleSelect(interaction) {
  const session = SetupSession.get(interaction.guild.id, interaction.user.id);
  if (!session) return interaction.reply({ embeds: [errorEmbed('Setup session expired.')], flags: 64 });

  SetupSession.update(interaction.guild.id, interaction.user.id, { allowedRoles: interaction.values });
  const updated = SetupSession.get(interaction.guild.id, interaction.user.id);
  return interaction.update({ embeds: [buildSetupEmbed(updated)], components: buildMainComponents() });
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
  return interaction.update({ embeds: [buildSetupEmbed(updated)], components: buildMainComponents() });
}
