import { buildHelpCenterPayload, HELP_SECTION_KEYS } from '../utils/helpCenter.js';

const VALID_SECTIONS = new Set(HELP_SECTION_KEYS);

export async function handleHelpInteraction(interaction) {
  const selected = interaction.values?.[0] ?? 'overview';
  const sectionKey = VALID_SECTIONS.has(selected) ? selected : 'overview';
  return interaction.update(buildHelpCenterPayload(interaction, sectionKey));
}
