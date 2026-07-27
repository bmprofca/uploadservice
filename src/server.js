require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const cors = require("cors");
const express = require("express");
const metrics = require("./lib/metrics");
const { getUploadStorageStats } = require("./lib/storage");
const uploadRouter = require("./routes/upload");

const rootDir = path.join(__dirname, "..");
const uploadDir = path.join(rootDir, "uploads");

const app = express();
const port = Number(process.env.PORT) || 3000;
const publicBaseUrl = (process.env.PUBLIC_BASE_URL || "https://upload.onesaas.in").replace(
  /\/$/,
  ""
);

app.locals.uploadDir = uploadDir;
app.locals.publicBaseUrl = publicBaseUrl;

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "upload-service" });
});

// Ensure uploads directory exists in production.
try {
  fs.mkdirSync(uploadDir, { recursive: true });
} catch (err) {
  console.error("Failed to create uploadDir:", uploadDir, err);
}

app.get("/status", async (_req, res, next) => {
  try {
    const storage = await getUploadStorageStats(uploadDir);
    res.json(metrics.getSnapshot({ storage }));
  } catch (err) {
    next(err);
  }
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

app.listen(port, () => {
  console.log(`Upload service listening on http://localhost:${port}`);
  console.log(`Public base URL: ${publicBaseUrl}`);
});
