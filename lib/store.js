const fs = require("fs/promises");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_PATH = path.join(DATA_DIR, "library.json");

const defaultData = () => ({
  videos: [],
  images: [],
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
    lastError: null
  }
});

let data = defaultData();
let writeInFlight = Promise.resolve();

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function initStore() {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    data = { ...defaultData(), ...parsed };
  } catch (error) {
    data = defaultData();
    await saveData();
  }
}

function getData() {
  return data;
}

async function saveData() {
  writeInFlight = writeInFlight.then(() =>
    fs.writeFile(DATA_PATH, JSON.stringify(data, null, 2))
  );
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
