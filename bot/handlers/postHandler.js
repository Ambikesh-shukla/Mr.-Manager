import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder } from 'discord.js';
import { Colors, errorEmbed, successEmbed } from '../utils/embeds.js';
import { PostEmbedSession } from '../storage/PostEmbedSession.js';

const STEPS = [
  { key: 'title', label: 'Title', max: 256 },
  { key: 'description', label: 'Description', max: 4096 },
  { key: 'color', label: 'Color', max: 7 },
  { key: 'image', label: 'Image URL or attachment', max: 2000 },
  { key: 'thumbnail', label: 'Thumbnail URL or attachment', max: 2000 },
  { key: 'footer', label: 'Footer', max: 2048 },
  { key: 'targetChannelId', label: 'Target channel', max: 30 },
];

function dashboardComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('post:embed:start').setLabel('Start').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('post:embed:preview').setLabel('Preview').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('post:embed:publish').setLabel('Publish').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('post:embed:cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger),
    ),
  ];
}

function waitingComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('post:embed:cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger),
    ),
  ];
}

function normalizeHexColor(input) {
  const cleaned = input.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return null;
  return `#${cleaned.toUpperCase()}`;
}

function looksLikeHttpUrl(raw) {
  if (!raw || raw.startsWith('data:')) return false;
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function getImageUrlFromMessage(message) {
  const attachment = message.attachments.find(att => att.contentType?.startsWith('image/')) ?? null;
  if (attachment) return attachment.url;
  const raw = message.content.trim();
  if (!raw) return null;
  if (['skip', 'none', 'clear'].includes(raw.toLowerCase())) return '';
  if (!looksLikeHttpUrl(raw)) return null;
  return raw;
}

async function resolveTargetChannelId(message) {
  const mentioned = message.mentions.channels.find(ch => ch.type === ChannelType.GuildText) ?? null;
  if (mentioned) return mentioned.id;

  const raw = message.content.trim();
  const mentionMatch = raw.match(/^<#(\d+)>$/);
  const id = mentionMatch?.[1] ?? (/^\d+$/.test(raw) ? raw : null);
  if (!id) return null;

  const channel = await message.guild.channels.fetch(id).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) return null;
  return channel.id;
}

function currentStepMeta(step) {
  const idx = STEPS.findIndex(s => s.key === step);
  if (idx < 0) return null;
  return { ...STEPS[idx], index: idx };
}

function nextStep(current) {
  const idx = STEPS.findIndex(s => s.key === current);
  if (idx < 0 || idx + 1 >= STEPS.length) return null;
  return STEPS[idx + 1].key;
}

function buildWizardDashboardEmbed(session) {
  return new EmbedBuilder()
    .setTitle('🧩 Post Embed Wizard')
    .setColor(Colors.primary)
    .setDescription(
      'Use the buttons to build your embed.\n\n' +
      '> **Start** — begin step-by-step setup\n' +
      '> **Preview** — view final embed\n' +
      '> **Publish** — send to selected channel\n' +
      '> **Cancel** — discard this setup'
    )
    .addFields(
      { name: 'Title', value: session.title ? '`Set`' : '`Not set`', inline: true },
      { name: 'Description', value: session.description ? '`Set`' : '`Not set`', inline: true },
      { name: 'Color', value: `\`${session.color || '#5865F2'}\``, inline: true },
      { name: 'Image', value: session.image ? '`Set`' : '`Not set`', inline: true },
      { name: 'Thumbnail', value: session.thumbnail ? '`Set`' : '`Not set`', inline: true },
      { name: 'Footer', value: session.footer ? '`Set`' : '`Not set`', inline: true },
      { name: 'Target Channel', value: session.targetChannelId ? `<#${session.targetChannelId}>` : '`Not set`', inline: false },
    )
    .setFooter({ text: 'Only the command user can answer setup steps • Session timeout: 2 min inactivity' })
    .setTimestamp();
}

function buildStepEmbed(stepKey) {
  const meta = currentStepMeta(stepKey);
  if (!meta) {
    return new EmbedBuilder()
      .setTitle('🧩 Post Embed Wizard')
      .setColor(Colors.primary)
      .setDescription('Use Start to begin.');
  }

  const prompts = {
    title: 'Type the embed **title** as a normal chat message.',
    description: 'Type the embed **description** as a normal chat message.',
    color: 'Type a hex color like `#5865F2`.',
    image: 'Send an image **URL** or upload an **image attachment**. Type `skip` to leave empty.',
    thumbnail: 'Send a thumbnail **URL** or upload an **image attachment**. Type `skip` to leave empty.',
    footer: 'Type the embed **footer** as a normal chat message. Type `skip` to leave empty.',
    targetChannelId: 'Mention a text channel (example: `#general`) or send a channel ID.',
  };

  return new EmbedBuilder()
    .setTitle(`🧩 Step ${meta.index + 1}/${STEPS.length} — ${meta.label}`)
    .setColor(Colors.primary)
    .setDescription(`${prompts[stepKey]}\n\n⏳ Waiting for your next message...`)
    .setFooter({ text: 'Only your next message will be used for this step' })
    .setTimestamp();
}

function buildFinalEmbed(session) {
  const colorInt = parseInt((session.color ?? '#5865F2').replace('#', ''), 16) || Colors.primary;
  const out = new EmbedBuilder()
    .setColor(colorInt)
    .setTitle(session.title ?? 'Untitled Embed')
    .setDescription(session.description ?? 'No description provided');

  if (session.image) out.setImage(session.image);
  if (session.thumbnail) out.setThumbnail(session.thumbnail);
  if (session.footer) out.setFooter({ text: session.footer });
  return out;
}

async function updateOriginalWizardMessage(session, payload) {
  if (!session?.webhook) return;
  try {
    await session.webhook.editMessage('@original', payload);
  } catch {}
}

async function respondWithDashboard(interaction, session) {
  const payload = { embeds: [buildWizardDashboardEmbed(session)], components: dashboardComponents(), flags: 64 };
  if (interaction.replied || interaction.deferred) return interaction.editReply(payload);
  return interaction.reply(payload);
}

function getOrCreateSession(guildId, userId) {
  return PostEmbedSession.get(guildId, userId) ?? PostEmbedSession.create(guildId, userId);
}

export async function openPostEmbedWizard(interaction) {
  if (!interaction.guildId) {
    return interaction.reply({ embeds: [errorEmbed('This command can only be used in a server.')], flags: 64 });
  }
  const session = getOrCreateSession(interaction.guildId, interaction.user.id);
  return respondWithDashboard(interaction, session);
}

export async function handlePostEmbedButton(interaction, parts) {
  if (parts[1] !== 'embed') return interaction.deferUpdate();
  const action = parts[2];
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  let session = PostEmbedSession.get(guildId, userId);

  if (!session && action !== 'start') {
    return interaction.reply({ embeds: [errorEmbed('Post embed session expired. Run `/post embed` again.')], flags: 64 });
  }
  if (!session) session = PostEmbedSession.create(guildId, userId);

  if (action === 'cancel') {
    PostEmbedSession.delete(guildId, userId);
    return interaction.update({
      embeds: [successEmbed('Cancelled', 'Embed setup cancelled. No embed was published.')],
      components: [],
    });
  }

  if (action === 'start') {
    PostEmbedSession.resetDraft(guildId, userId);
    PostEmbedSession.update(guildId, userId, {
      step: 'title',
      inputChannelId: interaction.channelId,
      webhook: interaction.webhook,
    });
    session = PostEmbedSession.get(guildId, userId);
    return interaction.update({
      embeds: [buildStepEmbed('title')],
      components: waitingComponents(),
    });
  }

  if (action === 'preview') {
    return interaction.reply({
      embeds: [buildFinalEmbed(session)],
      flags: 64,
    });
  }

  if (action === 'publish') {
    if (!session.targetChannelId) {
      return interaction.reply({ embeds: [errorEmbed('Set the target channel first by running **Start** and completing all steps.')], flags: 64 });
    }
    const target = await interaction.guild.channels.fetch(session.targetChannelId).catch(() => null);
    if (!target || target.type !== ChannelType.GuildText) {
      return interaction.reply({ embeds: [errorEmbed('Target channel is invalid or no longer exists.')], flags: 64 });
    }
    try {
      await target.send({ embeds: [buildFinalEmbed(session)] });
      return interaction.reply({ embeds: [successEmbed('Published', `Embed sent to <#${target.id}>.`)], flags: 64 });
    } catch {
      return interaction.reply({ embeds: [errorEmbed('Failed to publish embed. Check bot send/embed permissions in that channel.')], flags: 64 });
    }
  }

  return interaction.deferUpdate();
}

export async function handlePostEmbedWizardMessage(message, session) {
  const step = session.step;
  if (!step) return;

  const raw = message.content;
  const rawTrim = raw.trim();
  const max = currentStepMeta(step)?.max ?? 2000;

  if (step === 'title') {
    if (!rawTrim) return message.reply({ embeds: [errorEmbed('Title cannot be empty. Please send the title again.')] });
    PostEmbedSession.update(session.guildId, session.userId, {
      title: raw.slice(0, max),
      step: nextStep(step),
    });
  } else if (step === 'description') {
    if (!rawTrim) return message.reply({ embeds: [errorEmbed('Description cannot be empty. Please send the description again.')] });
    PostEmbedSession.update(session.guildId, session.userId, {
      description: raw.slice(0, max),
      step: nextStep(step),
    });
  } else if (step === 'color') {
    const normalized = normalizeHexColor(rawTrim);
    if (!normalized) return message.reply({ embeds: [errorEmbed('Invalid color. Use a 6-digit hex code like `#5865F2`.')] });
    PostEmbedSession.update(session.guildId, session.userId, {
      color: normalized,
      step: nextStep(step),
    });
  } else if (step === 'image' || step === 'thumbnail') {
    const value = getImageUrlFromMessage(message);
    if (value === null) {
      return message.reply({
        embeds: [errorEmbed(`Invalid ${step} input. Send a valid image URL or image attachment, or type \`skip\`.`)],
      });
    }
    PostEmbedSession.update(session.guildId, session.userId, {
      [step]: value || null,
      step: nextStep(step),
    });
  } else if (step === 'footer') {
    const isSkip = ['skip', 'none', 'clear'].includes(rawTrim.toLowerCase());
    PostEmbedSession.update(session.guildId, session.userId, {
      footer: isSkip ? null : raw.slice(0, max),
      step: nextStep(step),
    });
  } else if (step === 'targetChannelId') {
    const channelId = await resolveTargetChannelId(message);
    if (!channelId) {
      return message.reply({ embeds: [errorEmbed('Invalid channel. Mention a text channel like `#general` or provide a channel ID.')] });
    }
    PostEmbedSession.update(session.guildId, session.userId, {
      targetChannelId: channelId,
      step: null,
      inputChannelId: null,
    });
  }

  const updated = PostEmbedSession.get(session.guildId, session.userId);
  if (!updated) return;

  if (!updated.step) {
    await updateOriginalWizardMessage(updated, {
      embeds: [buildWizardDashboardEmbed(updated)],
      components: dashboardComponents(),
    });
    return;
  }

  await updateOriginalWizardMessage(updated, {
    embeds: [buildStepEmbed(updated.step)],
    components: waitingComponents(),
  });
}

