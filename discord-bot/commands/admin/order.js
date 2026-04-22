import { SlashCommandBuilder } from 'discord.js';
import { Order } from '../../storage/Order.js';
import { successEmbed, errorEmbed, embed, Colors } from '../../utils/embeds.js';

const STATUS_EMOJIS = { pending: '🟡', 'in-progress': '🔵', delivered: '✅', cancelled: '❌', refunded: '💸' };
const STATUS_COLORS = { pending: Colors.warning, 'in-progress': Colors.info, delivered: Colors.success, cancelled: Colors.error, refunded: Colors.warning };

const statusChoices = [
  { name: '🟡 Pending', value: 'pending' },
  { name: '🔵 In Progress', value: 'in-progress' },
  { name: '✅ Delivered', value: 'delivered' },
  { name: '❌ Cancelled', value: 'cancelled' },
  { name: '💸 Refunded', value: 'refunded' },
];

export default {
  data: new SlashCommandBuilder()
    .setName('order')
    .setDescription('Manage customer orders')
    .addSubcommand(s => s.setName('create')
      .setDescription('Create a new customer order')
      .addUserOption(o => o.setName('user').setDescription('Customer').setRequired(true))
      .addStringOption(o => o.setName('plan').setDescription('Plan or service ordered').setRequired(true))
      .addStringOption(o => o.setName('notes').setDescription('Order notes').setRequired(false)))
    .addSubcommand(s => s.setName('update')
      .setDescription('Update a customer order status')
      .addStringOption(o => o.setName('order_id').setDescription('Order ID').setRequired(true))
      .addStringOption(o => o.setName('status').setDescription('New status').setRequired(true).addChoices(...statusChoices))
      .addStringOption(o => o.setName('notes').setDescription('Update notes').setRequired(false)))
    .addSubcommand(s => s.setName('list')
      .setDescription('List orders')
      .addUserOption(o => o.setName('user').setDescription('Filter by customer').setRequired(false))
      .addStringOption(o => o.setName('status').setDescription('Filter by status').setRequired(false).addChoices(...statusChoices))),

  defaultLevel: 'staff',

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ── create ─────────────────────────────────────────────────────────────
    if (sub === 'create') {
      const user = interaction.options.getUser('user');
      const plan = interaction.options.getString('plan');
      const notes = interaction.options.getString('notes') ?? '';

      const order = Order.create(interaction.guild.id, {
        userId: user.id,
        username: user.tag,
        planName: plan,
        notes,
      });

      await interaction.reply({
        embeds: [embed({
          title: '📦 Order Created',
          color: Colors.success,
          fields: [
            { name: 'Order ID', value: `\`${order.id}\``, inline: false },
            { name: 'Customer', value: `${user}`, inline: true },
            { name: 'Plan', value: plan, inline: true },
            { name: 'Status', value: '🟡 Pending', inline: true },
            { name: 'Notes', value: notes || 'None', inline: false },
          ],
          footer: `Created by ${interaction.user.tag}`,
        })],
        flags: 64,
      });

      try {
        await user.send({ embeds: [embed({
          title: '📦 Your Order Has Been Placed!',
          description: `Thank you for your purchase in **${interaction.guild.name}**!\n\n**Plan:** ${plan}\n**Status:** Pending\n\nWe'll update you once your order is processed.`,
          color: Colors.success,
          footer: `Order ID: ${order.id}`,
        })] });
      } catch {}
      return;
    }

    // ── update ─────────────────────────────────────────────────────────────
    if (sub === 'update') {
      const orderId = interaction.options.getString('order_id');
      const status = interaction.options.getString('status');
      const notes = interaction.options.getString('notes');
      const order = Order.get(orderId);

      if (!order || order.guildId !== interaction.guild.id) {
        return interaction.reply({ embeds: [errorEmbed('Order not found.')], flags: 64 });
      }

      const patch = { status };
      if (notes) patch.notes = notes;
      const updated = Order.update(orderId, patch);

      await interaction.reply({
        embeds: [embed({
          title: '📦 Order Updated',
          color: STATUS_COLORS[status] ?? Colors.primary,
          fields: [
            { name: 'Order ID', value: `\`${orderId}\``, inline: false },
            { name: 'Customer', value: `<@${order.userId}>`, inline: true },
            { name: 'Plan', value: order.planName, inline: true },
            { name: 'New Status', value: `${STATUS_EMOJIS[status]} ${status}`, inline: true },
            { name: 'Notes', value: updated.notes || 'None', inline: false },
          ],
          footer: `Updated by ${interaction.user.tag}`,
        })],
        flags: 64,
      });

      try {
        const member = await interaction.guild.members.fetch(order.userId);
        await member.send({ embeds: [embed({
          title: '📦 Order Status Update',
          description: `Your order in **${interaction.guild.name}** has been updated!\n\n**Plan:** ${order.planName}\n**New Status:** ${STATUS_EMOJIS[status]} ${status}${notes ? `\n**Notes:** ${notes}` : ''}`,
          color: STATUS_COLORS[status] ?? Colors.primary,
          footer: `Order ID: ${orderId}`,
        })] });
      } catch {}
      return;
    }

    // ── list ───────────────────────────────────────────────────────────────
    if (sub === 'list') {
      const user = interaction.options.getUser('user');
      const status = interaction.options.getString('status');
      let orders = user
        ? Order.forUser(interaction.guild.id, user.id)
        : Order.forGuild(interaction.guild.id);
      if (status) orders = orders.filter(o => o.status === status);

      if (orders.length === 0) {
        return interaction.reply({ embeds: [embed({ description: 'No orders found.', color: Colors.warning })], flags: 64 });
      }

      const fields = orders.slice(0, 20).map(o => ({
        name: `${STATUS_EMOJIS[o.status] ?? '📦'} ${o.planName} — <@${o.userId}>`,
        value: `Status: **${o.status}** | ID: \`${o.id.slice(0, 8)}\` | Created: <t:${Math.floor(o.createdAt / 1000)}:R>`,
        inline: false,
      }));

      return interaction.reply({
        embeds: [embed({
          title: `📦 Orders (${orders.length})`,
          fields,
          color: Colors.primary,
          footer: orders.length > 20 ? `Showing first 20 of ${orders.length}` : undefined,
        })],
        flags: 64,
      });
    }
  },
};
