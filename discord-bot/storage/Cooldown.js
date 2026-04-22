import { get, set, del, getAll } from './db.js';

const COLLECTION = 'cooldowns';

function key(guildId, userId, panelId) {
  return `${guildId}:${userId}:${panelId}`;
}

export const Cooldown = {
  set: (guildId, userId, panelId, hours) => {
    const k = key(guildId, userId, panelId);
    set(COLLECTION, k, { guildId, userId, panelId, expiresAt: Date.now() + hours * 3600000 });
  },
  get: (guildId, userId, panelId) => {
    const k = key(guildId, userId, panelId);
    const entry = get(COLLECTION, k);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      Cooldown.clear(guildId, userId, panelId);
      return null;
    }
    return entry;
  },
  clear: (guildId, userId, panelId) => {
    // Use del() so the removal is persisted to disk
    del(COLLECTION, key(guildId, userId, panelId));
  },
  remaining: (entry) => {
    if (!entry) return '0m';
    const ms = entry.expiresAt - Date.now();
    if (ms <= 0) return '0m';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  },
};
