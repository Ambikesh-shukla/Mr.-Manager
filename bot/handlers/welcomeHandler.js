import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ChannelSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  EmbedBuilder, ChannelType,
} from 'discord.js';
import { WelcomeConfig } from '../storage/WelcomeConfig.js';
import { embed, Colors, errorEmbed } from '../utils/embeds.js';
import { THEMES, buildWelcomePayload, DEFAULT_MESSAGES } from '../utils/welcomeCard.js';
import { isAdmin } from '../utils/permissions.js';
import { logger } from '../utils/logger.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS = (enabled) => enabled ? '✅ Enabled' : '❌ Disabled';
const CHAN    = (id) => id ? `<#${id}>` : '`Not set`';
const VAL    = (v) => v ? `\`${v.length > 60 ? v.slice(0, 57) + '…' : v}\`` : '`Not set`';
const SECTION_LABEL = (s) => s === 'welcome' ? '👋 Welcome' : '🚪 Goodbye';

// ── Dashboard ─────────────────────────────────────────────────────────────────

export async function showWelcomeDashboard(interaction) {
  const cfg = WelcomeConfig.get(interaction.guildId);

  const dashEmbed = new EmbedBuilder()
    .setTitle('👋 Welcome & Goodbye System')
    .setColor(Colors.primary)
    .setDescription('Manage the welcome and goodbye message cards for new and departing members.')
    .addFields(
      {
        name: '👋 Welcome',
        value: [
          `**Status:** ${STATUS(cfg.welcome.enabled)}`,
          `**Channel:** ${CHAN(cfg.welcome.channelId)}`,
          `**Theme:** \`${cfg.welcome.theme}\``,
          `**Mention:** \`${cfg.welcome.mentionUser ? 'Yes' : 'No'}\``,
        ].join('\n'),
        inline: true,
      },
      {
        name: '🚪 Goodbye',
        value: [
          `**Status:** ${STATUS(cfg.goodbye.enabled)}`,
          `**Channel:** ${CHAN(cfg.goodbye.channelId)}`,
          `**Theme:** \`${cfg.goodbye.theme}\``,
          `**Mention:** \`${cfg.goodbye.mentionUser ? 'Yes' : 'No'}\``,
        ].join('\n'),
        inline: true,
      },
    )
    .setFooter({ text: 'Placeholders: {user} {server} {memberCount}' })
    .setTimestamp();

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('welcome:btn:setup:welcome').setLabel('Setup Welcome').setEmoji('👋').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('welcome:btn:setup:goodbye').setLabel('Setup Goodbye').setEmoji('🚪').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('welcome:btn:preview:welcome').setLabel('Preview Welcome').setEmoji('👁️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('welcome:btn:preview:goodbye').setLabel('Preview Goodbye').setEmoji('👁️').setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('welcome:btn:cancel').setLabel('Cancel').setEmoji('✖️').setStyle(ButtonStyle.Danger),
  );

  const payload = { embeds: [dashEmbed], components: [row1, row2], flags: 64 };
  if (interaction.replied || interaction.deferred) return interaction.editReply(payload);
  return interaction.reply(payload);
}

// ── Per-section config panel ──────────────────────────────────────────────────

