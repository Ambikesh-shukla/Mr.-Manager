import { get, set, del, getAll } from './db.js';
import { randomUUID } from 'crypto';

const COLLECTION = 'orders';
const STATUSES = ['pending', 'in-progress', 'delivered', 'cancelled', 'refunded'];

export const Order = {
  create: (guildId, data) => {
    const id = randomUUID();
    const order = {
      id, guildId,
      userId: data.userId,
      username: data.username,
      planName: data.planName ?? '',
      notes: data.notes ?? '',
      status: 'pending',
      assignedTo: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    set(COLLECTION, id, order);
    return order;
  },
  get: (id) => get(COLLECTION, id),
  update: (id, patch) => { const o = Order.get(id); if (!o) return null; const u = {...o,...patch,updatedAt:Date.now()}; set(COLLECTION,id,u); return u; },
  delete: (id) => del(COLLECTION, id),
  forGuild: (guildId) => Object.values(getAll(COLLECTION)).filter(o => o.guildId === guildId),
  forUser: (guildId, userId) => Object.values(getAll(COLLECTION)).filter(o => o.guildId === guildId && o.userId === userId),
  STATUSES,
};
