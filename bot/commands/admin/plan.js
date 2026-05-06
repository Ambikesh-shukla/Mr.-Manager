import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } from 'discord.js';

import { Plan } from '../../storage/Plan.js';
import { GuildConfig } from '../../storage/GuildConfig.js';
import { successEmbed, errorEmbed, planEmbed, embed, Colors } from '../../utils/embeds.js';

function buyButtonFor(plan) {
  return new ButtonBuilder()
    .setCustomId(`plan_buy:${plan.id}`)
    .setLabel(`Buy ${plan.name}`)
    .setEmoji(plan.emoji || '🛒')
    .setStyle(ButtonStyle.Success);
}

export default {
  data: new SlashCommandBuilder()
    .setName('plan')
    .setDescription('Manage hosting/service plans')
    .addSubcommand(s => s.setName('create')
      .setDescription('Create a new hosting plan and post it publicly')
      .addStringOption(o => o.setName('name').setDescription('Plan name (e.g. Starter, Pro)').setRequired(true))
      .addStringOption(o => o.setName('price').setDescription('Price (e.g. $5/mo)').setRequired(true))
      .addStringOption(o => o.setName('ram').setDescription('RAM (e.g. 4GB)').setRequired(false))
      .addStringOption(o => o.setName('cpu').setDescription('CPU (e.g. 2 vCores)').setRequired(false))
      .addStringOption(o => o.setName('storage').setDescription('Storage (e.g. 20GB SSD)').setRequired(false))
      .addStringOption(o => o.setName('slots').setDescription('Player slots (e.g. 20)').setRequired(false))
      .addStringOption(o => o.setName('versions').setDescription('MC versions (e.g. 1.8-1.21)').setRequired(false))
      .addStringOption(o => o.setName('description').setDescription('Plan description').setRequired(false))
      .addStringOption(o => o.setName('emoji').setDescription('Plan emoji').setRequired(false))
      .addStringOption(o => o.setName('discount').setDescription('Discount tag (e.g. 20% OFF)').setRequired(false))
      .addStringOption(o => o.setName('thumbnail').setDescription('Logo URL (top-right of embed)').setRequired(false))
      .addStringOption(o => o.setName('banner').setDescription('Banner image URL (bottom of embed)').setRequired(false))
      .addChannelOption(o => o.setName('channel').setDescription('Channel to post in (default: configured plan channel)').addChannelTypes(ChannelType.GuildText).setRequired(false))
      .addBooleanOption(o => o.setName('available').setDescription('Is this plan available?').setRequired(false)))
    .addSubcommand(s => s.setName('delete')
      .setDescription('Delete a hosting plan')
      .addStringOption(o => o.setName('plan_id').setDescription('Plan ID to delete').setRequired(true)))
    .addSubcommand(s => s.setName('list')
      .setDescription('View all available plans')
      .addBooleanOption(o => o.setName('public').setDescription('Post publicly in channel?').setRequired(false))),

  defaultLevel: 'admin',
  subcommandDefaults: { list: 'public' },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ── create ─────────────────────────────────────────────────────────────
    if (sub === 'create') {
      const config = GuildConfig.get(interaction.guild.id);
      const overrideCh = interaction.options.getChannel('channel');
      let targetCh = overrideCh ?? interaction.channel;
      if (!overrideCh && config.planChannel) {
        targetCh = interaction.guild.channels.cache.get(config.planChannel)
          ?? await interaction.guild.channels.fetch(config.planChannel).catch(() => null)
          ?? interaction.channel;
      }

      const plan = Plan.create(interaction.guild.id, {
        name: interaction.options.getString('name'),
        price: interaction.options.getString('price'),
        ram: interaction.options.getString('ram') ?? '',
        cpu: interaction.options.getString('cpu') ?? '',
        storage: interaction.options.getString('storage') ?? '',
        slots: interaction.options.getString('slots') ?? '',
        versions: interaction.options.getString('versions') ?? '',
        description: interaction.options.getString('description') ?? '',
        emoji: interaction.options.getString('emoji') ?? '🖥️',
        discount: interaction.options.getString('discount') ?? '',
        thumbnail: interaction.options.getString('thumbnail') ?? '',
        banner: interaction.options.getString('banner') ?? '',
        available: interaction.options.getBoolean('available') ?? true,
      });

      const row = new ActionRowBuilder().addComponents(buyButtonFor(plan));

      try {
        await targetCh.send({ embeds: [planEmbed(plan)], components: [row] });
      } catch {
        return interaction.reply({
          embeds: [errorEmbed(`Plan saved (ID \`${plan.id}\`) but I couldn't post in <#${targetCh.id}>. Check my **Send Messages** + **Embed Links** permissions there.`)],
          flags: 64,
        });
      }

      return interaction.reply({
        embeds: [successEmbed('Plan Created', `Plan **${plan.name}** posted in <#${targetCh.id}>.\nID: \`${plan.id}\``)],
        flags: 64,
      });
    }

    // ── delete ─────────────────────────────────────────────────────────────
    if (sub === 'delete') {
      const id = interaction.options.getString('plan_id');
      const plan = Plan.get(id);
      if (!plan || plan.guildId !== interaction.guild.id) {
        return interaction.reply({ embeds: [errorEmbed('Plan not found.')], flags: 64 });
      }
      Plan.delete(id);
      return interaction.reply({ embeds: [successEmbed('Plan Deleted', `Plan **${plan.name}** has been deleted.`)], flags: 64 });
    }

    // ── list ───────────────────────────────────────────────────────────────
    if (sub === 'list') {
      const plans = Plan.forGuild(interaction.guild.id).filter(p => p.available);
      if (plans.length === 0) {
        return interaction.reply({ embeds: [embed({ description: 'No plans configured yet. Use `/plan create`.', color: Colors.warning })], flags: 64 });
      }
      const isPublic = interaction.options.getBoolean('public') ?? false;
      const embeds = plans.slice(0, 10).map(p => planEmbed(p));
      const buttons = plans.slice(0, 5).map(p => buyButtonFor(p));
      const rows = [];
      for (let i = 0; i < buttons.length; i += 5) rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
      return interaction.reply({ embeds, components: rows, flags: isPublic ? undefined : 64 });
    }

  },
};
