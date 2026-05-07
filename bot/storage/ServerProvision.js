import { get, set } from './db.js';

const COLLECTION = 'serverprovision';

function defaults(guildId) {
  return {
    guildId,
    panelConfigRef: null,
    panelSetup: null,
    inviteRequirement: 0,
    userClaims: {},
    createdServerRecords: {},
    cooldowns: {},
  };
}

function normalizeGuildData(guildId, data = {}) {
  const base = { ...defaults(guildId), ...data };
  return {
    ...base,
    guildId,
    panelSetup: base.panelSetup && typeof base.panelSetup === 'object' ? base.panelSetup : null,
    userClaims: typeof base.userClaims === 'object' && base.userClaims ? base.userClaims : {},
    createdServerRecords: typeof base.createdServerRecords === 'object' && base.createdServerRecords ? base.createdServerRecords : {},
    cooldowns: typeof base.cooldowns === 'object' && base.cooldowns ? base.cooldowns : {},
  };
}

export const ServerProvision = {
  getGuild(guildId) {
    return normalizeGuildData(guildId, get(COLLECTION, guildId) ?? {});
  },

  setGuild(guildId, data) {
    set(COLLECTION, guildId, normalizeGuildData(guildId, data));
  },

  updateGuild(guildId, patch) {
    ServerProvision.setGuild(guildId, { ...ServerProvision.getGuild(guildId), ...patch });
  },

  ensureGuild(guildId) {
    const data = ServerProvision.getGuild(guildId);
    ServerProvision.setGuild(guildId, data);
    return data;
  },

  ensureUserClaim(guildId, userId) {
    const data = ServerProvision.ensureGuild(guildId);
    if (!data.userClaims[userId]) {
      data.userClaims[userId] = { claimed: false, claimCount: 0, lastClaimAt: null };
      ServerProvision.setGuild(guildId, data);
    }
    return data.userClaims[userId];
  },

  ensureUserServers(guildId, userId) {
    const data = ServerProvision.ensureGuild(guildId);
    if (!Array.isArray(data.createdServerRecords[userId])) {
      data.createdServerRecords[userId] = [];
      ServerProvision.setGuild(guildId, data);
    }
    return data.createdServerRecords[userId];
  },

  ensureUserCooldowns(guildId, userId) {
    const data = ServerProvision.ensureGuild(guildId);
    if (!data.cooldowns[userId] || typeof data.cooldowns[userId] !== 'object') {
      data.cooldowns[userId] = {};
      ServerProvision.setGuild(guildId, data);
    }
    return data.cooldowns[userId];
  },
};
