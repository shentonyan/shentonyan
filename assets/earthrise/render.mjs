/*
 * render.mjs — capture earthrise frames in headless Chromium and build a
 * looping GIF with ffmpeg.
 *
 *   npm i -D playwright      # or use a global install
 *   node render.mjs
 *
 * Requires ffmpeg on PATH. Writes frames to ./frames and earthrise.gif here.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRAME_DIR = join(HERE, 'frames');
const FPS = 14;

rmSync(FRAME_DIR, { recursive: true, force: true });
mkdirSync(FRAME_DIR, { recursive: true });

const browser = await chromium.launch({
  args: ['--force-device-scale-factor=1', '--hide-scrollbars']
});
const page = await browser.newPage({ deviceScaleFactor: 1 });

// Stop the live loop so frames are rendered only on demand.
await page.addInitScript(() => { window.__earthriseNoAutoplay = true; });
await page.goto('file://' + join(HERE, 'index.html'));
await page.waitForFunction(() => typeof window.__earthriseRender === 'function');

const frames = await page.evaluate(() => window.__earthriseFrames);
const size = await page.evaluate(() => window.__earthriseSize);
console.log(`rendering ${frames} frames at ${size.w}x${size.h}`);

for (let i = 0; i < frames; i++) {
  await page.evaluate((n) => window.__earthriseRender(n), i);
  const b64 = await page.evaluate(() => {
    const c = document.getElementById('c');
    return c.toDataURL('image/png').slice('data:image/png;base64,'.length);
  });
  writeFileSync(join(FRAME_DIR, String(i).padStart(4, '0') + '.png'),
                Buffer.from(b64, 'base64'));
  if ((i + 1) % 12 === 0) console.log(`  ${i + 1}/${frames}`);
}

await browser.close();

// Two-pass GIF: build one global palette from the whole loop, then map every
// frame onto it. Bayer dithering keeps the dot characters crisp instead of
// smearing them the way error-diffusion does.
const pattern = join(FRAME_DIR, '%04d.png');
const palette = join(FRAME_DIR, 'palette.png');
execFileSync('ffmpeg', [
  '-y', '-v', 'error',
  '-framerate', String(FPS), '-i', pattern,
  '-vf', 'palettegen=max_colors=64:stats_mode=full',
  palette
], { stdio: 'inherit' });

execFileSync('ffmpeg', [
  '-y', '-v', 'error',
  '-framerate', String(FPS), '-i', pattern,
  '-i', palette,
  '-lavfi', 'paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle',
  '-loop', '0',
  join(HERE, 'earthrise.gif')
], { stdio: 'inherit' });

console.log('wrote earthrise.gif');
