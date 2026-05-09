/**
 * Safely reply to an interaction, using followUp if already replied or deferred.
 * Prevents double-reply errors across all billing/error paths.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {object} payload - The message payload to send.
 */
export async function safeReply(interaction, payload) {
  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(payload);
  }
  return interaction.reply(payload);
}
