import { logger } from './logger.js';

const inviteSnapshots = new Map();

function normalizeUses(value) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function inviteUsesMap(invites) {
  const map = new Map();
  for (const invite of invites.values()) {
    map.set(invite.code, normalizeUses(invite.uses));
  }
  return map;
}

export async function primeInviteSnapshotForGuild(guild) {
  if (!guild) return;
  try {
    const invites = await guild.invites.fetch();
    inviteSnapshots.set(guild.id, inviteUsesMap(invites));
  } catch (err) {
    logger.warn(`Failed to prime invite snapshot for guild ${guild?.id ?? 'unknown'}: ${err?.message ?? 'unknown error'}`);
  }
}

export async function primeInviteSnapshotsForClient(client) {
  const guilds = [...client.guilds.cache.values()];
  await Promise.all(guilds.map((guild) => primeInviteSnapshotForGuild(guild)));
}

export async function consumeInviteUsageDelta(guild) {
  try {
    const previous = inviteSnapshots.get(guild.id) ?? new Map();
    const invites = await guild.invites.fetch();
    const current = inviteUsesMap(invites);
    inviteSnapshots.set(guild.id, current);

    let usedInvite = null;
    let maxDelta = 0;
    for (const invite of invites.values()) {
      const delta = normalizeUses(invite.uses) - (previous.get(invite.code) ?? 0);
      if (delta > maxDelta) {
        maxDelta = delta;
        usedInvite = invite;
      }
    }

    return usedInvite;
  } catch (err) {
    logger.warn(`Failed to consume invite delta for guild ${guild?.id ?? 'unknown'}: ${err?.message ?? 'unknown error'}`);
    return null;
  }
}
