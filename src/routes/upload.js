const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { Router } = require("express");
const { imageSize } = require("image-size");
const multer = require("multer");

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

function buildStorage(uploadDir) {
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const fromName = path.extname(file.originalname || "");
      const ext =
        fromName ||
        extensionFromMime(file.mimetype) ||
        "";
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
    // image-size v2 expects a buffer (sync file-path API was removed)
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

router.post("/upload", (req, res, next) => {
  const uploadDir = req.app.locals.uploadDir;
  const publicBaseUrl = req.app.locals.publicBaseUrl;
  const upload = createUploader(uploadDir);
  const single = upload.single("file");

  single(req, res, async (err) => {
    if (err) return next(err);
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Missing file. Use multipart field name "file".',
      });
    }

    const { filename, originalname, mimetype, size, path: filePath } = req.file;
    const uploadedAt = new Date().toISOString();
    const relativePath = `/files/${encodeURIComponent(filename)}`;
    const url = `${publicBaseUrl}${relativePath}`;

    let checksum;
    try {
      checksum = await sha256File(filePath);
    } catch (e) {
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
      relativePath,
      image,
    };

    return res.status(201).json({
      success: true,
      url,
      meta,
    });
  });
});

module.exports = router;
