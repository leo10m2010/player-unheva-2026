const { spawn } = require("child_process");
const fs = require("fs/promises");

const DEFAULT_STDIO_CAPTURE_LIMIT = Math.max(
  16 * 1024,
  Number(process.env.MEDIA_STDIO_CAPTURE_LIMIT || 128 * 1024)
);
const DEFAULT_TERM_GRACE_MS = Math.max(
  500,
  Number(process.env.MEDIA_TERM_GRACE_MS || 3000)
);
const FFPROBE_IDLE_TIMEOUT_MS = Math.max(
  5000,
  Number(process.env.FFPROBE_IDLE_TIMEOUT_MS || 120000)
);
const FFMPEG_IDLE_TIMEOUT_MS = Math.max(
  10000,
  Number(process.env.FFMPEG_IDLE_TIMEOUT_MS || 900000)
);
const FFMPEG_TOTAL_TIMEOUT_MS = Math.max(
  0,
  Number(process.env.FFMPEG_TOTAL_TIMEOUT_MS || 0)
);

function appendWithLimit(current, nextChunk, limit) {
  const next = current + nextChunk;
  if (next.length <= limit) return next;
  return next.slice(next.length - limit);
}

function run(command, args, options = {}) {
  const {
    idleTimeoutMs = 0,
    totalTimeoutMs = 0,
    termGraceMs = DEFAULT_TERM_GRACE_MS,
    captureLimit = DEFAULT_STDIO_CAPTURE_LIMIT
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stdout = "";
    let stderr = "";
    let settled = false;
    let lastActivityAt = Date.now();
    let idleTimer = null;
    let totalTimer = null;
    let killTimer = null;
    let terminationError = null;

    const clearTimers = () => {
      if (idleTimer) {
        clearInterval(idleTimer);
        idleTimer = null;
      }
      if (totalTimer) {
        clearTimeout(totalTimer);
        totalTimer = null;
      }
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }
    };

    const finalize = (error, output) => {
      if (settled) return;
      settled = true;
      clearTimers();
      if (error) {
        reject(error);
      } else {
        resolve(output);
      }
    };

    const terminateProcess = (reason) => {
      if (settled || terminationError) return;
      const context = stderr || stdout || "No command output";
      terminationError = new Error(`${reason}. Command: ${command}. Output: ${context}`);
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (!settled) {
          child.kill("SIGKILL");
        }
      }, termGraceMs);
    };

    if (idleTimeoutMs > 0) {
      idleTimer = setInterval(() => {
        if (settled) return;
        if (Date.now() - lastActivityAt > idleTimeoutMs) {
          terminateProcess(`Process idle timeout after ${idleTimeoutMs}ms`);
        }
      }, Math.min(1000, Math.max(250, Math.floor(idleTimeoutMs / 10))));
      if (idleTimer.unref) idleTimer.unref();
    }

    if (totalTimeoutMs > 0) {
      totalTimer = setTimeout(() => {
        terminateProcess(`Process total timeout after ${totalTimeoutMs}ms`);
      }, totalTimeoutMs);
      if (totalTimer.unref) totalTimer.unref();
    }

    child.stdout.on("data", (data) => {
      lastActivityAt = Date.now();
      stdout = appendWithLimit(stdout, data.toString(), captureLimit);
    });
    child.stderr.on("data", (data) => {
      lastActivityAt = Date.now();
      stderr = appendWithLimit(stderr, data.toString(), captureLimit);
    });

    child.on("error", (error) => {
      finalize(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      if (terminationError) {
        finalize(terminationError);
        return;
      }
      if (code !== 0) {
        finalize(new Error(stderr || stdout || "Command failed"));
      } else {
        finalize(null, stdout);
      }
    });
  });
}

async function probeVideo(filePath) {
  const output = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_name,codec_type,width,height",
    "-of",
    "json",
    filePath
  ], {
    idleTimeoutMs: FFPROBE_IDLE_TIMEOUT_MS,
    totalTimeoutMs: FFPROBE_IDLE_TIMEOUT_MS
  });
  const parsed = JSON.parse(output);
  const format = parsed.format || {};
  const streams = parsed.streams || [];
  const videoStream = streams.find((stream) => stream.width && stream.height) || {};
  const audioStream = streams.find((stream) => stream.codec_type === "audio") || {};

  return {
    duration: format.duration ? Number(format.duration) : 0,
    width: videoStream.width || null,
    height: videoStream.height || null,
    codec: videoStream.codec_name || null,
    audioCodec: audioStream.codec_name || null
  };
}

