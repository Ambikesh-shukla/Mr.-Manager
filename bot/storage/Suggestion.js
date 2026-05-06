import { get, set, del, getAll } from './db.js';
import { randomUUID } from 'crypto';

const COLLECTION = 'suggestions';

export const Suggestion = {
  create: (data) => {
    const id = data.id ?? randomUUID();
    const suggestion = {
      id,
      guildId: data.guildId,
      channelId: data.channelId,
      messageId: data.messageId ?? null,
      text: data.text,
      submitterId: data.submitterId,
      upvotes: [],
      downvotes: [],
      createdAt: Date.now(),
    };
    set(COLLECTION, id, suggestion);
    return suggestion;
  },
  get: (id) => get(COLLECTION, id),
  update: (id, patch) => {
    const s = Suggestion.get(id);
    if (!s) return null;
    const updated = { ...s, ...patch };
    set(COLLECTION, id, updated);
    return updated;
  },
  delete: (id) => del(COLLECTION, id),
  forGuild: (guildId) => Object.values(getAll(COLLECTION)).filter(s => s.guildId === guildId),
};
