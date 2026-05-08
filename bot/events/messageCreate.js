import { PermissionFlagsBits } from 'discord.js';
import { GuildConfig } from '../storage/GuildConfig.js';
import { Afk } from '../storage/Afk.js';
import { SetupSession } from '../storage/SetupSession.js';
import { PostEmbedSession } from '../storage/PostEmbedSession.js';
import { LinkConfig } from '../storage/LinkConfig.js';
import { handleWizardMessage } from '../handlers/setupHandler.js';
import { handlePostEmbedWizardMessage } from '../handlers/postHandler.js';
import { logger } from '../utils/logger.js';

const afkMentionCooldown = new Map();
const COOLDOWN_MS = 30_000;

// Matches http(s)://, www., discord.gg/, discord.com/invite/, and common TLDs
const LINK_REGEX = /https?:\/\/|www\.|discord\.gg\/|discord\.com\/invite\/|\S+\.(com|net|org|gg|io|xyz|me|in)(?:\/|\s|$)/i;

const BOT_OWNER_ID = process.env.BOT_OWNER_ID ?? null;

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

    // ── Wizard message collector ─────────────────────────────────────────────
    const wizardSession = SetupSession.getWaitingInChannel(message.guild.id, message.channelId);
    if (wizardSession && message.author.id === wizardSession.userId) {
      await handleWizardMessage(message, wizardSession);
      return;
    }

    // ── /post embed wizard message collector ──────────────────────────────────
    const postEmbedSession = PostEmbedSession.getWaitingInChannel(message.guild.id, message.channelId, message.author.id);
    if (postEmbedSession && message.author.id === postEmbedSession.userId) {
      await handlePostEmbedWizardMessage(message, postEmbedSession);
      return;
    }

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

    // ── Link blocking ─────────────────────────────────────────────────────────
    const linkCfg = LinkConfig.get(message.guild.id);
    if (linkCfg.enabled && LINK_REGEX.test(message.content)) {
      let canBypass = false;
      if (linkCfg.allowOwner && message.guild.ownerId === message.author.id) canBypass = true;
      if (!canBypass && linkCfg.allowAdmins && message.member?.permissions.has(PermissionFlagsBits.Administrator)) canBypass = true;
      if (!canBypass && linkCfg.allowBotOwner && BOT_OWNER_ID && message.author.id === BOT_OWNER_ID) canBypass = true;
      if (!canBypass && linkCfg.allowedUsers.includes(message.author.id)) canBypass = true;

      if (!canBypass) {
        try {
          await message.delete();
        } catch (err) {
          if (err.code !== 10008) logger.warn('Failed to delete link message', err);
        }
        try {
          const warn = await message.channel.send({
            content: `🔗 <@${message.author.id}>, links are not allowed in this server.`,
            allowedMentions: { users: [message.author.id] },
          });
          setTimeout(() => warn.delete().catch(() => {}), 5000);
        } catch (err) {
          logger.warn('Failed to send link warning', err);
        }
        return;
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
