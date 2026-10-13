// Puts the ffmpeg sidecar where Tauri looks for it (tauri.conf.json
// bundle.externalBin): src-tauri/binaries/ffmpeg-<target triple>[.exe].
//
//   npm run ffmpeg                       # for this computer
//   npm run ffmpeg -- aarch64-apple-darwin
//   FFMPEG_BIN=/usr/bin/ffmpeg npm run ffmpeg   # copy one you already have
//
// The builds are ffmpeg-static's (https://github.com/eugeneware/ffmpeg-static).
// Its release tag is not the ffmpeg version of every file in it (below), so
// the version is printed after the download. CI exports with the Linux and
// the Windows build; the filters used are all in ffmpeg 6.0.
// They are GPL builds (libx264 inside), see README「ffmpeg について」. Pinned
// by release tag and by the SHA-256 of each download, so a build never picks
// up a different binary unnoticed.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const RELEASE = "b6.1.1";
const BASE = `https://github.com/eugeneware/ffmpeg-static/releases/download/${RELEASE}`;

/** Target triple → the release's file name, and the SHA-256 of that .gz. */
const BUILDS = {
  // ffmpeg 6.0
  "aarch64-apple-darwin": { file: "ffmpeg-darwin-arm64.gz", sha256: "8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa" },
  // ffmpeg 6.1.1 (www.gyan.dev essentials build)
  "x86_64-pc-windows-msvc": { file: "ffmpeg-win32-x64.gz", sha256: "8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77" },
  // ffmpeg 7.0.2 (johnvansickle.com): development and CI only
  "x86_64-unknown-linux-gnu": { file: "ffmpeg-linux-x64.gz", sha256: "bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa" },
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function hostTriple() {
  const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const line = out.split("\n").find((l) => l.startsWith("host:"));
  if (!line) throw new Error("rustc -vV: no host line");
  return line.slice("host:".length).trim();
}

const triple = process.argv[2] || process.env.TAURI_ENV_TARGET_TRIPLE || hostTriple();
const dest = join(root, "src-tauri", "binaries", `ffmpeg-${triple}${triple.includes("windows") ? ".exe" : ""}`);
mkdirSync(dirname(dest), { recursive: true });

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

if (process.env.FFMPEG_BIN) {
  copyFileSync(process.env.FFMPEG_BIN, dest);
  chmodSync(dest, 0o755);
  console.log(`ffmpeg: ${process.env.FFMPEG_BIN} → ${dest}`);
  process.exit(0);
}

const build = BUILDS[triple];
if (!build) {
  console.error(`ffmpeg: no build for ${triple}; set FFMPEG_BIN to an ffmpeg to copy`);
  process.exit(1);
}

// Already there from an earlier run (the .gz hash is kept next to it).
const stamp = `${dest}.sha256`;
const had = existsSync(stamp) ? readFileSync(stamp, "utf8").trim() : "";
if (existsSync(dest) && had && (!build.sha256 || had === build.sha256)) {
  console.log(`ffmpeg: ${dest} is there already`);
  process.exit(0);
}

const url = `${BASE}/${build.file}`;
console.log(`ffmpeg: downloading ${url}`);
const res = await fetch(url);
if (!res.ok) {
  console.error(`ffmpeg: ${res.status} ${res.statusText} for ${url}`);
  process.exit(1);
}
const gz = Buffer.from(await res.arrayBuffer());
const hash = sha256(gz);
console.log(`ffmpeg: sha256 ${hash}  ${build.file}`);
if (build.sha256 && hash !== build.sha256) {
  console.error(`ffmpeg: expected sha256 ${build.sha256}; refusing the download`);
  process.exit(1);
}
if (!build.sha256) console.warn(`ffmpeg: no sha256 pinned for ${triple} yet; pin the one above in scripts/fetch-ffmpeg.mjs`);
writeFileSync(dest, gunzipSync(gz));
chmodSync(dest, 0o755);
writeFileSync(stamp, hash);
console.log(`ffmpeg: → ${dest}`);
// The version, when it runs here (not a macOS build fetched on Windows).
try {
  console.log(`ffmpeg: ${execFileSync(dest, ["-version"], { encoding: "utf8" }).split("\n")[0]}`);
} catch {
  /* another OS's build */
}
