const fsp = require("node:fs/promises");
const path = require("node:path");
const { formatBytes } = require("./metrics");

async function getUploadStorageStats(uploadDir) {
  let fileCount = 0;
  let totalSizeBytes = 0;
  let oldestFileAt = null;
  let newestFileAt = null;

  try {
    const entries = await fsp.readdir(uploadDir, { withFileTypes: true });

    await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          const filePath = path.join(uploadDir, entry.name);
          const stat = await fsp.stat(filePath);
          fileCount += 1;
          totalSizeBytes += stat.size;

          const modifiedAt = stat.mtime.toISOString();
          if (!oldestFileAt || modifiedAt < oldestFileAt) oldestFileAt = modifiedAt;
          if (!newestFileAt || modifiedAt > newestFileAt) newestFileAt = modifiedAt;
        })
    );
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  return {
    directory: uploadDir,
    fileCount,
    totalSizeBytes,
    totalSizeFormatted: formatBytes(totalSizeBytes),
    averageFileSizeBytes: fileCount ? Math.round(totalSizeBytes / fileCount) : 0,
    averageFileSizeFormatted: fileCount ? formatBytes(totalSizeBytes / fileCount) : "0 B",
    oldestFileAt,
    newestFileAt,
  };
}

module.exports = { getUploadStorageStats };
