import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } from 'discord.js';
import { GuildConfig } from '../../storage/GuildConfig.js';
import { Review } from '../../storage/Review.js';
import { embed, successEmbed, errorEmbed, Colors, reviewEmbed } from '../../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('review')
    .setDescription('Review and vouch system')
    .addSubcommand(s => s.setName('submit')
      .setDescription('Submit a review/vouch for this server')
      .addIntegerOption(o => o.setName('rating').setDescription('Rating 1–5').setMinValue(1).setMaxValue(5).setRequired(true))
      .addStringOption(o => o.setName('review').setDescription('Your review').setRequired(true))
      .addStringOption(o => o.setName('service').setDescription('Service you used (e.g. Starter Plan)').setRequired(false)))
    .addSubcommand(s => s.setName('config')
      .setDescription('Configure vouch and approval channels')
      .addChannelOption(o => o.setName('vouch_channel').setDescription('Where approved reviews are posted').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addChannelOption(o => o.setName('approval_channel').setDescription('Where reviews await admin approval').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(s => s.setName('list')
      .setDescription('List pending reviews awaiting approval')),

  defaultLevel: 'public',
  subcommandDefaults: { config: 'admin', list: 'admin', submit: 'public' },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ── submit (public) ────────────────────────────────────────────────────
    if (sub === 'submit') {
      const rating = interaction.options.getInteger('rating');
      const content = interaction.options.getString('review');
      const service = interaction.options.getString('service') ?? '';
      const config = GuildConfig.get(interaction.guild.id);

      if (!config.vouchApprovalChannel) {
        return interaction.reply({ embeds: [errorEmbed('Review system not configured. Ask an admin to run `/review config`.')], flags: 64 });
      }

      const review = Review.create(interaction.guild.id, {
        userId: interaction.user.id,
        username: interaction.user.tag,
        rating, content, service,
      });

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
      } catch {}

      return interaction.reply({ embeds: [successEmbed('Review Submitted', 'Your review has been submitted for approval. Thank you! 🙏')], flags: 64 });
    }

    // ── config (admin) ─────────────────────────────────────────────────────
    if (sub === 'config') {
      const vouchChannel = interaction.options.getChannel('vouch_channel');
      const approvalChannel = interaction.options.getChannel('approval_channel');
      GuildConfig.update(interaction.guild.id, {
        vouchChannel: vouchChannel.id,
        vouchApprovalChannel: approvalChannel.id,
      });
      return interaction.reply({
        embeds: [successEmbed('Review System Configured',
          `✅ Vouch Channel: <#${vouchChannel.id}>\n✅ Approval Channel: <#${approvalChannel.id}>`)],
        flags: 64,
      });
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
