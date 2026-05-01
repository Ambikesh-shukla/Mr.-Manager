import { GuildConfig } from '../storage/GuildConfig.js';
import { Afk } from '../storage/Afk.js';
import { logger } from '../utils/logger.js';

const afkMentionCooldown = new Map();
const COOLDOWN_MS = 30_000;

function relTime(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default {
  name: 'messageCreate',
  once: false,
  async execute(message) {
    if (message.author.bot || !message.guild) return;

    // ── AFK: auto-remove for the author if they were AFK ────────────────────
    const ownAfk = Afk.get(message.guild.id, message.author.id);
    if (ownAfk) {
      Afk.remove(message.guild.id, message.author.id);
      try {
        const reply = await message.reply({ content: `👋 Welcome back <@${message.author.id}> — AFK removed (was AFK for **${relTime(ownAfk.since)}**).` });
        setTimeout(() => reply.delete().catch(() => {}), 8000);
      } catch (err) {
        logger.error('Failed to send AFK removal message', err);
      }
    }

    // ── AFK: notify if mentions an AFK user ─────────────────────────────────
    if (message.mentions.users.size > 0) {
      const afkLines = [];
      for (const [, user] of message.mentions.users) {
        if (user.bot || user.id === message.author.id) continue;
        const data = Afk.get(message.guild.id, user.id);
        if (!data) continue;
        const cdKey = `${message.guild.id}:${user.id}:${message.channel.id}`;
        const last = afkMentionCooldown.get(cdKey) ?? 0;
        if (Date.now() - last < COOLDOWN_MS) continue;
        afkMentionCooldown.set(cdKey, Date.now());
        afkLines.push(`💤 <@${user.id}> is AFK: **${data.reason}** _(since ${relTime(data.since)} ago)_`);
      }
      if (afkLines.length > 0) {
        try { await message.reply({ content: afkLines.join('\n'), allowedMentions: { parse: [] } }); } catch (err) { logger.error('Failed to send AFK mention notification', err); }
      }
    }

    // ── Auto-responses ──────────────────────────────────────────────────────
    const config = GuildConfig.get(message.guild.id);
    const responses = config.autoResponses ?? [];
    for (const ar of responses) {
      const trigger = ar.trigger?.toLowerCase() ?? '';
      const content = message.content.toLowerCase();
      const matched = ar.exact ? content === trigger : content.includes(trigger);
      if (matched) {
        try { await message.reply({ content: ar.response }); } catch {}
        break;
      }
    }
  },
};
