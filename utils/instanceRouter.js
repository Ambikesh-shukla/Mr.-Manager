import { redis, INSTANCE_ID } from "./redis.js";

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

async function readHeartbeats(candidates) {
  const keys = candidates.map((instanceId) => `heartbeat:${instanceId}`);

  if (typeof redis.mget === "function") {
    try {
      const values = await redis.mget(keys);
      if (Array.isArray(values) && values.length === candidates.length) {
        if (DEBUG) {
          console.log(`[HEARTBEAT] mget batch lookup success for ${candidates.length} instance(s)`);
        }
        return values;
      }
    } catch (error) {
      console.warn(`[HEARTBEAT] mget failed, falling back to sequential checks: ${error.message}`);
    }
  }

  if (DEBUG) {
    console.log("[HEARTBEAT] using sequential heartbeat checks");
  }

  const values = [];
  for (const key of keys) {
    values.push(await redis.get(key));
  }
  return values;
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
    return unique(["vps_3gb", ...fastPool, "vps_256"]);
  }

  if (LIGHT_COMMANDS.has(name)) {
    return unique(["vps_3gb", ...fastPool, "vps_256"]);
  }

  return unique(["vps_3gb", ...fastPool, "vps_256"]);
}

// Old index.js may still call this. Keep it as no-op so server does not crash.
export function startClusterSync() {
  if (DEBUG) {
    console.log(`[CLUSTER] ${INSTANCE_ID} no-poll router active`);
  }
}

export async function shouldHandleInteraction(interaction) {
  try {
    // 1. Get candidate priority list based on command type
    const candidates = getCandidateOrder(interaction);
    
    if (DEBUG) {
      console.log(`[ROUTER] Candidates for ${getInteractionName(interaction)}: ${candidates.join(', ')}`);
    }
    
    // 2. Check which instances are alive (heartbeat check)
    const heartbeatValues = await readHeartbeats(candidates);
    const aliveInstances = [];
    for (let i = 0; i < candidates.length; i++) {
      const instanceId = candidates[i];
      const heartbeat = heartbeatValues[i];
      if (heartbeat) {
        const age = Date.now() - parseInt(heartbeat);
        if (age < 300000) { // 5 minutes max
          aliveInstances.push(instanceId);
          if (DEBUG) {
            console.log(`[HEARTBEAT] ${instanceId} is alive (age: ${Math.floor(age/1000)}s)`);
          }
        } else if (DEBUG) {
          console.log(`[HEARTBEAT] ${instanceId} heartbeat too old (age: ${Math.floor(age/1000)}s)`);
        }
      } else if (DEBUG) {
        console.log(`[HEARTBEAT] ${instanceId} has no heartbeat`);
      }
    }
    
    // 3. Selected handler should acquire lock
    const shouldAttemptLock = aliveInstances.length === 0 || aliveInstances[0] === INSTANCE_ID;
    let shouldHandle = false;

    if (shouldAttemptLock) {
      const lockKey = `lock:interaction:${interaction.id}`;
      const locked = await redis.set(lockKey, INSTANCE_ID, {
        nx: true,
        ex: 60,
      });
      
      if (!locked) {
        console.log(`[LOCK] ${INSTANCE_ID} failed lock for ${getInteractionName(interaction)}`);
        return false;
      }

      console.log(`[LOCK] ${INSTANCE_ID} lock success for ${getInteractionName(interaction)}`);
      shouldHandle = true;
    }
    
    if (DEBUG || shouldHandle) {
      console.log(`[ROUTER] ${INSTANCE_ID} ${shouldHandle ? 'HANDLING' : 'SKIPPING'} ${getInteractionName(interaction)} (alive: ${aliveInstances.join(', ')})`);
    }
    
    return shouldHandle;
  } catch (error) {
    console.error(`[ROUTER ERROR] ${INSTANCE_ID} Redis error, skipping interaction:`, error.message);
    return false;
  }
}
