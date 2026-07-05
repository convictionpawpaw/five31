// Generates the PWA/app icons from src/assets/icon.svg using sharp.
//
//   node scripts/generate-icons.mjs   (or: npm run icons)
//
// Outputs (committed to the repo so CI never needs to render them):
//   public/icons/icon-192.png            192x192  full-bleed art
//   public/icons/icon-512.png            512x512  full-bleed art
//   public/icons/icon-maskable-512.png   512x512  art at ~70% in the safe zone
//   public/icons/apple-touch-icon.png    180x180  OPAQUE #060a0b, art at ~80%
//   public/favicon.svg                   simplified inline favicon
//
// The maskable variant insets the art so Android's circular/squircle mask never
// clips the "531"; apple-touch-icon is fully opaque (iOS ignores transparency)
// with a hard #060a0b field.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const srcSvg = join(root, 'src', 'assets', 'icon.svg');
const outDir = join(root, 'public', 'icons');
const publicDir = join(root, 'public');

const BG = '#060a0b';
const BG_RGB = { r: 0x06, g: 0x0a, b: 0x0b, alpha: 1 };

/** Render the source SVG to a raw PNG buffer at a given square size. */
async function renderArt(size) {
  const svg = await readFile(srcSvg);
  return sharp(svg, { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

/** Full-bleed icon: the source art fills the whole square. */
async function fullBleed(size, outfile) {
  const svg = await readFile(srcSvg);
  await sharp(svg, { density: 384 })
    .resize(size, size, { fit: 'contain', background: BG_RGB })
    .png()
    .toFile(outfile);
}

/**
 * Inset icon: art scaled to `scale` of the canvas, centered on a solid BG field.
 * `opaque` controls whether the background alpha is 1 (apple-touch) or matches
 * the near-black field anyway (maskable) — both use the same #060a0b here.
 */
async function inset(size, scale, outfile) {
  const artSize = Math.round(size * scale);
  const art = await renderArt(artSize);
  const pad = Math.round((size - artSize) / 2);
  await sharp({
    create: { width: size, height: size, channels: 4, background: BG_RGB },
  })
    .composite([{ input: art, top: pad, left: pad }])
    .png()
    .toFile(outfile);
}

const FAVICON = `<svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" fill="#060a0b"/>
  <g stroke="#5ee6eb" stroke-width="2" fill="none" stroke-linecap="square" opacity="0.9">
    <path d="M8 16 L8 8 L16 8"/>
    <path d="M48 8 L56 8 L56 16"/>
    <path d="M56 48 L56 56 L48 56"/>
    <path d="M16 56 L8 56 L8 48"/>
  </g>
  <text x="32" y="41" font-family="'Rajdhani','Segoe UI',system-ui,sans-serif"
        font-size="26" font-weight="700" text-anchor="middle" fill="#ffb000"
        letter-spacing="-1">531</text>
</svg>
`;

async function main() {
  await mkdir(outDir, { recursive: true });

  await fullBleed(192, join(outDir, 'icon-192.png'));
  await fullBleed(512, join(outDir, 'icon-512.png'));
  await inset(512, 0.7, join(outDir, 'icon-maskable-512.png'));
  await inset(180, 0.8, join(outDir, 'apple-touch-icon.png'));

  await writeFile(join(publicDir, 'favicon.svg'), FAVICON, 'utf8');

  // Verify each PNG with sharp metadata.
  const files = [
    ['icon-192.png', 192],
    ['icon-512.png', 512],
    ['icon-maskable-512.png', 512],
    ['apple-touch-icon.png', 180],
  ];
  console.log('Generated icons:');
  for (const [name, expected] of files) {
    const p = join(outDir, name);
    const meta = await sharp(p).metadata();
    const ok = meta.format === 'png' && meta.width === expected && meta.height === expected;
    const buf = await readFile(p);
    console.log(
      `  ${ok ? 'OK ' : 'BAD'} ${name.padEnd(24)} ${meta.width}x${meta.height} ${meta.format} ${buf.length} bytes`,
    );
    if (!ok) throw new Error(`Icon ${name} failed verification`);
  }
  console.log('  OK  favicon.svg (public/favicon.svg)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
