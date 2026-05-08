import { getDb } from '../database/mongo.js';

const GUILDS_COLLECTION = 'guilds';
const CREDIT_TRANSACTIONS_COLLECTION = 'credit_transactions';

const DEFAULT_PLAN = 'free';
const PRO_PLAN = 'pro';
const DEFAULT_CREDITS = 50;

function normalizeGuildId(guildId) {
  return typeof guildId === 'string' ? guildId.trim() : '';
}

function normalizeActionKey(actionKey) {
  if (typeof actionKey !== 'string') return null;
  const trimmed = actionKey.trim();
  return trimmed ? trimmed : null;
}

function normalizePlan(plan) {
  if (typeof plan !== 'string') return DEFAULT_PLAN;
  const trimmed = plan.trim();
  return trimmed || DEFAULT_PLAN;
}

function normalizeAmount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

function normalizeCreditsValue(value) {
  const parsed = Number(value);
  if (parsed === -1) return -1;
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

function createDefaultGuild(guildId, now = new Date()) {
  return {
    guildId,
    plan: DEFAULT_PLAN,
    credits: DEFAULT_CREDITS,
    totalUsed: 0,
    byAction: {},
    redeemedBy: null,
    planExpiresAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function buildByActionIncrementExpression(actionKey, amount) {
  if (!actionKey || amount <= 0) {
    return { $ifNull: ['$byAction', {}] };
  }

  return {
    $let: {
      vars: {
        currentByAction: { $ifNull: ['$byAction', {}] },
      },
      in: {
        $setField: {
          field: actionKey,
          input: '$$currentByAction',
          value: {
            $add: [
              {
                $ifNull: [
                  {
                    $getField: {
                      field: actionKey,
                      input: '$$currentByAction',
                    },
                  },
                  0,
                ],
              },
              amount,
            ],
          },
        },
      },
    },
  };
}

async function insertCreditTransaction({
  guildId,
  userId = null,
  type,
  actionKey = null,
  amount,
  beforeCredits,
  afterCredits,
  reason = null,
  createdAt = new Date(),
}) {
  const db = getDb();
  await db.collection(CREDIT_TRANSACTIONS_COLLECTION).insertOne({
    guildId,
    userId,
    type,
    actionKey,
    amount,
    beforeCredits,
    afterCredits,
    reason,
    createdAt,
  });
}

function isUnlimitedGuild(guild) {
  if (!guild) return false;
  return guild.credits === -1 || guild.plan === PRO_PLAN;
}

export async function ensureGuild(guildId) {
  const normalizedGuildId = normalizeGuildId(guildId);
  if (!normalizedGuildId) {
    throw new Error('guildId is required');
  }

  const db = getDb();
  const now = new Date();
  const defaultGuild = createDefaultGuild(normalizedGuildId, now);

  const result = await db.collection(GUILDS_COLLECTION).findOneAndUpdate(
    { guildId: normalizedGuildId },
    { $setOnInsert: defaultGuild },
    {
      upsert: true,
      returnDocument: 'after',
    },
  );

  return result;
}

export async function getGuildCredits(guildId) {
  return ensureGuild(guildId);
}

export async function canUseAction(guildId, cost) {
  const requiredCost = normalizeAmount(cost);
  if (requiredCost <= 0) return true;

  const guild = await ensureGuild(guildId);
  if (isUnlimitedGuild(guild)) return true;

  return (guild.credits ?? 0) >= requiredCost;
}

export async function deductCredits(guildId, cost, actionKey = null, userId = null) {
  const normalizedGuildId = normalizeGuildId(guildId);
  if (!normalizedGuildId) {
    throw new Error('guildId is required');
  }

  const amount = normalizeAmount(cost);
  const normalizedActionKey = normalizeActionKey(actionKey);

  const guilds = getDb().collection(GUILDS_COLLECTION);

  if (amount <= 0) {
    return ensureGuild(normalizedGuildId);
  }

  const now = new Date();
  const performDeduction = (timestamp) => guilds.findOneAndUpdate(
    {
      guildId: normalizedGuildId,
      $or: [
        { credits: -1 },
        { plan: PRO_PLAN },
        { credits: { $gte: amount } },
      ],
    },
    [
      {
        $set: {
          credits: {
            $cond: [
              { $or: [{ $eq: ['$credits', -1] }, { $eq: ['$plan', PRO_PLAN] }] },
              '$credits',
              { $subtract: [{ $ifNull: ['$credits', DEFAULT_CREDITS] }, amount] },
            ],
          },
          totalUsed: {
            $add: [{ $ifNull: ['$totalUsed', 0] }, amount],
          },
          byAction: buildByActionIncrementExpression(normalizedActionKey, amount),
          updatedAt: timestamp,
        },
      },
    ],
    {
      returnDocument: 'after',
      upsert: false,
    },
  );

  let updatedGuild = await performDeduction(now);
  let transactionTime = now;

  if (!updatedGuild) {
    await ensureGuild(normalizedGuildId);
    transactionTime = new Date();
    updatedGuild = await performDeduction(transactionTime);
    if (!updatedGuild) return null;
  }

  const unlimited = isUnlimitedGuild(updatedGuild);
  const beforeCredits = unlimited ? updatedGuild.credits : updatedGuild.credits + amount;

  await insertCreditTransaction({
    guildId: normalizedGuildId,
    userId,
    type: 'deduct',
    actionKey: normalizedActionKey,
    amount,
    beforeCredits,
    afterCredits: updatedGuild.credits,
    createdAt: transactionTime,
  });

  return updatedGuild;
}

export async function refundCredits(guildId, cost, actionKey = null, userId = null, reason = null) {
  const normalizedGuildId = normalizeGuildId(guildId);
  if (!normalizedGuildId) {
    throw new Error('guildId is required');
  }

  const amount = normalizeAmount(cost);
  const normalizedActionKey = normalizeActionKey(actionKey);

  if (amount <= 0) {
    return ensureGuild(normalizedGuildId);
  }

  await ensureGuild(normalizedGuildId);

  const now = new Date();
  const updatedGuild = await getDb().collection(GUILDS_COLLECTION).findOneAndUpdate(
    { guildId: normalizedGuildId },
    [
      {
        $set: {
          credits: {
            $cond: [
              { $or: [{ $eq: ['$credits', -1] }, { $eq: ['$plan', PRO_PLAN] }] },
              '$credits',
              { $add: [{ $ifNull: ['$credits', DEFAULT_CREDITS] }, amount] },
            ],
          },
          updatedAt: now,
        },
      },
    ],
    {
      returnDocument: 'after',
    },
  );

  const unlimited = isUnlimitedGuild(updatedGuild);
  const beforeCredits = unlimited ? updatedGuild.credits : updatedGuild.credits - amount;

  await insertCreditTransaction({
    guildId: normalizedGuildId,
    userId,
    type: 'refund',
    actionKey: normalizedActionKey,
    amount,
    beforeCredits,
    afterCredits: updatedGuild.credits,
    reason,
    createdAt: now,
  });

  return updatedGuild;
}

export async function addCredits(guildId, amount, reason = null) {
  const normalizedGuildId = normalizeGuildId(guildId);
  if (!normalizedGuildId) {
    throw new Error('guildId is required');
  }

  const normalizedAmount = normalizeAmount(amount);
  if (normalizedAmount <= 0) {
    return ensureGuild(normalizedGuildId);
  }

  await ensureGuild(normalizedGuildId);

  const now = new Date();
  const updatedGuild = await getDb().collection(GUILDS_COLLECTION).findOneAndUpdate(
    { guildId: normalizedGuildId },
    [
      {
        $set: {
          credits: {
            $cond: [
              { $or: [{ $eq: ['$credits', -1] }, { $eq: ['$plan', PRO_PLAN] }] },
              '$credits',
              { $add: [{ $ifNull: ['$credits', DEFAULT_CREDITS] }, normalizedAmount] },
            ],
          },
          updatedAt: now,
        },
      },
    ],
    {
      returnDocument: 'after',
    },
  );

  const unlimited = isUnlimitedGuild(updatedGuild);
  const beforeCredits = unlimited ? updatedGuild.credits : updatedGuild.credits - normalizedAmount;

  await insertCreditTransaction({
    guildId: normalizedGuildId,
    type: 'add',
    amount: normalizedAmount,
    beforeCredits,
    afterCredits: updatedGuild.credits,
    reason,
    createdAt: now,
  });

  return updatedGuild;
}

export async function setPlan(guildId, plan, credits, planExpiresAt = null, redeemedBy = null) {
  const normalizedGuildId = normalizeGuildId(guildId);
  if (!normalizedGuildId) {
    throw new Error('guildId is required');
  }

  const normalizedPlan = normalizePlan(plan);
  const resolvedCredits = normalizeCreditsValue(credits);

  const previousGuild = await ensureGuild(normalizedGuildId);

  const now = new Date();
  const updatePayload = {
    plan: normalizedPlan,
    credits: resolvedCredits,
    redeemedBy: redeemedBy ?? null,
    planExpiresAt: planExpiresAt ? new Date(planExpiresAt) : null,
    updatedAt: now,
  };

  const updatedGuild = await getDb().collection(GUILDS_COLLECTION).findOneAndUpdate(
    { guildId: normalizedGuildId },
    { $set: updatePayload },
    {
      returnDocument: 'after',
    },
  );

  await insertCreditTransaction({
    guildId: normalizedGuildId,
    userId: redeemedBy ?? null,
    type: 'redeem',
    amount: resolvedCredits,
    beforeCredits: previousGuild.credits,
    afterCredits: updatedGuild.credits,
    reason: `Plan set to ${normalizedPlan}`,
    createdAt: now,
  });

  return updatedGuild;
}
