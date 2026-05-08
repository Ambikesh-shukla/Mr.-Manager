import { getActionCost, normalizeActionKey } from './billingConfig.js';

function parseSlashActionKey(interaction) {
  const command = interaction?.commandName?.trim?.();
  if (!command) return null;

  let subcommand = null;
  try {
    subcommand = interaction.options?.getSubcommand?.(false) ?? null;
  } catch {
    subcommand = null;
  }

  return normalizeActionKey(subcommand ? `${command}.${subcommand}` : command);
}

function parseBillCustomId(customId) {
  if (!customId || typeof customId !== 'string') return null;
  const trimmed = customId.trim();
  if (!trimmed.startsWith('bill:')) return null;

  const [, actionKey] = trimmed.split(':');
  return normalizeActionKey(actionKey ?? null);
}

function parseComponentActionKey(interaction) {
  return parseBillCustomId(interaction?.customId);
}

export function detectActionKey(interaction) {
  if (!interaction) return null;

  if (typeof interaction.isChatInputCommand === 'function' && interaction.isChatInputCommand()) {
    return parseSlashActionKey(interaction);
  }

  if (
    (typeof interaction.isButton === 'function' && interaction.isButton()) ||
    (typeof interaction.isStringSelectMenu === 'function' && interaction.isStringSelectMenu()) ||
    (typeof interaction.isModalSubmit === 'function' && interaction.isModalSubmit())
  ) {
    return parseComponentActionKey(interaction);
  }

  if (typeof interaction.customId === 'string') {
    return parseBillCustomId(interaction.customId);
  }

  return null;
}

export function getBillingDecision(interaction) {
  const actionKey = detectActionKey(interaction);
  const cost = getActionCost(actionKey);
  return {
    actionKey,
    cost,
    shouldCharge: cost > 0,
  };
}
