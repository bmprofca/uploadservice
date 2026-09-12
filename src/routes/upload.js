import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { Router } from "express";
import { imageSize } from "image-size";
import multer from "multer";
import {
  recordUploadFailure,
  recordUploadStart,
  recordUploadSuccess,
} from "../lib/metrics.js";
import { requireApiKey } from "../middleware/auth.js";

const router = Router();

const mimeToExt = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
};

function extensionFromMime(mime) {
  return mimeToExt[mime] || "";
}

function getTtlMs() {
  const hours = Number(process.env.FILE_TTL_HOURS) || 24;
  return hours * 60 * 60 * 1000;
}

function buildStorage(uploadDir) {
  return multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        fs.mkdirSync(uploadDir, { recursive: true });
      } catch {
        // Multer will surface any real filesystem failure.
      }
      cb(null, uploadDir);
    },
    filename: (_req, file, cb) => {
      const fromName = path.extname(file.originalname || "");
      const ext = fromName || extensionFromMime(file.mimetype) || "";
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  });
}

function createUploader(uploadDir) {
  const maxMb = Number(process.env.MAX_FILE_SIZE_MB) || 50;
  return multer({
    storage: buildStorage(uploadDir),
    limits: { fileSize: maxMb * 1024 * 1024 },
  });
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  const buf = await fsp.readFile(filePath);
  hash.update(buf);
  return hash.digest("hex");
}

function tryImageMeta(filePath, mimeType) {
  if (!mimeType?.startsWith("image/") || mimeType === "image/svg+xml") {
    return null;
  }
  try {
    const buf = fs.readFileSync(filePath);
    const dim = imageSize(buf);
    if (dim.width && dim.height) {
      return { width: dim.width, height: dim.height, type: dim.type ?? undefined };
    }
  } catch {
    /* not a readable raster image */
  }
  return null;
}

async function writeFileMeta(filePath, meta) {
  const metaPath = `${filePath}.meta.json`;
  await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf8");
}

router.post("/upload", requireApiKey, (req, res, next) => {
  const uploadDir = req.app.locals.uploadDir;
  const publicBaseUrl = req.app.locals.publicBaseUrl;
  const upload = createUploader(uploadDir);
  const single = upload.single("file");
  const startedAt = Date.now();

  recordUploadStart();

  single(req, res, async (err) => {
    if (err) {
      recordUploadFailure();
      return next(err);
    }
    if (!req.file) {
      recordUploadFailure();
      return res.status(400).json({
        success: false,
        error: 'Missing file. Use multipart field name "file".',
      });
    }

    const { filename, originalname, mimetype, size, path: filePath } = req.file;
    const uploadedAtMs = Date.now();
    const expiresAtMs = uploadedAtMs + getTtlMs();
    const uploadedAt = new Date(uploadedAtMs).toISOString();
    const expiresAt = new Date(expiresAtMs).toISOString();
    const relativePath = `/files/${encodeURIComponent(filename)}`;
    const url = `${publicBaseUrl}${relativePath}`;

    let checksum;
    try {
      checksum = await sha256File(filePath);
    } catch (e) {
      recordUploadFailure();
      return next(e);
    }

    const stat = await fsp.stat(filePath);
    const image = tryImageMeta(filePath, mimetype);

    const meta = {
      id: path.parse(filename).name,
      originalName: originalname,
      storedName: filename,
      mimeType: mimetype,
      size,
      sizeOnDisk: stat.size,
      checksumSha256: checksum,
      uploadedAt,
      expiresAt,
      ttlHours: Number(process.env.FILE_TTL_HOURS) || 24,
      relativePath,
      image,
    };

    try {
      await writeFileMeta(filePath, meta);
    } catch (e) {
      recordUploadFailure();
      return next(e);
    }

    recordUploadSuccess(size, Date.now() - startedAt);

    return res.status(201).json({
      success: true,
      url,
      meta,
    });
  });
});

export default router;
