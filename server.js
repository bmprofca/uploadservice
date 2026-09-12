import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { getSnapshot } from "./src/lib/metrics.js";
import { getUploadStorageStats } from "./src/lib/storage.js";
import { startCleanupScheduler } from "./src/lib/cleanup.js";
import uploadRouter from "./src/routes/upload.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = __dirname;
const uploadDir = path.join(rootDir, "uploads");

const app = express();
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "0.0.0.0";
const publicBaseUrl = (process.env.PUBLIC_BASE_URL || "https://upload.onesaas.in").replace(
  /\/$/,
  ""
);

app.locals.uploadDir = uploadDir;
app.locals.publicBaseUrl = publicBaseUrl;

app.use(cors());
app.use(express.json());

try {
  fs.mkdirSync(uploadDir, { recursive: true });
} catch (err) {
  console.error("Failed to create uploadDir:", uploadDir, err);
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "upload-service" });
});

app.get("/status", async (_req, res, next) => {
  try {
    const storage = await getUploadStorageStats(uploadDir);
    res.json(getSnapshot({ storage }));
  } catch (err) {
    next(err);
  }
});

app.use("/files", (req, res, next) => {
  if (req.path.endsWith(".meta.json")) {
    return res.status(404).end();
  }
  return next();
});
app.use("/files", express.static(uploadDir, { fallthrough: false }));

app.use("/api", uploadRouter);

app.use((err, _req, res, _next) => {
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ success: false, error: "File too large" });
  }
  console.error(err);
  res.status(500).json({
    success: false,
    error: err?.message || "Internal server error",
    code: err?.code,
    name: err?.name,
    stack: err?.stack,
  });
});

startCleanupScheduler(uploadDir);

app.listen(port, host, () => {
  console.log(`Upload service listening on http://${host}:${port}`);
  console.log(`Public base URL: ${publicBaseUrl}`);
  console.log(`File TTL: ${Number(process.env.FILE_TTL_HOURS) || 24} hour(s)`);
});
