import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { embed } from '../../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Open a premium compact game promo card'),

  defaultLevel: 'public',

  async execute(interaction) {
    const promoEmbed = embed({
      title: '🎮 𝗕𝗼𝗿𝗲𝗱 𝗢𝗳 𝗔𝗰𝗰𝗵𝗮 𝗗𝗶𝗻?',
      color: 0x2ECF9A,
      description: [
        '━━━━━━━━━━━━━━━━━━━━',
        '',
        `👤 ${interaction.user}`,
        '',
        'Bored? Time pass ka jugaad nahi mil raha? Come on, I challenge you for a Bingo match 😏',
        '',
        'FireBow, CutCross, Raja Mantri Chor Sipahi, Snake, Fast Reflex aur aur bhi old-school games ready hain.',
        '',
        '━━━━━━━━━━━━━━━━━━━━',
        '',
        'Net nahi hai? Koi na bhai. Bas 10 min online chala le, phir lifetime offline school-wali masti enjoy kar 😭🔥',
        '',
        '━━━━━━━━━━━━━━━━━━━━',
      ].join('\n'),
      thumbnail: interaction.user.displayAvatarURL({ size: 256 }),
      timestamp: false,
    });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('🎮 Play Game')
        .setURL('https://indiangamess.tech/'),
    );

    await interaction.reply({
      embeds: [promoEmbed],
      components: [row],
    });
  },
};
