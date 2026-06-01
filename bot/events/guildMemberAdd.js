import { WelcomeConfig } from '../storage/WelcomeConfig.js';
import { ServerProvision } from '../storage/ServerProvision.js';
import { buildWelcomePayload } from '../utils/welcomeCard.js';
import { logger } from '../utils/logger.js';
import { consumeInviteUsageDelta } from '../utils/inviteTracker.js';
import { getInviteJoinEntries, isLikelyFakeInvite, recordInviteJoin } from '../utils/inviteRewards.js';
import { FEATURE_BOT_PERMISSIONS, getMissingBotPermissions } from '../utils/permissions.js';

export default {
  name: 'guildMemberAdd',
  once: false,
  async execute(member, client) {
    try {
      const usedInvite = await consumeInviteUsageDelta(member.guild);
      const guildId = member.guild.id;
      const data = ServerProvision.ensureGuild(guildId);
      const existingEntries = getInviteJoinEntries(data);
      const isRejoin = existingEntries.some((entry) => entry.invitedUserId === member.id);
      const joinedAt = new Date().toISOString();
      const accountCreatedAt = member.user?.createdAt ? member.user.createdAt.toISOString() : null;
      const isFake = isLikelyFakeInvite({ joinedAt, accountCreatedAt });

      recordInviteJoin(data, {
        inviterId: usedInvite?.inviter?.id ?? null,
        invitedUserId: member.id,
        inviteCode: usedInvite?.code ?? null,
        joinedAt,
        accountCreatedAt,
        isFake,
        isRejoin,
      });
      ServerProvision.updateGuild(guildId, { inviteJoins: data.inviteJoins });

      const cfg = WelcomeConfig.get(member.guild.id);
      const section = cfg.welcome;

      if (!section.enabled || !section.channelId) return;

      const channel = await member.guild.channels.fetch(section.channelId).catch(() => null);
      if (!channel?.isTextBased()) return;
      const missing = getMissingBotPermissions(channel, FEATURE_BOT_PERMISSIONS.welcomeGoodbye);
      if (missing.length > 0) {
        logger.warn(`Skipping welcome message in guild ${member.guild.id}: missing permissions (${missing.join(', ')})`);
        return;
      }

      const payload = await buildWelcomePayload({ member, config: section, section: 'welcome' });
      await channel.send(payload);
    } catch (err) {
      logger.error(`guildMemberAdd welcome error [${member.guild.id}]: ${err.message}`, err);
    }
  },
};
