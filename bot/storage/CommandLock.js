import { get, set, del, getAll } from './db.js';

const COLLECTION = 'commandlocks';

// Structure per guild: { 'command-name': { mode: 'public'|'admin'|'staff'|'role', roleId?: string } }

export const CommandLock = {
  getAll(guildId) {
    const all = getAll(COLLECTION);
    return all[guildId] ?? {};
  },

  get(guildId, commandName) {
    const guild = this.getAll(guildId);
    return guild[commandName] ?? null;
  },

  set(guildId, commandName, mode, roleId = null) {
    const guild = this.getAll(guildId);
    guild[commandName] = { mode, ...(roleId ? { roleId } : {}) };
    set(COLLECTION, guildId, guild);
  },

  reset(guildId, commandName) {
    const guild = this.getAll(guildId);
    delete guild[commandName];
    set(COLLECTION, guildId, guild);
  },

  resetAll(guildId) {
    del(COLLECTION, guildId);
  },
};
