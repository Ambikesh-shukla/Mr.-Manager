import { SlashCommandBuilder } from 'discord.js';
import { CommandLock } from '../../storage/CommandLock.js';
import { COMMAND_DEFAULTS } from '../../utils/permissions.js';
import { successEmbed, errorEmbed, embed, Colors } from '../../utils/embeds.js';

const LOCKABLE_COMMANDS = Object.keys(COMMAND_DEFAULTS).filter(c => c !== 'command-lock');

export default {
  data: new SlashCommandBuilder()
    .setName('command-lock')
    .setDescription('Control who can use each command')
    .addSubcommand(s => s.setName('set')
      .setDescription('Set access mode for a command')
      .addStringOption(o => o.setName('command').setDescription('Command to configure').setRequired(true)
        .addChoices(...LOCKABLE_COMMANDS.map(c => ({ name: c, value: c }))))
      .addStringOption(o => o.setName('mode').setDescription('Access mode').setRequired(true)
        .addChoices(
          { name: '🌐 Public — everyone can use it', value: 'public' },
          { name: '👮 Staff — admin or staff role only', value: 'staff' },
          { name: '🔒 Admin — administrator only', value: 'admin' },
          { name: '🎭 Role — specific role only', value: 'role' },
        ))
      .addRoleOption(o => o.setName('role').setDescription('Required role (only if mode = role)').setRequired(false)))
    .addSubcommand(s => s.setName('view')
      .setDescription('View access settings for a command')
      .addStringOption(o => o.setName('command').setDescription('Command to inspect').setRequired(true)
        .addChoices(...LOCKABLE_COMMANDS.map(c => ({ name: c, value: c })))))
    .addSubcommand(s => s.setName('list')
      .setDescription('List all command permission settings'))
    .addSubcommand(s => s.setName('reset')
      .setDescription('Reset a command to its default permission')
      .addStringOption(o => o.setName('command').setDescription('Command to reset').setRequired(true)
        .addChoices(...LOCKABLE_COMMANDS.map(c => ({ name: c, value: c }))))),

  defaultLevel: 'admin',

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      const cmd = interaction.options.getString('command');
      const mode = interaction.options.getString('mode');
      const role = interaction.options.getRole('role');

      if (mode === 'role' && !role) {
        return interaction.reply({ embeds: [errorEmbed('You must provide a **role** when using `role` mode.\nExample: `/command-lock set ticket role @SupportTeam`')], flags: 64 });
      }

      CommandLock.set(interaction.guild.id, cmd, mode, role?.id ?? null);

      const modeLabels = { public: '🌐 Public', staff: '👮 Staff', admin: '🔒 Admin', role: '🎭 Role' };
      const detail = mode === 'role' ? ` → ${role}` : '';

      return interaction.reply({
        embeds: [successEmbed('Command Lock Updated',
          `**\`/${cmd}\`** is now **${modeLabels[mode]}${detail}**.\n\n` +
          `> 🌐 Public = everyone\n> 👮 Staff = admin or staff role\n> 🔒 Admin = administrator only\n> 🎭 Role = specific role (admin bypasses)`
        )],
        flags: 64,
      });
    }

    if (sub === 'view') {
      const cmd = interaction.options.getString('command');
      const lock = CommandLock.get(interaction.guild.id, cmd);
      const mode = lock?.mode ?? COMMAND_DEFAULTS[cmd] ?? 'admin';
      const isDefault = !lock;

      const roleStr = mode === 'role' && lock?.roleId ? `\nRequired Role: <@&${lock.roleId}>` : '';
      const icon = mode === 'public' ? '🌐' : mode === 'staff' ? '👮' : mode === 'role' ? '🎭' : '🔒';

      return interaction.reply({
        embeds: [embed({
          title: `${icon} /${cmd} — Access Settings`,
          color: Colors.info,
          fields: [
            { name: 'Current Mode', value: `**${mode}**${isDefault ? ' *(default)*' : ' *(custom)*'}${roleStr}`, inline: false },
            { name: 'Default Mode', value: COMMAND_DEFAULTS[cmd] ?? 'admin', inline: true },
            { name: 'Custom Override', value: lock ? `Yes (${lock.mode})` : 'No', inline: true },
          ],
          footer: 'Use /command-lock set to change | /command-lock reset to restore default',
        })],
        flags: 64,
      });
    }

    if (sub === 'list') {
      const locks = CommandLock.getAll(interaction.guild.id);
      const lines = Object.keys(COMMAND_DEFAULTS).map(cmd => {
        const lock = locks[cmd];
        const mode = lock?.mode ?? COMMAND_DEFAULTS[cmd];
        const isCustom = !!lock;
        const icon = mode === 'public' ? '🌐' : mode === 'staff' ? '👮' : mode === 'role' ? '🎭' : '🔒';
        const roleStr = mode === 'role' && lock?.roleId ? ` <@&${lock.roleId}>` : '';
        const tag = isCustom ? ' ✏️' : '';
        return `${icon} \`/${cmd}\` — **${mode}**${roleStr}${tag}`;
      });

      return interaction.reply({
        embeds: [embed({
          title: '🔐 Command Permission Settings',
          description: lines.join('\n') + '\n\n> ✏️ = custom override | 🌐 public | 👮 staff | 🔒 admin | 🎭 role',
          color: Colors.primary,
          footer: 'Use /command-lock set <command> <mode> to configure',
          timestamp: false,
        })],
        flags: 64,
      });
    }

    if (sub === 'reset') {
      const cmd = interaction.options.getString('command');
      CommandLock.reset(interaction.guild.id, cmd);
      return interaction.reply({
        embeds: [successEmbed('Reset', `\`/${cmd}\` is back to its default permission: **${COMMAND_DEFAULTS[cmd] ?? 'admin'}**.`)],
        flags: 64,
      });
    }
  },
};
