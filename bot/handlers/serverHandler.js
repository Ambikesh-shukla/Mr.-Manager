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
import {
  fetchInviteCountForMember,
  getInviteRewardPlans,
  getRewardEligibility,
  getRewardClaimState,
  setRewardCooldown,
} from '../utils/inviteRewards.js';

const setupSessions = new Map();
const pendingProvisionClaims = new Set();
const pendingAdminRewardSelections = new Map();
const panelNodeCache = new Map();
const API_TEST_TIMEOUT_MS = 10_000;
const MS_PER_HOUR = 3_600_000;
const MIN_API_TOKEN_LENGTH = 8;
const TOTAL_SETUP_STEPS = 12;
const PANEL_NODE_CACHE_TTL_MS = 5 * 60_000;

const PROVIDERS = [
  { label: 'Pterodactyl', value: 'pterodactyl', description: 'Official Application API only' },
  { label: 'Pelican', value: 'pelican', description: 'Official panel API only' },
  { label: 'WISP', value: 'wisp', description: 'Official API endpoint only' },
  { label: 'Custom API', value: 'custom', description: 'Admin-owned official API with token' },
];

const PROVISION_MODES = [
  { label: 'Invite Reward Mode', value: 'invite_reward', description: 'Users can claim using invite rewards' },
  { label: 'Manual Admin Mode', value: 'manual_admin', description: 'Only admins can provision servers manually' },
];

function setupKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function getProviderLabel(value) {
  return PROVIDERS.find((p) => p.value === value)?.label ?? 'Unknown';
}

function normalizeProvisioningMode(value) {
  return value === 'manual_admin' ? 'manual_admin' : 'invite_reward';
}

function getProvisionMode(data, panelSetup) {
  return normalizeProvisioningMode(panelSetup?.provisioningMode ?? data?.provisioningMode);
}

function getProvisionModeLabel(value) {
  return PROVISION_MODES.find((mode) => mode.value === value)?.label ?? 'Invite Reward Mode';
}

function normalizeNodeLimits(limits = {}, fallback = { ramMb: 4096, cpuPercent: 100, diskMb: 10240 }) {
  const ramMb = parseNonNegativeInt(limits.ramMb, fallback.ramMb);
  const cpuPercent = parseNonNegativeInt(limits.cpuPercent, fallback.cpuPercent);
  const diskMb = parseNonNegativeInt(limits.diskMb, fallback.diskMb);
  return {
    ramMb: Math.max(1, ramMb),
    cpuPercent: Math.max(1, cpuPercent),
    diskMb: Math.max(1, diskMb),
  };
}

function sanitizeNodeConfig(raw, fallbackLimits = { ramMb: 4096, cpuPercent: 100, diskMb: 10240 }) {
  const id = String(raw?.id ?? '').trim().slice(0, 80);
  const name = String(raw?.name ?? '').trim().slice(0, 80);
  const location = String(raw?.location ?? '').trim().slice(0, 80);
  const panelNodeId = String(raw?.panelNodeId ?? '').trim().slice(0, 80);
  if (!id || !name || !location || !panelNodeId) return null;
  return {
    id,
    name,
    location,
    panelNodeId,
    available: normalizeNodeLimits(raw?.available, fallbackLimits),
    createdAt: raw?.createdAt ?? null,
    updatedAt: raw?.updatedAt ?? null,
  };
}

function getConfiguredNodes(panelSetup) {
  const fallbackLimits = normalizeNodeLimits(panelSetup?.limits ?? {});
  const configured = Array.isArray(panelSetup?.nodes) ? panelSetup.nodes : [];
  const deduped = new Map();
  for (const raw of configured) {
    const node = sanitizeNodeConfig(raw, fallbackLimits);
    if (!node) continue;
    deduped.set(node.id, node);
  }
  const nodes = [...deduped.values()];
  if (nodes.length > 0) return nodes;

  if (panelSetup?.nodeLocation) {
    return [{
      id: 'legacy-default-node',
      name: 'Default Node',
      location: String(panelSetup.nodeLocation).trim().slice(0, 80),
      panelNodeId: String(panelSetup.nodeId ?? panelSetup.nodeLocation).trim().slice(0, 80),
      available: normalizeNodeLimits(panelSetup?.limits ?? fallbackLimits, fallbackLimits),
      createdAt: null,
      updatedAt: panelSetup?.updatedAt ?? null,
    }];
  }
  return [];
}

function getDefaultConfiguredNode(panelSetup) {
  const nodes = getConfiguredNodes(panelSetup);
  if (nodes.length === 0) return null;
  const defaultNode = nodes.find((node) => node.id === panelSetup?.defaultNodeId);
  return defaultNode ?? nodes[0];
}

function findConfiguredNodeBySelector(panelSetup, selector) {
  const value = String(selector ?? '').trim();
  if (!value) return null;
  const nodes = getConfiguredNodes(panelSetup);
  return nodes.find((node) => (
    node.id === value
    || node.panelNodeId === value
    || node.location === value
    || node.name === value
  )) ?? null;
}

function setSessionFromPanelSetup(session, panelSetup) {
  if (!panelSetup || typeof panelSetup !== 'object') return;
  const defaultNode = getDefaultConfiguredNode(panelSetup);
  const fallbackLimits = defaultNode?.available ?? normalizeNodeLimits(panelSetup?.limits ?? {});
  session.provider = panelSetup.provider ?? session.provider;
  session.baseUrl = panelSetup.baseUrl ?? session.baseUrl;
  session.nodeLocation = defaultNode?.location ?? panelSetup.nodeLocation ?? session.nodeLocation;
  session.eggTemplate = panelSetup.eggTemplate ?? session.eggTemplate;
  session.limits = normalizeNodeLimits(panelSetup?.limits ?? fallbackLimits, fallbackLimits);
  session.serverNameFormat = panelSetup.serverNameFormat ?? session.serverNameFormat;
  session.inviteRequirement = parseNonNegativeInt(panelSetup.inviteRequirement, session.inviteRequirement);
  session.cooldownHours = parseNonNegativeInt(panelSetup.cooldownHours, session.cooldownHours);
  session.maxServersPerUser = Math.max(1, parseNonNegativeInt(panelSetup.maxServersPerUser, session.maxServersPerUser));
  session.provisioningMode = normalizeProvisioningMode(panelSetup.provisioningMode ?? session.provisioningMode);
  session.nodes = getConfiguredNodes(panelSetup);
  session.defaultNodeId = defaultNode?.id ?? session.nodes[0]?.id ?? null;
}