export async function showConfigPanel(interaction, section) {
  const cfg = WelcomeConfig.get(interaction.guildId)[section];

  const panelEmbed = new EmbedBuilder()
    .setTitle(`${SECTION_LABEL(section)} Setup`)
    .setColor(THEMES[cfg.theme ?? 'dark']?.accent ?? Colors.primary)
    .setDescription('Configure each field below. Changes are saved automatically.')
    .addFields(
      { name: '📺 Channel',       value: CHAN(cfg.channelId),        inline: true },
      { name: '🎨 Theme',         value: `\`${cfg.theme}\``,         inline: true },
      { name: '🔔 Mention User',  value: `\`${cfg.mentionUser ? 'Yes' : 'No'}\``, inline: true },
      { name: '💬 Message',       value: VAL(cfg.message),           inline: false },
      { name: '🖼️ Background URL', value: VAL(cfg.backgroundUrl),    inline: true },
      { name: '🏷️ Logo URL',      value: VAL(cfg.logoUrl),           inline: true },
      { name: '✅ Status',        value: STATUS(cfg.enabled),        inline: true },
    )
    .setFooter({ text: 'Placeholders: {user} {server} {memberCount}' })
    .setTimestamp();

  // Configure dropdown
  const configMenu = new StringSelectMenuBuilder()
    .setCustomId(`welcome:cfg:${section}`)
    .setPlaceholder('⚙️ Configure a field…')
    .addOptions(
      { label: 'Set Message',        value: 'message',      description: 'Welcome/goodbye text (supports placeholders)', emoji: '💬' },
      { label: 'Set Background URL', value: 'backgroundUrl', description: 'URL of the background image', emoji: '🖼️' },
      { label: 'Set Logo URL',       value: 'logoUrl',      description: 'URL of the logo/icon shown on the card', emoji: '🏷️' },
    );

  // Theme dropdown
  const themeMenu = new StringSelectMenuBuilder()
    .setCustomId(`welcome:theme:${section}`)
    .setPlaceholder('🎨 Select theme…')
    .addOptions(
      Object.entries(THEMES).map(([key, t]) => ({
        label: t.label, value: key,
        description: `${t.label} card style`,
        default: cfg.theme === key,
      })),
    );

  const toggleMentionBtn = new ButtonBuilder()
    .setCustomId(`welcome:btn:mention:${section}`)
    .setLabel(cfg.mentionUser ? 'Disable Mention' : 'Enable Mention')
    .setEmoji('🔔')
    .setStyle(cfg.mentionUser ? ButtonStyle.Secondary : ButtonStyle.Success);

  const toggleEnableBtn = new ButtonBuilder()
    .setCustomId(`welcome:btn:toggle:${section}`)
    .setLabel(cfg.enabled ? 'Disable' : 'Enable')
    .setEmoji(cfg.enabled ? '⛔' : '✅')
    .setStyle(cfg.enabled ? ButtonStyle.Danger : ButtonStyle.Success);

  const previewBtn = new ButtonBuilder()
    .setCustomId(`welcome:btn:preview:${section}`)
    .setLabel('Preview')
    .setEmoji('👁️')
    .setStyle(ButtonStyle.Secondary);

  const backBtn = new ButtonBuilder()
    .setCustomId('welcome:btn:back')
    .setLabel('Back')
    .setEmoji('◀️')
    .setStyle(ButtonStyle.Secondary);

  const setChanBtn = new ButtonBuilder()
    .setCustomId(`welcome:btn:setchan:${section}`)
    .setLabel('Set Channel')
    .setEmoji('📺')
    .setStyle(ButtonStyle.Primary);

  const rows = [
    new ActionRowBuilder().addComponents(configMenu),
    new ActionRowBuilder().addComponents(themeMenu),
    new ActionRowBuilder().addComponents(setChanBtn, toggleMentionBtn, toggleEnableBtn, previewBtn, backBtn),
  ];

  const payload = { embeds: [panelEmbed], components: rows, flags: 64 };
  if (interaction.replied || interaction.deferred) return interaction.editReply(payload);
  return interaction.reply(payload);
}

// ── Channel select panel ──────────────────────────────────────────────────────

async function showChannelSelect(interaction, section) {
  await interaction.deferUpdate();
  const chanSelect = new ChannelSelectMenuBuilder()
    .setCustomId(`welcome:chan:${section}`)
    .setPlaceholder(`Select the ${section} channel…`)
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(1)
    .setMaxValues(1);

  const cancelBtn = new ButtonBuilder()
    .setCustomId(`welcome:btn:setup:${section}`)
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary);

  return interaction.editReply({
    embeds: [embed({
      title: `📺 Select ${section === 'welcome' ? 'Welcome' : 'Goodbye'} Channel`,
      description: 'Choose the channel where messages will be sent.',
      color: Colors.primary,
      timestamp: false,
    })],
    components: [
      new ActionRowBuilder().addComponents(chanSelect),
      new ActionRowBuilder().addComponents(cancelBtn),
    ],
  });
}

// ── Modal launchers ───────────────────────────────────────────────────────────

async function showFieldModal(interaction, section, field) {
  const cfg = WelcomeConfig.get(interaction.guildId)[section];

  const fieldMeta = {
    message:       { label: 'Welcome/Goodbye Message', placeholder: DEFAULT_MESSAGES[section], style: TextInputStyle.Paragraph, max: 500 },
    backgroundUrl: { label: 'Background Image URL',    placeholder: 'https://i.imgur.com/…',   style: TextInputStyle.Short,     max: 500 },
    logoUrl:       { label: 'Logo / Icon URL',          placeholder: 'https://i.imgur.com/…',   style: TextInputStyle.Short,     max: 500 },
  };

  const meta = fieldMeta[field];
  if (!meta) return interaction.deferUpdate();

  const input = new TextInputBuilder()
    .setCustomId('value')
    .setLabel(meta.label)
    .setStyle(meta.style)
    .setPlaceholder(meta.placeholder)
    .setMaxLength(meta.max)
    .setRequired(false);

  if (cfg[field]) input.setValue(cfg[field]);

  const modal = new ModalBuilder()
    .setCustomId(`welcome:modal:${section}:${field}`)
    .setTitle(`Configure ${section === 'welcome' ? 'Welcome' : 'Goodbye'}`)
    .addComponents(new ActionRowBuilder().addComponents(input));

  return interaction.showModal(modal);
}

