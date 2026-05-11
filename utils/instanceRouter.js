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
    const aliveInstances = [];
    for (const instanceId of candidates) {
      const heartbeat = await redis.get(`heartbeat:${instanceId}`);
      if (heartbeat) {
        const age = Date.now() - parseInt(heartbeat);
        if (age < 300000) { // 5 minutes max
          aliveInstances.push(instanceId);
          if (DEBUG) {
            console.log(`[ROUTER] ${instanceId} is alive (age: ${Math.floor(age/1000)}s)`);
          }
        } else if (DEBUG) {
          console.log(`[ROUTER] ${instanceId} heartbeat too old (age: ${Math.floor(age/1000)}s)`);
        }
      } else if (DEBUG) {
        console.log(`[ROUTER] ${instanceId} has no heartbeat`);
      }
    }
    
    // 3. If no instances alive, fallback to current instance
    if (aliveInstances.length === 0) {
      console.log(`[ROUTER] No alive instances, ${INSTANCE_ID} handling fallback`);
      return true;
    }
    
    // 4. Check if current instance is the first alive candidate
    const shouldHandle = aliveInstances[0] === INSTANCE_ID;
    
    // 5. Redis lock to prevent race conditions (only if we should handle)
    if (shouldHandle) {
      const lockKey = `lock:interaction:${interaction.id}`;
      const locked = await redis.set(lockKey, INSTANCE_ID, {
        ex: LOCK_TTL_SECONDS,
        nx: true // Only set if not exists
      });
      
      if (!locked) {
        console.log(`[ROUTER] ${INSTANCE_ID} lost lock race for ${getInteractionName(interaction)}`);
        return false;
      }
    }
    
    if (DEBUG || shouldHandle) {
      console.log(`[ROUTER] ${INSTANCE_ID} ${shouldHandle ? 'HANDLING' : 'SKIPPING'} ${getInteractionName(interaction)} (alive: ${aliveInstances.join(', ')})`);
    }
    
    return shouldHandle;
  } catch (error) {
    // If Redis fails, fallback to handling locally
    console.error(`[ROUTER ERROR] ${INSTANCE_ID} Redis error, handling locally:`, error.message);
    return true;
  }
}
