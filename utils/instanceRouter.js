import { redis, INSTANCE_ID } from "./redis.js";

const LOCK_TTL_SECONDS = Number(process.env.LOCK_TTL_SECONDS || 60);
const DEBUG = process.env.CLUSTER_DEBUG === "true";

const LIGHT_COMMANDS = new Set([
  "ping",
  "help",
  "serverinfo",
  "afk",
  "suggest",
  "noop",
]);

const HEAVY_COMMANDS = new Set([
  "admin",
  "plan",
  "post",
  "command-lock",
]);

const HEAVY_ORDER = ["vps_3gb", "vps_512_a", "vps_512_b"];
const NORMAL_ORDER = ["vps_512_a", "vps_512_b", "vps_3gb"];

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
  if (HEAVY_COMMANDS.has(name)) return HEAVY_ORDER;
  if (LIGHT_COMMANDS.has(name)) return NORMAL_ORDER;
  return NORMAL_ORDER;
}

async function getAliveCandidates(candidates) {
  const checks = await Promise.all(
    candidates.map(async (instanceId) => {
      try {
        // An instance is considered alive when its heartbeat key exists:
        // `heartbeat:<instance_id>`. The heartbeat writer refreshes TTL periodically.
        const heartbeat = await redis.get(`heartbeat:${instanceId}`);
        return heartbeat ? instanceId : null;
      } catch {
        return null;
      }
    }),
  );

  return checks.filter(Boolean);
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
  const aliveCandidates = await getAliveCandidates(candidates);
  const owner = aliveCandidates[0];

  if (!owner || owner !== INSTANCE_ID) return false;

  const lockKey = `lock:interaction:${interaction.id}`;

  try {
    const lock = await redis.set(lockKey, INSTANCE_ID, {
      nx: true,
      ex: LOCK_TTL_SECONDS,
    });

    if (!lock) {
      return false;
    }

    if (DEBUG) {
      console.log(`[ROUTER] ${INSTANCE_ID} accepted ${name} owner=${owner}`);
    }
    return true;
  } catch (error) {
    console.error(`[ROUTER ERROR] ${INSTANCE_ID}`, error);
    return false;
  }
}
