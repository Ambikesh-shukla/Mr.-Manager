import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { embed, Colors, errorEmbed } from '../../utils/embeds.js';
import { getGuildInfo, getTopActions, getTotalUsed } from '../../../utils/credits.js';

export default {
  data: new SlashCommandBuilder()
    .setName('credits')
    .setDescription("View this server's credit balance, plan details, and usage history"),

  defaultLevel: 'admin',

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        embeds: [errorEmbed('This command can only be used in a server.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guildId = interaction.guildId;
    const [guildInfo, topActions, totalUsed] = await Promise.all([
      getGuildInfo(guildId),
      getTopActions(guildId, 5),
      getTotalUsed(guildId),
    ]);

    const plan = guildInfo?.plan ?? 'none';
    const credits = guildInfo?.credits ?? 0;
    const planExpiresAt = guildInfo?.planExpiresAt;

    const isPro = plan === 'pro' && credits === -1;
    const creditsDisplay = credits === -1 ? '∞ Unlimited' : String(credits);

    const expiryDisplay = planExpiresAt
      ? `<t:${Math.floor(new Date(planExpiresAt).getTime() / 1000)}:F>`
      : 'No active plan';

    const topActionsDisplay = topActions.length > 0
      ? topActions
          .map((a, i) => `${i + 1}. \`${a.actionKey}\` — ${a.count} use${a.count !== 1 ? 's' : ''}`)
          .join('\n')
      : 'No actions recorded yet.';

    const upgradeMsg = isPro
      ? '✨ You\'re on **Pro** — enjoy unlimited credits!'
      : 'Upgrade to **Pro** for unlimited credits.\nUse `/redeem` to activate a plan code, or join our support server for help.';

    return interaction.editReply({
      embeds: [
        embed({
          title: '💳 Server Credits',
          color: isPro ? Colors.gold : Colors.primary,
          fields: [
            { name: '📦 Plan', value: plan === 'none' ? 'None' : plan.toUpperCase(), inline: true },
            { name: '💳 Remaining Credits', value: creditsDisplay, inline: true },
            { name: '📊 Total Used', value: String(totalUsed), inline: true },
            { name: '📅 Plan Expiry', value: expiryDisplay, inline: false },
            { name: '🔥 Top 5 Actions', value: topActionsDisplay, inline: false },
            { name: '⬆️ Upgrade / Support', value: upgradeMsg, inline: false },
          ],
          footer: 'Use /redeem to add credits • Pro = Unlimited',
          timestamp: true,
        }),
      ],
    });
  },
};