// ── Preview ───────────────────────────────────────────────────────────────────

async function sendPreview(interaction, section) {
  await interaction.deferReply({ flags: 64 });

  const cfg = WelcomeConfig.get(interaction.guildId)[section];

  // Build a fake "member-like" object for preview
  const fakeMember = {
    user:  interaction.user,
    guild: interaction.guild,
    toString() { return `<@${interaction.user.id}>`; },
  };

  try {
    const payload = await buildWelcomePayload({ member: fakeMember, config: cfg, section });
    await interaction.editReply({ ...payload, content: `**Preview (${section}):** ${payload.content ?? ''}`.trim() });
  } catch (err) {
    logger.error('Welcome preview failed', err);
    await interaction.editReply({ embeds: [errorEmbed('Preview failed. Check your image URLs and try again.')] });
  }
}

// ── Main interaction router (called from interactionCreate) ───────────────────

export async function handleWelcomeInteraction(interaction, parts) {
  // parts[0] = 'welcome'
  const type = parts[1]; // btn | cfg | theme | chan | modal

  // ── Buttons: welcome:btn:{action}:{section} ───────────────────────────────
  if (type === 'btn') {
    const action  = parts[2];
    const section = parts[3]; // 'welcome' | 'goodbye'

    if (!isAdmin(interaction.member)) {
      return interaction.reply({ embeds: [errorEmbed('You need **Administrator** permission.')], flags: 64 });
    }

    if (action === 'cancel') {
      await interaction.deferUpdate();
      return interaction.editReply({ embeds: [embed({ description: '✖️ Cancelled.', color: Colors.error, timestamp: false })], components: [] });
    }

    if (action === 'back') {
      await interaction.deferUpdate();
      return showWelcomeDashboard(interaction);
    }

    if (action === 'setup') {
      await interaction.deferUpdate();
      return showConfigPanel(interaction, section);
    }

    if (action === 'setchan') return showChannelSelect(interaction, section);

    if (action === 'toggle') {
      const cfg = WelcomeConfig.get(interaction.guildId)[section];
      WelcomeConfig.updateSection(interaction.guildId, section, { enabled: !cfg.enabled });
      await interaction.deferUpdate();
      return showConfigPanel(interaction, section);
    }

    if (action === 'mention') {
      const cfg = WelcomeConfig.get(interaction.guildId)[section];
      WelcomeConfig.updateSection(interaction.guildId, section, { mentionUser: !cfg.mentionUser });
      await interaction.deferUpdate();
      return showConfigPanel(interaction, section);
    }

    if (action === 'preview') return sendPreview(interaction, section);
  }

  // ── Config dropdown: welcome:cfg:{section} ────────────────────────────────
  if (type === 'cfg') {
    const section = parts[2]; // customId: welcome:cfg:{section}
    const field   = interaction.values[0];
    return showFieldModal(interaction, section, field);
  }

  // ── Theme select: welcome:theme:{section} ─────────────────────────────────
  if (type === 'theme') {
    const section = parts[2]; // customId: welcome:theme:{section}
    const chosen  = interaction.values[0];
    WelcomeConfig.updateSection(interaction.guildId, section, { theme: chosen });
    await interaction.deferUpdate();
    return showConfigPanel(interaction, section);
  }

  // ── Channel select: welcome:chan:{section} ────────────────────────────────
  if (type === 'chan') {
    const section = parts[2]; // customId: welcome:chan:{section}
    const channel = interaction.values[0];
    WelcomeConfig.updateSection(interaction.guildId, section, { channelId: channel });
    await interaction.deferUpdate();
    return showConfigPanel(interaction, section);
  }

  // ── Modal submission: welcome:modal:{section}:{field} ─────────────────────
  if (type === 'modal') {
    // customId: welcome:modal:{section}:{field}  (section=parts[2], field=parts[3])
    const section = parts[2];
    const field   = parts[3];
    const value   = interaction.fields.getTextInputValue('value')?.trim() || null;
    WelcomeConfig.updateSection(interaction.guildId, section, { [field]: value || null });
    await interaction.deferUpdate();
    return showConfigPanel(interaction, section);
  }
}
