/**
 * Rebuild original brand artwork. No remote request, AI image, or user data.
 * Icons are geometry only. The OG image is promotional artwork, not a post.
 * Japanese text uses an installed font; font binaries are never distributed.
 * Optional: OG_FONT_FILE=/absolute/path/to/font.ttf OG_FONT_FAMILY="Font Name"
 */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, "public");
await mkdir(output, { recursive: true });
const icon = await readFile(join(output, "icon.svg"));
const favicon = await readFile(join(output, "favicon.svg"));

await Promise.all(
  [
    ["icon-192.png", 192],
    ["icon-512.png", 512],
  ].map(([name, size]) =>
    sharp(icon).resize(size, size).png().toFile(join(output, name)),
  ),
);

// A full-bleed opaque background and centrally positioned artwork satisfy the
// maskable icon safe zone, including circular launcher masks.
const maskable = icon.toString("utf8").replace('rx="112"', 'rx="0"');
await sharp(Buffer.from(maskable))
  .resize(180, 180)
  .png()
  .toFile(join(output, "apple-touch-icon.png"));
await sharp(Buffer.from(maskable))
  .resize(512, 512)
  .png()
  .toFile(join(output, "maskable-icon-512.png"));

// ICO supports PNG frames. Keep small-size artwork optically simpler.
const frames = await Promise.all(
  [16, 32, 48].map(async (size) => ({
    size,
    data: await sharp(favicon).resize(size, size).png().toBuffer(),
  })),
);
const directory = Buffer.alloc(6 + frames.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(frames.length, 4);
let offset = directory.length;
for (const [index, frame] of frames.entries()) {
  const entry = 6 + index * 16;
  directory.writeUInt8(frame.size, entry);
  directory.writeUInt8(frame.size, entry + 1);
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(frame.data.length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += frame.data.length;
}
await writeFile(
  join(output, "favicon.ico"),
  Buffer.concat([directory, ...frames.map((frame) => frame.data)]),
);

const fontCandidates = [
  {
    file: process.env.OG_FONT_FILE,
    family: process.env.OG_FONT_FAMILY || "sans-serif",
  },
  { file: "C:/Windows/Fonts/BIZ-UDGothicB.ttc", family: "BIZ UDGothic" },
  { file: "C:/Windows/Fonts/YuGothB.ttc", family: "Yu Gothic" },
  {
    file: "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc",
    family: "Hiragino Sans",
  },
  {
    file: "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    family: "Noto Sans CJK JP",
  },
];
let font;
for (const candidate of fontCandidates) {
  if (!candidate.file) continue;
  try {
    await access(candidate.file);
    font = candidate;
    break;
  } catch {
    // An unavailable platform font is expected; try the next supported font.
  }
}
if (!font) {
  throw new Error(
    "A Japanese font is required to rebuild og.png. Install Noto Sans CJK, or set OG_FONT_FILE and OG_FONT_FAMILY. Existing committed assets are sufficient to build the app.",
  );
}

const ogBackground = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="glow">
      <stop offset="0" stop-color="#c6f475" stop-opacity=".065"/>
      <stop offset="1" stop-color="#c6f475" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="#101411"/>
  <ellipse cx="928" cy="295" rx="357" ry="365" fill="url(#glow)"/>
  <rect x="80" y="71" width="32" height="19" rx="5" fill="none" stroke="#c6f475" stroke-width="2"/>
  <rect x="84" y="75" width="17" height="11" rx="2" fill="#c6f475"/>
  <rect x="116" y="77" width="3" height="7" rx="1.5" fill="#c6f475"/>
  <rect x="744" y="214" width="323" height="191" rx="47" fill="#192119" stroke="#526343" stroke-width="3"/>
  <rect x="760" y="230" width="213" height="159" rx="33" fill="#c6f475"/>
  <rect x="1080" y="275" width="16" height="66" rx="8" fill="#526343"/>
  <path d="M81 518H1119" stroke="#2a3329"/>
  <circle cx="1088" cy="556" r="5" fill="#c6f475"/>
</svg>`);

async function textLayer(text, size, color, left, top, options = {}) {
  const image = await sharp({
    text: {
      text: `<span foreground="${color}"${options.bold ? ' weight="bold"' : ""}>${text}</span>`,
      font: `${font.family} ${size}`,
      fontfile: font.file,
      dpi: 72,
      rgba: true,
      spacing: options.spacing ?? 8,
    },
  })
    .png()
    .toBuffer();
  return { input: image, left, top };
}

const layers = await Promise.all([
  textLayer("SOMEONE’S BATTERY", 18, "#c6f475", 137, 72),
  textLayer("誰かの充電", 84, "#f5f7f2", 78, 206, { bold: true }),
  textLayer("名前も知らない誰かの、\nいまの残量。", 28, "#aeb8aa", 84, 328, {
    spacing: 15,
  }),
  textLayer("匿名で、0〜100%。ただ、眺めるだけ。", 20, "#aeb8aa", 81, 545),
  textLayer("24h", 17, "#c6f475", 1031, 546),
]);
await sharp(ogBackground).composite(layers).png().toFile(join(output, "og.png"));

for (const name of [
  "icon-192.png",
  "icon-512.png",
  "maskable-icon-512.png",
  "apple-touch-icon.png",
  "og.png",
]) {
  const { width, height } = await sharp(join(output, name)).metadata();
  console.log(`${name}: ${width} × ${height}`);
}
console.log("favicon.ico: 16, 32, 48 px; Japanese text rendered with a local font.");
