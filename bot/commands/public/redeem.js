import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { redeemCodeForGuild } from '../../../utils/redeemCodes.js';

function isGuildOwnerOrAdmin(interaction) {
  if (!interaction.guild || !interaction.member) return false;
  return (
    interaction.guild.ownerId === interaction.user.id
    || interaction.member.permissions?.has(PermissionFlagsBits.Administrator)
  );
}

function toDateString(value) {
  return value instanceof Date ? `<t:${Math.floor(value.getTime() / 1000)}:F>` : '30 days from now';
}

function formatUsage(usedCount, maxUses) {
  if (!Number.isFinite(maxUses) || maxUses <= 0) return `${usedCount}/∞`;
  return `${usedCount}/${maxUses}`;
}

function reasonToMessage(reason) {
  switch (reason) {
    case 'storage_unavailable':
      return 'Redeem system is currently unavailable. Please try again later.';
    case 'not_found':
    case 'invalid_code':
      return 'Invalid redeem code.';
    case 'inactive':
      return 'This redeem code is inactive.';
    case 'expired':
      return 'This redeem code has expired.';
    case 'max_uses_reached':
      return 'This redeem code has reached its max usage limit.';
    case 'invalid_plan':
      return 'This redeem code is misconfigured.';
    default:
      return 'Failed to redeem code. Please try again.';
  }
}

export default {
  data: new SlashCommandBuilder()
    .setName('redeem')
    .setDescription('Redeem a Core/Pro server code')
    .addStringOption((option) => option
      .setName('code')
      .setDescription('Redeem code')
      .setRequired(true)),

  defaultLevel: 'public',

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ embeds: [errorEmbed('This command can only be used in a server.')], flags: MessageFlags.Ephemeral });
    }

    if (!isGuildOwnerOrAdmin(interaction)) {
      return interaction.reply({
        embeds: [errorEmbed('Only the **server owner** or a user with **Administrator** can redeem codes.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const code = interaction.options.getString('code', true);
    const result = await redeemCodeForGuild({
      code,
      guildId: interaction.guild.id,
      userId: interaction.user.id,
    });

    if (!result.ok) {
      return interaction.reply({ embeds: [errorEmbed(reasonToMessage(result.reason))], flags: MessageFlags.Ephemeral });
    }

    const creditsLabel = result.credits === -1 ? 'Unlimited' : String(result.credits);
    return interaction.reply({
      embeds: [
        successEmbed(
          'Code Redeemed',
          `Code: \`${result.code}\`\nPlan: **${result.plan.toUpperCase()}**\nCredits: **${creditsLabel}**\nExpires: ${toDateString(result.planExpiresAt)}\nUsage: **${formatUsage(result.usedCount, result.maxUses)}**`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};
