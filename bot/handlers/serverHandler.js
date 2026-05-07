import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { createCipheriv, createHash, randomBytes } from 'crypto';
import { ServerProvision } from '../storage/ServerProvision.js';
import { embed, Colors, errorEmbed } from '../utils/embeds.js';
import { isAdmin } from '../utils/permissions.js';

const setupSessions = new Map();

const PROVIDERS = [
  { label: 'Pterodactyl', value: 'pterodactyl', description: 'Official Application API only' },
  { label: 'Pelican', value: 'pelican', description: 'Official panel API only' },
  { label: 'WISP', value: 'wisp', description: 'Official API endpoint only' },
  { label: 'Custom API', value: 'custom', description: 'Admin-owned official API with token' },
];

function setupKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function getProviderLabel(value) {
  return PROVIDERS.find((p) => p.value === value)?.label ?? 'Unknown';
}

function getSession(guildId, userId) {
  return setupSessions.get(setupKey(guildId, userId)) ?? null;
}

function upsertSession(guildId, userId) {
  const existing = getSession(guildId, userId);
  if (existing) return existing;
  const session = {
    guildId,
    userId,
    step: 1,
    provider: null,
    baseUrl: '',
    apiKey: '',
    nodeLocation: '',
    eggTemplate: '',
    limits: { ramMb: 4096, cpuPercent: 100, diskMb: 10240 },
    serverNameFormat: '{username}-minecraft',
    inviteRequirement: 0,
    cooldownHours: 24,
    maxServersPerUser: 1,
    lastApiTest: null,
  };
  setupSessions.set(setupKey(guildId, userId), session);
  return session;
}

function clearSession(guildId, userId) {
  setupSessions.delete(setupKey(guildId, userId));
}

function maskSecret(value) {
  if (!value) return '`Not set`';
  if (value.length <= 4) return '`****`';
  return `\`****${value.slice(-4)}\``;
}

