import { logger } from './logger.js';
import { ServerProvision } from '../storage/ServerProvision.js';

const DEFAULT_LIMITS = { ramMb: 4096, cpuPercent: 100, diskMb: 10240 };
const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;

function toNonNegativeInt(value, fallback = 0) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(0, n);
}

function toMinInt(value, min, fallback) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, n);
}

function rewardIdFromData(value) {
  const id = String(value ?? '').trim().slice(0, 80);
  if (!id) return null;
  return id;
}

function normalizeLimits(raw, fallback = DEFAULT_LIMITS) {
  return {
    ramMb: toMinInt(raw?.ramMb, 1, fallback.ramMb),
    cpuPercent: toMinInt(raw?.cpuPercent, 1, fallback.cpuPercent),
    diskMb: toMinInt(raw?.diskMb, 1, fallback.diskMb),
  };
}

function normalizeReward(raw, fallback = {}) {
  const invitesRequired = toNonNegativeInt(raw?.invitesRequired, toNonNegativeInt(fallback.invitesRequired, 0));
  const fallbackMaxClaims = toMinInt(fallback.maxClaims, 1, 1);
  const fallbackCooldownHours = toNonNegativeInt(fallback.cooldownHours, 0);
  const maxClaims = toMinInt(raw?.maxClaims, 1, fallbackMaxClaims);
  const cooldownHours = toNonNegativeInt(raw?.cooldownHours, fallbackCooldownHours);
  const limits = normalizeLimits(raw?.limits, normalizeLimits(fallback?.limits));
  const id = rewardIdFromData(raw?.id ?? fallback.id);
  const name = String(raw?.name ?? fallback.name ?? `${invitesRequired} Invites Reward`).trim().slice(0, 80);

  return {
    id,
    name: name || `${invitesRequired} Invites Reward`,
    invitesRequired,
    limits,
    nodeId: String(raw?.nodeId ?? fallback.nodeId ?? '').trim().slice(0, 80),
    nodeLocation: String(raw?.nodeLocation ?? fallback.nodeLocation ?? '').trim().slice(0, 80),
    eggTemplate: String(raw?.eggTemplate ?? fallback.eggTemplate ?? '').trim().slice(0, 80),
    maxClaims,
    cooldownHours,
    available: raw?.available !== false,
    createdAt: raw?.createdAt ?? fallback.createdAt ?? null,
    updatedAt: raw?.updatedAt ?? fallback.updatedAt ?? null,
  };
}

export function getLegacyRewardPlan(data, panelSetup) {
  const invitesRequired = toNonNegativeInt(panelSetup?.inviteRequirement ?? data?.inviteRequirement ?? 0);
  const limits = normalizeLimits(panelSetup?.limits, DEFAULT_LIMITS);
  return normalizeReward(
    {
      id: 'legacy-default',
      name: `${invitesRequired} Invites Reward`,
      invitesRequired,
      limits,
      nodeId: panelSetup?.defaultNodeId ?? '',
      nodeLocation: panelSetup?.nodeLocation ?? '',
      eggTemplate: panelSetup?.eggTemplate ?? '',
      maxClaims: 1,
      cooldownHours: toNonNegativeInt(panelSetup?.cooldownHours ?? 0),
      available: true,
    },
    {},
  );
}

export function getInviteRewardPlans(data, panelSetup) {
  const configured = Array.isArray(data?.inviteRewards) ? data.inviteRewards : [];
  if (configured.length === 0) {
    return [getLegacyRewardPlan(data, panelSetup)];
  }

  const deduped = new Map();
  for (const raw of configured) {
    const reward = normalizeReward(raw, {
      limits: panelSetup?.limits ?? DEFAULT_LIMITS,
      nodeId: panelSetup?.defaultNodeId ?? '',
      nodeLocation: panelSetup?.nodeLocation ?? '',
      eggTemplate: panelSetup?.eggTemplate ?? '',
      cooldownHours: panelSetup?.cooldownHours ?? 0,
    });
    if (!reward.id) continue;
    deduped.set(reward.id, reward);
  }
  return [...deduped.values()].sort((a, b) => a.invitesRequired - b.invitesRequired);
}

export function getUserInviteCount(invites, userId) {
  let total = 0;
  for (const inv of invites.values()) {
    if (inv.inviter?.id !== userId) continue;
    if (!Number.isFinite(inv.uses)) continue;
    total += inv.uses;
  }
  return total;
}

function normalizeInviteJoinEntry(raw) {
  const joinedAt = raw?.joinedAt ?? new Date().toISOString();
  return {
    inviterId: raw?.inviterId ? String(raw.inviterId) : null,
    invitedUserId: raw?.invitedUserId ? String(raw.invitedUserId) : null,
    inviteCode: raw?.inviteCode ? String(raw.inviteCode) : null,
    joinedAt,
    accountCreatedAt: raw?.accountCreatedAt ?? null,
    isFake: raw?.isFake === true,
    isRejoin: raw?.isRejoin === true,
  };
}

