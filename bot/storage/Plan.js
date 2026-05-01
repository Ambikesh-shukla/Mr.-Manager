import { get, set, del, getAll } from './db.js';
import { randomUUID } from 'crypto';

const COLLECTION = 'plans';

export const Plan = {
  create: (guildId, data) => {
    const id = randomUUID();
    const plan = {
      id, guildId,
      name: data.name,
      price: data.price,
      ram: data.ram ?? '',
      cpu: data.cpu ?? '',
      storage: data.storage ?? '',
      slots: data.slots ?? '',
      versions: data.versions ?? '',
      description: data.description ?? '',
      emoji: data.emoji ?? '🖥️',
      available: data.available ?? true,
      discount: data.discount ?? '',
      thumbnail: data.thumbnail ?? '',
      banner: data.banner ?? '',
      buyTicketType: data.buyTicketType ?? 'purchase',
      createdAt: Date.now(),
    };
    set(COLLECTION, id, plan);
    return plan;
  },
  get: (id) => get(COLLECTION, id),
  update: (id, patch) => { const p = Plan.get(id); if (!p) return null; const u = {...p,...patch}; set(COLLECTION,id,u); return u; },
  delete: (id) => del(COLLECTION, id),
  forGuild: (guildId) => Object.values(getAll(COLLECTION)).filter(p => p.guildId === guildId),
};
