/**
 * Safely reply to an interaction:
 * - If deferred (thinking indicator visible): uses editReply (replaces it).
 * - If already replied: uses followUp (additional message).
 * - Otherwise: uses reply.
 *
 * This matches the pattern used internally in ticketInteractions.js and supports
 * interactions that have been deferred early (e.g. before a billing check).
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {object} payload - The message payload to send.
 */
export async function safeReply(interaction, payload) {
  if (interaction.deferred) return interaction.editReply(payload);
  if (interaction.replied) return interaction.followUp(payload);
  return interaction.reply(payload);
}
