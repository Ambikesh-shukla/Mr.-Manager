import { EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { logger } from './logger.js';

// ── Theme definitions ─────────────────────────────────────────────────────────
export const THEMES = {
  dark:      { label: 'Dark',      color: 'ffffff', accent: 0x2C2F33, bg: 'https://i.imgur.com/nFXqb2N.jpg' },
  neon:      { label: 'Neon',      color: '00ff99', accent: 0x00ff99, bg: 'https://i.imgur.com/rqFOtcb.jpg' },
  minecraft: { label: 'Minecraft', color: 'a0ff00', accent: 0x4c7a3c, bg: 'https://i.imgur.com/ZuGy0Kb.jpg' },
  minimal:   { label: 'Minimal',   color: '000000', accent: 0xf2f2f2, bg: 'https://i.imgur.com/QmVdFmE.jpg' },
};

const DEFAULT_WELCOME_MSG = 'Welcome to {server}! You are member #{memberCount}.';
const DEFAULT_GOODBYE_MSG  = 'Goodbye {user}! We hope to see you again.';

// ── Placeholder resolver ──────────────────────────────────────────────────────
export function resolvePlaceholders(template, member) {
  return (template ?? '')
    .replace(/{user}/gi,        member.user.username)
    .replace(/{server}/gi,      member.guild.name)
    .replace(/{memberCount}/gi, String(member.guild.memberCount));
}

// ── Image card generation (uses popcat.xyz API — no npm package needed) ───────
const cardCache = new Map(); // url-cache to avoid refetching same card
const CARD_CACHE_TTL = 30_000; // 30 s
const MIN_IMAGE_BYTES = 1024;  // API error payloads are typically < 100 bytes
const PNG_MAGIC  = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8]);

export async function generateWelcomeCard({ username, avatarUrl, backgroundUrl, logoUrl, text, theme = 'dark', textColor }) {
  const themeConfig = THEMES[theme] ?? THEMES.dark;
  const bg = backgroundUrl || themeConfig.bg;
  const color = textColor || themeConfig.color;

  const params = new URLSearchParams({
    background: bg,
    avatar:     avatarUrl,
    username:   username.slice(0, 32),
    text:       text.slice(0, 60),
    color,
  });

  const apiUrl = `https://api.popcat.xyz/welcomecard?${params}`;

  // Return cached buffer if identical request was made recently
  const cached = cardCache.get(apiUrl);
  if (cached && Date.now() - cached.ts < CARD_CACHE_TTL) {
    return cached.result;
  }

  try {
    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(8_000) });
    if (res.ok) {
      const buffer = Buffer.from(await res.arrayBuffer());

      // Validate the buffer is a real image:
      // - must be at least MIN_IMAGE_BYTES (a ~40-byte response is an API error payload, not an image)
      // - must start with PNG (89 50 4E 47) or JPEG (FF D8) magic bytes
      const isPng  = buffer.subarray(0, 4).equals(PNG_MAGIC);
      const isJpeg = buffer.subarray(0, 2).equals(JPEG_MAGIC);
      if (buffer.length < MIN_IMAGE_BYTES || (!isPng && !isJpeg)) {
        logger.warn(`Welcome card API returned invalid image data (${buffer.length} bytes)`);
        return null;
      }

      const result = { type: 'image', buffer };
      cardCache.set(apiUrl, { ts: Date.now(), result });
      return result;
    }
    logger.warn(`Welcome card API returned ${res.status}`);
  } catch (err) {
    logger.warn(`Welcome card API failed: ${err.message}`);
  }

  return null; // caller should fall back to embed
}

// ── Attachment builder from card result ───────────────────────────────────────
export function buildCardAttachment(cardResult, filename = 'welcome.png') {
  return new AttachmentBuilder(cardResult.buffer, { name: filename });
}

// ── Fallback rich embed (used when image generation fails) ────────────────────
export function buildFallbackEmbed({ member, resolvedText, config, section }) {
  const themeConfig = THEMES[config.theme ?? 'dark'] ?? THEMES.dark;
  const isWelcome = section === 'welcome';

  const e = new EmbedBuilder()
    .setColor(themeConfig.accent)
    .setAuthor({ name: isWelcome ? `Welcome to ${member.guild.name}!` : `Goodbye from ${member.guild.name}!`, iconURL: member.guild.iconURL() ?? undefined })
    .setDescription(resolvedText)
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setFooter({ text: `Members: ${member.guild.memberCount}` })
    .setTimestamp();

  if (config.backgroundUrl) e.setImage(config.backgroundUrl);
  if (config.logoUrl)       e.setThumbnail(config.logoUrl);

  return e;
}

// ── Build the full message payload for a welcome/goodbye event ────────────────
export async function buildWelcomePayload({ member, config, section }) {
  const defaultMsg = section === 'welcome' ? DEFAULT_WELCOME_MSG : DEFAULT_GOODBYE_MSG;
  const resolvedText = resolvePlaceholders(config.message || defaultMsg, member);
  const mentionStr   = config.mentionUser ? `${member}` : null;

  // Try image card first
  const card = await generateWelcomeCard({
    username:      member.user.username,
    avatarUrl:     member.user.displayAvatarURL({ extension: 'png', size: 256 }),
    backgroundUrl: config.backgroundUrl,
    logoUrl:       config.logoUrl,
    text:          resolvedText,
    theme:         config.theme,
    textColor:     config.textColor,
  });

  if (card) {
    const filename   = section === 'welcome' ? 'welcome.png' : 'goodbye.png';
    const attachment = buildCardAttachment(card, filename);
    const themeConfig  = THEMES[config.theme ?? 'dark'] ?? THEMES.dark;
    const thumbnailUrl = config.logoUrl || member.guild.iconURL() || null;

    const cardEmbed = new EmbedBuilder()
      .setColor(themeConfig.accent)
      .setImage(`attachment://${filename}`)
      .setFooter({ text: `Members: ${member.guild.memberCount}` })
      .setTimestamp();

    if (thumbnailUrl) cardEmbed.setThumbnail(thumbnailUrl);

    return {
      content: mentionStr ?? undefined,
      embeds:  [cardEmbed],
      files:   [attachment],
    };
  }

  // Fallback embed
  const fallback = buildFallbackEmbed({ member, resolvedText, config, section });
  return {
    content: mentionStr ?? undefined,
    embeds:  [fallback],
  };
}

export const DEFAULT_MESSAGES = { welcome: DEFAULT_WELCOME_MSG, goodbye: DEFAULT_GOODBYE_MSG };
