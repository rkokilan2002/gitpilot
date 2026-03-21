import { getDB } from "./mongo.js";
import { loadConfig } from "./config.js";
import { loadState, saveState } from "./state.js";
import { warning } from "./ui.js";

function mergeLocks(local: any[], remote: any[]) {
  const map = new Map();

  [...local, ...remote].forEach((l) => {
    map.set(l.file, l);
  });

  return Array.from(map.values());
}

export async function pullState(repo: string) {
  try {
    const config = await loadConfig();

    if (!config.mongoUri) {
      return;
    }

    const db = await getDB();
    const col = db.collection("state");

    const remote = await col.findOne({ repo });

    if (!remote) return;

    const local = await loadState();

    const merged = {
      locks: mergeLocks(local.locks, remote.locks || []),
      activity: [...local.activity, ...(remote.activity || [])],
    };

    merged.activity = merged.activity.slice(-500);

    await saveState(merged);
  } catch (error: any) {
    if (error?.message?.includes("Mongo URI not set")) {
      return;
    }

    warning("Sync pull skipped (offline)");
  }
}

export async function pushState(repo: string) {
  try {
    const config = await loadConfig();

    if (!config.mongoUri) {
      return;
    }

    const db = await getDB();
    const col = db.collection("state");

    const state = await loadState();

    await col.updateOne(
      { repo },
      {
        $set: {
          repo,
          locks: state.locks,
          activity: state.activity,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
  } catch (error: any) {
    if (error?.message?.includes("Mongo URI not set")) {
      return;
    }

    warning("Sync push skipped (offline)");
  }
}