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
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'crypto';
import { ServerProvision } from '../storage/ServerProvision.js';
import { embed, Colors, errorEmbed } from '../utils/embeds.js';
import { isAdmin } from '../utils/permissions.js';
import { GuildConfig } from '../storage/GuildConfig.js';
import { logger } from '../utils/logger.js';

const setupSessions = new Map();
const pendingProvisionClaims = new Set();
const API_TEST_TIMEOUT_MS = 10_000;
const MS_PER_HOUR = 3_600_000;
const MIN_API_TOKEN_LENGTH = 8;
const TOTAL_SETUP_STEPS = 11;

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

function decryptApiKey(panelSetup) {
  const key = getSecretKey();
  if (!key || !panelSetup?.apiKeyEncrypted || !panelSetup?.apiKeyIv || !panelSetup?.apiKeyTag) return null;
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(panelSetup.apiKeyIv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(panelSetup.apiKeyTag, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(panelSetup.apiKeyEncrypted, 'base64')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

function getApiKey(panelSetup) {
  const decrypted = decryptApiKey(panelSetup);
  if (decrypted) return decrypted;
  // Fallback: unencrypted token stored when SERVER_PANEL_SECRET was absent during setup
  if (panelSetup?.apiKeyPlain) {
    logger.warn('[ServerSetup] Using plaintext API key — set SERVER_PANEL_SECRET and re-run setup to enable encryption.');
    return panelSetup.apiKeyPlain;
  }
  return null;
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').replace(/\/+$/, '');
}

function claimLockKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0m';
  const h = Math.floor(ms / MS_PER_HOUR);
  const m = Math.floor((ms % MS_PER_HOUR) / 60_000);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

function renderServerName(format, user) {
  return (format || '{username}-minecraft')
    .replaceAll('{username}', user.username)
    .replaceAll('{userid}', user.id)
    .slice(0, 64);
}

function getUserInviteCount(invites, userId) {
  let total = 0;
  for (const inv of invites.values()) {
    if (inv.inviter?.id !== userId) continue;
    if (!Number.isFinite(inv.uses)) continue;
    total += inv.uses;
  }
  return total;
}

async function fetchInviteCountForMember(guild, userId) {
  try {
    const invites = await guild.invites.fetch();
    return getUserInviteCount(invites, userId);
  } catch {
    return 0;
  }
}

function getEligibilityState(data, panelSetup, userId, inviteCount) {
  const requirement = Math.max(0, Number(panelSetup?.inviteRequirement ?? data.inviteRequirement ?? 0) || 0);
  const maxServersPerUser = Math.max(1, Number(panelSetup?.maxServersPerUser) || 1);
  const cooldownHours = Math.max(0, Number(panelSetup?.cooldownHours ?? 0) || 0);
  const servers = Array.isArray(data.createdServerRecords?.[userId]) ? data.createdServerRecords[userId] : [];
  const cooldownRef = data.cooldowns?.[userId] ?? {};
  const nextClaimAt = Number(cooldownRef.nextClaimAt) || 0;
  const now = Date.now();

  if (inviteCount < requirement) {
    return { ok: false, reason: `You need **${requirement}** invites to claim this reward. You currently have **${inviteCount}**.` };
  }
  if (servers.length >= maxServersPerUser) {
    return { ok: false, reason: `You have reached the max limit (**${maxServersPerUser}**) of reward servers.` };
  }
  if (nextClaimAt > now) {
    return { ok: false, reason: `You are on cooldown. Try again in **${formatDuration(nextClaimAt - now)}**.` };
  }
  return { ok: true, requirement, maxServersPerUser, cooldownHours };
}

function getPanelApiEndpoint(panelSetup, kind, serverId = null) {
  const base = normalizeBaseUrl(panelSetup?.baseUrl);
  if (!base) return null;
  if (kind === 'create') {
    if (panelSetup.provider === 'custom') return `${base}/servers`;
    return `${base}/api/application/servers`;
  }
  if (!serverId) return null;
  if (kind === 'suspend') {
    if (panelSetup.provider === 'custom') return `${base}/servers/${serverId}/suspend`;
    return `${base}/api/application/servers/${serverId}/suspend`;
  }
  if (kind === 'delete') {
    if (panelSetup.provider === 'custom') return `${base}/servers/${serverId}`;
    return `${base}/api/application/servers/${serverId}/force`;
  }
  if (kind === 'test') {
    if (panelSetup.provider === 'custom') return `${base}/health`;
    return `${base}/api/application/nodes`;
  }
  return null;
}

function buildProvisionPayload(panelSetup, user, idempotencyKey, inviteCount) {
  const serverName = renderServerName(panelSetup.serverNameFormat, user);
  return {
    external_id: idempotencyKey,
    name: serverName,
    owner: {
      discord_user_id: user.id,
      username: user.username,
      tag: user.tag,
    },
    metadata: {
      source: 'invite_reward',
      invite_count: inviteCount,
      provider: panelSetup.provider,
      egg_template: panelSetup.eggTemplate,
      node_location: panelSetup.nodeLocation,
    },
    limits: {
      memory: panelSetup.limits?.ramMb ?? 4096,
      cpu: panelSetup.limits?.cpuPercent ?? 100,
      disk: panelSetup.limits?.diskMb ?? 10240,
    },
  };
}

function hoursToMs(hours) {
  return Math.max(0, Number(hours) || 0) * MS_PER_HOUR;
}

async function callPanelApi(panelSetup, method, endpoint, body) {
  const apiKey = getApiKey(panelSetup);
  if (!apiKey) {
    return { ok: false, error: 'Panel API key not found or could not be decrypted. Please re-run setup to configure the panel connection.' };
  }
  try {
    const response = await fetch(endpoint, {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': 'Mr. Manager/ServerProvision',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const raw = await response.text();
    let parsed = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch (err) {
      logger.warn(`Panel API returned non-JSON response (${err?.message ?? 'parse error'})`);
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error:
          parsed?.errors?.[0]?.detail ||
          parsed?.message ||
          `Panel API responded with HTTP ${response.status}.`,
      };
    }
    return { ok: true, status: response.status, data: parsed ?? raw ?? null };
  } catch (err) {
    logger.warn(`Panel API request failed: ${err?.message ?? 'unknown error'}`);
    return { ok: false, error: 'Failed to reach panel API endpoint.' };
  }
}

async function sendAdminLog(guild, payload) {
  const cfg = GuildConfig.get(guild.id);
  if (!cfg.logChannel) return;
  try {
    const logChannel = await guild.channels.fetch(cfg.logChannel);
    if (!logChannel?.isTextBased()) return;
    await logChannel.send(payload);
  } catch (err) {
    logger.warn(`Failed to post server log to admin channel: ${err?.message ?? 'unknown error'}`);
  }
}

function summarizeCreatedServers(data) {
  const all = Object.entries(data.createdServerRecords ?? {});
  if (all.length === 0) return 'No servers recorded yet.';
  const lines = [];
  for (const [uid, records] of all) {
    if (!Array.isArray(records) || records.length === 0) continue;
    for (const rec of records.slice(-5)) {
      lines.push(`<@${uid}> • \`${getRecordServerId(rec)}\` • ${rec.name ?? 'Unnamed'} • ${rec.status ?? 'active'}`);
    }
  }
  return lines.length ? lines.slice(-20).join('\n') : 'No servers recorded yet.';
}

function getRecordServerId(record) {
  return String(record?.panelServerId ?? record?.id ?? 'unknown');
}

async function testPanelApi(session) {
  if (!session.baseUrl || !session.apiKey) {
    return { ok: false, message: 'Base URL and API token must be set first.', checkedAt: new Date().toISOString() };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TEST_TIMEOUT_MS);
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
        'User-Agent': 'Mr. Manager/ServerSetup',
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
  const hasSecret = !!getSecretKey();
  const noSecretNote = hasSecret
    ? ''
    : '\n\n⚠️ **`SERVER_PANEL_SECRET` is not set.** Your API token will be saved without encryption. To enable AES-256-GCM encryption, add `SERVER_PANEL_SECRET` to your environment variables and re-run setup.';

  if (session.step === 10) {
    return embed({
      title: `🧪 Step 10/${TOTAL_SETUP_STEPS} — Preview Configuration`,
      color: Colors.info,
      description:
        'Review settings, test API connection, then save.\n' +
        'Only official admin-owned APIs are allowed. Password scraping is not supported.' +
        noSecretNote,
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
    title: `⚙️ Step ${session.step}/${TOTAL_SETUP_STEPS} — Panel Setup`,
    color: Colors.primary,
    description: `${stepText[session.step] ?? 'Continue setup.'}\n\nSafety: official APIs only, no passwords, no scraping.${noSecretNote}`,
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
  if (field === 'apikey') return buildSimpleModal('server:modal:apikey', 'API Token (keep private)', 'Enter API key/token', 'Enter your API token', '', 300);
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
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('maxservers')
          .setLabel('Max Servers Per User (min 1)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(session.maxServersPerUser))
          .setMaxLength(5),
      ),
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
        { name: 'Invite Requirement', value: String(panelSetup?.inviteRequirement ?? data.inviteRequirement), inline: true },
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
      // SERVER_PANEL_SECRET being missing is a non-blocking warning shown inside the wizard.
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
          description: 'Manage reward servers and provisioning controls.',
          color: Colors.info,
          fields: [
            { name: 'Setup', value: 'Use **Setup Panel** from dashboard to manage invites, limits, cooldown, and API config.', inline: false },
            { name: 'Available Actions', value: 'View servers, test API, reset claims, suspend/delete servers.', inline: false },
          ],
        })],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('server:btn:admin_view').setLabel('View Created Servers').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('server:btn:admin_test').setLabel('Test API').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('server:btn:admin_reset').setLabel('Reset User Claim').setStyle(ButtonStyle.Primary),
          ),
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('server:btn:admin_suspend').setLabel('Suspend Server').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('server:btn:admin_delete').setLabel('Delete Server').setStyle(ButtonStyle.Danger),
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (action === 'create') {
      const lock = claimLockKey(guildId, userId);
      if (pendingProvisionClaims.has(lock)) {
        return interaction.reply({
          embeds: [errorEmbed('A provisioning request for you is already in progress. Please wait.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.deferUpdate();
      pendingProvisionClaims.add(lock);
      try {
        const data = ServerProvision.ensureGuild(guildId);
        const panelSetup = data.panelSetup;
        if (!panelSetup) {
          return interaction.followUp({
            embeds: [errorEmbed('Panel setup is not configured yet. Ask an admin to run **Setup Panel** first.')],
            flags: MessageFlags.Ephemeral,
          });
        }

        const inviteCount = await fetchInviteCountForMember(interaction.guild, userId);
        const eligibility = getEligibilityState(data, panelSetup, userId, inviteCount);
        if (!eligibility.ok) {
          return interaction.followUp({ embeds: [errorEmbed(eligibility.reason)], flags: MessageFlags.Ephemeral });
        }

        const claim = ServerProvision.ensureUserClaim(guildId, userId);
        const servers = ServerProvision.ensureUserServers(guildId, userId);
        const cooldowns = ServerProvision.ensureUserCooldowns(guildId, userId);
        const idempotencyKey = `${guildId}:${userId}:${randomUUID()}`;
        const endpoint = getPanelApiEndpoint(panelSetup, 'create');
        if (!endpoint) {
          return interaction.followUp({
            embeds: [errorEmbed('Invalid panel API base URL in setup. Re-run setup and save again.')],
            flags: MessageFlags.Ephemeral,
          });
        }

        const payload = buildProvisionPayload(panelSetup, interaction.user, idempotencyKey, inviteCount);
        const provision = await callPanelApi(panelSetup, 'POST', endpoint, payload);
        if (!provision.ok) {
          return interaction.followUp({
            embeds: [errorEmbed(`Failed to create server: ${provision.error}`)],
            flags: MessageFlags.Ephemeral,
          });
        }

        const createdAtIso = new Date().toISOString();
        const panelServerId =
          provision.data?.attributes?.id ||
          provision.data?.id ||
          provision.data?.server_id ||
          idempotencyKey;
        if (panelServerId === idempotencyKey) {
          logger.warn('Panel API did not return a server ID; falling back to external ID key.');
        }
        const serverName = payload.name;
        const record = {
          id: idempotencyKey,
          panelServerId: String(panelServerId),
          name: serverName,
          provider: panelSetup.provider,
          status: 'active',
          createdAt: createdAtIso,
          inviteCountAtClaim: inviteCount,
          createdBy: userId,
        };
        servers.push(record);
        claim.claimed = true;
        claim.claimCount = (claim.claimCount ?? 0) + 1;
        claim.lastClaimAt = createdAtIso;
        claim.lastInviteSnapshot = inviteCount;
        if (eligibility.cooldownHours > 0) {
          cooldowns.nextClaimAt = Date.now() + hoursToMs(eligibility.cooldownHours);
        } else {
          delete cooldowns.nextClaimAt;
        }
        ServerProvision.updateGuild(guildId, {
          userClaims: data.userClaims,
          createdServerRecords: data.createdServerRecords,
          cooldowns: data.cooldowns,
        });

        const detailEmbed = embed({
          title: '✅ Server Created',
          color: Colors.success,
          description: 'Your invite reward server has been provisioned successfully.',
          fields: [
            { name: 'Server Name', value: `\`${serverName}\``, inline: true },
            { name: 'Server ID', value: `\`${record.panelServerId}\``, inline: true },
            { name: 'Provider', value: `\`${panelSetup.providerLabel ?? panelSetup.provider}\``, inline: true },
            { name: 'Claim Count', value: String(claim.claimCount), inline: true },
            { name: 'Invites Used', value: String(inviteCount), inline: true },
          ],
        });

        try {
          await interaction.user.send({ embeds: [detailEmbed] });
        } catch (err) {
          logger.warn(`Could not DM server details to ${interaction.user.tag}: ${err?.message ?? 'unknown error'}`);
        }
        await interaction.followUp({ embeds: [detailEmbed], flags: MessageFlags.Ephemeral });

        await sendAdminLog(interaction.guild, {
          embeds: [embed({
            title: '🆕 Reward Server Provisioned',
            color: Colors.info,
            fields: [
              { name: 'User', value: `<@${userId}> (\`${userId}\`)`, inline: false },
              { name: 'Server ID', value: `\`${record.panelServerId}\``, inline: true },
              { name: 'Server Name', value: `\`${record.name}\``, inline: true },
              { name: 'Provider', value: `\`${record.provider}\``, inline: true },
              { name: 'Invites', value: String(inviteCount), inline: true },
              { name: 'Claim Count', value: String(claim.claimCount), inline: true },
            ],
          })],
        });
        return;
      } finally {
        pendingProvisionClaims.delete(lock);
      }
    }

    if (action === 'rewards') {
      await interaction.deferUpdate();
      const data = ServerProvision.ensureGuild(guildId);
      const panelSetup = data.panelSetup;
      const inviteCount = await fetchInviteCountForMember(interaction.guild, userId);
      const requirement = Math.max(0, Number(panelSetup?.inviteRequirement ?? data.inviteRequirement ?? 0) || 0);
      const eligible = inviteCount >= requirement;
      return interaction.followUp({
        embeds: [embed({
          title: '🎁 Invite Rewards',
          description: eligible
            ? 'You are eligible to claim your reward server.'
            : 'You are not eligible yet. Invite more users and try again.',
          color: Colors.info,
          fields: [
            { name: 'Your Invites', value: String(inviteCount), inline: true },
            { name: 'Required Invites', value: String(requirement), inline: true },
            { name: 'Eligible', value: eligible ? '✅ Yes' : '❌ No', inline: true },
          ],
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

    if (action === 'admin_view') {
      if (!admin) {
        return interaction.reply({ embeds: [errorEmbed('Only administrators can use this control.')], flags: MessageFlags.Ephemeral });
      }
      const data = ServerProvision.ensureGuild(guildId);
      await interaction.deferUpdate();
      return interaction.followUp({
        embeds: [embed({
          title: '📋 Created Reward Servers',
          color: Colors.info,
          description: summarizeCreatedServers(data),
        })],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (action === 'admin_test') {
      if (!admin) {
        return interaction.reply({ embeds: [errorEmbed('Only administrators can use this control.')], flags: MessageFlags.Ephemeral });
      }
      const data = ServerProvision.ensureGuild(guildId);
      const panelSetup = data.panelSetup;
      if (!panelSetup) {
        return interaction.reply({ embeds: [errorEmbed('Panel setup is not configured yet.')], flags: MessageFlags.Ephemeral });
      }
      const endpoint = getPanelApiEndpoint(panelSetup, 'test');
      if (!endpoint) {
        return interaction.reply({ embeds: [errorEmbed('Invalid panel API base URL in saved setup.')], flags: MessageFlags.Ephemeral });
      }
      await interaction.deferUpdate();
      const testResult = await callPanelApi(panelSetup, 'GET', endpoint);
      return interaction.followUp({
        embeds: [embed({
          title: '🧪 API Test Result',
          color: testResult.ok ? Colors.success : Colors.error,
          description: testResult.ok
            ? `Connection successful (HTTP ${testResult.status}).`
            : `Connection failed: ${testResult.error}`,
        })],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (action === 'admin_reset') {
      if (!admin) {
        return interaction.reply({ embeds: [errorEmbed('Only administrators can use this control.')], flags: MessageFlags.Ephemeral });
      }
      const modal = new ModalBuilder()
        .setCustomId('server:modal:admin_reset')
        .setTitle('Reset User Claim');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('userid')
            .setLabel('Discord User ID')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('e.g. 123456789012345678')
            .setMaxLength(30),
        ),
      );
      return interaction.showModal(modal);
    }

    if (action === 'admin_suspend' || action === 'admin_delete') {
      if (!admin) {
        return interaction.reply({ embeds: [errorEmbed('Only administrators can use this control.')], flags: MessageFlags.Ephemeral });
      }
      const isSuspend = action === 'admin_suspend';
      const modal = new ModalBuilder()
        .setCustomId(`server:modal:${isSuspend ? 'admin_suspend' : 'admin_delete'}`)
        .setTitle(isSuspend ? 'Suspend User Server' : 'Delete User Server');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('userid')
            .setLabel('Discord User ID')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('e.g. 123456789012345678')
            .setMaxLength(30),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('serverid')
            .setLabel('Panel Server ID')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('Server ID from panel')
            .setMaxLength(100),
        ),
      );
      return interaction.showModal(modal);
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

      const panelSetupData = {
        provider: session.provider,
        providerLabel: getProviderLabel(session.provider),
        baseUrl: session.baseUrl,
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
      };

      if (encrypted) {
        panelSetupData.apiKeyEncrypted = encrypted.ciphertext;
        panelSetupData.apiKeyIv = encrypted.iv;
        panelSetupData.apiKeyTag = encrypted.tag;
      } else {
        // No encryption secret available — store token as plaintext with a warning
        logger.warn(`[ServerSetup] SERVER_PANEL_SECRET not set; saving API token unencrypted for guild ${guildId}.`);
        panelSetupData.apiKeyPlain = session.apiKey;
      }

      ServerProvision.updateGuild(guildId, {
        panelConfigRef: `${session.provider}:${session.nodeLocation}`,
        inviteRequirement: session.inviteRequirement,
        panelSetup: panelSetupData,
      });

      clearSession(guildId, userId);
      return interaction.update({
        embeds: [embed({
          title: `✅ Step ${TOTAL_SETUP_STEPS}/${TOTAL_SETUP_STEPS} — Setup Saved`,
          description: encrypted
            ? 'Panel API setup saved successfully and will persist across restarts.'
            : '⚠️ Setup saved **without encryption** because `SERVER_PANEL_SECRET` is not set.\nTo protect the API token, add `SERVER_PANEL_SECRET` to your environment variables and re-run setup.',
          color: encrypted ? Colors.success : Colors.warning,
          fields: [
            { name: 'Provider', value: `\`${getProviderLabel(session.provider)}\``, inline: true },
            { name: 'Node', value: `\`${session.nodeLocation}\``, inline: true },
            { name: 'Egg', value: `\`${session.eggTemplate}\``, inline: true },
            ...(!encrypted ? [{ name: '🔐 How to enable encryption', value: 'Set `SERVER_PANEL_SECRET` to any long random string in your environment, then re-run **Setup Panel** to re-encrypt the token.', inline: false }] : []),
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

    if (field === 'admin_reset' || field === 'admin_suspend' || field === 'admin_delete') {
      if (!admin) {
        return interaction.reply({ embeds: [errorEmbed('Only administrators can use this control.')], flags: MessageFlags.Ephemeral });
      }

      const data = ServerProvision.ensureGuild(guildId);
      const panelSetup = data.panelSetup;
      const targetUserId = interaction.fields.getTextInputValue('userid').trim();

      if (!/^\d{17,20}$/.test(targetUserId)) {
        return interaction.reply({ embeds: [errorEmbed('Invalid Discord user ID.')], flags: MessageFlags.Ephemeral });
      }

      if (field === 'admin_reset') {
        const claims = data.userClaims ?? {};
        const cooldowns = data.cooldowns ?? {};
        claims[targetUserId] = {
          claimed: false,
          claimCount: 0,
          lastClaimAt: null,
          lastInviteSnapshot: null,
        };
        if (cooldowns[targetUserId]) {
          delete cooldowns[targetUserId].nextClaimAt;
        }
        ServerProvision.updateGuild(guildId, { userClaims: claims, cooldowns });
        await sendAdminLog(interaction.guild, {
          embeds: [embed({
            title: '♻️ User Claim Reset',
            color: Colors.warning,
            fields: [
              { name: 'Target User', value: `<@${targetUserId}> (\`${targetUserId}\`)`, inline: false },
              { name: 'Reset By', value: `<@${userId}>`, inline: true },
            ],
          })],
        });
        return interaction.reply({
          embeds: [embed({ title: '✅ Claim Reset', color: Colors.success, description: `Reset reward claim state for <@${targetUserId}>.` })],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (!panelSetup) {
        return interaction.reply({ embeds: [errorEmbed('Panel setup is not configured yet.')], flags: MessageFlags.Ephemeral });
      }
      const serverId = interaction.fields.getTextInputValue('serverid').trim();
      if (!serverId) {
        return interaction.reply({ embeds: [errorEmbed('Server ID is required.')], flags: MessageFlags.Ephemeral });
      }
      const op = field === 'admin_suspend' ? 'suspend' : 'delete';
      const endpoint = getPanelApiEndpoint(panelSetup, op, serverId);
      if (!endpoint) {
        return interaction.reply({ embeds: [errorEmbed('Invalid panel API base URL in saved setup.')], flags: MessageFlags.Ephemeral });
      }

      const method = op === 'delete' ? 'DELETE' : 'POST';
      const apiResult = await callPanelApi(panelSetup, method, endpoint);
      if (!apiResult.ok) {
        return interaction.reply({
          embeds: [errorEmbed(`Failed to ${op} server: ${apiResult.error}`)],
          flags: MessageFlags.Ephemeral,
        });
      }

      const records = Array.isArray(data.createdServerRecords?.[targetUserId]) ? data.createdServerRecords[targetUserId] : [];
      const idx = records.findIndex((r) => getRecordServerId(r) === serverId);
      if (idx >= 0) {
        records[idx] = {
          ...records[idx],
          status: op === 'delete' ? 'deleted' : 'suspended',
          updatedAt: new Date().toISOString(),
          updatedBy: userId,
        };
        ServerProvision.updateGuild(guildId, { createdServerRecords: data.createdServerRecords });
      } else {
        logger.warn(`Panel ${op} succeeded but local server record was not found for user ${targetUserId} and server ${serverId}.`);
      }

      await sendAdminLog(interaction.guild, {
        embeds: [embed({
          title: op === 'delete' ? '🗑️ Reward Server Deleted' : '⏸️ Reward Server Suspended',
          color: Colors.warning,
          fields: [
            { name: 'Target User', value: `<@${targetUserId}> (\`${targetUserId}\`)`, inline: false },
            { name: 'Server ID', value: `\`${serverId}\``, inline: true },
            { name: 'Action By', value: `<@${userId}>`, inline: true },
          ],
        })],
      });

      return interaction.reply({
        embeds: [embed({
          title: `✅ Server ${op === 'delete' ? 'Deleted' : 'Suspended'}`,
          color: Colors.success,
          description: op === 'delete'
            ? `Server \`${serverId}\` has been deleted.`
            : `Server \`${serverId}\` has been suspended.`,
        })],
        flags: MessageFlags.Ephemeral,
      });
    }

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
      if (value.length < MIN_API_TOKEN_LENGTH) {
        return interaction.reply({ embeds: [errorEmbed(`API token must be at least ${MIN_API_TOKEN_LENGTH} characters.`)], flags: MessageFlags.Ephemeral });
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
      const rawMax = interaction.fields.getTextInputValue('maxservers').trim();
      const parsedMax = Number.parseInt(rawMax, 10);
      if (Number.isNaN(parsedMax) || parsedMax < 1) {
        return interaction.reply({ embeds: [errorEmbed('Max servers per user must be at least 1.')], flags: MessageFlags.Ephemeral });
      }
      session.cooldownHours = cooldownHours;
      session.maxServersPerUser = parsedMax;
      session.step = 10;
      session.lastApiTest = null;
      return interaction.reply({ ...setupPayload(session), flags: MessageFlags.Ephemeral });
    }
  }

  if (type !== 'btn') return interaction.deferUpdate();
  return interaction.deferUpdate();
}
