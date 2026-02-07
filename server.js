const path = require("path");
const fs = require("fs/promises");
const fssync = require("fs");
const express = require("express");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const winston = require("winston");
const morgan = require("morgan");

const { initStore, getData, saveData } = require("./lib/store");
const { probeVideo, probeImage, createThumbnail, transcodeToMp4, createAdaptiveHlsPackage } = require("./lib/media");

const PORT = Number(process.env.PORT || 3000);
const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || "").trim();
const UPLOAD_DIR = path.join(__dirname, "uploads");
const THUMB_DIR = path.join(__dirname, "thumbnails");
const HLS_DIR = path.join(__dirname, "hls");
const LOG_DIR = path.join(__dirname, "logs");

const app = express();
const ERROR_WINDOW_MS = 24 * 60 * 60 * 1000;

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: path.join(LOG_DIR, "error.log"), level: "error" }),
    new winston.transports.File({ filename: path.join(LOG_DIR, "combined.log") }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

const playerStatus = {
  currentVideoId: null,
  currentTime: 0,
  state: "idle",
  lastError: null,
  lastUpdate: null
};

const TRANSCODE_CONCURRENCY = Math.max(1, Number(process.env.TRANSCODE_CONCURRENCY || 1));
const MAX_TRANSCODE_QUEUE = Math.max(1, Number(process.env.MAX_TRANSCODE_QUEUE || 25));

const processingQueue = [];
let activeProcessingJobs = 0;
const hlsProcessing = new Set();
const hlsFailed = new Set();
const processingMetrics = {
  cycleTotal: 0,
  cycleDone: 0,
  cycleFailed: 0,
  lastLabel: null,
  startedAt: null
};

function beginProcessingCycleIfNeeded() {
  if (processingMetrics.startedAt) return;
  processingMetrics.cycleTotal = 0;
  processingMetrics.cycleDone = 0;
  processingMetrics.cycleFailed = 0;
  processingMetrics.lastLabel = null;
  processingMetrics.startedAt = new Date().toISOString();
}

function maybeCloseProcessingCycle() {
  if (activeProcessingJobs > 0 || processingQueue.length > 0) return;
  processingMetrics.startedAt = null;
  processingMetrics.lastLabel = null;
}

function queueSnapshot() {
  const completed = processingMetrics.cycleDone + processingMetrics.cycleFailed;
  const total = processingMetrics.cycleTotal;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  return {
    active: activeProcessingJobs,
    pending: processingQueue.length,
    concurrency: TRANSCODE_CONCURRENCY,
    maxPending: MAX_TRANSCODE_QUEUE,
    totalInCycle: total,
    completedInCycle: completed,
    failedInCycle: processingMetrics.cycleFailed,
    percent,
    running: Boolean(processingMetrics.startedAt),
    currentLabel: processingMetrics.lastLabel,
    startedAt: processingMetrics.startedAt
  };
}

function runNextProcessingJob() {
  if (activeProcessingJobs >= TRANSCODE_CONCURRENCY) return;
  const next = processingQueue.shift();
  if (!next) return;

  activeProcessingJobs += 1;
  processingMetrics.lastLabel = next.label || "Procesando";
  Promise.resolve()
    .then(() => next.task())
    .then((result) => {
      processingMetrics.cycleDone += 1;
      next.resolve(result);
    })
    .catch((error) => {
      processingMetrics.cycleFailed += 1;
      next.reject(error);
    })
    .finally(() => {
      activeProcessingJobs -= 1;
      runNextProcessingJob();
      maybeCloseProcessingCycle();
    });
}

function enqueueProcessingJob(task, options = {}) {
  return new Promise((resolve, reject) => {
    if (processingQueue.length >= MAX_TRANSCODE_QUEUE) {
      const error = new Error("Processing queue full");
      error.code = "QUEUE_FULL";
      reject(error);
      return;
    }
    beginProcessingCycleIfNeeded();
    processingMetrics.cycleTotal += 1;
    processingQueue.push({ task, resolve, reject, label: options.label || "Procesando" });
    runNextProcessingJob();
  });
}

function formatSize(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const precision = size >= 100 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
}

async function getDiskUsage() {
  try {
    const stat = await fs.statfs(UPLOAD_DIR);
    const blockSize = Number(stat.bsize || 0);
    const totalBlocks = Number(stat.blocks || 0);
    const freeBlocks = Number(stat.bavail || stat.bfree || 0);

    const totalBytes = blockSize * totalBlocks;
    const freeBytes = blockSize * freeBlocks;
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    const usedPercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;

    return {
      total: formatSize(totalBytes),
      used: formatSize(usedBytes),
      free: formatSize(freeBytes),
      usedPercent: `${usedPercent}%`,
      totalBytes,
      usedBytes,
      freeBytes
    };
  } catch (error) {
    return null;
  }
}

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${uuidv4()}${ext}`);
    }
  }),
  limits: {
    fileSize: Number(process.env.MAX_FILE_SIZE || 4294967296)
  }
});

function isSupportedExtension(filename) {
  const ext = path.extname(filename).toLowerCase();
  return [".mp4", ".webm", ".mkv", ".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext);
}

function isImageExtension(filename) {
  const ext = path.extname(filename).toLowerCase();
  return [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext);
}

function isAudioExtension(filename) {
  const ext = path.extname(filename).toLowerCase();
  return [".mp3", ".m4a", ".aac", ".ogg", ".wav"].includes(ext);
}

function detectMediaType(item) {
  if (!item) return "video";
  if (item.type === "image" || item.type === "video") return item.type;
  if (isImageExtension(item.filename || item.originalName || "")) return "image";
  return "video";
}

function normalizePlaylistEntry(entry) {
  if (!entry) return null;
  if (typeof entry === "string") return { type: "video", id: entry };
  if (typeof entry === "object" && entry.id) {
    return { type: entry.type || "video", id: entry.id };
  }
  return null;
}

function getHlsManifestPath(item) {
  if (!item?.id || !item?.hlsManifest) return null;
  return path.join(HLS_DIR, item.id, "index.m3u8");
}

function getHlsStatus(item) {
  if (detectMediaType(item) !== "video") return "na";
  const manifestPath = getHlsManifestPath(item);
  if (manifestPath && fssync.existsSync(manifestPath)) return "ready";
  if (hlsProcessing.has(item.id)) return "processing";
  if (hlsFailed.has(item.id)) return "error";
  return "missing";
}

function getOrderedPlaylist(data, options = {}) {
  const { readyOnly = false } = options;
  const defaultImageDuration = Number(
    process.env.DEFAULT_IMAGE_DURATION || data?.settings?.imageDefaultDuration || 15
  );
  const defaultGroupDuration = Number(data?.settings?.photoGroupDuration || 30);
  const videoMap = new Map(data.videos.map((video) => [video.id, video]));
  const groupMap = new Map((data.photoGroups || []).map((group) => [group.id, group]));
  const ordered = [];
  const seenVideoIds = new Set();

  const hasPlaylist = Array.isArray(data.playlist) && data.playlist.length > 0;
  if (hasPlaylist) {
    data.playlist
      .map((entry) => normalizePlaylistEntry(entry))
      .filter(Boolean)
      .forEach((entry) => {
        if (entry.type === "photoGroup") {
          const group = groupMap.get(entry.id);
          if (group) ordered.push({ ...group, type: "photoGroup" });
          return;
        }
        const item = videoMap.get(entry.id);
        if (item) {
          ordered.push(item);
          seenVideoIds.add(item.id);
        }
      });
  }

  if (!hasPlaylist) {
    data.videos.forEach((video) => {
      if (!seenVideoIds.has(video.id)) {
        ordered.push(video);
      }
    });
  }

  const mapped = ordered.map((item) => ({
    ...item,
    type: item.type === "photoGroup" ? "photoGroup" : detectMediaType(item),
    hlsStatus: item.type === "photoGroup" ? null : getHlsStatus(item),
    displayDuration:
      item.type === "photoGroup"
        ? Number(item.displayDuration || defaultGroupDuration)
        : detectMediaType(item) === "image"
          ? Number(item.displayDuration || defaultImageDuration)
          : null,
    photos:
      item.type === "photoGroup"
        ? (item.photos || []).map((photo) => ({
            id: photo.id,
            filename: photo.filename,
            url: `/api/photo-groups/${item.id}/photos/${photo.id}/stream`,
            width: photo.width || null,
            height: photo.height || null
          }))
        : undefined
  }));

  if (!readyOnly) return mapped;

  return mapped.filter((item) => {
    if (item.type === "image") return true;
    if (item.type === "photoGroup") return (item.photos || []).length > 0;
    return item.hlsStatus === "ready";
  });
}

function mapLibraryMedia(data) {
  const defaultImageDuration = Number(
    process.env.DEFAULT_IMAGE_DURATION || data?.settings?.imageDefaultDuration || 15
  );
  return (data.videos || []).map((item) => ({
    ...item,
    type: detectMediaType(item),
    hlsStatus: getHlsStatus(item),
    displayDuration:
      detectMediaType(item) === "image"
        ? Number(item.displayDuration || defaultImageDuration)
        : null
  }));
}

function getContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".webm") return "video/webm";
  if (ext === ".mkv") return "video/x-matroska";
  return "video/mp4";
}

function getImageContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

function pruneRecentErrors(errors) {
  const now = Date.now();
  return (errors || []).filter((item) => {
    const ts = new Date(item.timestamp || 0).getTime();
    if (!Number.isFinite(ts)) return false;
    return now - ts <= ERROR_WINDOW_MS;
  });
}

async function ensureDirs() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.mkdir(THUMB_DIR, { recursive: true });
  await fs.mkdir(HLS_DIR, { recursive: true });
  await fs.mkdir(LOG_DIR, { recursive: true });
}

async function cleanupOrphanThumbnails() {
  const data = getData();
  const referenced = new Set(
    data.videos
      .map((item) => item.thumbnail || "")
      .filter((thumb) => thumb.startsWith("/thumbnails/"))
      .map((thumb) => thumb.replace("/thumbnails/", ""))
  );

  const files = await fs.readdir(THUMB_DIR);
  let removed = 0;
  let kept = 0;

  for (const file of files) {
    if (referenced.has(file)) {
      kept += 1;
      continue;
    }
    try {
      await fs.unlink(path.join(THUMB_DIR, file));
      removed += 1;
    } catch (error) {
      logger.error(`Cleanup thumbnail error (${file}): ${error.message}`);
    }
  }

  return {
    scanned: files.length,
    referenced: referenced.size,
    removed,
    kept
  };
}

async function backfillMissingHls() {
  const data = getData();
  const candidates = data.videos.filter((item) => {
    if (detectMediaType(item) !== "video") return false;
    const manifestPath = getHlsManifestPath(item);
    if (!manifestPath) return true;
    return !fssync.existsSync(manifestPath);
  });
  if (!candidates.length) return;

  logger.info(`HLS backfill queued for ${candidates.length} video(s)`);
  for (const item of candidates) {
    const sourcePath = path.join(UPLOAD_DIR, item.filename || "");
    if (!item.filename || !fssync.existsSync(sourcePath)) continue;

    hlsProcessing.add(item.id);
    hlsFailed.delete(item.id);
    enqueueProcessingJob(async () => {
      const hlsOutputDir = path.join(HLS_DIR, item.id);
      await fs.mkdir(hlsOutputDir, { recursive: true });
      await createAdaptiveHlsPackage(sourcePath, hlsOutputDir, item.height);
      item.hlsManifest = `/hls/${item.id}/index.m3u8`;
      await saveData();
      logger.info(`HLS backfill done for ${item.id}`);
      hlsProcessing.delete(item.id);
    }, { label: `Backfill HLS ${item.title || item.id}` }).catch((error) => {
      hlsProcessing.delete(item.id);
      hlsFailed.add(item.id);
      logger.error(`HLS backfill failed for ${item.id}: ${error.message}`);
    });
  }
}

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan("combined", { stream: { write: (message) => logger.info(message.trim()) } }));

function extractAdminToken(req) {
  const headerToken = String(req.get("x-admin-token") || "").trim();
  if (headerToken) return headerToken;
  const auth = String(req.get("authorization") || "").trim();
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return "";
}

app.use("/api", (req, res, next) => {
  if (!ADMIN_TOKEN) return next();
  const isWriteMethod = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  if (!isWriteMethod) return next();
  const allowedWithoutToken = req.path === "/player/status" || req.path === "/player/event";
  if (allowedWithoutToken) return next();
  const token = extractAdminToken(req);
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return next();
});

app.use("/admin", express.static(path.join(__dirname, "public", "admin")));
app.use("/player", express.static(path.join(__dirname, "public", "player")));
app.use("/vendor/hls", express.static(path.join(__dirname, "node_modules", "hls.js", "dist")));
app.use("/thumbnails", express.static(THUMB_DIR));
app.use("/uploads", express.static(UPLOAD_DIR));
app.use("/hls", express.static(HLS_DIR));

app.get("/", (req, res) => {
  res.redirect("/player");
});

app.get("/api/health", async (req, res) => {
  const data = getData();
  const ordered = getOrderedPlaylist(data);
  const diskUsage = await getDiskUsage();
  res.json({
    status: "ok",
    uptime: Math.floor(process.uptime()),
    currentVideo: playerStatus.currentVideoId,
    playerState: playerStatus.state,
    playerLastUpdate: playerStatus.lastUpdate,
    playlistSize: ordered.length,
    lastError: playerStatus.lastError,
    settings: data.settings || { imageDefaultDuration: 15 },
    memoryUsage: {
      rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`,
      heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`
    },
    diskUsage,
    processingQueue: queueSnapshot()
  });
});

app.patch("/api/settings", async (req, res) => {
  const data = getData();
  const { imageDefaultDuration, photoGroupDuration } = req.body || {};
  if (imageDefaultDuration === undefined && photoGroupDuration === undefined) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  if (imageDefaultDuration !== undefined) {
    const parsed = Number(imageDefaultDuration);
    if (!Number.isFinite(parsed) || parsed < 3 || parsed > 300) {
      return res.status(400).json({ error: "imageDefaultDuration must be between 3 and 300" });
    }
    data.settings = data.settings || {};
    data.settings.imageDefaultDuration = Math.round(parsed);
  }

  if (photoGroupDuration !== undefined) {
    const parsed = Number(photoGroupDuration);
    if (!Number.isFinite(parsed) || parsed < 5 || parsed > 300) {
      return res.status(400).json({ error: "photoGroupDuration must be between 5 and 300" });
    }
    data.settings = data.settings || {};
    data.settings.photoGroupDuration = Math.round(parsed);
  }
  await saveData();
  res.json({ status: "ok", settings: data.settings });
});

app.post("/api/images/apply-default", async (req, res) => {
  const data = getData();
  const defaultDuration = Number(
    process.env.DEFAULT_IMAGE_DURATION || data?.settings?.imageDefaultDuration || 15
  );
  const value = Math.round(defaultDuration);
  let updated = 0;

  data.videos.forEach((item) => {
    if (detectMediaType(item) === "image") {
      item.displayDuration = value;
      updated += 1;
    }
  });

  await saveData();
  res.json({ status: "ok", updated });
});

app.get("/api/photo-groups", (req, res) => {
  const data = getData();
  res.json(data.photoGroups || []);
});

app.post("/api/photo-groups", async (req, res) => {
  const data = getData();
  const { title, footer } = req.body || {};
  const name = String(title || "").trim();
  if (!name) {
    return res.status(400).json({ error: "title is required" });
  }

  const group = {
    id: uuidv4(),
    title: name,
    footer: String(footer || "").trim(),
    photos: [],
    displayDuration: Number(data?.settings?.photoGroupDuration || 30),
    createdAt: new Date().toISOString()
  };
  data.photoGroups = data.photoGroups || [];
  data.photoGroups.push(group);
  await saveData();
  res.json(group);
});

app.patch("/api/photo-groups/:id", async (req, res) => {
  const data = getData();
  const group = (data.photoGroups || []).find((item) => item.id === req.params.id);
  if (!group) return res.status(404).json({ error: "Group not found" });
  const { title, footer, displayDuration } = req.body || {};

  if (title !== undefined) {
    const next = String(title || "").trim();
    if (!next) return res.status(400).json({ error: "title cannot be empty" });
    group.title = next;
  }
  if (footer !== undefined) group.footer = String(footer || "").trim();
  if (displayDuration !== undefined) {
    const parsed = Number(displayDuration);
    if (!Number.isFinite(parsed) || parsed < 5 || parsed > 300) {
      return res.status(400).json({ error: "displayDuration must be between 5 and 300" });
    }
    group.displayDuration = Math.round(parsed);
  }

  await saveData();
  res.json(group);
});

app.delete("/api/photo-groups/:id", async (req, res) => {
  const data = getData();
  const index = (data.photoGroups || []).findIndex((item) => item.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: "Group not found" });
  const [removed] = data.photoGroups.splice(index, 1);
  data.playlist = (data.playlist || []).filter((entry) => {
    const normalized = normalizePlaylistEntry(entry);
    if (!normalized) return false;
    return !(normalized.type === "photoGroup" && normalized.id === removed.id);
  });
  if (Array.isArray(removed.photos)) {
    for (const photo of removed.photos) {
      try {
        await fs.unlink(path.join(UPLOAD_DIR, photo.filename));
      } catch (error) {
        logger.error(`Delete group photo error: ${error.message}`);
      }
    }
  }
  await saveData();
  res.json({ status: "ok" });
});

app.post("/api/photo-groups/:id/photos", upload.array("photos", 50), async (req, res) => {
  const data = getData();
  const files = req.files || [];
  const group = (data.photoGroups || []).find((item) => item.id === req.params.id);
  if (!group) {
    for (const file of files) {
      try {
        await fs.unlink(file.path);
      } catch (error) {
        logger.error(`Cleanup group upload error: ${error.message}`);
      }
    }
    return res.status(404).json({ error: "Group not found" });
  }
  if (!files.length) return res.status(400).json({ error: "No files uploaded" });

  for (const file of files) {
    if (!isImageExtension(file.originalname)) {
      await fs.unlink(file.path);
      continue;
    }
    let meta = { width: null, height: null };
    try {
      meta = await probeImage(file.path);
    } catch (error) {
      logger.warn(`Photo probe warning for ${file.originalname}: ${error.message}`);
    }
    group.photos.push({
      id: uuidv4(),
      filename: file.filename,
      originalName: file.originalname,
      width: meta.width,
      height: meta.height,
      createdAt: new Date().toISOString()
    });
  }

  await saveData();
  res.json({ status: "ok", count: group.photos.length });
});

app.delete("/api/photo-groups/:id/photos/:photoId", async (req, res) => {
  const data = getData();
  const group = (data.photoGroups || []).find((item) => item.id === req.params.id);
  if (!group) return res.status(404).json({ error: "Group not found" });
  const index = (group.photos || []).findIndex((photo) => photo.id === req.params.photoId);
  if (index === -1) return res.status(404).json({ error: "Photo not found" });
  const [removed] = group.photos.splice(index, 1);
  try {
    await fs.unlink(path.join(UPLOAD_DIR, removed.filename));
  } catch (error) {
    logger.error(`Delete group photo error: ${error.message}`);
  }
  await saveData();
  res.json({ status: "ok" });
});

app.get("/api/audio/background", (req, res) => {
  const data = getData();
  const audio = data.settings?.photoAudio || null;
  if (!audio) return res.json({ url: null });
  res.json({ url: `/uploads/${audio.filename}`, originalName: audio.originalName });
});

app.post("/api/audio/background", upload.single("audio"), async (req, res) => {
  const data = getData();
  const file = req.file;
  if (!file) return res.status(400).json({ error: "No file uploaded" });
  if (!isAudioExtension(file.originalname)) {
    await fs.unlink(file.path);
    return res.status(400).json({ error: "Unsupported audio type" });
  }

  const previousAudio = data.settings?.photoAudio;
  if (previousAudio?.filename && previousAudio.filename !== file.filename) {
    try {
      await fs.unlink(path.join(UPLOAD_DIR, previousAudio.filename));
    } catch (error) {
      logger.error(`Delete previous audio error: ${error.message}`);
    }
  }

  data.settings = data.settings || {};
  data.settings.photoAudio = {
    filename: file.filename,
    originalName: file.originalname
  };
  await saveData();
  res.json({ status: "ok" });
});

app.delete("/api/audio/background", async (req, res) => {
  const data = getData();
  const audio = data.settings?.photoAudio;
  if (audio?.filename) {
    try {
      await fs.unlink(path.join(UPLOAD_DIR, audio.filename));
    } catch (error) {
      logger.error(`Delete audio error: ${error.message}`);
    }
  }
  if (data.settings) delete data.settings.photoAudio;
  await saveData();
  res.json({ status: "ok" });
});

app.get("/api/stats", (req, res) => {
  const data = getData();
  data.stats = data.stats || {};
  data.stats.recentErrors = pruneRecentErrors(data.stats.recentErrors);
  data.stats.errors24h = data.stats.recentErrors.length;
  const durations = data.videos.map((video) => video.duration || 0).filter(Boolean);
  const averageVideoLength = durations.length
    ? durations.reduce((total, value) => total + value, 0) / durations.length
    : 0;
  res.json({
    videosPlayed: data.stats.videosPlayed,
    totalUptime: Math.floor(process.uptime()),
    averageVideoLength: averageVideoLength ? `${Math.round(averageVideoLength)}s` : null,
    errors24h: data.stats.errors24h,
    lastRestart: data.stats.lastRestart,
    lastError: data.stats.lastError,
    recentErrors: data.stats.recentErrors
  });
});

app.delete("/api/stats/errors", async (req, res) => {
  const data = getData();
  data.stats = data.stats || {};
  data.stats.recentErrors = [];
  data.stats.errors24h = 0;
  data.stats.lastError = null;
  await saveData();
  res.json({ status: "ok" });
});

app.get("/api/videos", (req, res) => {
  const data = getData();
  res.json(mapLibraryMedia(data));
});

app.get("/api/playlist", (req, res) => {
  const data = getData();
  res.json(getOrderedPlaylist(data, { readyOnly: true }));
});

app.put("/api/playlist", async (req, res) => {
  const { order } = req.body;
  const data = getData();
  if (!Array.isArray(order)) {
    return res.status(400).json({ error: "order must be an array" });
  }
  data.playlist = order.map((entry) => normalizePlaylistEntry(entry)).filter(Boolean);
  await saveData();
  res.json({ status: "ok" });
});

app.patch("/api/videos/:id", async (req, res) => {
  const data = getData();
  const item = data.videos.find((video) => video.id === req.params.id);
  if (!item) {
    return res.status(404).json({ error: "Video not found" });
  }

  const { displayDuration, title } = req.body || {};
  if (displayDuration === undefined && title === undefined) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  if (title !== undefined) {
    const normalized = String(title || "").trim();
    if (!normalized) {
      return res.status(400).json({ error: "title cannot be empty" });
    }
    if (normalized.length > 180) {
      return res.status(400).json({ error: "title too long (max 180)" });
    }
    item.title = normalized;
  }

  if (displayDuration !== undefined) {
    if (detectMediaType(item) !== "image") {
      return res.status(400).json({ error: "displayDuration can only be set for images" });
    }

    const parsed = Number(displayDuration);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 300) {
      return res.status(400).json({ error: "displayDuration must be between 1 and 300" });
    }

    item.displayDuration = Math.round(parsed);
  }
  await saveData();
  res.json({ status: "ok", item });
});

app.post("/api/maintenance/cleanup-thumbnails", async (req, res) => {
  try {
    const result = await cleanupOrphanThumbnails();
    logger.info(
      `Thumbnail cleanup: scanned=${result.scanned} referenced=${result.referenced} removed=${result.removed}`
    );
    res.json({ status: "ok", ...result });
  } catch (error) {
    logger.error(`Cleanup thumbnails failed: ${error.message}`);
    res.status(500).json({ error: "Cleanup failed" });
  }
});

app.post("/api/videos", upload.single("video"), async (req, res) => {
  let file = null;
  try {
    file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    if (!isSupportedExtension(file.originalname)) {
      await fs.unlink(file.path);
      return res.status(400).json({ error: "Unsupported file type" });
    }

    const videoId = uuidv4();
    const ext = path.extname(file.filename).toLowerCase();
    const mediaType = isImageExtension(file.originalname) ? "image" : "video";
    const defaultImageDuration = Number(
      process.env.DEFAULT_IMAGE_DURATION || getData()?.settings?.imageDefaultDuration || 15
    );
    let metadata = {
      duration: 0,
      width: null,
      height: null,
      codec: null,
      audioCodec: null
    };

    let finalPath = file.path;
    let finalFilename = file.filename;
    let thumbnail = null;
    let duration = 0;
    let hlsManifest = null;

    if (mediaType === "video") {
      await enqueueProcessingJob(async () => {
        metadata = await probeVideo(finalPath);
        const needsTranscode = ext !== ".mp4" || metadata.codec !== "h264" || metadata.audioCodec !== "aac";

        if (needsTranscode) {
          const transcodedName = `${uuidv4()}.mp4`;
          const transcodedPath = path.join(UPLOAD_DIR, transcodedName);
          await transcodeToMp4(finalPath, transcodedPath);
          await fs.unlink(finalPath);
          finalPath = transcodedPath;
          finalFilename = transcodedName;
          metadata = await probeVideo(finalPath);
        }

        duration = metadata.duration || 0;
        const thumbName = `${path.parse(finalFilename).name}.jpg`;
        const thumbPath = path.join(THUMB_DIR, thumbName);
        const seekPoint = duration > 10 ? 5 : Math.max(0, duration / 2);
        try {
          await createThumbnail(finalPath, thumbPath, seekPoint);
        } catch (error) {
          logger.error(`Thumbnail error for ${finalFilename}: ${error.message}`);
        }
        thumbnail = fssync.existsSync(thumbPath) ? `/thumbnails/${thumbName}` : null;

        const hlsOutputDir = path.join(HLS_DIR, videoId);
        hlsProcessing.add(videoId);
        hlsFailed.delete(videoId);
        try {
          await fs.mkdir(hlsOutputDir, { recursive: true });
          await createAdaptiveHlsPackage(finalPath, hlsOutputDir, metadata.height);
          hlsManifest = `/hls/${videoId}/index.m3u8`;
          hlsProcessing.delete(videoId);
        } catch (error) {
          hlsProcessing.delete(videoId);
          hlsFailed.add(videoId);
          logger.error(`HLS packaging error for ${finalFilename}: ${error.message}`);
          try {
            await fs.rm(hlsOutputDir, { recursive: true, force: true });
          } catch (cleanupError) {
            logger.error(`HLS cleanup error for ${finalFilename}: ${cleanupError.message}`);
          }
        }
      }, { label: `Procesar ${file.originalname}` });
    } else {
      try {
        metadata = await probeImage(file.path);
      } catch (error) {
        logger.warn(`Image probe warning for ${file.originalname}: ${error.message}`);
      }
      duration = 0;
      thumbnail = `/uploads/${finalFilename}`;
    }

    const data = getData();
    const videoRecord = {
      id: videoId,
      title: path.parse(file.originalname).name,
      type: mediaType,
      filename: finalFilename,
      originalName: file.originalname,
      duration,
      width: metadata.width,
      height: metadata.height,
      codec: metadata.codec,
      audioCodec: metadata.audioCodec,
      thumbnail,
      hlsManifest,
      displayDuration: mediaType === "image" ? defaultImageDuration : null,
      createdAt: new Date().toISOString()
    };

    data.videos.push(videoRecord);
    data.playlist.push(videoRecord.id);
    await saveData();

    logger.info(`Upload: ${videoRecord.id} ${videoRecord.title}`);
    res.json(videoRecord);
  } catch (error) {
    if (file?.path && error?.code === "QUEUE_FULL") {
      try {
        await fs.unlink(file.path);
      } catch (unlinkError) {
        logger.error(`Cleanup queued file failed: ${unlinkError.message}`);
      }
      return res.status(503).json({ error: "Processing queue full. Retry in a moment." });
    }
    logger.error(`Upload error: ${error.message}`);
    res.status(500).json({ error: "Upload failed" });
  }
});

app.delete("/api/videos/:id", async (req, res) => {
  const data = getData();
  const videoIndex = data.videos.findIndex((video) => video.id === req.params.id);
  if (videoIndex === -1) {
    return res.status(404).json({ error: "Video not found" });
  }

  const [removed] = data.videos.splice(videoIndex, 1);
  hlsProcessing.delete(removed.id);
  hlsFailed.delete(removed.id);
  data.playlist = (data.playlist || []).filter((entry) => {
    const normalized = normalizePlaylistEntry(entry);
    if (!normalized) return false;
    return normalized.id !== removed.id;
  });
  await saveData();

  try {
    await fs.unlink(path.join(UPLOAD_DIR, removed.filename));
  } catch (error) {
    logger.error(`Delete upload error: ${error.message}`);
  }

  if (removed.thumbnail) {
    if (removed.thumbnail.startsWith("/thumbnails/")) {
      const thumbFile = removed.thumbnail.replace("/thumbnails/", "");
      try {
        await fs.unlink(path.join(THUMB_DIR, thumbFile));
      } catch (error) {
        logger.error(`Delete thumbnail error: ${error.message}`);
      }
    }
  }

  try {
    await fs.rm(path.join(HLS_DIR, removed.id), { recursive: true, force: true });
  } catch (error) {
    logger.error(`Delete HLS error: ${error.message}`);
  }

  logger.info(`Delete: ${removed.id} ${removed.title}`);
  res.json({ status: "ok" });
});

app.get("/api/videos/:id/stream", async (req, res, next) => {
  try {
    const data = getData();
    const video = data.videos.find((item) => item.id === req.params.id);
    if (!video) {
      return res.status(404).end();
    }

    const filePath = path.join(UPLOAD_DIR, video.filename);
    if (detectMediaType(video) === "image") {
      const stat = await fs.stat(filePath);
      res.writeHead(200, {
        "Content-Length": stat.size,
        "Content-Type": getImageContentType(video.filename)
      });
      const stream = fssync.createReadStream(filePath);
      stream.on("error", (error) => {
        if (!res.headersSent) res.status(500).end();
        next(error);
      });
      return stream.pipe(res);
    }

    const stat = await fs.stat(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;
    const contentType = getContentType(video.filename);

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end) {
        return res.status(416).end();
      }
      const chunkSize = end - start + 1;
      const fileStream = fssync.createReadStream(filePath, { start, end });

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": contentType
      });
      fileStream.on("error", (error) => {
        if (!res.headersSent) res.status(500).end();
        next(error);
      });
      return fileStream.pipe(res);
    }

    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": contentType
    });
    const stream = fssync.createReadStream(filePath);
    stream.on("error", (error) => {
      if (!res.headersSent) res.status(500).end();
      next(error);
    });
    return stream.pipe(res);
  } catch (error) {
    if (error?.code === "ENOENT") return res.status(404).end();
    return next(error);
  }
});

app.get("/api/photo-groups/:id/photos/:photoId/stream", async (req, res, next) => {
  try {
    const data = getData();
    const group = (data.photoGroups || []).find((item) => item.id === req.params.id);
    if (!group) return res.status(404).end();
    const photo = (group.photos || []).find((item) => item.id === req.params.photoId);
    if (!photo) return res.status(404).end();
    const filePath = path.join(UPLOAD_DIR, photo.filename);
    const stat = await fs.stat(filePath);
    res.writeHead(200, {
      "Content-Length": stat.size,
      "Content-Type": getImageContentType(photo.filename)
    });
    const stream = fssync.createReadStream(filePath);
    stream.on("error", (error) => {
      if (!res.headersSent) res.status(500).end();
      next(error);
    });
    return stream.pipe(res);
  } catch (error) {
    if (error?.code === "ENOENT") return res.status(404).end();
    return next(error);
  }
});

app.post("/api/player/status", (req, res) => {
  const { currentVideoId, currentTime, state, lastError } = req.body || {};
  if (currentVideoId !== undefined) {
    playerStatus.currentVideoId = currentVideoId;
  }
  const parsedTime = Number(currentTime);
  if (Number.isFinite(parsedTime)) {
    playerStatus.currentTime = parsedTime;
  }
  if (state !== undefined) {
    playerStatus.state = state;
  }
  if (lastError) {
    playerStatus.lastError = lastError;
  }
  playerStatus.lastUpdate = new Date().toISOString();
  res.json({ status: "ok" });
});

app.post("/api/player/event", async (req, res) => {
  const { type, videoId, message, mediaType } = req.body || {};
  const data = getData();
  data.stats = data.stats || {};
  data.stats.recentErrors = pruneRecentErrors(data.stats.recentErrors);

  if (type === "videoChanged") {
    data.stats.videosPlayed += 1;
    logger.info(`Video change: ${videoId || "unknown"}`);
  }

  if (type === "error") {
    data.stats.recentErrors.push({
      timestamp: new Date().toISOString(),
      videoId: videoId || null,
      message: message || "unknown",
      mediaType: mediaType || "unknown"
    });
    data.stats.recentErrors = pruneRecentErrors(data.stats.recentErrors);
    data.stats.errors24h = data.stats.recentErrors.length;
    data.stats.lastError = message || "unknown";
    playerStatus.lastError = message || "unknown";
    logger.error(`Player error: ${message || "unknown"}`);
  }

  await saveData();
  res.json({ status: "ok" });
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "File too large" });
    }
    return res.status(400).json({ error: err.message || "Upload error" });
  }
  logger.error(`Request error: ${err?.stack || err}`);
  if (res.headersSent) return next(err);
  return res.status(500).json({ error: "Server error" });
});

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

async function start() {
  await ensureDirs();
  await initStore();
  await backfillMissingHls();

  logger.info("Server starting");
  const server = app.listen(PORT, () => {
    logger.info(`Server listening on ${PORT}`);
  });

  const requestTimeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 0);
  server.requestTimeout = requestTimeoutMs > 0 ? requestTimeoutMs : 0;
  server.keepAliveTimeout = Number(process.env.KEEP_ALIVE_TIMEOUT_MS || 65000);
  server.headersTimeout = Number(process.env.HEADERS_TIMEOUT_MS || 66000);

  const shutdown = (signal) => {
    logger.warn(`Received ${signal}, shutting down gracefully`);
    server.close(() => {
      logger.warn("HTTP server closed");
      process.exit(0);
    });
    setTimeout(() => {
      logger.error("Forced shutdown after timeout");
      process.exit(1);
    }, Number(process.env.SHUTDOWN_TIMEOUT_MS || 15000)).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("unhandledRejection", (error) => {
    logger.error(`Unhandled rejection: ${error?.stack || error}`);
  });
  process.on("uncaughtException", (error) => {
    logger.error(`Uncaught exception: ${error?.stack || error}`);
  });
}

start();
