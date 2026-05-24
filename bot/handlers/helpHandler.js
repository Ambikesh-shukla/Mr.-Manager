import { MessageFlags } from 'discord.js';
import { buildHelpCenterPayload, HELP_SECTION_KEYS, parseHelpMenuCustomId } from '../utils/helpCenter.js';

const VALID_SECTIONS = new Set(HELP_SECTION_KEYS);

export async function handleHelpInteraction(interaction) {
  const parsed = parseHelpMenuCustomId(interaction.customId);
  const ownerId = parsed?.ownerId;
  if (ownerId && ownerId !== interaction.user.id) {
    return interaction.reply({
      content: 'This help menu is not yours. Run /help to open your own.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const selected = interaction.values?.[0] ?? 'quickStart';
  const sectionKey = VALID_SECTIONS.has(selected) ? selected : 'quickStart';
  return interaction.update(buildHelpCenterPayload(interaction, sectionKey));
}
