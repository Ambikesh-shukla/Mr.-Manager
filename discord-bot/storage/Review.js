import { get, set, del, getAll } from './db.js';
import { randomUUID } from 'crypto';

const COLLECTION = 'reviews';

export const Review = {
  create: (guildId, data) => {
    const id = randomUUID();
    const review = {
      id, guildId,
      userId: data.userId,
      username: data.username,
      rating: data.rating ?? 5,
      content: data.content,
      service: data.service ?? '',
      approved: false,
      messageId: null,
      createdAt: Date.now(),
    };
    set(COLLECTION, id, review);
    return review;
  },
  get: (id) => get(COLLECTION, id),
  update: (id, patch) => { const r = Review.get(id); if (!r) return null; const u = {...r,...patch}; set(COLLECTION,id,u); return u; },
  delete: (id) => del(COLLECTION, id),
  forGuild: (guildId) => Object.values(getAll(COLLECTION)).filter(r => r.guildId === guildId),
  pending: (guildId) => Object.values(getAll(COLLECTION)).filter(r => r.guildId === guildId && !r.approved),
};
