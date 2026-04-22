import { SlashCommandBuilder, ChannelType } from 'discord.js';
import { embed, successEmbed, errorEmbed, Colors } from '../../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('post')
    .setDescription('Post content to a channel')
    .addSubcommand(s => s.setName('announce')
      .setDescription('Send a styled announcement embed')
      .addStringOption(o => o.setName('message').setDescription('Announcement content (use \\n for new lines)').setRequired(true))
      .addChannelOption(o => o.setName('channel').setDescription('Target channel (default: current)').addChannelTypes(ChannelType.GuildText).setRequired(false))
      .addStringOption(o => o.setName('title').setDescription('Announcement title').setRequired(false))
      .addStringOption(o => o.setName('color').setDescription('Embed color hex (e.g. #FF0000)').setRequired(false))
      .addStringOption(o => o.setName('ping').setDescription('Ping: everyone / here / role ID').setRequired(false)))
    .addSubcommand(s => s.setName('embed')
      .setDescription('Build and send a fully custom embed')
      .addStringOption(o => o.setName('title').setDescription('Embed title').setRequired(true))
      .addStringOption(o => o.setName('description').setDescription('Embed description (use \\n for new lines)').setRequired(true))
      .addChannelOption(o => o.setName('channel').setDescription('Target channel').addChannelTypes(ChannelType.GuildText).setRequired(false))
      .addStringOption(o => o.setName('color').setDescription('Hex color (e.g. #FF0000)').setRequired(false))
      .addStringOption(o => o.setName('footer').setDescription('Footer text').setRequired(false))
      .addStringOption(o => o.setName('thumbnail').setDescription('Thumbnail URL').setRequired(false))
      .addStringOption(o => o.setName('image').setDescription('Banner image URL').setRequired(false))
      .addStringOption(o => o.setName('author').setDescription('Author name').setRequired(false)))
    .addSubcommand(s => s.setName('faq')
      .setDescription('Post an FAQ embed')
      .addStringOption(o => o.setName('title').setDescription('FAQ title').setRequired(true))
      .addStringOption(o => o.setName('content').setDescription('FAQ content (use \\n for line breaks, Q: ... | A: ... format)').setRequired(true))
      .addChannelOption(o => o.setName('channel').setDescription('Target channel').addChannelTypes(ChannelType.GuildText).setRequired(false))
      .addStringOption(o => o.setName('color').setDescription('Embed color hex').setRequired(false))),

  defaultLevel: 'admin',

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const ch = interaction.options.getChannel('channel') ?? interaction.channel;

    const parseColor = (str, fallback = Colors.primary) => {
      try { return parseInt((str ?? '').replace('#', ''), 16) || fallback; } catch { return fallback; }
    };

    // ── announce ───────────────────────────────────────────────────────────
    if (sub === 'announce') {
      const message = interaction.options.getString('message').replace(/\\n/g, '\n');
      const title = interaction.options.getString('title') ?? '📢 Announcement';
      const colorInt = parseColor(interaction.options.getString('color'));
      const pingStr = interaction.options.getString('ping') ?? '';

      let pingContent = '';
      if (pingStr === 'everyone') pingContent = '@everyone';
      else if (pingStr === 'here') pingContent = '@here';
      else if (pingStr) pingContent = `<@&${pingStr}>`;

      try {
        await ch.send({
          content: pingContent || undefined,
          embeds: [embed({ title, description: message, color: colorInt, footer: `Announced by ${interaction.user.tag}` })],
        });
        return interaction.reply({ embeds: [successEmbed('Announced', `Message sent to <#${ch.id}>.`)], flags: 64 });
      } catch {
        return interaction.reply({ embeds: [errorEmbed('Failed to send. Check my permissions in that channel.')], flags: 64 });
      }
    }

    // ── embed ──────────────────────────────────────────────────────────────
    if (sub === 'embed') {
      const title = interaction.options.getString('title');
      const description = interaction.options.getString('description').replace(/\\n/g, '\n');
      const colorInt = parseColor(interaction.options.getString('color'));
      const footer = interaction.options.getString('footer') ?? '';
      const thumbnail = interaction.options.getString('thumbnail');
      const image = interaction.options.getString('image');
      const author = interaction.options.getString('author');

      const built = embed({
        title, description, color: colorInt,
        footer: footer || undefined,
        thumbnail: thumbnail || undefined,
        image: image || undefined,
        author: author ? { name: author } : undefined,
      });

      try {
        await ch.send({ embeds: [built] });
        return interaction.reply({ embeds: [successEmbed('Embed Sent', `Embed sent to <#${ch.id}>.`)], flags: 64 });
      } catch {
        return interaction.reply({ embeds: [errorEmbed('Failed to send embed.')], flags: 64 });
      }
    }

    // ── faq ────────────────────────────────────────────────────────────────
    if (sub === 'faq') {
      const title = interaction.options.getString('title');
      const content = interaction.options.getString('content').replace(/\\n/g, '\n');
      const colorInt = parseColor(interaction.options.getString('color'));

      try {
        await ch.send({ embeds: [embed({ title: `❓ ${title}`, description: content, color: colorInt, footer: 'Frequently Asked Questions', timestamp: false })] });
        return interaction.reply({ embeds: [successEmbed('FAQ Posted', `FAQ posted in <#${ch.id}>.`)], flags: 64 });
      } catch {
        return interaction.reply({ embeds: [errorEmbed('Failed to post FAQ.')], flags: 64 });
      }
    }
  },
};
