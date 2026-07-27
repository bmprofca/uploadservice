const os = require("node:os");

const startedAt = Date.now();
const recentUploads = [];

let totalUploads = 0;
let failedUploads = 0;
let totalBytesUploaded = 0;
let activeUploads = 0;
let lastUploadAt = null;

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 100 || exponent === 0 ? value.toFixed(0) : value.toFixed(2)} ${units[exponent]}`;
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function pruneRecentUploads() {
  const cutoff = Date.now() - 5 * 60 * 1000;
  while (recentUploads.length && recentUploads[0].at < cutoff) {
    recentUploads.shift();
  }
}

function recordUploadStart() {
  activeUploads += 1;
}

function recordUploadSuccess(bytes, durationMs) {
  activeUploads = Math.max(0, activeUploads - 1);
  totalUploads += 1;
  totalBytesUploaded += bytes;
  lastUploadAt = new Date().toISOString();

  recentUploads.push({ bytes, durationMs, at: Date.now() });
  pruneRecentUploads();
}

function recordUploadFailure() {
  activeUploads = Math.max(0, activeUploads - 1);
  failedUploads += 1;
}

function getWindowStats(windowMs) {
  const cutoff = Date.now() - windowMs;
  const uploads = recentUploads.filter((entry) => entry.at >= cutoff);
  const bytes = uploads.reduce((sum, entry) => sum + entry.bytes, 0);
  const durationMs = uploads.reduce((sum, entry) => sum + entry.durationMs, 0);
  const seconds = windowMs / 1000;

  return {
    windowSeconds: seconds,
    uploads: uploads.length,
    bytes,
    bytesFormatted: formatBytes(bytes),
    bytesPerSecond: Number((bytes / seconds).toFixed(2)),
    bytesPerSecondFormatted: `${formatBytes(bytes / seconds)}/s`,
    averageFileSizeBytes: uploads.length ? Math.round(bytes / uploads.length) : 0,
    averageFileSizeFormatted: uploads.length ? formatBytes(bytes / uploads.length) : "0 B",
    averageUploadSpeedBytesPerSecond:
      durationMs > 0 ? Number((bytes / (durationMs / 1000)).toFixed(2)) : 0,
    averageUploadSpeedFormatted:
      durationMs > 0 ? `${formatBytes(bytes / (durationMs / 1000))}/s` : "0 B/s",
  };
}

function getAverageUploadDurationMs() {
  if (!recentUploads.length) return 0;
  const totalDuration = recentUploads.reduce((sum, entry) => sum + entry.durationMs, 0);
  return Math.round(totalDuration / recentUploads.length);
}

function getPeakBytesPerSecond(windowMs = 60_000) {
  const cutoff = Date.now() - windowMs;
  const buckets = new Map();

  for (const entry of recentUploads) {
    if (entry.at < cutoff) continue;
    const bucket = Math.floor(entry.at / 1000);
    buckets.set(bucket, (buckets.get(bucket) || 0) + entry.bytes);
  }

  if (!buckets.size) return 0;
  return Math.max(...buckets.values());
}

function getSnapshot({ storage } = {}) {
  const uptimeMs = Date.now() - startedAt;
  const memory = process.memoryUsage();
  const lastMinute = getWindowStats(60_000);
  const lastFiveMinutes = getWindowStats(5 * 60_000);

  return {
    ok: true,
    service: "upload-service",
    timestamp: new Date().toISOString(),
    uptime: {
      ms: uptimeMs,
      human: formatDuration(uptimeMs),
      startedAt: new Date(startedAt).toISOString(),
    },
    uploads: {
      total: totalUploads,
      failed: failedUploads,
      active: activeUploads,
      successRate:
        totalUploads + failedUploads > 0
          ? Number(((totalUploads / (totalUploads + failedUploads)) * 100).toFixed(2))
          : 100,
      totalBytes: totalBytesUploaded,
      totalBytesFormatted: formatBytes(totalBytesUploaded),
      averageFileSizeBytes: totalUploads ? Math.round(totalBytesUploaded / totalUploads) : 0,
      averageFileSizeFormatted: totalUploads
        ? formatBytes(totalBytesUploaded / totalUploads)
        : "0 B",
      averageUploadDurationMs: getAverageUploadDurationMs(),
      lastUploadAt,
    },
    throughput: {
      lastMinute,
      lastFiveMinutes,
    },
    bandwidth: {
      currentBytesPerSecond: lastMinute.bytesPerSecond,
      currentFormatted: lastMinute.bytesPerSecondFormatted,
      peakBytesPerSecondLastMinute: getPeakBytesPerSecond(60_000),
      peakFormattedLastMinute: `${formatBytes(getPeakBytesPerSecond(60_000))}/s`,
      averageUploadSpeedBytesPerSecond: lastFiveMinutes.averageUploadSpeedBytesPerSecond,
      averageUploadSpeedFormatted: lastFiveMinutes.averageUploadSpeedFormatted,
    },
    storage: storage || null,
    system: {
      nodeVersion: process.version,
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      cpuCount: os.cpus().length,
      loadAverage: os.loadavg().map((value) => Number(value.toFixed(2))),
      memory: {
        totalBytes: os.totalmem(),
        freeBytes: os.freemem(),
        usedBytes: os.totalmem() - os.freemem(),
        usagePercent: Number((((os.totalmem() - os.freemem()) / os.totalmem()) * 100).toFixed(2)),
        totalFormatted: formatBytes(os.totalmem()),
        freeFormatted: formatBytes(os.freemem()),
        usedFormatted: formatBytes(os.totalmem() - os.freemem()),
        process: {
          rssBytes: memory.rss,
          heapUsedBytes: memory.heapUsed,
          heapTotalBytes: memory.heapTotal,
          externalBytes: memory.external,
          rssFormatted: formatBytes(memory.rss),
          heapUsedFormatted: formatBytes(memory.heapUsed),
        },
      },
    },
    limits: {
      maxFileSizeMb: Number(process.env.MAX_FILE_SIZE_MB) || 50,
      maxFileSizeBytes: (Number(process.env.MAX_FILE_SIZE_MB) || 50) * 1024 * 1024,
      maxFileSizeFormatted: formatBytes((Number(process.env.MAX_FILE_SIZE_MB) || 50) * 1024 * 1024),
    },
  };
}

module.exports = {
  formatBytes,
  recordUploadStart,
  recordUploadSuccess,
  recordUploadFailure,
  getSnapshot,
};
