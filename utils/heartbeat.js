import { redis, INSTANCE_ID } from "./redis.js";

const HEARTBEAT_TTL_SECONDS = Number(process.env.HEARTBEAT_TTL_SECONDS || 420);
const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS || 180000);
const DEBUG = process.env.CLUSTER_DEBUG === "true";

let heartbeatStarted = false;

export function startHeartbeat() {
  if (heartbeatStarted) return;
  heartbeatStarted = true;

  async function beat() {
    try {
      await redis.set(`heartbeat:${INSTANCE_ID}`, Date.now(), {
        ex: HEARTBEAT_TTL_SECONDS,
      });

      if (DEBUG) {
        console.log(`[HEARTBEAT] ${INSTANCE_ID} alive`);
      }
    } catch (error) {
      console.error(`[HEARTBEAT ERROR] ${INSTANCE_ID}`, error);
    }
  }

  beat();

  const timer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
  if (timer.unref) timer.unref();
}
