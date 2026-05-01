import { get, set, del, getAll } from './db.js';
import { randomUUID } from 'crypto';

const COLLECTION = 'tickets';

export const Ticket = {
  create: (data) => {
    const id = randomUUID();
    const ticket = {
      id,
      guildId: data.guildId,
      panelId: data.panelId,
      channelId: data.channelId,
      userId: data.userId,
      username: data.username,
      ticketType: data.ticketType ?? 'support',
      ticketNumber: data.ticketNumber ?? 1,
      status: 'open',
      claimedBy: null,
      priority: data.priority ?? 'normal',
      addedUsers: [],
      modalAnswers: data.modalAnswers ?? {},
      openTime: Date.now(),
      closeTime: null,
      closeReason: null,
      closedBy: null,
      transcriptPath: null,
      lastActivity: Date.now(),
    };
    set(COLLECTION, id, ticket);
    return ticket;
  },
  get: (id) => get(COLLECTION, id),
  getByChannel: (channelId) => Object.values(getAll(COLLECTION)).find(t => t.channelId === channelId) ?? null,
  update: (id, patch) => {
    const t = Ticket.get(id);
    if (!t) return null;
    const updated = { ...t, ...patch, lastActivity: Date.now() };
    set(COLLECTION, id, updated);
    return updated;
  },
  delete: (id) => del(COLLECTION, id),
  forUser: (guildId, userId) => Object.values(getAll(COLLECTION)).filter(t => t.guildId === guildId && t.userId === userId),
  forGuild: (guildId) => Object.values(getAll(COLLECTION)).filter(t => t.guildId === guildId),
  openForUser: (guildId, userId) => Object.values(getAll(COLLECTION)).filter(t => t.guildId === guildId && t.userId === userId && t.status === 'open'),
  openForPanel: (panelId) => Object.values(getAll(COLLECTION)).filter(t => t.panelId === panelId && t.status === 'open'),
  nextNumber: (guildId) => {
    const tickets = Object.values(getAll(COLLECTION)).filter(t => t.guildId === guildId);
    return tickets.length === 0 ? 1 : Math.max(...tickets.map(t => t.ticketNumber || 1)) + 1;
  },
  stats: (guildId) => {
    const all = Object.values(getAll(COLLECTION)).filter(t => t.guildId === guildId);
    const now = Date.now();
    const day = 86400000;
    return {
      total: all.length,
      open: all.filter(t => t.status === 'open').length,
      closed: all.filter(t => t.status === 'closed').length,
      today: all.filter(t => t.openTime > now - day).length,
      week: all.filter(t => t.openTime > now - 7 * day).length,
    };
  },
};