function normalizeUrl(raw) {
  try {
    const parsed = new URL(raw.trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.href.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function parseNonNegativeInt(raw, fallback = 0) {
  const n = Number.parseInt(String(raw).trim(), 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(0, n);
}

function getSecretKey() {
  const secret = process.env.SERVER_PANEL_SECRET?.trim();
  if (!secret) return null;
  return createHash('sha256').update(secret).digest();
}

function encryptApiKey(apiKey) {
  const key = getSecretKey();
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

async function testPanelApi(session) {
  if (!session.baseUrl || !session.apiKey) {
    return { ok: false, message: 'Base URL and API token must be set first.', checkedAt: new Date().toISOString() };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const endpoint = ['pterodactyl', 'pelican', 'wisp'].includes(session.provider)
      ? `${session.baseUrl}/api/application/nodes`
      : session.baseUrl;
    const res = await fetch(endpoint, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${session.apiKey}`,
        'User-Agent': 'Mr-Manager/ServerSetup',
      },
    });
    if (res.ok) {
      return { ok: true, status: res.status, message: `Connection successful (${res.status}).`, checkedAt: new Date().toISOString() };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, message: 'API token was rejected by the provider.', checkedAt: new Date().toISOString() };
    }
    return { ok: false, status: res.status, message: `Provider responded with HTTP ${res.status}.`, checkedAt: new Date().toISOString() };
  } catch (err) {
    return {
      ok: false,
      message: err?.name === 'AbortError' ? 'API test timed out.' : 'Failed to reach API endpoint.',
      checkedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timer);
  }
}

function buildSetupEmbed(session) {
  if (session.step === 10) {
    return embed({
      title: '🧪 Step 10/11 — Preview Configuration',
      color: Colors.info,
      description:
        'Review settings, test API connection, then save.\n' +
        'Only official admin-owned APIs are allowed. Password scraping is not supported.',
      fields: [
        { name: 'Provider', value: `\`${getProviderLabel(session.provider)}\``, inline: true },
        { name: 'Base URL', value: `\`${session.baseUrl || 'Not set'}\``, inline: false },
        { name: 'API Token', value: maskSecret(session.apiKey), inline: true },
        { name: 'Node/Location', value: `\`${session.nodeLocation || 'Not set'}\``, inline: true },
        { name: 'Egg/Template', value: `\`${session.eggTemplate || 'Not set'}\``, inline: true },
        { name: 'RAM / CPU / Disk', value: `\`${session.limits.ramMb}MB / ${session.limits.cpuPercent}% / ${session.limits.diskMb}MB\``, inline: false },
        { name: 'Server Name Format', value: `\`${session.serverNameFormat}\``, inline: false },
        { name: 'Invite Requirement', value: `\`${session.inviteRequirement}\``, inline: true },
        { name: 'Cooldown / Max per User', value: `\`${session.cooldownHours}h / ${session.maxServersPerUser}\``, inline: true },
        {
          name: 'API Test',
          value: session.lastApiTest ? `${session.lastApiTest.ok ? '✅' : '❌'} ${session.lastApiTest.message}` : '`Not tested yet`',
          inline: false,
        },
      ],
    });
  }

  const stepText = {
    1: 'Select panel/API provider.',
    2: 'Enter API base URL.',
    3: 'Enter API key/token.',
    4: 'Set node/location.',
    5: 'Set Minecraft egg/template.',
    6: 'Set RAM/CPU/Disk limits.',
    7: 'Set server name format.',
    8: 'Set invite requirement.',
    9: 'Set cooldown and max servers per user.',
  };

  return embed({
    title: `⚙️ Step ${session.step}/11 — Panel Setup`,
    color: Colors.primary,
    description: `${stepText[session.step] ?? 'Continue setup.'}\n\nSafety: official APIs only, no passwords, no scraping.`,
    fields: [
      { name: 'Provider', value: `\`${session.provider ? getProviderLabel(session.provider) : 'Not set'}\``, inline: true },
      { name: 'Base URL', value: `\`${session.baseUrl || 'Not set'}\``, inline: true },
      { name: 'API Token', value: maskSecret(session.apiKey), inline: true },
    ],
  });
}

function buildSetupComponents(session) {
  if (session.step === 1) {
    return [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('server:menu:provider')
          .setPlaceholder('Select API provider')
          .addOptions(PROVIDERS),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('server:btn:wiz_cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger),
      ),
    ];
  }

  if (session.step === 10) {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('server:btn:wiz_test').setLabel('Test API').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('server:btn:wiz_save').setLabel('Save Setup').setStyle(ButtonStyle.Success).setDisabled(!session.lastApiTest?.ok),
        new ButtonBuilder().setCustomId('server:btn:wiz_back').setLabel('Back').setStyle(ButtonStyle.Secondary),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('server:btn:wiz_cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger),
      ),
    ];
  }

  const fieldByStep = {
    2: 'baseurl',
    3: 'apikey',
    4: 'node',
    5: 'egg',
    6: 'limits',
    7: 'nameformat',
    8: 'invite',
    9: 'cooldownmax',
  };

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`server:btn:wiz_modal:${fieldByStep[session.step]}`).setLabel('Enter Value').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('server:btn:wiz_back').setLabel('Back').setStyle(ButtonStyle.Secondary).setDisabled(session.step <= 1),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('server:btn:wiz_cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger),
    ),
  ];
}

function setupPayload(session) {
  return { embeds: [buildSetupEmbed(session)], components: buildSetupComponents(session) };
}

function buildSimpleModal(customId, title, label, placeholder, value = '', maxLength = 200) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title);
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('value')
        .setLabel(label)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder(placeholder)
        .setValue(value)
        .setMaxLength(maxLength),
    ),
  );
  return modal;
}

function buildModalForField(session, field) {
  if (field === 'baseurl') return buildSimpleModal('server:modal:baseurl', 'API Base URL', 'Enter API base URL', 'https://panel.example.com', session.baseUrl, 300);
  if (field === 'apikey') return buildSimpleModal('server:modal:apikey', 'API Token', 'Enter API key/token', 'ptla_xxxxxxxxx', '', 300);
  if (field === 'node') return buildSimpleModal('server:modal:node', 'Node / Location', 'Enter node/location', 'node-1 or us-east', session.nodeLocation, 80);
  if (field === 'egg') return buildSimpleModal('server:modal:egg', 'Minecraft Egg/Template', 'Enter egg/template', 'minecraft-java', session.eggTemplate, 80);
  if (field === 'nameformat') return buildSimpleModal('server:modal:nameformat', 'Server Name Format', 'Enter naming format', '{username}-minecraft', session.serverNameFormat, 80);
  if (field === 'invite') return buildSimpleModal('server:modal:invite', 'Invite Requirement', 'Invites required', '0', String(session.inviteRequirement), 6);

  if (field === 'limits') {
    const modal = new ModalBuilder().setCustomId('server:modal:limits').setTitle('Resource Limits');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ram').setLabel('RAM MB').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(session.limits.ramMb)).setMaxLength(8)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cpu').setLabel('CPU %').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(session.limits.cpuPercent)).setMaxLength(4)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('disk').setLabel('Disk MB').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(session.limits.diskMb)).setMaxLength(8)),
    );
    return modal;
  }

  if (field === 'cooldownmax') {
    const modal = new ModalBuilder().setCustomId('server:modal:cooldownmax').setTitle('Cooldown & Max Servers');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cooldown').setLabel('Cooldown Hours').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(session.cooldownHours)).setMaxLength(5)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('maxservers').setLabel('Max Servers Per User').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(session.maxServersPerUser)).setMaxLength(5)),
    );
    return modal;
  }

  return null;
}

