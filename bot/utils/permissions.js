import { PermissionFlagsBits } from 'discord.js';
import { GuildConfig } from '../storage/GuildConfig.js';
import { CommandLock } from '../storage/CommandLock.js';
import { errorEmbed } from './embeds.js';
import { logger } from './logger.js';

// ─── Default access levels for every command ───────────────────────────────
// 'public' = anyone | 'staff' = admin or staff role | 'admin' = admin only
export const COMMAND_DEFAULTS = {
  admin: 'admin',
  autoresponse: 'admin',
  'command-lock': 'admin',
  order: 'staff',
  plan: 'admin',
  post: 'admin',
  review: 'public',
  suggest: 'public',
  ticket: 'public',
  'setup-ticket': 'admin',
  welcome: 'admin',
  link: 'admin',
  help: 'public',
  ping: 'public',
  serverinfo: 'public',
  afk: 'public',
};

// ─── Raw checkers ──────────────────────────────────────────────────────────

export function isAdmin(member) {
  return (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    member.guild?.ownerId === member.id
  );
}

export function isStaff(member, panel = null) {
  if (isAdmin(member)) return true;
  const config = GuildConfig.get(member.guild.id);
  const staffRoles = config.staffRoles ?? [];
  const panelRoles = panel?.allowedRoles ?? [];
  const allRoles = [...new Set([...staffRoles, ...panelRoles])];
  return allRoles.some(roleId => member.roles.cache.has(roleId));
}

export function canManageTicket(member, ticket, panel = null) {
  if (isAdmin(member)) return true;
  if (isStaff(member, panel)) return true;
  if (ticket && ticket.userId === member.id) return true;
  if (ticket && ticket.addedUsers?.includes(member.id)) return true;
  return false;
}

export function canCloseTicket(member, ticket, panel = null) {
  if (isAdmin(member)) return true;
  if (isStaff(member, panel)) return true;
  if (ticket && ticket.userId === member.id) return true;
  return false;
}

export function canClaimTicket(member, panel = null) {
  return isAdmin(member) || isStaff(member, panel);
}

// ─── Centralized command permission middleware ─────────────────────────────

/**
 * Checks whether the interaction's member has permission to run `commandName`.
 * Falls back to `defaultLevel` if no guild override exists.
 * Admin always bypasses everything.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {string} commandName  - slash command name (e.g. 'ticket')
 * @param {string} defaultLevel - 'public' | 'staff' | 'admin'
 * @returns {boolean}
 */
export function checkPermission(interaction, commandName, defaultLevel) {
  const member = interaction.member;
  if (!member) return true; // DM context — allow (commands shouldn't be used in DMs)

  if (isAdmin(member)) return true;

  const lock = CommandLock.get(interaction.guild?.id, commandName);
  const mode = lock?.mode ?? defaultLevel ?? COMMAND_DEFAULTS[commandName] ?? 'admin';

  if (mode === 'public') return true;
  if (mode === 'admin') return false; // isAdmin already returned true above if they qualify
  if (mode === 'staff') return isStaff(member);
  if (mode === 'role') return lock?.roleId ? member.roles.cache.has(lock.roleId) : false;

  return false;
}

/**
 * Checks permission and, if denied, automatically replies and returns false.
 * Use this at the top of every command execute() for commands that need custom
 * contextual checks beyond the default level. The router already calls this for
 * the top-level command; this function is also exported for subcommand-specific
 * use inside commands.
 */
export async function assertPermission(interaction, commandName, defaultLevel) {
  if (checkPermission(interaction, commandName, defaultLevel)) return true;

  const lock = CommandLock.get(interaction.guild?.id, commandName);
  const mode = lock?.mode ?? defaultLevel ?? COMMAND_DEFAULTS[commandName] ?? 'admin';

  let msg;
  if (mode === 'role' && lock?.roleId) {
    msg = `You need the <@&${lock.roleId}> role to use \`/${commandName}\`.`;
  } else if (mode === 'staff') {
    msg = `You need a **staff role** or **Administrator** to use \`/${commandName}\`.`;
  } else {
    msg = `You need **Administrator** permission to use \`/${commandName}\`.`;
  }

  try {
    const reply = { embeds: [errorEmbed(msg)], flags: 64 };
    if (interaction.replied || interaction.deferred) await interaction.followUp(reply);
    else await interaction.reply(reply);
  } catch (err) {
    logger.error('Failed to send permission error reply', err);
  }

  return false;
}

// ─── Legacy helpers (kept for ticket handler contextual checks) ────────────

export function requireAdmin(interaction) {
  if (!isAdmin(interaction.member)) {
    interaction.reply({ embeds: [errorEmbed('You need **Administrator** permission.')], flags: 64 });
    return false;
  }
  return true;
}

export function requireStaff(interaction, panel = null) {
  if (!isStaff(interaction.member, panel)) {
    interaction.reply({ embeds: [errorEmbed('You need a **staff role** or **Administrator**.')], flags: 64 });
    return false;
  }
  return true;
}
