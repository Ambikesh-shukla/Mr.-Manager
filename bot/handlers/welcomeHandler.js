import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ChannelSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  EmbedBuilder, ChannelType,
} from 'discord.js';
import { WelcomeConfig } from '../storage/WelcomeConfig.js';
import { WelcomeWizardSession } from '../storage/WelcomeWizardSession.js';
import { embed, Colors, errorEmbed } from '../utils/embeds.js';
import { THEMES, buildWelcomePayload, DEFAULT_MESSAGES } from '../utils/welcomeCard.js';
import { isAdmin } from '../utils/permissions.js';
import { logger } from '../utils/logger.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS       = (enabled) => enabled ? '✅ Enabled' : '❌ Disabled';
const CHAN         = (id)      => id ? `<#${id}>` : '`Not set`';
const SECTION_LABEL = (s)     => s === 'welcome' ? '👋 Welcome' : '🚪 Goodbye';
const TOTAL_WIZARD_STEPS = 6;

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

// ── Wizard helpers ────────────────────────────────────────────────────────────

function wizardEmbed(section, stepNum, title, description, fields = []) {
  const label = SECTION_LABEL(section);
  const e = new EmbedBuilder()
    .setTitle(`${label} Setup — Step ${stepNum}/${TOTAL_WIZARD_STEPS}: ${title}`)
    .setColor(Colors.primary)
    .setDescription(description)
    .setFooter({ text: 'Placeholders: {user} {server} {memberCount}  •  Session expires in 10 min' })
    .setTimestamp();
  if (fields.length) e.addFields(...fields);
  return e;
}

function navRow(section, backAction) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`welcome:wiz:btn:${section}:back_${backAction}`)
      .setLabel('Back')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`welcome:wiz:btn:${section}:cancel`)
      .setLabel('Cancel')
      .setEmoji('✖️')
      .setStyle(ButtonStyle.Danger),
  );
}

// Step 1 — Channel select
async function showWizardStep1(interaction, session) {
  const { section } = session;
  const e = wizardEmbed(section, 1, 'Channel',
    `Choose the text channel where **${section}** messages will be sent.`,
    session.channelId ? [{ name: '📺 Current Channel', value: CHAN(session.channelId), inline: true }] : [],
  );
  const chanSelect = new ChannelSelectMenuBuilder()
    .setCustomId(`welcome:wiz:chan:${section}`)
    .setPlaceholder(`Select the ${section} channel…`)
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(1).setMaxValues(1);

  const payload = {
    embeds: [e],
    components: [
      new ActionRowBuilder().addComponents(chanSelect),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`welcome:wiz:btn:${section}:back_dash`).setLabel('Back').setEmoji('◀️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`welcome:wiz:btn:${section}:cancel`).setLabel('Cancel').setEmoji('✖️').setStyle(ButtonStyle.Danger),
      ),
    ],
  };
  if (interaction.replied || interaction.deferred) return interaction.editReply(payload);
  return interaction.reply({ ...payload, flags: 64 });
}

// Step 2 — Message
async function showWizardStep2(interaction, session) {
  const { section } = session;
  const defaultMsg = DEFAULT_MESSAGES[section];
  const current = session.message;
  const e = wizardEmbed(section, 2, 'Message',
    `Set the text message sent with the **${section}** card.\n> Supports placeholders: \`{user}\` \`{server}\` \`{memberCount}\``,
    [{ name: '💬 Current Message', value: current ? `\`${current.slice(0, 100)}${current.length > 100 ? '…' : ''}\`` : `*Default:* \`${defaultMsg}\``, inline: false }],
  );
  const payload = {
    embeds: [e],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`welcome:wiz:btn:${section}:msg`).setLabel('Set Message').setEmoji('💬').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`welcome:wiz:btn:${section}:msg_skip`).setLabel('Skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
      ),
      navRow(section, 'channel'),
    ],
  };
  if (interaction.replied || interaction.deferred) return interaction.editReply(payload);
  return interaction.reply({ ...payload, flags: 64 });
}

