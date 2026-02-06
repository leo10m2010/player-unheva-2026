const { spawn } = require("child_process");
const fs = require("fs/promises");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || "Command failed"));
      } else {
        resolve(stdout);
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
  ]);
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
  ]);
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
  ]);
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
  ]);
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
  ]);
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
