// Genera imágenes de tarjetas: versión "scan" (limpia) y "photo" (perspectiva, rotación, desenfoque,
// iluminación irregular, ruido y JPEG q≈0.7) para simular una foto tomada con el teléfono en la feria.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARDS } from './cards.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(dir, 'fixtures');
await mkdir(out, { recursive: true });

const CSS = `
body{margin:0;background:#fff}
.card{width:900px;height:520px;box-sizing:border-box;padding:38px 46px;position:relative;font-family:"Helvetica Neue",Arial,"PingFang SC","Heiti SC",sans-serif;color:#1d2433;background:#fbfaf6;overflow:hidden}
.card.dark{background:#14243b;color:#f2f4f8}
.card.serif{font-family:Georgia,"Songti SC",serif}
.card.song .cn{font-family:"Songti SC","STSong",serif}
.card.dense{padding:26px 34px}
.card div{margin:3px 0;font-size:24px;line-height:1.25}
.card .big{font-size:31px;font-weight:700;margin-bottom:10px}
.card .huge{font-size:44px;font-weight:700}
.card .sm{font-size:21px}
.card.dense .sm{font-size:18px}
.card .row b{font-size:28px;margin-right:12px}
.card .rule{height:3px;width:120px;background:#b4232a;margin:12px 0}
.card .logo{position:absolute;right:40px;top:30px;width:86px;height:86px;border-radius:50%;background:#f4b400;color:#fff;font:700 26px "PingFang SC";display:flex;align-items:center;justify-content:center}
.card .qr{position:absolute;right:34px;bottom:30px;width:120px;height:120px;background:repeating-conic-gradient(#000 0 25%,#fff 0 50%) 0 0/20px 20px;border:6px solid #000}
`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1.6 });
const manifest = [];
for (const c of CARDS) {
  const name = `${c.id}_${c.side}`;
  await page.setViewportSize({ width: 900, height: 520 });
  await page.setContent(`<style>${CSS}</style><div class="card ${c.style}">${c.html}</div>`);
  await page.evaluate(() => document.fonts.ready);
  const scan = await page.locator('.card').screenshot({ type: 'png' });
  await writeFile(path.join(out, `${name}_scan.png`), scan);

  // Variante foto: mesa de fondo + transformaciones + ruido + JPEG.
  const seed = [...name].reduce((s, ch) => s + ch.charCodeAt(0), 0);
  const rot = ((seed % 9) - 4) * 1.2; const rx = 6 + (seed % 5); const ry = ((seed % 7) - 3) * 3;
  await page.setViewportSize({ width: 1500, height: 1050 });
  await page.setContent(`<style>${CSS}
    body{background:radial-gradient(circle at 30% 20%,#9a8268,#5b4836);width:1500px;height:1050px;display:flex;align-items:center;justify-content:center;overflow:hidden}
    .wrap{transform:perspective(1600px) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rot}deg) scale(1.15);filter:blur(0.9px) brightness(0.93) contrast(0.9);box-shadow:0 18px 40px rgba(0,0,0,.45)}
    .shade{position:fixed;inset:0;background:linear-gradient(${seed % 360}deg,rgba(0,0,0,.28),rgba(255,255,255,0) 55%,rgba(255,240,200,.18));pointer-events:none}
  </style><div class="wrap"><div class="card ${c.style}">${c.html}</div></div><div class="shade"></div>`);
  await page.evaluate(() => document.fonts.ready);
  const shot = await page.screenshot({ type: 'png' });
  const jpegB64 = await page.evaluate(async ({ b64, seed }) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, cv.width, cv.height); let s = seed;
    for (let i = 0; i < d.data.length; i += 4) { s = (s * 1103515245 + 12345) & 0x7fffffff; const n = ((s % 41) - 20); d.data[i] += n; d.data[i + 1] += n; d.data[i + 2] += n; }
    ctx.putImageData(d, 0, 0);
    return cv.toDataURL('image/jpeg', 0.7).split(',')[1];
  }, { b64: shot.toString('base64'), seed });
  await writeFile(path.join(out, `${name}_photo.jpg`), Buffer.from(jpegB64, 'base64'));

  const text = await page.locator('.card').innerText();
  manifest.push({ name, card: c.id, side: c.side, files: { scan: `${name}_scan.png`, photo: `${name}_photo.jpg` }, expect: c.expect, text: text.split('\n').map((t) => t.trim()).filter(Boolean) });
}
await writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
await browser.close();
console.log(`✓ ${manifest.length * 2} imágenes en ${out}`);