// Step 3 — Background image URL
async function showWizardStep3(interaction, session) {
  const { section } = session;
  const e = wizardEmbed(section, 3, 'Background Image',
    'Paste a **direct image URL** for the welcome card background.\nYou can also paste a Discord CDN link. Leave blank to use the theme default.',
    [{ name: '🖼️ Current Background', value: session.backgroundUrl ? `\`${session.backgroundUrl.slice(0, 80)}${session.backgroundUrl.length > 80 ? '…' : ''}\`` : '`Not set — theme default will be used`', inline: false }],
  );
  const payload = {
    embeds: [e],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`welcome:wiz:btn:${section}:bg`).setLabel('Set Background URL').setEmoji('🖼️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`welcome:wiz:btn:${section}:bg_skip`).setLabel('Skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
      ),
      navRow(section, 'message'),
    ],
  };
  if (interaction.replied || interaction.deferred) return interaction.editReply(payload);
  return interaction.reply({ ...payload, flags: 64 });
}

// Step 4 — Logo image URL
async function showWizardStep4(interaction, session) {
  const { section } = session;
  const e = wizardEmbed(section, 4, 'Logo Image',
    'Paste a **direct image URL** for the logo shown on the welcome card.\nLeave blank to skip.',
    [{ name: '🏷️ Current Logo', value: session.logoUrl ? `\`${session.logoUrl.slice(0, 80)}${session.logoUrl.length > 80 ? '…' : ''}\`` : '`Not set`', inline: false }],
  );
  const payload = {
    embeds: [e],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`welcome:wiz:btn:${section}:logo`).setLabel('Set Logo URL').setEmoji('🏷️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`welcome:wiz:btn:${section}:logo_skip`).setLabel('Skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
      ),
      navRow(section, 'background'),
    ],
  };
  if (interaction.replied || interaction.deferred) return interaction.editReply(payload);
  return interaction.reply({ ...payload, flags: 64 });
}

// Step 5 — Theme select
async function showWizardStep5(interaction, session) {
  const { section } = session;
  const e = wizardEmbed(section, 5, 'Theme',
    'Choose a **card theme** from the dropdown below.',
    [{ name: '🎨 Current Theme', value: `\`${THEMES[session.theme]?.label ?? session.theme}\``, inline: true }],
  );
  const themeSelect = new StringSelectMenuBuilder()
    .setCustomId(`welcome:wiz:theme:${section}`)
    .setPlaceholder('🎨 Select theme…')
    .addOptions(
      Object.entries(THEMES).map(([k, t]) => ({
        label: t.label,
        value: k,
        description: `${t.label} card style`,
        default: session.theme === k,
      })),
    );
  const payload = {
    embeds: [e],
    components: [
      new ActionRowBuilder().addComponents(themeSelect),
      navRow(section, 'logo'),
    ],
  };
  if (interaction.replied || interaction.deferred) return interaction.editReply(payload);
  return interaction.reply({ ...payload, flags: 64 });
}

// Step 6 — Mention user
async function showWizardStep6(interaction, session) {
  const { section } = session;
  const yes = session.mentionUser;
  const e = wizardEmbed(section, 6, 'Mention User',
    `Should the bot **@mention** the user when sending the ${section} message?`,
    [{ name: '🔔 Current Setting', value: yes ? '`Yes — mention`' : '`No — silent`', inline: true }],
  );
  const payload = {
    embeds: [e],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`welcome:wiz:btn:${section}:mention_yes`).setLabel('Yes — Mention').setEmoji('🔔').setStyle(yes ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`welcome:wiz:btn:${section}:mention_no`).setLabel('No — Silent').setEmoji('🔕').setStyle(!yes ? ButtonStyle.Success : ButtonStyle.Secondary),
      ),
      navRow(section, 'theme'),
    ],
  };
  if (interaction.replied || interaction.deferred) return interaction.editReply(payload);
  return interaction.reply({ ...payload, flags: 64 });
}

