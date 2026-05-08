import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { randomUUID } from 'crypto';
import { ServerProvision } from '../../storage/ServerProvision.js';
import { embed, Colors, successEmbed, errorEmbed } from '../../utils/embeds.js';
import {
  getInviteRewardPlans,
  getRewardEligibility,
  getRewardClaimState,
  getInviteStatsForMember,
} from '../../utils/inviteRewards.js';

function formatRewardStatusLine({ reward, eligibility, inviteCount }) {
  const remaining = Math.max(0, reward.invitesRequired - inviteCount);
  const remainingText = remaining > 0 ? ` • need ${remaining} more` : '';
  const status = eligibility.ok ? '✅' : '❌';
  const nodeText = reward.nodeId ? ` • node \`${reward.nodeId}\`` : '';
  return `${status} **${reward.name}** (\`${reward.id}\`) — ${reward.invitesRequired} invites • ${reward.limits.ramMb}MB RAM / ${reward.limits.cpuPercent}% CPU / ${reward.limits.diskMb}MB Disk${nodeText} • ${eligibility.rewardClaim.claimCount}/${reward.maxClaims} claims${remainingText}`;
}

function rewardFromOptions(interaction) {
  const customId = interaction.options.getString('reward_id')?.trim();
  return {
    id: customId ? customId.slice(0, 80) : randomUUID(),
    name: interaction.options.getString('name') ?? `${interaction.options.getInteger('invites')} Invites Reward`,
    invitesRequired: interaction.options.getInteger('invites'),
    limits: {
      ramMb: interaction.options.getInteger('ram'),
      cpuPercent: interaction.options.getInteger('cpu'),
      diskMb: interaction.options.getInteger('disk'),
    },
    nodeId: interaction.options.getString('node') ?? '',
    nodeLocation: '',
    eggTemplate: interaction.options.getString('egg') ?? '',
    maxClaims: interaction.options.getInteger('max_claims'),
    cooldownHours: interaction.options.getInteger('cooldown'),
    available: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export default {
  data: new SlashCommandBuilder()
    .setName('invite')
    .setDescription('View your invite stats and manage invite reward plans')
    .addSubcommand((sub) => sub
      .setName('list')
      .setDescription('List configured invite reward plans'))
    .addSubcommand((sub) => sub
      .setName('add')
      .setDescription('Create a new invite reward plan')
      .addIntegerOption((opt) => opt.setName('invites').setDescription('Invites required').setRequired(true).setMinValue(0))
      .addIntegerOption((opt) => opt.setName('ram').setDescription('RAM in MB').setRequired(true).setMinValue(1))
      .addIntegerOption((opt) => opt.setName('cpu').setDescription('CPU percent').setRequired(true).setMinValue(1))
      .addIntegerOption((opt) => opt.setName('disk').setDescription('Disk in MB').setRequired(true).setMinValue(1))
      .addIntegerOption((opt) => opt.setName('max_claims').setDescription('Max claims per user for this plan').setRequired(true).setMinValue(1))
      .addIntegerOption((opt) => opt.setName('cooldown').setDescription('Cooldown (hours) between claims').setRequired(true).setMinValue(0))
      .addStringOption((opt) => opt.setName('reward_id').setDescription('Optional reward ID (slug-like)').setRequired(false))
      .addStringOption((opt) => opt.setName('name').setDescription('Reward plan name').setRequired(false))
      .addStringOption((opt) => opt.setName('node').setDescription('Configured node ID override').setRequired(false))
      .addStringOption((opt) => opt.setName('egg').setDescription('Egg/template override').setRequired(false)))
    .addSubcommand((sub) => sub
      .setName('delete')
      .setDescription('Delete an invite reward plan')
      .addStringOption((opt) => opt.setName('reward_id').setDescription('Reward plan ID').setRequired(true))),

  defaultLevel: 'public',
  subcommandDefaults: {
    list: 'admin',
    add: 'admin',
    delete: 'admin',
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand(false);
    const guildId = interaction.guild.id;
    const data = ServerProvision.ensureGuild(guildId);
    const panelSetup = data.panelSetup;

    if (sub === 'add') {
      const reward = rewardFromOptions(interaction);
      const rewards = Array.isArray(data.inviteRewards) ? data.inviteRewards : [];
      if (rewards.some((existing) => existing.id === reward.id)) {
        return interaction.reply({
          embeds: [errorEmbed(`A reward with ID \`${reward.id}\` already exists. Use a different \`reward_id\`.`)],
          flags: MessageFlags.Ephemeral,
        });
      }
      rewards.push(reward);
      ServerProvision.updateGuild(guildId, { inviteRewards: rewards });
      return interaction.reply({
        embeds: [successEmbed('Invite Reward Added', `Created **${reward.name}** with ID \`${reward.id}\`.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'delete') {
      const rewardId = interaction.options.getString('reward_id', true).trim();
      const rewards = Array.isArray(data.inviteRewards) ? data.inviteRewards : [];
      const match = rewards.find((reward) => reward.id === rewardId);
      if (!match) {
        return interaction.reply({ embeds: [errorEmbed('Reward plan not found.')], flags: MessageFlags.Ephemeral });
      }
      ServerProvision.updateGuild(guildId, {
        inviteRewards: rewards.filter((reward) => reward.id !== rewardId),
      });
      return interaction.reply({
        embeds: [successEmbed('Invite Reward Deleted', `Deleted reward plan **${match.name}** (\`${match.id}\`).`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    const inviteStats = getInviteStatsForMember(data, interaction.user.id);
    const inviteCount = inviteStats.real;
    const rewards = getInviteRewardPlans(data, panelSetup);
    const lines = rewards.slice(0, 10).map((reward) => {
      const eligibility = getRewardEligibility({
        data,
        panelSetup,
        userId: interaction.user.id,
        inviteCount,
        reward,
      });
      return formatRewardStatusLine({
        reward,
        eligibility,
        inviteCount,
      });
    });

    if (sub === 'list') {
      return interaction.reply({
        embeds: [embed({
          title: '📋 Invite Reward Plans',
          color: Colors.info,
          description: lines.join('\n') || 'No reward plans configured yet.',
        })],
        flags: MessageFlags.Ephemeral,
      });
    }

    const userClaim = ServerProvision.ensureUserClaim(guildId, interaction.user.id);
    const claimedRewards = rewards
      .map((reward) => ({ reward, claim: getRewardClaimState(userClaim, reward.id) }))
      .filter((entry) => entry.claim.claimCount > 0)
      .map((entry) => `• ${entry.reward.name}: **${entry.claim.claimCount}/${entry.reward.maxClaims}**`)
      .join('\n') || 'No rewards claimed yet.';

    const minRemaining = rewards.length === 0
      ? 0
      : rewards.reduce((acc, reward) => (
        Math.min(acc, Math.max(0, reward.invitesRequired - inviteCount))
      ), Number.POSITIVE_INFINITY);

    return interaction.reply({
      embeds: [embed({
        title: '📨 Invite Stats & Rewards',
        color: Colors.primary,
        fields: [
          { name: 'Total Invites', value: String(inviteStats.total), inline: true },
          { name: 'Real Invites', value: String(inviteStats.real), inline: true },
          { name: 'Fake Invites', value: String(inviteStats.fake), inline: true },
          { name: 'Rejoin Invites', value: String(inviteStats.rejoin), inline: true },
          { name: 'Remaining Invites Needed', value: String(minRemaining), inline: true },
          { name: 'Claimed Rewards', value: claimedRewards, inline: false },
          { name: 'Available Server Rewards', value: lines.join('\n') || 'No reward plans configured yet.', inline: false },
        ],
      })],
      flags: MessageFlags.Ephemeral,
    });
  },
};