export function isLikelyFakeInvite({ joinedAt, accountCreatedAt }) {
  const joinedMs = Date.parse(joinedAt);
  const createdMs = Date.parse(accountCreatedAt);
  if (!Number.isFinite(joinedMs) || !Number.isFinite(createdMs)) return false;
  return (joinedMs - createdMs) < THREE_MONTHS_MS;
}

export function getInviteJoinEntries(data) {
  const entries = Array.isArray(data?.inviteJoins) ? data.inviteJoins : [];
  return entries.map((entry) => normalizeInviteJoinEntry(entry));
}

export function recordInviteJoin(data, entry) {
  if (!Array.isArray(data.inviteJoins)) data.inviteJoins = [];
  const normalized = normalizeInviteJoinEntry(entry);
  data.inviteJoins.push(normalized);
  return normalized;
}

export function getInviteStatsForMember(data, userId) {
  const stats = {
    total: 0,
    real: 0,
    fake: 0,
    rejoin: 0,
  };

  for (const entry of getInviteJoinEntries(data)) {
    if (entry.inviterId !== userId) continue;
    if (entry.isRejoin) {
      stats.rejoin += 1;
      continue;
    }
    stats.total += 1;
    if (entry.isFake) stats.fake += 1;
    else stats.real += 1;
  }

  return stats;
}

export function getRealInviteCountForMember(data, userId) {
  return getInviteStatsForMember(data, userId).real;
}

export async function fetchInviteCountForMember(guild, userId) {
  try {
    const data = ServerProvision.ensureGuild(guild.id);
    return getRealInviteCountForMember(data, userId);
  } catch (err) {
    logger.warn(`Failed to resolve stored invite count for guild ${guild?.id ?? 'unknown'} user ${userId}: ${err?.message ?? 'unknown error'}`);
    return 0;
  }
}

function getCooldownKeyForReward(rewardId) {
  return `reward:${rewardId}`;
}

export function getRewardClaimState(userClaim, rewardId) {
  const rewardClaims = userClaim?.rewardClaims && typeof userClaim.rewardClaims === 'object'
    ? userClaim.rewardClaims
    : {};
  const rewardClaim = rewardClaims[rewardId] ?? {};
  return {
    claimCount: toNonNegativeInt(rewardClaim.claimCount, 0),
    lastClaimAt: rewardClaim.lastClaimAt ?? null,
    lastInviteSnapshot: rewardClaim.lastInviteSnapshot ?? null,
  };
}

export function getRewardCooldown(cooldowns, rewardId) {
  if (!cooldowns || typeof cooldowns !== 'object') return 0;
  const key = getCooldownKeyForReward(rewardId);
  const nextAt = Number(cooldowns[key]);
  return Number.isFinite(nextAt) && nextAt > 0 ? nextAt : 0;
}

export function setRewardCooldown(cooldowns, rewardId, nextAt) {
  const key = getCooldownKeyForReward(rewardId);
  if (nextAt > 0) cooldowns[key] = nextAt;
  else delete cooldowns[key];
}

export function getRewardEligibility({ data, panelSetup, userId, inviteCount, reward, now = Date.now() }) {
  const maxServersPerUser = Math.max(1, Number(panelSetup?.maxServersPerUser) || 1);
  const servers = Array.isArray(data?.createdServerRecords?.[userId]) ? data.createdServerRecords[userId] : [];
  const userClaim = data?.userClaims?.[userId] ?? null;
  const rewardClaim = getRewardClaimState(userClaim, reward.id);
  const cooldowns = data?.cooldowns?.[userId] ?? {};
  const nextClaimAt = getRewardCooldown(cooldowns, reward.id);
  const remainingInvites = Math.max(0, reward.invitesRequired - inviteCount);

  if (!reward.available) {
    return { ok: false, reason: 'This reward plan is currently unavailable.', remainingInvites, rewardClaim, nextClaimAt };
  }
  if (inviteCount < reward.invitesRequired) {
    return {
      ok: false,
      reason: `You need **${reward.invitesRequired}** invites for this plan. You currently have **${inviteCount}**.`,
      remainingInvites,
      rewardClaim,
      nextClaimAt,
    };
  }
  if (rewardClaim.claimCount >= reward.maxClaims) {
    return {
      ok: false,
      reason: `You already used this plan **${rewardClaim.claimCount}/${reward.maxClaims}** times.`,
      remainingInvites: 0,
      rewardClaim,
      nextClaimAt,
    };
  }
  if (servers.length >= maxServersPerUser) {
    return {
      ok: false,
      reason: `You have reached the max limit (**${maxServersPerUser}**) of reward servers.`,
      remainingInvites: 0,
      rewardClaim,
      nextClaimAt,
    };
  }
  if (nextClaimAt > now) {
    return {
      ok: false,
      reason: 'You are on cooldown for this reward plan.',
      remainingInvites: 0,
      rewardClaim,
      nextClaimAt,
    };
  }
  return {
    ok: true,
    remainingInvites: 0,
    rewardClaim,
    nextClaimAt,
    maxServersPerUser,
    cooldownHours: reward.cooldownHours,
  };
}