// Step 7 — Preview & Save
async function showWizardPreview(interaction, session) {
  const { section } = session;
  const label = SECTION_LABEL(section);
  const themeLabel = THEMES[session.theme]?.label ?? session.theme;

  const e = new EmbedBuilder()
    .setTitle(`${label} Setup — Preview & Save`)
    .setColor(THEMES[session.theme]?.accent ?? Colors.primary)
    .setDescription('Review your settings below. Click **Preview** to see the card, then **Save** when ready.')
    .addFields(
      { name: '📺 Channel',      value: CHAN(session.channelId),  inline: true },
      { name: '🎨 Theme',        value: `\`${themeLabel}\``,       inline: true },
      { name: '🔔 Mention User', value: session.mentionUser ? '`Yes`' : '`No`', inline: true },
      { name: '💬 Message',      value: session.message ? `\`${session.message.slice(0, 80)}${session.message.length > 80 ? '…' : ''}\`` : `*Default*`, inline: false },
      { name: '🖼️ Background',   value: session.backgroundUrl ? '`Set ✅`' : '`Not set — theme default`', inline: true },
      { name: '🏷️ Logo',         value: session.logoUrl ? '`Set ✅`' : '`Not set`', inline: true },
    )
    .setFooter({ text: 'Save & Enable will immediately activate on member join/leave.' })
    .setTimestamp();

  const payload = {
    embeds: [e],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`welcome:wiz:btn:${section}:preview`).setLabel('Preview Card').setEmoji('👁️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`welcome:wiz:btn:${section}:save_enable`).setLabel('Save & Enable').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`welcome:wiz:btn:${section}:save_disable`).setLabel('Save (Disabled)').setEmoji('💾').setStyle(ButtonStyle.Secondary),
      ),
      navRow(section, 'mention'),
    ],
  };
  if (interaction.replied || interaction.deferred) return interaction.editReply(payload);
  return interaction.reply({ ...payload, flags: 64 });
}

// Start wizard (called when "Setup Welcome/Goodbye" is clicked)
async function startWizard(interaction, section) {
  const existingCfg = WelcomeConfig.get(interaction.guildId)[section];
  const session = WelcomeWizardSession.create(
    interaction.guildId,
    interaction.user.id,
    section,
    existingCfg,
  );
  await interaction.deferUpdate();
  return showWizardStep1(interaction, session);
}

// Wizard modal launchers
function showMessageModal(interaction, session) {
  const { section } = session;
  const input = new TextInputBuilder()
    .setCustomId('value')
    .setLabel('Welcome / Goodbye Message')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder(DEFAULT_MESSAGES[section])
    .setMaxLength(500)
    .setRequired(false);
  if (session.message) input.setValue(session.message);
  const modal = new ModalBuilder()
    .setCustomId(`welcome:wiz:modal:${section}:message`)
    .setTitle(`${SECTION_LABEL(section)} Message`)
    .addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}

function showUrlModal(interaction, session, field) {
  const { section } = session;
  const meta = {
    backgroundUrl: { label: 'Background Image URL', placeholder: 'https://i.imgur.com/…' },
    logoUrl:       { label: 'Logo / Icon URL',       placeholder: 'https://i.imgur.com/…' },
  };
  const m = meta[field];
  const input = new TextInputBuilder()
    .setCustomId('value')
    .setLabel(m.label)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(m.placeholder)
    .setMaxLength(500)
    .setRequired(false);
  if (session[field]) input.setValue(session[field]);
  const modal = new ModalBuilder()
    .setCustomId(`welcome:wiz:modal:${section}:${field}`)
    .setTitle(`${SECTION_LABEL(section)} — ${m.label}`)
    .addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}

