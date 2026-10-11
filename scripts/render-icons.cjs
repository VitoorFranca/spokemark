// Renders the brand assets with a hidden Electron window (no extra deps):
//  - app icon: assets/logo.png (the original artwork) clipped to a macOS squircle
//    on the 824/1024 icon grid -> build/icon.iconset -> build/macos/icon.icns
//  - build/icon.iconset/*.png -> build/icon.icns (iconutil)
//  - assets/tray/*Template(@2x).png (macOS template images)
// Run: npx electron scripts/render-icons.cjs
const { app, BrowserWindow } = require('electron');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

let win = null;
const getWin = () => win ?? (win = new BrowserWindow({ type: 'panel', width: 600, height: 600, show: false, transparent: true, frame: false, hasShadow: false, backgroundColor: '#00000000' }));
const scale = () => require('electron').screen.getPrimaryDisplay().scaleFactor;

async function capture(html, size, out) {
  const w = getWin();
  const tmp = path.join(ROOT, 'build', `render-icon-${process.pid}.html`);
  fs.writeFileSync(tmp, html);
  await w.loadFile(tmp);
  await w.webContents.executeJavaScript('window.__ready ?? Promise.resolve()');
  await new Promise((r) => setTimeout(r, 120));
  const dip = size / scale();
  const img = await w.webContents.capturePage({ x: 0, y: 0, width: Math.ceil(dip), height: Math.ceil(dip) }, { stayHidden: true });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, (img.getSize().width === size ? img : img.resize({ width: size, height: size, quality: 'best' })).toPNG());
  fs.rmSync(tmp, { force: true });
}

// One reusable window (destroying the only window would quit the app).
// capturePage(rect) returns device pixels (2x on Retina): draw at size/scale DIP.
async function render(svgFile, size, out) {
  const svg = fs.readFileSync(path.join(ROOT, 'assets/brand', svgFile), 'utf8');
  const dip = size / scale();
  await capture(`<html><body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" style="display:block;width:${dip}px;height:${dip}px"></body></html>`, size, out);
}

// App icon from the original PNG: crop the squircle (x 110..1141, y 108..1112 in
// the 1254 px artwork), clip it with a continuous-corner squircle and place it on
// the macOS grid (824 px body centered in 1024).
async function renderAppIcon(size, out) {
  const png = fs.readFileSync(path.join(ROOT, 'assets/logo.png')).toString('base64');
  const dip = size / scale();
  const html = `<html><body style="margin:0;background:transparent"><canvas id="c" width="${size}" height="${size}" style="width:${dip}px;height:${dip}px;display:block"></canvas><script>
    window.__ready = new Promise((res) => {
      const img = new Image();
      img.onload = () => {
        const c = document.getElementById('c'), k = ${size} / 1024, ctx = c.getContext('2d');
        ctx.scale(k, k);
        ctx.beginPath();
        for (let i = 0; i <= 360; i++) { // superellipse n=5 ~ Apple's continuous corners
          const t = (i / 360) * 2 * Math.PI, co = Math.cos(t), si = Math.sin(t);
          const x = 512 + 410 * Math.sign(co) * Math.abs(co) ** 0.4, y = 512 + 410 * Math.sign(si) * Math.abs(si) ** 0.4;
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.closePath(); ctx.clip();
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 110, 108, 1032, 1005, 100, 100, 824, 824);
        res();
      };
      img.src = 'data:image/png;base64,${png}';
    });
  </script></body></html>`;
  await capture(html, size, out);
}

app.whenReady().then(async () => {
  const iconset = path.join(ROOT, 'build/icon.iconset');
  fs.rmSync(iconset, { recursive: true, force: true });
  for (const s of [16, 32, 128, 256, 512]) {
    // <=32 px: the vector recreation stays crisp; the glow of the original turns to blur
    if (s <= 32) await render('logo.svg', s, path.join(iconset, `icon_${s}x${s}.png`));
    else await renderAppIcon(s, path.join(iconset, `icon_${s}x${s}.png`));
    if (s * 2 <= 32) await render('logo.svg', s * 2, path.join(iconset, `icon_${s}x${s}@2x.png`));
    else await renderAppIcon(s * 2, path.join(iconset, `icon_${s}x${s}@2x.png`));
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(ROOT, 'build/macos/icon.icns')]);
  await renderAppIcon(512, path.join(ROOT, 'src/renderer/public/icon.png')); // in-app logo
  await render('logo.svg', 512, path.join(ROOT, 'build/logo-svg-preview.png')); // review only
  for (const [svg, name] of [['tray-idle.svg', 'trayIdle'], ['tray-listening.svg', 'trayListening']]) {
    await render(svg, 18, path.join(ROOT, `assets/tray/${name}Template.png`));
    await render(svg, 36, path.join(ROOT, `assets/tray/${name}Template@2x.png`));
  }
  console.log('icons rendered');
  app.quit();
});
