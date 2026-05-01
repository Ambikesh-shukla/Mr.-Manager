import { EmbedBuilder } from 'discord.js';

export const Colors = {
  primary: 0x5865F2,
  success: 0x57F287,
  warning: 0xFEE75C,
  error: 0xED4245,
  info: 0x5865F2,
  gold: 0xFFD700,
};

export function embed(opts = {}) {
  const e = new EmbedBuilder();
  if (opts.title) e.setTitle(opts.title);
  if (opts.description) e.setDescription(opts.description);
  e.setColor(opts.color ?? Colors.primary);
  if (opts.footer) e.setFooter({ text: opts.footer });
  if (opts.thumbnail) e.setThumbnail(opts.thumbnail);
  if (opts.image) e.setImage(opts.image);
  if (opts.fields) e.addFields(opts.fields);
  if (opts.timestamp !== false) e.setTimestamp();
  if (opts.author) e.setAuthor(opts.author);
  return e;
}

export function successEmbed(title, description) {
  return embed({ title: `✅ ${title}`, description, color: Colors.success });
}

export function errorEmbed(description) {
  return embed({ title: '❌ Error', description, color: Colors.error });
}

export function warnEmbed(description) {
  return embed({ title: '⚠️ Warning', description, color: Colors.warning });
}

export function infoEmbed(title, description) {
  return embed({ title: `ℹ️ ${title}`, description, color: Colors.info });
}

export function ticketEmbed(panel, ticketType) {
  const e = new EmbedBuilder()
    .setTitle(panel.title)
    .setDescription(panel.description)
    .setColor(panel.color ? parseInt(panel.color.replace('#', ''), 16) : Colors.primary)
    .setTimestamp();
  if (panel.footer) e.setFooter({ text: panel.footer });
  if (panel.thumbnail) e.setThumbnail(panel.thumbnail);
  if (panel.banner) e.setImage(panel.banner);
  return e;
}

export function planEmbed(plan) {
  const fields = [];
  fields.push({ name: '💰 Price', value: plan.price, inline: true });
  if (plan.ram) fields.push({ name: '💾 RAM', value: plan.ram, inline: true });
  if (plan.cpu) fields.push({ name: '⚡ CPU', value: plan.cpu, inline: true });
  if (plan.storage) fields.push({ name: '💿 Storage', value: plan.storage, inline: true });
  if (plan.slots) fields.push({ name: '👥 Slots', value: plan.slots, inline: true });
  if (plan.versions) fields.push({ name: '🎮 Versions', value: plan.versions, inline: true });
  if (plan.discount) fields.push({ name: '🏷️ Discount', value: plan.discount, inline: true });

  const titleParts = [plan.emoji, plan.name];
  if (plan.discount) titleParts.push(`— ${plan.discount}`);

  return embed({
    title: titleParts.join(' '),
    description: plan.description ? `> ${plan.description}` : undefined,
    color: plan.available ? Colors.gold : Colors.error,
    fields,
    thumbnail: plan.thumbnail || undefined,
    image: plan.banner || undefined,
    footer: plan.available ? '✅ Available • Click Buy to order' : '❌ Currently Unavailable',
    timestamp: false,
  });
}

export function reviewEmbed(review) {
  const stars = '⭐'.repeat(Math.min(5, Math.max(1, review.rating)));
  return embed({
    title: `${stars} Review from ${review.username}`,
    description: review.content,
    color: Colors.gold,
    fields: review.service ? [{ name: 'Service', value: review.service, inline: true }] : [],
    footer: `Submitted • Rating: ${review.rating}/5`,
  });
}