function buildDashboard(guildId, userId, isUserAdmin) {
  const data = ServerProvision.ensureGuild(guildId);
  const userServers = data.createdServerRecords?.[userId] ?? [];
  const userClaim = data.userClaims?.[userId] ?? null;
  const panelSetup = data.panelSetup ?? null;

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('server:btn:setup')
      .setLabel('Setup Panel')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!isUserAdmin),
    new ButtonBuilder()
      .setCustomId('server:btn:create')
      .setLabel('Create Server')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('server:btn:rewards')
      .setLabel('Invite Rewards')
      .setStyle(ButtonStyle.Secondary),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('server:btn:my')
      .setLabel('My Server')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('server:btn:admin')
      .setLabel('Admin Controls')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!isUserAdmin),
    new ButtonBuilder()
      .setCustomId('server:btn:cancel')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Danger),
  );

  return {
    embeds: [embed({
      title: '🧭 Minecraft Server Dashboard',
      color: Colors.primary,
      description: 'Choose an option below to manage base server provisioning.',
      fields: [
        {
          name: 'Panel Config',
          value: panelSetup
            ? `Configured (\`${panelSetup.providerLabel ?? panelSetup.provider}\` • \`${panelSetup.nodeLocation}\`)`
            : 'Not configured',
          inline: true,
        },
        { name: 'Invite Requirement', value: String(panelSetup?.inviteRequirement ?? data.inviteRequirement ?? 0), inline: true },
        { name: 'My Claims', value: userClaim ? `Used: ${userClaim.claimCount ?? 0}` : 'None yet', inline: true },
        { name: 'My Servers', value: String(userServers.length), inline: true },
      ],
    })],
    components: [row1, row2],
  };
}