function upsertLegacyNodeInSession(session) {
  if (!session.nodeLocation) return;
  if (!Array.isArray(session.nodes)) session.nodes = [];
  const existing = session.nodes.find((node) => node.id === session.defaultNodeId) ?? session.nodes[0] ?? null;
  const nowIso = new Date().toISOString();
  if (existing) {
    existing.location = session.nodeLocation;
    existing.panelNodeId = existing.panelNodeId || session.nodeLocation;
    existing.available = normalizeNodeLimits(session.limits, existing.available);
    existing.updatedAt = nowIso;
    session.defaultNodeId = existing.id;
    return;
  }
  const created = {
    id: randomUUID(),
    name: 'Default Node',
    location: session.nodeLocation,
    panelNodeId: session.nodeLocation,
    available: normalizeNodeLimits(session.limits),
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  session.nodes.push(created);
  session.defaultNodeId = created.id;
}

function summarizeSessionNodes(session) {
  const nodes = Array.isArray(session.nodes) ? session.nodes : [];
  if (nodes.length === 0) return 'No nodes configured yet.';
  const summary = nodes.slice(0, 10).map((node) => {
    const marker = node.id === session.defaultNodeId ? '⭐ ' : '';
    return `${marker}**${node.name}** (\`${node.id}\`) • panel \`${node.panelNodeId}\` • ${node.location} • ${node.available.ramMb}MB/${node.available.cpuPercent}%/${node.available.diskMb}MB`;
  }).join('\n');
  return summary.length > 1000 ? `${summary.slice(0, 997)}...` : summary;
}

function buildNodeSelectOptions(session, includeAuto = false) {
  const nodes = Array.isArray(session.nodes) ? session.nodes : [];
  const options = nodes.slice(0, 25).map((node) => ({
    label: `${node.name}`.slice(0, 100),
    value: node.id,
    description: `${node.location} • panel ${node.panelNodeId}`.slice(0, 100),
    default: node.id === session.defaultNodeId,
  }));
  if (includeAuto) {
    options.unshift({
      label: 'Automatic (default node)',
      value: 'auto',
      description: 'Use the default configured node automatically',
    });
  }
  return options;
}

function buildNodeManagerPayload(session) {
  const canManage = session.step >= 2;
  return {
    embeds: [embed({
      title: '🧩 Node Manager',
      color: Colors.info,
      description: 'Manage connected panel nodes and assign reward plans to node IDs.',
      fields: [
        { name: 'Configured Nodes', value: String((session.nodes ?? []).length), inline: true },
        { name: 'Default Node', value: `\`${session.defaultNodeId ?? 'Not set'}\``, inline: true },
        { name: 'Node List', value: summarizeSessionNodes(session), inline: false },
      ],
    })],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('server:btn:wiz_node_add').setLabel('Add Node').setStyle(ButtonStyle.Success).setDisabled(!canManage),
        new ButtonBuilder().setCustomId('server:btn:wiz_node_edit').setLabel('Edit Node').setStyle(ButtonStyle.Secondary).setDisabled((session.nodes ?? []).length === 0),
        new ButtonBuilder().setCustomId('server:btn:wiz_node_remove').setLabel('Remove Node').setStyle(ButtonStyle.Danger).setDisabled((session.nodes ?? []).length === 0),
        new ButtonBuilder().setCustomId('server:btn:wiz_node_default').setLabel('Set Default').setStyle(ButtonStyle.Primary).setDisabled((session.nodes ?? []).length === 0),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('server:btn:wiz_reward_node_assign').setLabel('Assign Reward Plan Node').setStyle(ButtonStyle.Secondary),
      ),
    ],
    flags: MessageFlags.Ephemeral,
  };
}

function getPanelNodeCacheKey(guildId, panelSetup) {
  return `${guildId}:${panelSetup?.provider ?? 'unknown'}:${normalizeBaseUrl(panelSetup?.baseUrl)}:${panelSetup?.updatedAt ?? 'na'}`;
}

function parsePanelNodeListResponse(data) {
  if (Array.isArray(data?.data)) {
    return data.data.map((entry) => ({
      id: String(entry?.attributes?.id ?? entry?.id ?? '').trim(),
      name: String(entry?.attributes?.name ?? entry?.name ?? '').trim(),
      location: String(entry?.attributes?.location ?? entry?.location ?? '').trim(),
    })).filter((node) => node.id || node.name || node.location);
  }
  if (Array.isArray(data?.nodes)) {
    return data.nodes.map((entry) => ({
      id: String(entry?.id ?? '').trim(),
      name: String(entry?.name ?? '').trim(),
      location: String(entry?.location ?? '').trim(),
    })).filter((node) => node.id || node.name || node.location);
  }
  return [];
}

async function getCachedPanelNodes(guildId, panelSetup) {
  if (panelSetup?.provider === 'custom') {
    return { ok: true, nodes: [], cached: true, skipped: true };
  }
  const endpoint = getPanelApiEndpoint(panelSetup, 'test');
  if (!endpoint) return { ok: false, error: 'Invalid panel API base URL in setup.' };
  const cacheKey = getPanelNodeCacheKey(guildId, panelSetup);
  const now = Date.now();
  const cached = panelNodeCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return { ok: true, nodes: cached.nodes, cached: true };
  }
  const response = await callPanelApi(panelSetup, 'GET', endpoint);
  if (!response.ok) return { ok: false, error: response.error };
  const nodes = parsePanelNodeListResponse(response.data);
  panelNodeCache.set(cacheKey, { nodes, expiresAt: now + PANEL_NODE_CACHE_TTL_MS });
  return { ok: true, nodes, cached: false };
}