// Validate that a string looks like an https:// URL (basic guard against base64)
function isValidUrl(str) {
  if (!str) return true; // empty = clear/skip is fine
  return /^https?:\/\/.{4,}/.test(str) && !str.includes(' ') && str.length < 500;
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
  const type = parts[1]; // btn | wiz | chan | modal

  // ── Dashboard buttons: welcome:btn:{action}:{section} ─────────────────────
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
      // Start the step-by-step wizard
      return startWizard(interaction, section);
    }

    if (action === 'preview') return sendPreview(interaction, section);
  }

  // ── Wizard interactions: welcome:wiz:{subtype}:{section}[:{action}] ───────
  if (type === 'wiz') {
    const subtype = parts[2]; // 'chan' | 'btn' | 'theme' | 'modal'
    const section = parts[3]; // 'welcome' | 'goodbye'
    const action  = parts[4]; // varies (only for btn/modal)

    if (!isAdmin(interaction.member)) {
      return interaction.reply({ embeds: [errorEmbed('You need **Administrator** permission.')], flags: 64 });
    }

    // ── Channel select: welcome:wiz:chan:{section} ───────────────────────────
    if (subtype === 'chan') {
      const channelId = interaction.values[0];
      const session = WelcomeWizardSession.get(interaction.guildId, interaction.user.id, section);
      if (!session) {
        return interaction.reply({ embeds: [errorEmbed('Setup session expired. Run `/welcome` again.')], flags: 64 });
      }
      const updated = WelcomeWizardSession.update(interaction.guildId, interaction.user.id, section, { channelId });
      await interaction.deferUpdate();
      return showWizardStep2(interaction, updated);
    }

    // ── Theme select: welcome:wiz:theme:{section} ───────────────────────────
    if (subtype === 'theme') {
      const chosen = interaction.values[0];
      const session = WelcomeWizardSession.get(interaction.guildId, interaction.user.id, section);
      if (!session) {
        return interaction.reply({ embeds: [errorEmbed('Setup session expired. Run `/welcome` again.')], flags: 64 });
      }
      const updated = WelcomeWizardSession.update(interaction.guildId, interaction.user.id, section, { theme: chosen });
      await interaction.deferUpdate();
      return showWizardStep6(interaction, updated);
    }

    // ── Wizard buttons: welcome:wiz:btn:{section}:{action} ─────────────────
    if (subtype === 'btn') {
      const session = WelcomeWizardSession.get(interaction.guildId, interaction.user.id, section);

      if (action === 'cancel') {
        if (session) WelcomeWizardSession.delete(interaction.guildId, interaction.user.id, section);
        await interaction.deferUpdate();
        return interaction.editReply({ embeds: [embed({ description: '✖️ Setup cancelled.', color: Colors.error, timestamp: false })], components: [] });
      }

      if (!session) {
        return interaction.reply({ embeds: [errorEmbed('Setup session expired. Run `/welcome` again.')], flags: 64 });
      }

      // Back navigation
      if (action === 'back_dash') {
        WelcomeWizardSession.delete(interaction.guildId, interaction.user.id, section);
        await interaction.deferUpdate();
        return showWelcomeDashboard(interaction);
      }
      if (action === 'back_channel')    { await interaction.deferUpdate(); return showWizardStep1(interaction, session); }
      if (action === 'back_message')    { await interaction.deferUpdate(); return showWizardStep2(interaction, session); }
      if (action === 'back_background') { await interaction.deferUpdate(); return showWizardStep3(interaction, session); }
      if (action === 'back_logo')       { await interaction.deferUpdate(); return showWizardStep4(interaction, session); }
      if (action === 'back_theme')      { await interaction.deferUpdate(); return showWizardStep5(interaction, session); }
      if (action === 'back_mention')    { await interaction.deferUpdate(); return showWizardStep6(interaction, session); }

      // Open modals (must NOT defer before showModal)
      if (action === 'msg')  return showMessageModal(interaction, session);
      if (action === 'bg')   return showUrlModal(interaction, session, 'backgroundUrl');
      if (action === 'logo') return showUrlModal(interaction, session, 'logoUrl');

      // Skip buttons — advance without changing value
      if (action === 'msg_skip')  { await interaction.deferUpdate(); return showWizardStep3(interaction, session); }
      if (action === 'bg_skip')   { await interaction.deferUpdate(); return showWizardStep4(interaction, session); }
      if (action === 'logo_skip') { await interaction.deferUpdate(); return showWizardStep5(interaction, session); }

      // Mention choice
      if (action === 'mention_yes') {
        WelcomeWizardSession.update(interaction.guildId, interaction.user.id, section, { mentionUser: true });
        await interaction.deferUpdate();
        return showWizardPreview(interaction, WelcomeWizardSession.get(interaction.guildId, interaction.user.id, section));
      }
      if (action === 'mention_no') {
        WelcomeWizardSession.update(interaction.guildId, interaction.user.id, section, { mentionUser: false });
        await interaction.deferUpdate();
        return showWizardPreview(interaction, WelcomeWizardSession.get(interaction.guildId, interaction.user.id, section));
      }

      // Preview card (generates card as ephemeral followUp)
      if (action === 'preview') {
        await interaction.deferReply({ flags: 64 });
        const fakeMember = {
          user:  interaction.user,
          guild: interaction.guild,
          toString() { return `<@${interaction.user.id}>`; },
        };
        try {
          const previewCfg = {
            channelId:     session.channelId,
            message:       session.message,
            backgroundUrl: session.backgroundUrl,
            logoUrl:       session.logoUrl,
            theme:         session.theme,
            mentionUser:   session.mentionUser,
            enabled:       true,
          };
          const payload = await buildWelcomePayload({ member: fakeMember, config: previewCfg, section });
          return interaction.editReply({ ...payload, content: `**Preview (${section}):** ${payload.content ?? ''}`.trim() });
        } catch (err) {
          logger.error('Welcome wizard preview failed', err);
          return interaction.editReply({ embeds: [errorEmbed('Preview failed. Check your image URLs and try again.')] });
        }
      }

      // Save
      if (action === 'save_enable' || action === 'save_disable') {
        if (!session.channelId) {
          return interaction.reply({ embeds: [errorEmbed('Please set a channel first (Step 1).')], flags: 64 });
        }
        WelcomeConfig.updateSection(interaction.guildId, section, {
          channelId:     session.channelId,
          message:       session.message   || null,
          backgroundUrl: session.backgroundUrl || null,
          logoUrl:       session.logoUrl   || null,
          theme:         session.theme,
          mentionUser:   session.mentionUser,
          enabled:       action === 'save_enable',
        });
        WelcomeWizardSession.delete(interaction.guildId, interaction.user.id, section);
        await interaction.deferUpdate();
        logger.info(`Welcome wizard saved [${section}] for guild ${interaction.guildId}`);
        return showWelcomeDashboard(interaction);
      }
    }

    // ── Wizard modal submissions: welcome:wiz:modal:{section}:{field} ───────
    if (subtype === 'modal') {
      const field = action; // message | backgroundUrl | logoUrl
      const raw   = interaction.fields.getTextInputValue('value')?.trim() || null;

      if (field !== 'message' && raw && !isValidUrl(raw)) {
        return interaction.reply({ embeds: [errorEmbed('Please enter a valid image URL starting with `https://`.')], flags: 64 });
      }

      const session = WelcomeWizardSession.get(interaction.guildId, interaction.user.id, section);
      if (!session) {
        return interaction.reply({ embeds: [errorEmbed('Setup session expired. Run `/welcome` again.')], flags: 64 });
      }
      WelcomeWizardSession.update(interaction.guildId, interaction.user.id, section, { [field]: raw || null });
      const updatedSession = WelcomeWizardSession.get(interaction.guildId, interaction.user.id, section);
      await interaction.deferUpdate();
      if (field === 'message')       return showWizardStep3(interaction, updatedSession);
      if (field === 'backgroundUrl') return showWizardStep4(interaction, updatedSession);
      if (field === 'logoUrl')       return showWizardStep5(interaction, updatedSession);
    }
  }
}
