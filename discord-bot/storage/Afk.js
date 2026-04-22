import { get, set, del, getAll } from './db.js';

const COLLECTION = 'afk';

const key = (guildId, userId) => `${guildId}:${userId}`;

export const Afk = {
  set: (guildId, userId, reason) => {
    const data = { guildId, userId, reason: reason || 'AFK', since: Date.now() };
    set(COLLECTION, key(guildId, userId), data);
    return data;
  },
  get: (guildId, userId) => get(COLLECTION, key(guildId, userId)),
  remove: (guildId, userId) => del(COLLECTION, key(guildId, userId)),
  forGuild: (guildId) => Object.values(getAll(COLLECTION)).filter(a => a.guildId === guildId),
};