async function probeImage(filePath) {
  const output = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "stream=width,height",
    "-of",
    "json",
    filePath
  ], {
    idleTimeoutMs: FFPROBE_IDLE_TIMEOUT_MS,
    totalTimeoutMs: FFPROBE_IDLE_TIMEOUT_MS
  });
  const parsed = JSON.parse(output);
  const streams = parsed.streams || [];
  const imageStream = streams[0] || {};

  return {
    width: imageStream.width || null,
    height: imageStream.height || null
  };
}

async function createThumbnail(filePath, thumbPath, seekSeconds) {
  const seek = Math.max(0, Number(seekSeconds || 0));
  await run("ffmpeg", [
    "-y",
    "-ss",
    seek.toString(),
    "-i",
    filePath,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    thumbPath
  ], {
    idleTimeoutMs: FFMPEG_IDLE_TIMEOUT_MS,
    totalTimeoutMs: FFMPEG_TOTAL_TIMEOUT_MS
  });
}

async function transcodeToMp4(inputPath, outputPath) {
  await run("ffmpeg", [
    "-y",
    "-i",
    inputPath,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "22",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    outputPath
  ], {
    idleTimeoutMs: FFMPEG_IDLE_TIMEOUT_MS,
    totalTimeoutMs: FFMPEG_TOTAL_TIMEOUT_MS
  });
}

function selectHlsProfiles(sourceHeight) {
  const ladder = [
    { name: "360p", width: 640, height: 360, bitrate: "900k", maxrate: "963k", bufsize: "1350k", bandwidth: 1100000 },
    { name: "720p", width: 1280, height: 720, bitrate: "2800k", maxrate: "2996k", bufsize: "4200k", bandwidth: 3200000 },
    { name: "1080p", width: 1920, height: 1080, bitrate: "5000k", maxrate: "5350k", bufsize: "7500k", bandwidth: 5800000 }
  ];

  const height = Number(sourceHeight || 0);
  const available = ladder.filter((profile) => height >= profile.height);
  if (available.length) return available;
  if (height >= 720) return ladder.slice(0, 2);
  return [ladder[0]];
}

async function buildVariant(inputPath, outputDir, profile) {
  const variantDir = `${outputDir}/${profile.name}`;
  await fs.mkdir(variantDir, { recursive: true });

  await run("ffmpeg", [
    "-y",
    "-i",
    inputPath,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "21",
    "-profile:v",
    "high",
    "-level",
    "4.1",
    "-vf",
    `scale=w=${profile.width}:h=${profile.height}:force_original_aspect_ratio=decrease`,
    "-g",
    "48",
    "-keyint_min",
    "48",
    "-sc_threshold",
    "0",
    "-b:v",
    profile.bitrate,
    "-maxrate",
    profile.maxrate,
    "-bufsize",
    profile.bufsize,
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-hls_time",
    "4",
    "-hls_playlist_type",
    "vod",
    "-hls_list_size",
    "0",
    "-hls_flags",
    "independent_segments",
    "-hls_segment_filename",
    `${variantDir}/segment_%05d.ts`,
    `${variantDir}/index.m3u8`
  ], {
    idleTimeoutMs: FFMPEG_IDLE_TIMEOUT_MS,
    totalTimeoutMs: FFMPEG_TOTAL_TIMEOUT_MS
  });
}

async function createAdaptiveHlsPackage(inputPath, outputDir, sourceHeight) {
  const profiles = selectHlsProfiles(sourceHeight);
  await fs.mkdir(outputDir, { recursive: true });

  for (const profile of profiles) {
    await buildVariant(inputPath, outputDir, profile);
  }

  const masterLines = ["#EXTM3U", "#EXT-X-VERSION:3"];
  profiles.forEach((profile) => {
    masterLines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${profile.bandwidth},RESOLUTION=${profile.width}x${profile.height}`
    );
    masterLines.push(`${profile.name}/index.m3u8`);
  });

  await fs.writeFile(`${outputDir}/index.m3u8`, `${masterLines.join("\n")}\n`, "utf8");
}

module.exports = {
  probeVideo,
  probeImage,
  createThumbnail,
  transcodeToMp4,
  createAdaptiveHlsPackage
};
