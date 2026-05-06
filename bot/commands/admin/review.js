import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { GuildConfig } from '../../storage/GuildConfig.js';
import { Review } from '../../storage/Review.js';
import { embed, successEmbed, Colors, reviewEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('review')
    .setDescription('Review and vouch system')
    .addSubcommand(s => s.setName('submit')
      .setDescription('Submit a review/vouch for this server')
      .addIntegerOption(o => o.setName('rating').setDescription('Rating 1–5').setMinValue(1).setMaxValue(5).setRequired(true))
      .addStringOption(o => o.setName('review').setDescription('Your review').setRequired(true))
      .addStringOption(o => o.setName('service').setDescription('Service you used (e.g. Starter Plan)').setRequired(false)))
    .addSubcommand(s => s.setName('list')
      .setDescription('List pending reviews awaiting approval')),

  defaultLevel: 'public',
  subcommandDefaults: { list: 'admin', submit: 'public' },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ── submit (public) ────────────────────────────────────────────────────
    if (sub === 'submit') {
      const rating = interaction.options.getInteger('rating');
      const content = interaction.options.getString('review');
      const service = interaction.options.getString('service') ?? '';
      const config = GuildConfig.get(interaction.guild.id);

      const review = Review.create(interaction.guild.id, {
        userId: interaction.user.id,
        username: interaction.user.tag,
        rating, content, service,
      });

      if (config.vouchApprovalChannel) {
        try {
          const approvalCh = await interaction.guild.channels.fetch(config.vouchApprovalChannel);
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`review:approve:${review.id}`).setLabel('✅ Approve').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`review:deny:${review.id}`).setLabel('❌ Deny').setStyle(ButtonStyle.Danger),
          );
          await approvalCh?.send({
            embeds: [embed({
              title: `📝 New Review from ${interaction.user.tag}`,
              description: content,
              color: Colors.gold,
              fields: [
                { name: 'Rating', value: '⭐'.repeat(rating), inline: true },
                { name: 'Service', value: service || 'Not specified', inline: true },
              ],
              footer: `Review ID: ${review.id}`,
            })],
            components: [row],
          });
        } catch (err) {
          logger.warn('Failed to send review to approval channel', err);
        }
        return interaction.reply({ embeds: [successEmbed('Review Submitted', 'Your review has been submitted for approval. Thank you! 🙏')], flags: 64 });
      }

      // No approval channel configured — post review directly in the current channel
      try {
        const giveReviewRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('review:give').setLabel('Give Review').setStyle(ButtonStyle.Primary),
        );
        const msg = await interaction.channel.send({ embeds: [reviewEmbed(review)], components: [giveReviewRow] });
        Review.update(review.id, { approved: true, messageId: msg.id });
        GuildConfig.update(interaction.guild.id, {
          latestReviewMessageId: msg.id,
          latestReviewChannelId: interaction.channel.id,
        });
      } catch (err) {
        logger.warn('Failed to post review in current channel', err);
      }

      return interaction.reply({ embeds: [successEmbed('Review Submitted', 'Your review has been posted. Thank you! 🙏')], flags: 64 });
    }

    // ── list (admin) ───────────────────────────────────────────────────────
    if (sub === 'list') {
      const pending = Review.pending(interaction.guild.id);
      if (pending.length === 0) {
        return interaction.reply({ embeds: [embed({ description: 'No pending reviews.', color: Colors.info })], flags: 64 });
      }
      const fields = pending.map(r => ({
        name: `${r.username} — ${'⭐'.repeat(r.rating)}`,
        value: r.content.slice(0, 100),
        inline: false,
      }));
      return interaction.reply({ embeds: [embed({ title: `📝 Pending Reviews (${pending.length})`, fields, color: Colors.gold })], flags: 64 });
    }
  },
};
