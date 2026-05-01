import { SlashCommandBuilder, ChannelType } from 'discord.js';
import { GuildConfig } from '../../storage/GuildConfig.js';
import { successEmbed, errorEmbed } from '../../utils/embeds.js';
import { requireAdmin } from '../../utils/permissions.js';

export default {
  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Configure the welcome system')
    .addSubcommand(s => s.setName('enable')
      .setDescription('Enable welcome messages')
      .addChannelOption(o => o.setName('channel').setDescription('Welcome channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addStringOption(o => o.setName('message').setDescription('Welcome message (use {user}, {server}, {count})').setRequired(false)))
    .addSubcommand(s => s.setName('disable')
      .setDescription('Disable welcome messages'))
    .addSubcommand(s => s.setName('test')
      .setDescription('Test the welcome message')),

  defaultLevel: 'admin',

  async execute(interaction) {
    if (!requireAdmin(interaction)) return;
    const sub = interaction.options.getSubcommand();

    if (sub === 'enable') {
      const ch = interaction.options.getChannel('channel');
      const message = interaction.options.getString('message') ?? 'Welcome {user} to **{server}**! 🎮 You are member #{count}.';
      GuildConfig.update(interaction.guild.id, {
        welcomeEnabled: true,
        welcomeChannel: ch.id,
        welcomeMessage: message,
      });
      return interaction.reply({ embeds: [successEmbed('Welcome Enabled', `Welcome messages will be sent to <#${ch.id}>.`)], flags: 64 });
    }

    if (sub === 'disable') {
      GuildConfig.update(interaction.guild.id, { welcomeEnabled: false });
      return interaction.reply({ embeds: [successEmbed('Welcome Disabled', 'Welcome messages have been disabled.')], flags: 64 });
    }

    if (sub === 'test') {
      const config = GuildConfig.get(interaction.guild.id);
      if (!config.welcomeEnabled || !config.welcomeChannel) {
        return interaction.reply({ embeds: [errorEmbed('Welcome is not configured.')], flags: 64 });
      }
      // Simulate welcome event
      const { default: guildMemberAdd } = await import('../../events/guildMemberAdd.js');
      await guildMemberAdd.execute(interaction.member);
      return interaction.reply({ embeds: [successEmbed('Test Sent', 'Test welcome message sent!')], flags: 64 });
    }
  },
};
