const fs = require("fs/promises");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_PATH = path.join(DATA_DIR, "library.json");
const DATA_TMP_PATH = `${DATA_PATH}.tmp`;

const defaultData = () => ({
  videos: [],
  images: [],
  photoGroups: [],
  playlist: [],
  settings: {
    imageDefaultDuration: 15,
    photoGroupDuration: 30
  },
  stats: {
    videosPlayed: 0,
    errors24h: 0,
    totalUptime: 0,
    lastRestart: new Date().toISOString(),
    lastError: null,
    recentErrors: []
  }
});

let data = defaultData();
let writeInFlight = Promise.resolve();

function toSafeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeData(raw) {
  const defaults = defaultData();
  const source = raw && typeof raw === "object" ? raw : {};

  const merged = {
    ...defaults,
    ...source,
    videos: Array.isArray(source.videos) ? source.videos : [],
    images: Array.isArray(source.images) ? source.images : [],
    photoGroups: Array.isArray(source.photoGroups) ? source.photoGroups : [],
    playlist: Array.isArray(source.playlist) ? source.playlist : [],
    settings: {
      ...defaults.settings,
      ...(source.settings && typeof source.settings === "object" ? source.settings : {})
    },
    stats: {
      ...defaults.stats,
      ...(source.stats && typeof source.stats === "object" ? source.stats : {})
    }
  };

  merged.settings.imageDefaultDuration = toSafeNumber(
    merged.settings.imageDefaultDuration,
    defaults.settings.imageDefaultDuration
  );
  merged.settings.photoGroupDuration = toSafeNumber(
    merged.settings.photoGroupDuration,
    defaults.settings.photoGroupDuration
  );

  merged.stats.videosPlayed = Math.max(0, toSafeNumber(merged.stats.videosPlayed, 0));
  merged.stats.errors24h = Math.max(0, toSafeNumber(merged.stats.errors24h, 0));
  merged.stats.totalUptime = Math.max(0, toSafeNumber(merged.stats.totalUptime, 0));
  merged.stats.lastRestart =
    typeof merged.stats.lastRestart === "string" && merged.stats.lastRestart
      ? merged.stats.lastRestart
      : defaults.stats.lastRestart;
  merged.stats.lastError = merged.stats.lastError || null;
  merged.stats.recentErrors = Array.isArray(merged.stats.recentErrors)
    ? merged.stats.recentErrors
    : [];

  return merged;
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function initStore() {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(DATA_PATH, "utf8");
    data = normalizeData(JSON.parse(raw));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      data = defaultData();
      await saveData();
      return;
    }

    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in ${DATA_PATH}. Refusing to overwrite existing data.`);
    }

    throw error;
  }
}

function getData() {
  return data;
}

async function saveData() {
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  writeInFlight = writeInFlight
    .catch(() => {})
    .then(async () => {
      await fs.writeFile(DATA_TMP_PATH, payload, "utf8");
      await fs.rename(DATA_TMP_PATH, DATA_PATH);
    });
  return writeInFlight;
}

async function setData(next) {
  data = next;
  await saveData();
}

module.exports = {
  initStore,
  getData,
  saveData,
  setData
};
