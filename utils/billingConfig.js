const FREE_ACTIONS = new Set([
  'help',
  'ping',
  'credits',
  'premium.status',
  'redeem',
  'serverinfo',
  'afk.set',
  'afk.status',
  'afk.remove',
  'plan.list',
  'review.submit',
  'command-lock.view',
  'command-lock.list',
  'autoresponse.list',
]);

const PAID_ACTIONS = new Set([
  'ticket.panel.publish',
  'ticket.panel.edit',
  'ticket.panel.delete',
  'ticket.open',
  'ticket.close',
  'plan.create',
  'plan.delete',
  'post.embed',
  'server.create',
  // Slash alias compatibility
  'ticket.edit',
  'ticket.delete',
]);

const ACTION_KEY_ALIASES = Object.freeze({
  'ticket.edit': 'ticket.panel.edit',
  'ticket.delete': 'ticket.panel.delete',
});

export { FREE_ACTIONS, PAID_ACTIONS, ACTION_KEY_ALIASES };

export function normalizeActionKey(actionKey) {
  if (!actionKey || typeof actionKey !== 'string') return null;
  const normalized = actionKey.trim();
  if (!normalized) return null;
  return ACTION_KEY_ALIASES[normalized] ?? normalized;
}

export function getActionCost(actionKey) {
  const key = normalizeActionKey(actionKey);
  if (!key) return 0;
  if (PAID_ACTIONS.has(key)) return 1;
  if (FREE_ACTIONS.has(key)) return 0;
  return 0;
}

export function isPaidAction(actionKey) {
  return getActionCost(actionKey) > 0;
}

export function isFreeAction(actionKey) {
  const key = normalizeActionKey(actionKey);
  return !!key && FREE_ACTIONS.has(key);
}