export async function showServerDashboard(interaction) {
  const isUserAdmin = isAdmin(interaction.member);
  const payload = buildDashboard(interaction.guildId, interaction.user.id, isUserAdmin);
  if (interaction.replied || interaction.deferred) return interaction.editReply(payload);
  return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

export async function handleServerInteraction(interaction, parts) {
  const type = parts[1];
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const admin = isAdmin(interaction.member);

  if (interaction.isButton()) {
    const action = parts[2];
    const extra = parts[3];

    if (action === 'cancel') {
      await interaction.deferUpdate();
      return interaction.editReply({
        embeds: [embed({ description: '✖️ Server dashboard closed.', color: Colors.error, timestamp: false })],
        components: [],
      });
    }

    if (action === 'setup') {
      if (!admin) {
        return interaction.reply({ embeds: [errorEmbed('You need **Administrator** permission for this control.')], flags: MessageFlags.Ephemeral });
      }
      const session = upsertSession(guildId, userId);
      session.step = 1;
      return interaction.update(setupPayload(session));
    }

    if (action === 'admin') {
      if (!admin) {
        return interaction.reply({ embeds: [errorEmbed('You need **Administrator** permission for this control.')], flags: MessageFlags.Ephemeral });
      }
      await interaction.deferUpdate();
      return interaction.followUp({
        embeds: [embed({
          title: '🛠️ Admin Controls',
          description: 'Use **Setup Panel** to configure provider, limits, invite gating, and quotas.',
          color: Colors.info,
        })],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (action === 'create') {
      ServerProvision.ensureUserClaim(guildId, userId);
      ServerProvision.ensureUserServers(guildId, userId);
      ServerProvision.ensureUserCooldowns(guildId, userId);
      await interaction.deferUpdate();
      return interaction.followUp({
        embeds: [embed({
          title: '🆕 Create Server',
          description: 'Base flow initialized. API provisioning is intentionally disabled in this phase.',
          color: Colors.success,
        })],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (action === 'rewards') {
      ServerProvision.ensureUserClaim(guildId, userId);
      await interaction.deferUpdate();
      return interaction.followUp({
        embeds: [embed({
          title: '🎁 Invite Rewards',
          description: 'Reward claim scaffolding is ready. Invite reward validation will be added later.',
          color: Colors.info,
        })],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (action === 'my') {
      const servers = ServerProvision.ensureUserServers(guildId, userId);
      ServerProvision.ensureUserCooldowns(guildId, userId);
      await interaction.deferUpdate();
      return interaction.followUp({
        embeds: [embed({
          title: '🖥️ My Servers',
          description: `You currently have **${servers.length}** recorded server(s).`,
          color: Colors.info,
        })],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (action === 'wiz_cancel') {
      clearSession(guildId, userId);
      await interaction.deferUpdate();
      return showServerDashboard(interaction);
    }

    const session = getSession(guildId, userId);
    if (!session) {
      return interaction.reply({ embeds: [errorEmbed('Setup session expired. Click **Setup Panel** again.')], flags: MessageFlags.Ephemeral });
    }
    if (!admin) {
      return interaction.reply({ embeds: [errorEmbed('Only administrators can modify setup.')], flags: MessageFlags.Ephemeral });
    }

    if (action === 'wiz_back') {
      session.step = Math.max(1, session.step - 1);
      return interaction.update(setupPayload(session));
    }

    if (action === 'wiz_modal') {
      const modal = buildModalForField(session, extra);
      if (!modal) return interaction.reply({ embeds: [errorEmbed('Invalid setup action.')], flags: MessageFlags.Ephemeral });
      return interaction.showModal(modal);
    }

    if (action === 'wiz_test') {
      await interaction.deferUpdate();
      session.lastApiTest = await testPanelApi(session);
      return interaction.editReply(setupPayload(session));
    }

    if (action === 'wiz_save') {
      if (session.step !== 10) {
        return interaction.reply({ embeds: [errorEmbed('Complete all setup steps before saving.')], flags: MessageFlags.Ephemeral });
      }
      if (!session.lastApiTest?.ok) {
        return interaction.reply({ embeds: [errorEmbed('Run a successful **Test API** before saving.')], flags: MessageFlags.Ephemeral });
      }

      const encrypted = encryptApiKey(session.apiKey);
      if (!encrypted) {
        return interaction.reply({
          embeds: [errorEmbed('Missing `SERVER_PANEL_SECRET` env. Cannot securely store API token.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      ServerProvision.updateGuild(guildId, {
        panelConfigRef: `${session.provider}:${session.nodeLocation}`,
        inviteRequirement: session.inviteRequirement,
        panelSetup: {
          provider: session.provider,
          providerLabel: getProviderLabel(session.provider),
          baseUrl: session.baseUrl,
          apiKeyEncrypted: encrypted.ciphertext,
          apiKeyIv: encrypted.iv,
          apiKeyTag: encrypted.tag,
          nodeLocation: session.nodeLocation,
          eggTemplate: session.eggTemplate,
          limits: session.limits,
          serverNameFormat: session.serverNameFormat,
          inviteRequirement: session.inviteRequirement,
          cooldownHours: session.cooldownHours,
          maxServersPerUser: session.maxServersPerUser,
          testedAt: session.lastApiTest.checkedAt,
          updatedAt: new Date().toISOString(),
          updatedBy: userId,
        },
      });

      clearSession(guildId, userId);
      return interaction.update({
        embeds: [embed({
          title: '✅ Step 11/11 — Setup Saved',
          description: 'Panel API setup saved successfully and will persist across restarts.',
          color: Colors.success,
          fields: [
            { name: 'Provider', value: `\`${getProviderLabel(session.provider)}\``, inline: true },
            { name: 'Node', value: `\`${session.nodeLocation}\``, inline: true },
            { name: 'Egg', value: `\`${session.eggTemplate}\``, inline: true },
          ],
        })],
        components: [],
      });
    }

    return interaction.deferUpdate();
  }

  if (interaction.isStringSelectMenu()) {
    if (type !== 'menu' || parts[2] !== 'provider') return interaction.deferUpdate();
    if (!admin) {
      return interaction.reply({ embeds: [errorEmbed('Only administrators can modify setup.')], flags: MessageFlags.Ephemeral });
    }
    const session = upsertSession(guildId, userId);
    session.provider = interaction.values[0];
    session.step = 2;
    session.lastApiTest = null;
    return interaction.update(setupPayload(session));
  }

  if (interaction.isModalSubmit()) {
    if (type !== 'modal') return;
    const field = parts[2];
    const session = getSession(guildId, userId);
    if (!session) {
      return interaction.reply({ embeds: [errorEmbed('Setup session expired. Click **Setup Panel** again.')], flags: MessageFlags.Ephemeral });
    }
    if (!admin) {
      return interaction.reply({ embeds: [errorEmbed('Only administrators can modify setup.')], flags: MessageFlags.Ephemeral });
    }

    if (field === 'baseurl') {
      const value = normalizeUrl(interaction.fields.getTextInputValue('value'));
      if (!value) {
        return interaction.reply({ embeds: [errorEmbed('Invalid URL. Use full `http(s)://` API base URL.')], flags: MessageFlags.Ephemeral });
      }
      session.baseUrl = value;
      session.step = 3;
      session.lastApiTest = null;
      return interaction.reply({ ...setupPayload(session), flags: MessageFlags.Ephemeral });
    }

    if (field === 'apikey') {
      const value = interaction.fields.getTextInputValue('value').trim();
      if (value.length < 8) {
        return interaction.reply({ embeds: [errorEmbed('API token looks too short.')], flags: MessageFlags.Ephemeral });
      }
      session.apiKey = value;
      session.step = 4;
      session.lastApiTest = null;
      return interaction.reply({ ...setupPayload(session), flags: MessageFlags.Ephemeral });
    }

    if (field === 'node') {
      session.nodeLocation = interaction.fields.getTextInputValue('value').trim().slice(0, 80);
      session.step = 5;
      return interaction.reply({ ...setupPayload(session), flags: MessageFlags.Ephemeral });
    }

    if (field === 'egg') {
      session.eggTemplate = interaction.fields.getTextInputValue('value').trim().slice(0, 80);
      session.step = 6;
      return interaction.reply({ ...setupPayload(session), flags: MessageFlags.Ephemeral });
    }

    if (field === 'limits') {
      const ramMb = parseNonNegativeInt(interaction.fields.getTextInputValue('ram'));
      const cpuPercent = parseNonNegativeInt(interaction.fields.getTextInputValue('cpu'));
      const diskMb = parseNonNegativeInt(interaction.fields.getTextInputValue('disk'));
      if (ramMb <= 0 || cpuPercent <= 0 || diskMb <= 0) {
        return interaction.reply({ embeds: [errorEmbed('RAM, CPU, and Disk must be greater than 0.')], flags: MessageFlags.Ephemeral });
      }
      session.limits = { ramMb, cpuPercent, diskMb };
      session.step = 7;
      return interaction.reply({ ...setupPayload(session), flags: MessageFlags.Ephemeral });
    }

    if (field === 'nameformat') {
      const value = interaction.fields.getTextInputValue('value').trim().slice(0, 80);
      if (!value) {
        return interaction.reply({ embeds: [errorEmbed('Server name format cannot be empty.')], flags: MessageFlags.Ephemeral });
      }
      session.serverNameFormat = value;
      session.step = 8;
      return interaction.reply({ ...setupPayload(session), flags: MessageFlags.Ephemeral });
    }

    if (field === 'invite') {
      session.inviteRequirement = parseNonNegativeInt(interaction.fields.getTextInputValue('value'));
      session.step = 9;
      return interaction.reply({ ...setupPayload(session), flags: MessageFlags.Ephemeral });
    }

    if (field === 'cooldownmax') {
      const cooldownHours = parseNonNegativeInt(interaction.fields.getTextInputValue('cooldown'));
      const maxServersPerUser = Math.max(1, parseNonNegativeInt(interaction.fields.getTextInputValue('maxservers'), 1));
      session.cooldownHours = cooldownHours;
      session.maxServersPerUser = maxServersPerUser;
      session.step = 10;
      session.lastApiTest = null;
      return interaction.reply({ ...setupPayload(session), flags: MessageFlags.Ephemeral });
    }
  }

  if (type !== 'btn') return interaction.deferUpdate();
  return interaction.deferUpdate();
}
