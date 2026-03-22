import { getDB } from "./mongo.js";
import { loadConfig } from "./config.js";
import { loadState, saveState } from "./state.js";
import { warning } from "./ui.js";

function normalizeFilePath(file: unknown) {
  if (typeof file !== "string") {
    return "";
  }

  return file.replace(/\\/g, "/").trim();
}

function lockIdentity(lock: any) {
  const file = normalizeFilePath(lock?.file);
  const user = String(lock?.userId ?? lock?.user ?? "").trim();
  return `${file}::${user}`;
}

function activityIdentity(activity: any) {
  const file = normalizeFilePath(activity?.file);
  const user = String(activity?.userId ?? activity?.user ?? "").trim();
  const timestamp = Number(activity?.timestamp ?? 0);
  return `${file}::${user}::${timestamp}`;
}

function dedupeActivity(local: any[], remote: any[]) {
  const map = new Map<string, any>();

  [...remote, ...local].forEach((item) => {
    const normalized = {
      ...item,
      file: normalizeFilePath(item?.file),
    };

    const key = activityIdentity(normalized);
    map.set(key, normalized);
  });

  return Array.from(map.values())
    .sort((a: any, b: any) => Number(a?.timestamp ?? 0) - Number(b?.timestamp ?? 0))
    .slice(-500);
}

function locksFromRemote(remote: any[]) {
  const map = new Map<string, any>();

  remote.forEach((lock) => {
    const normalized = {
      ...lock,
      file: normalizeFilePath(lock?.file),
    };

    const key = lockIdentity(normalized);

    if (!key.startsWith("::")) {
      map.set(key, normalized);
    }
  });

  return Array.from(map.values());
}

function mergeLocksForPush(local: any[], remote: any[]) {
  const remoteMap = new Map<string, any>();

  remote.forEach((lock) => {
    const normalized = {
      ...lock,
      file: normalizeFilePath(lock?.file),
    };

    const key = lockIdentity(normalized);
    if (!key.startsWith("::")) {
      remoteMap.set(key, normalized);
    }
  });

  const localMap = new Map<string, any>();

  local.forEach((lock) => {
    const normalized = {
      ...lock,
      file: normalizeFilePath(lock?.file),
    };

    const key = lockIdentity(normalized);
    if (!key.startsWith("::")) {
      localMap.set(key, normalized);
    }
  });

  // Local lock set is authoritative for removals; remote contributes metadata and concurrent fields.
  const merged: any[] = [];

  localMap.forEach((localLock, key) => {
    const remoteLock = remoteMap.get(key) ?? {};
    merged.push({
      ...remoteLock,
      ...localLock,
    });
  });

  return merged;
}

export async function pullState(repo: string) {
  let client: { close: () => Promise<void> } | null = null;

  try {
    const config = await loadConfig();

    if (!config.mongoUri) {
      return;
    }

    const mongo = await getDB();
    const db = mongo.db;
    client = mongo.client;
    const col = db.collection("state");

    const remote = await col.findOne({ repo });

    if (!remote) return;

    const local = await loadState();

    const merged = {
      locks: locksFromRemote(remote.locks || []),
      activity: dedupeActivity(local.activity || [], remote.activity || []),
    };

    await saveState(merged);
  } catch (error: any) {
    if (error?.message?.includes("Mongo URI not set")) {
      return;
    }

    warning("Sync pull skipped (offline)");
  } finally {
    if (client) {
      await client.close();
    }
  }
}

export async function pushState(repo: string) {
  let client: { close: () => Promise<void> } | null = null;

  try {
    const config = await loadConfig();

    if (!config.mongoUri) {
      return;
    }

    const mongo = await getDB();
    const db = mongo.db;
    client = mongo.client;
    const col = db.collection("state");

    const local = await loadState();
    const remote = await col.findOne({ repo });

    const merged = {
      locks: mergeLocksForPush(local.locks || [], remote?.locks || []),
      activity: dedupeActivity(local.activity || [], remote?.activity || []),
    };

    await saveState(merged);

    await col.updateOne(
      { repo },
      {
        $set: {
          repo,
          locks: merged.locks,
          activity: merged.activity,
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
  } finally {
    if (client) {
      await client.close();
    }
  }
}