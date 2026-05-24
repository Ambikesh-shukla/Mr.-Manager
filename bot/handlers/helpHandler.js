import { buildHelpCenterPayload } from '../utils/helpCenter.js';

const VALID_SECTIONS = new Set(['overview', 'tickets', 'hosting', 'tools', 'automation']);

export async function handleHelpInteraction(interaction) {
  const selected = interaction.values?.[0] ?? 'overview';
  const sectionKey = VALID_SECTIONS.has(selected) ? selected : 'overview';
  return interaction.update(buildHelpCenterPayload(interaction, sectionKey));
}