async function resolveProvisionNode(guildId, panelSetup, options = {}) {
  const configured = getConfiguredNodes(panelSetup);
  if (configured.length === 0) {
    return { ok: false, error: 'No configured node is available. Add at least one node in Setup Panel.' };
  }
  const requestedNodeId = String(options.nodeId ?? '').trim();
  const rewardNodeId = String(options.rewardNodeId ?? '').trim();
  let selected = null;
  if (requestedNodeId && requestedNodeId !== 'auto') {
    selected = findConfiguredNodeBySelector(panelSetup, requestedNodeId);
    if (!selected) return { ok: false, error: `Selected node \`${requestedNodeId}\` is not configured.` };
  } else if (rewardNodeId) {
    selected = findConfiguredNodeBySelector(panelSetup, rewardNodeId);
    if (!selected) return { ok: false, error: `Reward plan targets node \`${rewardNodeId}\`, but it is not configured.` };
  } else {
    selected = getDefaultConfiguredNode(panelSetup);
  }
  if (!selected) {
    return { ok: false, error: 'No default node is configured. Set a default node in Setup Panel.' };
  }
  const remote = await getCachedPanelNodes(guildId, panelSetup);
  if (!remote.ok) {
    return { ok: false, error: `Failed to verify panel node: ${remote.error}` };
  }
  if (!remote.skipped && remote.nodes.length > 0) {
    const exists = remote.nodes.some((node) => (
      node.id === selected.panelNodeId
      || node.name === selected.name
      || node.location === selected.location
    ));
    if (!exists) {
      return { ok: false, error: `Configured node \`${selected.name}\` (\`${selected.panelNodeId}\`) does not exist on the panel API.` };
    }
  }
  return { ok: true, node: selected };
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
    provisioningMode: 'invite_reward',
    nodes: [],
    defaultNodeId: null,
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

function isSafeProvisionIdentifier(value) {
  return /^[A-Za-z0-9._:-]+$/.test(value);
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

function formatRewardLine(reward, inviteCount, data, panelSetup, userId) {
  const now = Date.now();
  const eligibility = getRewardEligibility({ data, panelSetup, userId, inviteCount, reward, now });
  const cooldownText = eligibility.nextClaimAt > now
    ? ` • cooldown: ${formatDuration(eligibility.nextClaimAt - now)}`
    : '';
  const remaining = eligibility.remainingInvites > 0 ? ` • need ${eligibility.remainingInvites} more invites` : '';
  const status = eligibility.ok ? '✅ Eligible' : '❌ Not eligible';
  const nodeTarget = reward.nodeId ? ` • node \`${reward.nodeId}\`` : '';
  return `• **${reward.name}** (\`${reward.id}\`) — ${reward.invitesRequired} invites, ${reward.limits.ramMb}MB RAM, ${reward.limits.cpuPercent}% CPU, ${reward.limits.diskMb}MB Disk${nodeTarget}, claims ${eligibility.rewardClaim.claimCount}/${reward.maxClaims}${remaining}${cooldownText} • ${status}`;
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

function buildProvisionPayload(panelSetup, rewardPlan, user, idempotencyKey, inviteCount, options = {}) {
  const serverName = renderServerName(panelSetup.serverNameFormat, user);
  const selectedNode = options.resolvedNode ?? null;
  const effectiveNode = selectedNode?.location || options.nodeLocation || rewardPlan?.nodeLocation || panelSetup.nodeLocation;
  const effectiveEgg = options.eggTemplate || rewardPlan?.eggTemplate || panelSetup.eggTemplate;
  const effectiveLimits = options.limits ?? rewardPlan?.limits ?? panelSetup.limits ?? {};
  const source = options.source || 'invite_reward';
  return {
    external_id: idempotencyKey,
    name: serverName,
    owner: {
      discord_user_id: user.id,
      username: user.username,
      tag: user.tag,
    },
    metadata: {
      source,
      invite_count: inviteCount,
      reward_plan_id: options.rewardPlanId ?? rewardPlan?.id ?? (source === 'manual_admin' ? 'manual-admin' : 'legacy-default'),
      provider: panelSetup.provider,
      egg_template: effectiveEgg,
      node_location: effectiveNode,
      configured_node_id: selectedNode?.id ?? rewardPlan?.nodeId ?? null,
      panel_node_id: selectedNode?.panelNodeId ?? null,
      provisioned_by: options.provisionedBy ?? null,
    },
    limits: {
      memory: effectiveLimits.ramMb ?? 4096,
      cpu: effectiveLimits.cpuPercent ?? 100,
      disk: effectiveLimits.diskMb ?? 10240,
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

async function provisionRewardClaim(interaction, { selectedRewardId, selectedNodeId = 'auto' }) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const lock = claimLockKey(guildId, userId);
  if (pendingProvisionClaims.has(lock)) {
    return interaction.followUp({
      embeds: [errorEmbed('A provisioning request for you is already in progress. Please wait.')],
      flags: MessageFlags.Ephemeral,
    });
  }

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
    const provisionMode = getProvisionMode(data, panelSetup);
    if (provisionMode === 'manual_admin') {
      return interaction.followUp({
        embeds: [errorEmbed('Invite reward claiming is disabled because this guild is in **Manual Admin Mode**.')],
        flags: MessageFlags.Ephemeral,
      });
    }
    const rewardPlan = getInviteRewardPlans(data, panelSetup).find((reward) => reward.id === selectedRewardId);
    if (!rewardPlan) {
      return interaction.followUp({
        embeds: [errorEmbed('Selected reward plan was not found. Please try again.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const inviteCount = await fetchInviteCountForMember(interaction.guild, userId);
    const eligibility = getRewardEligibility({
      data,
      panelSetup,
      userId,
      inviteCount,
      reward: rewardPlan,
    });
    if (!eligibility.ok) {
      const cooldownHint = eligibility.nextClaimAt > Date.now()
        ? ` Try again in **${formatDuration(eligibility.nextClaimAt - Date.now())}**.`
        : '';
      return interaction.followUp({
        embeds: [errorEmbed(`${eligibility.reason}${cooldownHint}`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    const resolvedNode = await resolveProvisionNode(guildId, panelSetup, {
      nodeId: selectedNodeId,
      rewardNodeId: rewardPlan.nodeId,
    });
    if (!resolvedNode.ok) {
      return interaction.followUp({
        embeds: [errorEmbed(resolvedNode.error)],
        flags: MessageFlags.Ephemeral,
      });
    }

    const claim = ServerProvision.ensureUserClaim(guildId, userId);
    const rewardClaim = getRewardClaimState(claim, rewardPlan.id);
    const servers = ServerProvision.ensureUserServers(guildId, userId);
    const cooldowns = ServerProvision.ensureUserCooldowns(guildId, userId);
    const history = ServerProvision.ensureClaimHistory(guildId);
    const idempotencyKey = `${guildId}:${userId}:${randomUUID()}`;
    const endpoint = getPanelApiEndpoint(panelSetup, 'create');
    if (!endpoint) {
      return interaction.followUp({
        embeds: [errorEmbed('Invalid panel API base URL in setup. Re-run setup and save again.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const payload = buildProvisionPayload(panelSetup, rewardPlan, interaction.user, idempotencyKey, inviteCount, {
      resolvedNode: resolvedNode.node,
    });
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
      rewardPlanId: rewardPlan.id,
      rewardPlanName: rewardPlan.name,
      status: 'active',
      createdAt: createdAtIso,
      inviteCountAtClaim: inviteCount,
      createdBy: userId,
      nodeId: resolvedNode.node.id,
      panelNodeId: resolvedNode.node.panelNodeId,
      nodeLocation: resolvedNode.node.location,
    };
    servers.push(record);
    claim.claimed = true;
    claim.claimCount = (claim.claimCount ?? 0) + 1;
    claim.lastClaimAt = createdAtIso;
    claim.lastInviteSnapshot = inviteCount;
    claim.lastRewardId = rewardPlan.id;
    if (!claim.rewardClaims || typeof claim.rewardClaims !== 'object') {
      claim.rewardClaims = {};
    }
    claim.rewardClaims[rewardPlan.id] = {
      claimCount: rewardClaim.claimCount + 1,
      lastClaimAt: createdAtIso,
      lastInviteSnapshot: inviteCount,
    };
    if (rewardPlan.cooldownHours > 0) {
      setRewardCooldown(cooldowns, rewardPlan.id, Date.now() + hoursToMs(rewardPlan.cooldownHours));
    } else {
      setRewardCooldown(cooldowns, rewardPlan.id, 0);
    }
    history.push({
      id: randomUUID(),
      userId,
      rewardPlanId: rewardPlan.id,
      rewardPlanName: rewardPlan.name,
      invitesAtClaim: inviteCount,
      panelServerId: record.panelServerId,
      createdAt: createdAtIso,
      claimCountForReward: claim.rewardClaims[rewardPlan.id].claimCount,
      nodeId: resolvedNode.node.id,
      panelNodeId: resolvedNode.node.panelNodeId,
    });
    ServerProvision.updateGuild(guildId, {
      userClaims: data.userClaims,
      createdServerRecords: data.createdServerRecords,
      cooldowns: data.cooldowns,
      claimHistory: data.claimHistory,
    });

    const detailEmbed = embed({
      title: '✅ Server Created',
      color: Colors.success,
      description: 'Your invite reward server has been provisioned successfully.',
      fields: [
        { name: 'Reward Plan', value: `\`${rewardPlan.name}\``, inline: true },
        { name: 'Server Name', value: `\`${serverName}\``, inline: true },
        { name: 'Server ID', value: `\`${record.panelServerId}\``, inline: true },
        { name: 'Node', value: `\`${resolvedNode.node.name}\` (\`${resolvedNode.node.id}\`)`, inline: true },
        { name: 'Provider', value: `\`${panelSetup.providerLabel ?? panelSetup.provider}\``, inline: true },
        { name: 'Plan Claim Count', value: String(claim.rewardClaims[rewardPlan.id].claimCount), inline: true },
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
          { name: 'Reward Plan', value: `\`${rewardPlan.name}\` (\`${rewardPlan.id}\`)`, inline: false },
          { name: 'Server ID', value: `\`${record.panelServerId}\``, inline: true },
          { name: 'Server Name', value: `\`${record.name}\``, inline: true },
          { name: 'Provider', value: `\`${record.provider}\``, inline: true },
          { name: 'Node', value: `\`${resolvedNode.node.name}\` (\`${resolvedNode.node.id}\`)`, inline: false },
          { name: 'Invites', value: String(inviteCount), inline: true },
          { name: 'Total Claims', value: String(claim.claimCount), inline: true },
        ],
      })],
    });
    return;
  } finally {
    pendingProvisionClaims.delete(lock);
  }
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

  if (session.step === 11) {
    return embed({
      title: `🧪 Step 11/${TOTAL_SETUP_STEPS} — Preview Configuration`,
      color: Colors.info,
      description:
        'Review settings, test API connection, then save.\n' +
        'Only official admin-owned APIs are allowed. Password scraping is not supported.' +
        noSecretNote,
      fields: [
        { name: 'Provider', value: `\`${getProviderLabel(session.provider)}\``, inline: true },
        { name: 'Base URL', value: `\`${session.baseUrl || 'Not set'}\``, inline: false },
        { name: 'API Token', value: maskSecret(session.apiKey), inline: true },
        { name: 'Default Node ID', value: `\`${session.defaultNodeId || 'Not set'}\``, inline: true },
        { name: 'Node/Location (legacy)', value: `\`${session.nodeLocation || 'Not set'}\``, inline: true },
        { name: 'Egg/Template', value: `\`${session.eggTemplate || 'Not set'}\``, inline: true },
        { name: 'RAM / CPU / Disk', value: `\`${session.limits.ramMb}MB / ${session.limits.cpuPercent}% / ${session.limits.diskMb}MB\``, inline: false },
        { name: 'Configured Nodes', value: String((session.nodes ?? []).length), inline: true },
        { name: 'Nodes', value: summarizeSessionNodes(session), inline: false },
        { name: 'Server Name Format', value: `\`${session.serverNameFormat}\``, inline: false },
        { name: 'Invite Requirement', value: `\`${session.inviteRequirement}\``, inline: true },
        { name: 'Cooldown / Max per User', value: `\`${session.cooldownHours}h / ${session.maxServersPerUser}\``, inline: true },
        { name: 'Provisioning Mode', value: `\`${getProvisionModeLabel(session.provisioningMode)}\``, inline: true },
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
    10: 'Select provisioning mode.',
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
        new StringSelectMenuBuilder()
          .setCustomId('server:menu:mode_select')
          .setPlaceholder('Select provisioning mode')
          .addOptions(PROVISION_MODES.map((mode) => ({ ...mode, default: mode.value === session.provisioningMode }))),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('server:btn:wiz_back').setLabel('Back').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('server:btn:wiz_cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger),
      ),
    ];
  }

  if (session.step === 11) {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('server:btn:wiz_test').setLabel('Test API').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('server:btn:wiz_save').setLabel('Save Setup').setStyle(ButtonStyle.Success).setDisabled(!session.lastApiTest?.ok),
        new ButtonBuilder().setCustomId('server:btn:wiz_back').setLabel('Back').setStyle(ButtonStyle.Secondary),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('server:btn:wiz_nodes').setLabel('Manage Nodes').setStyle(ButtonStyle.Primary),
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
    10: 'mode',
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
  const configuredNodes = getConfiguredNodes(panelSetup);
  const defaultNode = getDefaultConfiguredNode(panelSetup);
  const provisionMode = getProvisionMode(data, panelSetup);
  const rewardPlans = getInviteRewardPlans(data, panelSetup);

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
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(provisionMode === 'manual_admin'),
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
            ? `Configured (\`${panelSetup.providerLabel ?? panelSetup.provider}\` • default \`${defaultNode?.name ?? defaultNode?.id ?? panelSetup.nodeLocation ?? 'unknown'}\`)`
            : 'Not configured',
          inline: true,
        },
        { name: 'Provisioning Mode', value: getProvisionModeLabel(provisionMode), inline: true },
        { name: 'Reward Plans', value: String(rewardPlans.length), inline: true },
        { name: 'Nodes', value: String(configuredNodes.length), inline: true },
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
      const existing = ServerProvision.ensureGuild(guildId);
      setSessionFromPanelSetup(session, existing.panelSetup);
      session.provisioningMode = getProvisionMode(existing, existing.panelSetup);
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
            { name: 'Available Actions', value: 'Manual provision (Manual Admin Mode), view servers, test API, reset claims, suspend/delete servers.', inline: false },
          ],
        })],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('server:btn:admin_view').setLabel('View Created Servers').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('server:btn:admin_user_servers').setLabel('View User Servers').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('server:btn:admin_test').setLabel('Test API').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('server:btn:admin_reset').setLabel('Reset User Claim').setStyle(ButtonStyle.Primary),
          ),
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('server:btn:admin_manual_create').setLabel('Manual Provision').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('server:btn:admin_suspend').setLabel('Suspend Server').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('server:btn:admin_delete').setLabel('Delete Server').setStyle(ButtonStyle.Danger),
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (action === 'create') {
      await interaction.deferUpdate();
      const data = ServerProvision.ensureGuild(guildId);
      const panelSetup = data.panelSetup;
      if (!panelSetup) {
        return interaction.followUp({
          embeds: [errorEmbed('Panel setup is not configured yet. Ask an admin to run **Setup Panel** first.')],
          flags: MessageFlags.Ephemeral,
        });
      }
      const provisionMode = getProvisionMode(data, panelSetup);
      if (provisionMode === 'manual_admin' && !admin) {
        return interaction.followUp({
          embeds: [errorEmbed('This guild is in **Manual Admin Mode**. Only administrators can provision servers.')],
          flags: MessageFlags.Ephemeral,
        });
      }
      if (provisionMode === 'manual_admin' && admin) {
        return interaction.followUp({
          embeds: [embed({
            title: '🛠️ Manual Admin Mode Enabled',
            description: 'Use **Admin Controls → Manual Provision** to create servers for users.',
            color: Colors.info,
          })],
          flags: MessageFlags.Ephemeral,
        });
      }

      const inviteCount = await fetchInviteCountForMember(interaction.guild, userId);
      const rewards = getInviteRewardPlans(data, panelSetup);
      const eligibleRewards = rewards.filter((reward) => getRewardEligibility({
        data,
        panelSetup,
        userId,
        inviteCount,
        reward,
      }).ok);

      if (eligibleRewards.length === 0) {
        const top = rewards.slice(0, 8).map((reward) => formatRewardLine(reward, inviteCount, data, panelSetup, userId)).join('\n');
        return interaction.followUp({
          embeds: [embed({
            title: '🎁 Invite Reward Plans',
            color: Colors.warning,
            description: 'No reward plan is currently claimable for your account.',
            fields: [
              { name: 'Your Invites', value: String(inviteCount), inline: true },
              { name: 'Plans', value: top || 'No plans configured yet.', inline: false },
            ],
          })],
          flags: MessageFlags.Ephemeral,
        });
      }

      // Discord select menus allow up to 25 options.
      const options = eligibleRewards.slice(0, 25).map((reward) => ({
        label: reward.name.slice(0, 100),
        value: reward.id,
        description: `${reward.invitesRequired} invites • ${reward.limits.ramMb}MB RAM • ${reward.maxClaims} max claims`.slice(0, 100),
      }));
      return interaction.followUp({
        embeds: [embed({
          title: '🧩 Select Reward Plan',
          color: Colors.info,
          description: 'Only plans you can currently claim are shown below.',
          fields: [
            { name: 'Your Invites', value: String(inviteCount), inline: true },
            { name: 'Eligible Plans', value: String(eligibleRewards.length), inline: true },
          ],
        })],
        components: [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('server:menu:reward_create')
              .setPlaceholder('Select a reward plan')
              .addOptions(options),
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (action === 'rewards') {
      await interaction.deferUpdate();
      const data = ServerProvision.ensureGuild(guildId);
      const panelSetup = data.panelSetup;
      const provisionMode = getProvisionMode(data, panelSetup);
      if (provisionMode === 'manual_admin') {
        return interaction.followUp({
          embeds: [embed({
            title: '🎁 Invite Rewards Disabled',
            description: 'This guild is currently in **Manual Admin Mode**.',
            color: Colors.warning,
          })],
          flags: MessageFlags.Ephemeral,
        });
      }
      const inviteCount = await fetchInviteCountForMember(interaction.guild, userId);
      const rewards = getInviteRewardPlans(data, panelSetup);
      const preview = rewards.slice(0, 10).map((reward) => formatRewardLine(reward, inviteCount, data, panelSetup, userId)).join('\n');
      const eligible = rewards.some((reward) => getRewardEligibility({
        data,
        panelSetup,
        userId,
        inviteCount,
        reward,
      }).ok);
      return interaction.followUp({
        embeds: [embed({
          title: '🎁 Invite Rewards',
          description: eligible
            ? 'You are eligible to claim your reward server.'
            : 'You are not eligible yet. Invite more users and try again.',
          color: Colors.info,
          fields: [
            { name: 'Your Invites', value: String(inviteCount), inline: true },
            { name: 'Total Plans', value: String(rewards.length), inline: true },
            { name: 'Eligible', value: eligible ? '✅ Yes' : '❌ No', inline: true },
            { name: 'Plans', value: preview || 'No reward plans configured yet.', inline: false },
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

    if (action === 'wiz_nodes') {
      const session = getSession(guildId, userId);
      if (!session) {
        return interaction.reply({ embeds: [errorEmbed('Setup session expired. Click **Setup Panel** again.')], flags: MessageFlags.Ephemeral });
      }
      if (!admin) {
        return interaction.reply({ embeds: [errorEmbed('Only administrators can modify setup.')], flags: MessageFlags.Ephemeral });
      }
      return interaction.reply(buildNodeManagerPayload(session));
    }

    if (action === 'wiz_node_add') {
      const session = getSession(guildId, userId);
      if (!session) {
        return interaction.reply({ embeds: [errorEmbed('Setup session expired. Click **Setup Panel** again.')], flags: MessageFlags.Ephemeral });
      }
      if (!admin) {
        return interaction.reply({ embeds: [errorEmbed('Only administrators can modify setup.')], flags: MessageFlags.Ephemeral });
      }
      const modal = new ModalBuilder().setCustomId('server:modal:wiz_node_add').setTitle('Add Panel Node');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Node Name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setPlaceholder('US-East #1')),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('location').setLabel('Location').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setPlaceholder('us-east')),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('panelid').setLabel('Panel Node ID').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setPlaceholder('1 or node-1')),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('limits').setLabel('Available RAM,CPU,Disk').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(40).setPlaceholder('4096,100,10240')),
      );
      return interaction.showModal(modal);
    }

    if (action === 'wiz_node_edit' || action === 'wiz_node_remove' || action === 'wiz_node_default') {
      const session = getSession(guildId, userId);
      if (!session) {
        return interaction.reply({ embeds: [errorEmbed('Setup session expired. Click **Setup Panel** again.')], flags: MessageFlags.Ephemeral });
      }
      if (!admin) {
        return interaction.reply({ embeds: [errorEmbed('Only administrators can modify setup.')], flags: MessageFlags.Ephemeral });
      }
      const options = buildNodeSelectOptions(session);
      if (options.length === 0) {
        return interaction.reply({ embeds: [errorEmbed('No nodes available. Add a node first.')], flags: MessageFlags.Ephemeral });
      }
      const menuAction = action === 'wiz_node_edit'
        ? 'wiz_node_edit_select'
        : action === 'wiz_node_remove'
          ? 'wiz_node_remove_select'
          : 'wiz_node_default_select';
      const title = action === 'wiz_node_edit'
        ? 'Select node to edit'
        : action === 'wiz_node_remove'
          ? 'Select node to remove'
          : 'Select default node';
      return interaction.reply({
        embeds: [embed({ title: '🧩 Node Selection', color: Colors.info, description: title })],
        components: [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`server:menu:${menuAction}`)
              .setPlaceholder(title)
              .addOptions(options),
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (action === 'wiz_reward_node_assign') {
      const session = getSession(guildId, userId);
      if (!session) {
        return interaction.reply({ embeds: [errorEmbed('Setup session expired. Click **Setup Panel** again.')], flags: MessageFlags.Ephemeral });
      }
      if (!admin) {
        return interaction.reply({ embeds: [errorEmbed('Only administrators can modify setup.')], flags: MessageFlags.Ephemeral });
      }
      const modal = new ModalBuilder().setCustomId('server:modal:wiz_reward_node_assign').setTitle('Assign Reward Plan Node');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('rewardid').setLabel('Reward Plan ID').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setPlaceholder('legacy-default or custom reward id')),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nodeid').setLabel('Node ID (blank = auto/default)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(80).setPlaceholder('Configured node id')),
      );
      return interaction.showModal(modal);
    }

    if (action === 'admin_view') {
      if (!admin) {
        return interaction.reply({ embeds: [errorEmbed('Only administrators can use this control.')], flags: MessageFlags.Ephemeral });
      }
      const data = ServerProvision.ensureGuild(guildId);
      await interaction.deferUpdate();
      return interaction.followUp({
        embeds: [embed({
            title: '📋 Created Servers',
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

    if (action === 'admin_user_servers') {
      if (!admin) {
        return interaction.reply({ embeds: [errorEmbed('Only administrators can use this control.')], flags: MessageFlags.Ephemeral });
      }
      const modal = new ModalBuilder()
        .setCustomId('server:modal:admin_user_servers')
        .setTitle('View User Servers');
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

    if (action === 'admin_manual_create') {
      if (!admin) {
        return interaction.reply({ embeds: [errorEmbed('Only administrators can use this control.')], flags: MessageFlags.Ephemeral });
      }
      const data = ServerProvision.ensureGuild(guildId);
      const panelSetup = data.panelSetup;
      if (!panelSetup) {
        return interaction.reply({ embeds: [errorEmbed('Panel setup is not configured yet.')], flags: MessageFlags.Ephemeral });
      }
      const mode = getProvisionMode(data, panelSetup);
      if (mode !== 'manual_admin') {
        return interaction.reply({
          embeds: [errorEmbed('Manual provisioning is only available when provisioning mode is set to **Manual Admin Mode**.')],
          flags: MessageFlags.Ephemeral,
        });
      }
      const modal = new ModalBuilder()
        .setCustomId('server:modal:admin_manual_create')
        .setTitle('Manual Provision Server');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('userid')
            .setLabel('Target Discord User ID')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('e.g. 123456789012345678')
            .setMaxLength(30),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('node')
            .setLabel('Node ID / panel ID / location (optional)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setPlaceholder(panelSetup.defaultNodeId || panelSetup.nodeId || panelSetup.nodeLocation || 'auto')
            .setMaxLength(80),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('egg')
            .setLabel('Egg/Template (optional)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setPlaceholder(panelSetup.eggTemplate || 'minecraft-java')
            .setMaxLength(80),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('limits')
            .setLabel('RAM,CPU,Disk (MB,%,MB)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder(`${panelSetup.limits?.ramMb ?? 4096},${panelSetup.limits?.cpuPercent ?? 100},${panelSetup.limits?.diskMb ?? 10240}`)
            .setMaxLength(40),
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
      if (session.step !== 11) {
        return interaction.reply({ embeds: [errorEmbed('Complete all setup steps before saving.')], flags: MessageFlags.Ephemeral });
      }
      if (!session.lastApiTest?.ok) {
        return interaction.reply({ embeds: [errorEmbed('Run a successful **Test API** before saving.')], flags: MessageFlags.Ephemeral });
      }

      upsertLegacyNodeInSession(session);
      const normalizedNodes = (session.nodes ?? [])
        .map((node) => sanitizeNodeConfig(node, session.limits))
        .filter(Boolean);
      const defaultNode = normalizedNodes.find((node) => node.id === session.defaultNodeId) ?? normalizedNodes[0] ?? null;
      if (!defaultNode) {
        return interaction.reply({ embeds: [errorEmbed('At least one node must be configured before saving setup.')], flags: MessageFlags.Ephemeral });
      }
      session.defaultNodeId = defaultNode.id;
      session.nodeLocation = defaultNode.location;
      session.limits = normalizeNodeLimits(defaultNode.available, session.limits);

      const encrypted = encryptApiKey(session.apiKey);

      const panelSetupData = {
        provider: session.provider,
        providerLabel: getProviderLabel(session.provider),
        baseUrl: session.baseUrl,
        nodeLocation: defaultNode.location,
        nodeId: defaultNode.panelNodeId,
        nodes: normalizedNodes,
        defaultNodeId: defaultNode.id,
        eggTemplate: session.eggTemplate,
        limits: normalizeNodeLimits(defaultNode.available, session.limits),
        serverNameFormat: session.serverNameFormat,
        inviteRequirement: session.inviteRequirement,
        cooldownHours: session.cooldownHours,
        maxServersPerUser: session.maxServersPerUser,
        provisioningMode: normalizeProvisioningMode(session.provisioningMode),
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
        panelConfigRef: `${session.provider}:${defaultNode.location}`,
        inviteRequirement: session.inviteRequirement,
        provisioningMode: normalizeProvisioningMode(session.provisioningMode),
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
            { name: 'Default Node', value: `\`${defaultNode.name}\` (\`${defaultNode.id}\`)`, inline: true },
            { name: 'Panel Node ID', value: `\`${defaultNode.panelNodeId}\``, inline: true },
            { name: 'Total Nodes', value: String(normalizedNodes.length), inline: true },
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
    if (type !== 'menu') return interaction.deferUpdate();

    if (parts[2] === 'reward_create') {
      const selectedRewardId = interaction.values[0];
      await interaction.deferUpdate();
      if (admin) {
        const data = ServerProvision.ensureGuild(guildId);
        const panelSetup = data.panelSetup;
        if (!panelSetup) {
          return interaction.followUp({
            embeds: [errorEmbed('Panel setup is not configured yet. Ask an admin to run **Setup Panel** first.')],
            flags: MessageFlags.Ephemeral,
          });
        }
        const nodes = getConfiguredNodes(panelSetup);
        pendingAdminRewardSelections.set(setupKey(guildId, userId), {
          rewardId: selectedRewardId,
          expiresAt: Date.now() + 60_000,
        });
        return interaction.followUp({
          embeds: [embed({
            title: '🧩 Select Provisioning Node',
            color: Colors.info,
            description: 'Choose **Automatic** to use the default node, or select a specific node for this provisioning request.',
          })],
          components: [
            new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId('server:menu:reward_node_select')
                .setPlaceholder('Select node mode')
                .addOptions(buildNodeSelectOptions({ nodes, defaultNodeId: panelSetup.defaultNodeId }, true)),
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }
      return provisionRewardClaim(interaction, { selectedRewardId, selectedNodeId: 'auto' });
    }

    if (parts[2] === 'reward_node_select') {
      await interaction.deferUpdate();
      const pending = pendingAdminRewardSelections.get(setupKey(guildId, userId));
      pendingAdminRewardSelections.delete(setupKey(guildId, userId));
      if (!pending || pending.expiresAt < Date.now()) {
        return interaction.followUp({
          embeds: [errorEmbed('Reward provisioning selection expired. Start again from **Create Server**.')],
          flags: MessageFlags.Ephemeral,
        });
      }
      const selectedNodeId = interaction.values[0] ?? 'auto';
      return provisionRewardClaim(interaction, {
        selectedRewardId: pending.rewardId,
        selectedNodeId,
      });
    }

    if (parts[2] === 'wiz_node_edit_select') {
      const session = getSession(guildId, userId);
      if (!session || !admin) {
        return interaction.reply({ embeds: [errorEmbed('Setup session expired or missing permissions.')], flags: MessageFlags.Ephemeral });
      }
      const node = (session.nodes ?? []).find((entry) => entry.id === interaction.values[0]);
      if (!node) {
        return interaction.reply({ embeds: [errorEmbed('Selected node was not found in this setup session.')], flags: MessageFlags.Ephemeral });
      }
      const modal = new ModalBuilder().setCustomId(`server:modal:wiz_node_edit:${node.id}`).setTitle('Edit Panel Node');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Node Name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setValue(node.name)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('location').setLabel('Location').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setValue(node.location)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('panelid').setLabel('Panel Node ID').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setValue(node.panelNodeId)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('limits').setLabel('Available RAM,CPU,Disk').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(40).setValue(`${node.available.ramMb},${node.available.cpuPercent},${node.available.diskMb}`)),
      );
      return interaction.showModal(modal);
    }

    if (parts[2] === 'wiz_node_remove_select') {
      const session = getSession(guildId, userId);
      if (!session || !admin) {
        return interaction.reply({ embeds: [errorEmbed('Setup session expired or missing permissions.')], flags: MessageFlags.Ephemeral });
      }
      const nodeId = interaction.values[0];
      session.nodes = (session.nodes ?? []).filter((node) => node.id !== nodeId);
      if (session.defaultNodeId === nodeId) {
        session.defaultNodeId = session.nodes[0]?.id ?? null;
      }
      await interaction.deferUpdate();
      return interaction.followUp({
        embeds: [embed({ title: '✅ Node Removed', color: Colors.success, description: `Removed node \`${nodeId}\` from this setup session.` })],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (parts[2] === 'wiz_node_default_select') {
      const session = getSession(guildId, userId);
      if (!session || !admin) {
        return interaction.reply({ embeds: [errorEmbed('Setup session expired or missing permissions.')], flags: MessageFlags.Ephemeral });
      }
      const nodeId = interaction.values[0];
      if (!(session.nodes ?? []).some((node) => node.id === nodeId)) {
        return interaction.reply({ embeds: [errorEmbed('Selected node was not found in this setup session.')], flags: MessageFlags.Ephemeral });
      }
      session.defaultNodeId = nodeId;
      const node = session.nodes.find((entry) => entry.id === nodeId);
      if (node) {
        session.nodeLocation = node.location;
        session.limits = normalizeNodeLimits(node.available, session.limits);
      }
      await interaction.deferUpdate();
      return interaction.followUp({
        embeds: [embed({ title: '✅ Default Node Updated', color: Colors.success, description: `Default node is now \`${nodeId}\`.` })],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (parts[2] === 'mode_select') {
      const session = getSession(guildId, userId);
      if (!session) {
        return interaction.reply({ embeds: [errorEmbed('Setup session expired. Click **Setup Panel** again.')], flags: MessageFlags.Ephemeral });
      }
      if (!admin) {
        return interaction.reply({ embeds: [errorEmbed('Only administrators can modify setup.')], flags: MessageFlags.Ephemeral });
      }
      session.provisioningMode = normalizeProvisioningMode(interaction.values[0]);
      session.step = 11;
      session.lastApiTest = null;
      return interaction.update(setupPayload(session));
    }

    if (parts[2] !== 'provider') return interaction.deferUpdate();
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

    if (field === 'wiz_node_add' || field === 'wiz_node_edit' || field === 'wiz_reward_node_assign') {
      const session = getSession(guildId, userId);
      if (!session) {
        return interaction.reply({ embeds: [errorEmbed('Setup session expired. Click **Setup Panel** again.')], flags: MessageFlags.Ephemeral });
      }
      if (!admin) {
        return interaction.reply({ embeds: [errorEmbed('Only administrators can modify setup.')], flags: MessageFlags.Ephemeral });
      }

      if (field === 'wiz_reward_node_assign') {
        const rewardId = interaction.fields.getTextInputValue('rewardid').trim().slice(0, 80);
        const nodeId = interaction.fields.getTextInputValue('nodeid').trim().slice(0, 80);
        if (!rewardId) {
          return interaction.reply({ embeds: [errorEmbed('Reward plan ID is required.')], flags: MessageFlags.Ephemeral });
        }
        const data = ServerProvision.ensureGuild(guildId);
        const rewards = Array.isArray(data.inviteRewards) ? data.inviteRewards : [];
        let targetReward = rewards.find((reward) => reward.id === rewardId);
        if (!targetReward && rewardId === 'legacy-default') {
          const legacyReward = getInviteRewardPlans(data, data.panelSetup).find((reward) => reward.id === 'legacy-default');
          if (legacyReward) {
            targetReward = {
              ...legacyReward,
              createdAt: legacyReward.createdAt ?? new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            rewards.push(targetReward);
          }
        }
        if (!targetReward) {
          return interaction.reply({ embeds: [errorEmbed(`Reward plan \`${rewardId}\` was not found in configured invite rewards.`)], flags: MessageFlags.Ephemeral });
        }
        if (nodeId) {
          const node = (session.nodes ?? []).find((entry) => entry.id === nodeId);
          if (!node) {
            return interaction.reply({ embeds: [errorEmbed(`Node \`${nodeId}\` is not configured in this setup session.`)], flags: MessageFlags.Ephemeral });
          }
          targetReward.nodeId = node.id;
          targetReward.nodeLocation = node.location;
        } else {
          delete targetReward.nodeId;
          delete targetReward.nodeLocation;
        }
        targetReward.updatedAt = new Date().toISOString();
        ServerProvision.updateGuild(guildId, { inviteRewards: rewards });
        return interaction.reply({
          embeds: [embed({
            title: '✅ Reward Plan Node Updated',
            color: Colors.success,
            description: nodeId
              ? `Reward \`${rewardId}\` now targets node \`${nodeId}\`.`
              : `Reward \`${rewardId}\` now uses automatic/default node selection.`,
          })],
          flags: MessageFlags.Ephemeral,
        });
      }

      const name = interaction.fields.getTextInputValue('name').trim().slice(0, 80);
      const location = interaction.fields.getTextInputValue('location').trim().slice(0, 80);
      const panelNodeId = interaction.fields.getTextInputValue('panelid').trim().slice(0, 80);
      const limitsRaw = interaction.fields.getTextInputValue('limits').trim();
      const [ramRaw, cpuRaw, diskRaw] = limitsRaw.split(',').map((part) => part.trim());
      const ramMb = parseNonNegativeInt(ramRaw);
      const cpuPercent = parseNonNegativeInt(cpuRaw);
      const diskMb = parseNonNegativeInt(diskRaw);
      if (!name || !location || !panelNodeId) {
        return interaction.reply({ embeds: [errorEmbed('Node name, location, and panel node ID are required.')], flags: MessageFlags.Ephemeral });
      }
      if (
        !ramRaw || !cpuRaw || !diskRaw ||
        !Number.isFinite(ramMb) || !Number.isFinite(cpuPercent) || !Number.isFinite(diskMb) ||
        ramMb <= 0 || cpuPercent <= 0 || diskMb <= 0
      ) {
        return interaction.reply({
          embeds: [errorEmbed('Invalid limits format. Use `RAM,CPU,Disk` with values greater than 0.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const nowIso = new Date().toISOString();
      if (field === 'wiz_node_add') {
        const newNode = {
          id: randomUUID(),
          name,
          location,
          panelNodeId,
          available: { ramMb, cpuPercent, diskMb },
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        if (!Array.isArray(session.nodes)) session.nodes = [];
        session.nodes.push(newNode);
        if (!session.defaultNodeId) session.defaultNodeId = newNode.id;
        return interaction.reply({
          embeds: [embed({
            title: '✅ Node Added',
            color: Colors.success,
            description: `Added node **${newNode.name}** (\`${newNode.id}\`).`,
          })],
          flags: MessageFlags.Ephemeral,
        });
      }

      const editNodeId = parts[3];
      const node = (session.nodes ?? []).find((entry) => entry.id === editNodeId);
      if (!node) {
        return interaction.reply({ embeds: [errorEmbed('Node to edit was not found in this setup session.')], flags: MessageFlags.Ephemeral });
      }
      node.name = name;
      node.location = location;
      node.panelNodeId = panelNodeId;
      node.available = { ramMb, cpuPercent, diskMb };
      node.updatedAt = nowIso;
      if (session.defaultNodeId === node.id) {
        session.nodeLocation = node.location;
        session.limits = normalizeNodeLimits(node.available, session.limits);
      }
      return interaction.reply({
        embeds: [embed({ title: '✅ Node Updated', color: Colors.success, description: `Updated node \`${node.id}\`.` })],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (field === 'admin_reset' || field === 'admin_suspend' || field === 'admin_delete' || field === 'admin_user_servers' || field === 'admin_manual_create') {
      if (!admin) {
        return interaction.reply({ embeds: [errorEmbed('Only administrators can use this control.')], flags: MessageFlags.Ephemeral });
      }

      const data = ServerProvision.ensureGuild(guildId);
      const panelSetup = data.panelSetup;
      const targetUserId = interaction.fields.getTextInputValue('userid').trim();

      if (!/^\d{17,20}$/.test(targetUserId)) {
        return interaction.reply({ embeds: [errorEmbed('Invalid Discord user ID.')], flags: MessageFlags.Ephemeral });
      }

      if (field === 'admin_user_servers') {
        const records = Array.isArray(data.createdServerRecords?.[targetUserId]) ? data.createdServerRecords[targetUserId] : [];
        const lines = records.length
          ? records.slice(-20).map((rec) => `• \`${getRecordServerId(rec)}\` • ${rec.name ?? 'Unnamed'} • ${rec.status ?? 'active'}`).join('\n')
          : 'No servers recorded for this user.';
        return interaction.reply({
          embeds: [embed({
            title: '📦 User Server Records',
            color: Colors.info,
            fields: [
              { name: 'User', value: `<@${targetUserId}> (\`${targetUserId}\`)`, inline: false },
              { name: 'Server Count', value: String(records.length), inline: true },
              { name: 'Records', value: lines, inline: false },
            ],
          })],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (field === 'admin_manual_create') {
        if (!panelSetup) {
          return interaction.reply({ embeds: [errorEmbed('Panel setup is not configured yet.')], flags: MessageFlags.Ephemeral });
        }
        const mode = getProvisionMode(data, panelSetup);
        if (mode !== 'manual_admin') {
          return interaction.reply({
            embeds: [errorEmbed('Manual provisioning is only available when provisioning mode is set to **Manual Admin Mode**.')],
            flags: MessageFlags.Ephemeral,
          });
        }
        const endpoint = getPanelApiEndpoint(panelSetup, 'create');
        if (!endpoint) {
          return interaction.reply({ embeds: [errorEmbed('Invalid panel API base URL in setup. Re-run setup and save again.')], flags: MessageFlags.Ephemeral });
        }

        const limitsRaw = interaction.fields.getTextInputValue('limits').trim();
        const [ramRaw, cpuRaw, diskRaw] = limitsRaw.split(',').map((part) => part.trim());
        const ramMb = parseNonNegativeInt(ramRaw);
        const cpuPercent = parseNonNegativeInt(cpuRaw);
        const diskMb = parseNonNegativeInt(diskRaw);
        if (
          !ramRaw || !cpuRaw || !diskRaw ||
          !Number.isFinite(ramMb) || !Number.isFinite(cpuPercent) || !Number.isFinite(diskMb) ||
          ramMb <= 0 || cpuPercent <= 0 || diskMb <= 0
        ) {
          return interaction.reply({
            embeds: [errorEmbed('Invalid limits format. Use `RAM,CPU,Disk` with values greater than 0.')],
            flags: MessageFlags.Ephemeral,
          });
        }

        const nodeSelector = interaction.fields.getTextInputValue('node').trim().slice(0, 80);
        const resolvedNode = await resolveProvisionNode(guildId, panelSetup, { nodeId: nodeSelector || 'auto' });
        if (!resolvedNode.ok) {
          return interaction.reply({
            embeds: [errorEmbed(resolvedNode.error)],
            flags: MessageFlags.Ephemeral,
          });
        }
        const nodeLocation = resolvedNode.node.location;
        const eggTemplate = interaction.fields.getTextInputValue('egg').trim().slice(0, 80) || panelSetup.eggTemplate;
        if (!nodeLocation || !eggTemplate) {
          return interaction.reply({
            embeds: [errorEmbed('Node/Location and Egg/Template are required (either set in setup or provided here).')],
            flags: MessageFlags.Ephemeral,
          });
        }
        if (!isSafeProvisionIdentifier(eggTemplate)) {
          return interaction.reply({
            embeds: [errorEmbed('Egg/Template can only contain letters, numbers, `.`, `_`, `:`, and `-`.')],
            flags: MessageFlags.Ephemeral,
          });
        }

        let targetUser = null;
        try {
          targetUser = await interaction.client.users.fetch(targetUserId);
        } catch {
          return interaction.reply({ embeds: [errorEmbed('Target user could not be fetched from Discord.')], flags: MessageFlags.Ephemeral });
        }

        const idempotencyKey = `${guildId}:${targetUserId}:${randomUUID()}`;
        const payload = buildProvisionPayload(panelSetup, null, targetUser, idempotencyKey, 0, {
          source: 'manual_admin',
          resolvedNode: resolvedNode.node,
          eggTemplate,
          limits: { ramMb, cpuPercent, diskMb },
          provisionedBy: userId,
        });
        const provision = await callPanelApi(panelSetup, 'POST', endpoint, payload);
        if (!provision.ok) {
          return interaction.reply({
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
          logger.warn('Manual panel provisioning response missing server ID; using external ID fallback.');
        }
        const record = {
          id: idempotencyKey,
          panelServerId: String(panelServerId),
          name: payload.name,
          provider: panelSetup.provider,
          rewardPlanId: null,
          rewardPlanName: 'Manual Admin Provision',
          status: 'active',
          createdAt: createdAtIso,
          inviteCountAtClaim: null,
          createdBy: userId,
          createdFor: targetUserId,
          source: 'manual_admin',
          nodeId: resolvedNode.node.id,
          panelNodeId: resolvedNode.node.panelNodeId,
          nodeLocation,
          eggTemplate,
          limits: { ramMb, cpuPercent, diskMb },
        };
        if (!Array.isArray(data.createdServerRecords[targetUserId])) {
          data.createdServerRecords[targetUserId] = [];
        }
        data.createdServerRecords[targetUserId].push(record);
        ServerProvision.updateGuild(guildId, { createdServerRecords: data.createdServerRecords });

        await sendAdminLog(interaction.guild, {
          embeds: [embed({
            title: '🆕 Manual Server Provisioned',
            color: Colors.info,
            fields: [
              { name: 'Target User', value: `<@${targetUserId}> (\`${targetUserId}\`)`, inline: false },
              { name: 'Server ID', value: `\`${record.panelServerId}\``, inline: true },
              { name: 'Server Name', value: `\`${record.name}\``, inline: true },
              { name: 'Provisioned By', value: `<@${userId}>`, inline: true },
              { name: 'Node / Egg', value: `\`${resolvedNode.node.name}\` (\`${resolvedNode.node.id}\`) / \`${eggTemplate}\``, inline: false },
              { name: 'Limits', value: `\`${ramMb}MB / ${cpuPercent}% / ${diskMb}MB\``, inline: false },
            ],
          })],
        });

        return interaction.reply({
          embeds: [embed({
            title: '✅ Manual Provision Complete',
            color: Colors.success,
            description: `Created server \`${record.panelServerId}\` for <@${targetUserId}>.`,
            fields: [
              { name: 'Node / Egg', value: `\`${resolvedNode.node.name}\` (\`${resolvedNode.node.id}\`) / \`${eggTemplate}\``, inline: false },
              { name: 'Limits', value: `\`${ramMb}MB / ${cpuPercent}% / ${diskMb}MB\``, inline: false },
            ],
          })],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (field === 'admin_reset') {
        const claims = data.userClaims ?? {};
        const cooldowns = data.cooldowns ?? {};
        claims[targetUserId] = {
          claimed: false,
          claimCount: 0,
          lastClaimAt: null,
          lastInviteSnapshot: null,
          rewardClaims: {},
        };
        if (cooldowns[targetUserId]) {
          const keysToDelete = Object.keys(cooldowns[targetUserId]).filter((key) => key.startsWith('reward:') || key === 'nextClaimAt');
          for (const key of keysToDelete) {
            delete cooldowns[targetUserId][key];
          }
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
      upsertLegacyNodeInSession(session);
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
      upsertLegacyNodeInSession(session);
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
