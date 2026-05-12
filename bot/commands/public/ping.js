import { SlashCommandBuilder } from 'discord.js';
import { embed, Colors } from '../../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check bot latency and status'),

  defaultLevel: 'public',

  async execute(interaction) {
    const start = Date.now();
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: 64 });
    }
    const latency = Date.now() - start;
    const ws = interaction.client.ws.ping;
    await interaction.editReply({
      embeds: [embed({
        title: '🏓 Pong!',
        color: latency < 150 ? Colors.success : latency < 400 ? Colors.warning : Colors.error,
        fields: [
          { name: '📡 Bot Latency', value: `${latency}ms`, inline: true },
          { name: '💓 API Latency', value: `${ws}ms`, inline: true },
          { name: '⚡ Status', value: latency < 200 ? '🟢 Excellent' : latency < 400 ? '🟡 Good' : '🔴 Slow', inline: true },
        ],
        timestamp: false,
      })],
    });
  },
};
