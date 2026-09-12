import fsp from "node:fs/promises";
import path from "node:path";

function getTtlMs() {
  const hours = Number(process.env.FILE_TTL_HOURS) || 24;
  return hours * 60 * 60 * 1000;
}

async function readMeta(metaPath) {
  try {
    const raw = await fsp.readFile(metaPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function cleanupExpiredFiles(uploadDir) {
  const ttlMs = getTtlMs();
  const now = Date.now();
  let deleted = 0;

  let entries;
  try {
    entries = await fsp.readdir(uploadDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return { deleted: 0 };
    throw err;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".meta.json")) continue;

    const filePath = path.join(uploadDir, entry.name);
    const metaPath = `${filePath}.meta.json`;
    const meta = await readMeta(metaPath);

    let expiresAtMs = null;
    if (meta?.expiresAt) {
      expiresAtMs = Date.parse(meta.expiresAt);
    } else {
      try {
        const stat = await fsp.stat(filePath);
        expiresAtMs = stat.mtimeMs + ttlMs;
      } catch {
        continue;
      }
    }

    if (!Number.isFinite(expiresAtMs) || expiresAtMs > now) continue;

    try {
      await fsp.unlink(filePath);
      deleted += 1;
    } catch (err) {
      if (err.code !== "ENOENT") {
        console.error("Failed to delete expired file:", filePath, err.message);
      }
    }

    try {
      await fsp.unlink(metaPath);
    } catch (err) {
      if (err.code !== "ENOENT") {
        console.error("Failed to delete meta file:", metaPath, err.message);
      }
    }
  }

  if (deleted > 0) {
    console.log(`Cleanup removed ${deleted} expired file(s)`);
  }

  return { deleted };
}

export function startCleanupScheduler(uploadDir) {
  const intervalMs = Number(process.env.CLEANUP_INTERVAL_MS) || 5 * 60 * 1000;

  cleanupExpiredFiles(uploadDir).catch((err) => {
    console.error("Initial cleanup failed:", err);
  });

  const timer = setInterval(() => {
    cleanupExpiredFiles(uploadDir).catch((err) => {
      console.error("Scheduled cleanup failed:", err);
    });
  }, intervalMs);

  if (typeof timer.unref === "function") timer.unref();

  return timer;
}
