const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const router = express.Router();

const uploadDir = path.resolve(__dirname, "..", "..", "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

function sanitizeBaseName(value) {
  return String(value || "")
    .trim()
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function buildStoredFileName(originalName) {
  const ext = path.extname(String(originalName || "")).toLowerCase().slice(0, 10);
  const base = sanitizeBaseName(path.basename(String(originalName || "file"), ext)) || "file";
  const stamp = Date.now();
  const rand = Math.floor(Math.random() * 1e7).toString(36);
  return `${stamp}_${rand}_${base}${ext}`;
}

function resolveProtocol(req) {
  const forwarded = String(req.header("x-forwarded-proto") || "").trim();
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.protocol || "http";
}

function buildPublicUrl(req, fileName) {
  return `${resolveProtocol(req)}://${req.get("host")}/uploads/${fileName}`;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, buildStoredFileName(file.originalname))
});

const upload = multer({
  storage,
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 1
  }
});

router.post("/upload", upload.single("file"), (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ message: "未接收到上传文件" });
    return;
  }

  res.json({
    key: file.filename,
    name: file.originalname || file.filename,
    size: Number(file.size || 0),
    mimeType: file.mimetype || "",
    url: buildPublicUrl(req, file.filename)
  });
});

router.delete("/upload/:key", (req, res) => {
  const key = String((req.params || {}).key || "").trim();
  if (!key) {
    res.status(400).json({ message: "缺少文件标识" });
    return;
  }

  const fileName = path.basename(key);
  if (!fileName || fileName !== key) {
    res.status(400).json({ message: "文件标识非法" });
    return;
  }

  const targetPath = path.join(uploadDir, fileName);
  fs.unlink(targetPath, (error) => {
    if (error && error.code !== "ENOENT") {
      res.status(500).json({ message: "删除失败，请稍后重试" });
      return;
    }
    res.json({ ok: true, key: fileName });
  });
});

module.exports = router;
