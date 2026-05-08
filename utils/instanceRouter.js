import { redis, INSTANCE_ID } from "./redis.js";

const LOCK_TTL_SECONDS = Number(process.env.LOCK_TTL_SECONDS || 60);
const ROUTER_FALLBACK_DELAY_MS = Number(process.env.ROUTER_FALLBACK_DELAY_MS || 350);
const DEBUG = process.env.CLUSTER_DEBUG === "true";

const LIGHT_COMMANDS = new Set([
  "ping",
  "help",
  "serverinfo",
  "afk",
  "suggest",
  "noop",
]);

const MIDDLE_COMMANDS = new Set([
  "ticket",
  "ticketopentype",
  "ticketmodal",
  "ticketclose",
  "ticketadduser",
  "ticketremoveuser",
  "ticketrename",
  "panel",
  "panelselect",
  "setup",
  "setup-ticket",
  "welcome",
  "autoresponse",
  "review",
  "plan_buy",
]);

const HEAVY_COMMANDS = new Set([
  "admin",
  "plan",
  "post",
  "command-lock",
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hashString(input) {
  let hash = 0;
  const text = String(input || "");

  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }

  return hash;
}

function rotate(list, amount) {
  if (!list.length) return list;
  const cut = amount % list.length;
  return [...list.slice(cut), ...list.slice(0, cut)];
}

function unique(list) {
  return [...new Set(list.filter(Boolean))];
}

function getInteractionName(interaction) {
  if (interaction.isChatInputCommand?.()) {
    return interaction.commandName || "unknown";
  }

  if (interaction.customId) {
    return interaction.customId.split(":")[0] || "unknown";
  }

  return "unknown";
}

function getCandidateOrder(interaction) {
  const name = getInteractionName(interaction);
  const seed = hashString(interaction.id || `${name}:${interaction.user?.id}`);

  const fastPool = rotate(["vps_512_a", "vps_512_b"], seed);

  if (HEAVY_COMMANDS.has(name)) {
    return unique(["vps_3gb", ...fastPool, "vps_256"]);
  }

  if (MIDDLE_COMMANDS.has(name)) {
    return unique([...fastPool, "vps_256", "vps_3gb"]);
  }

  if (LIGHT_COMMANDS.has(name)) {
    return unique([...fastPool, "vps_256", "vps_3gb"]);
  }

  return unique([...fastPool, "vps_256", "vps_3gb"]);
}

// Old index.js may still call this. Keep it as no-op so server does not crash.
export function startClusterSync() {
  if (DEBUG) {
    console.log(`[CLUSTER] ${INSTANCE_ID} no-poll router active`);
  }
}

export async function shouldHandleInteraction(interaction) {
  const name = getInteractionName(interaction);
  const candidates = getCandidateOrder(interaction);
  const myIndex = candidates.indexOf(INSTANCE_ID);

  if (myIndex === -1) {
    return false;
  }

  if (myIndex > 0) {
    await sleep(myIndex * ROUTER_FALLBACK_DELAY_MS);
  }

  const lockKey = `lock:interaction:${interaction.id}`;

  try {
    const lock = await redis.set(lockKey, INSTANCE_ID, {
      nx: true,
      ex: LOCK_TTL_SECONDS,
    });

    if (!lock) {
      return false;
    }

    console.log(`[ROUTER] ${INSTANCE_ID} accepted ${name}`);
    return true;
  } catch (error) {
    console.error(`[ROUTER ERROR] ${INSTANCE_ID}`, error);
    return false;
  }
}
