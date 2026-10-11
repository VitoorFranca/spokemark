// Rasterizes assets/brand/*.svg with a hidden Electron window (no extra deps):
//  - build/icon.iconset/*.png -> build/icon.icns (iconutil)
//  - assets/tray/*Template(@2x).png (macOS template images)
// Run: npx electron scripts/render-icons.cjs
const { app, BrowserWindow } = require('electron');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

let win = null;
// One reusable 600pt window (very small windows fail to load in Electron 44).
// capturePage(rect) returns device pixels (2x on Retina): draw at size/scale DIP.
async function render(svgFile, size, out) {
  if (!win) win = new BrowserWindow({ type: 'panel', width: 600, height: 600, show: false, transparent: true, frame: false, hasShadow: false, backgroundColor: '#00000000' });
  const svg = fs.readFileSync(path.join(ROOT, 'assets/brand', svgFile), 'utf8');
  const scale = require('electron').screen.getPrimaryDisplay().scaleFactor;
  const dip = size / scale;
  const html = `<html><body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" style="display:block;width:${dip}px;height:${dip}px"></body></html>`;
  const tmp = path.join(ROOT, 'build', `render-icon-${process.pid}.html`);
  fs.writeFileSync(tmp, html);
  await win.loadFile(tmp);
  await new Promise((r) => setTimeout(r, 120));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: Math.ceil(dip), height: Math.ceil(dip) }, { stayHidden: true });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const sz = img.getSize();
  fs.writeFileSync(out, (sz.width === size ? img : img.resize({ width: size, height: size, quality: 'best' })).toPNG());
  fs.rmSync(tmp, { force: true });
}

app.whenReady().then(async () => {
  const iconset = path.join(ROOT, 'build/icon.iconset');
  fs.rmSync(iconset, { recursive: true, force: true });
  for (const s of [16, 32, 128, 256, 512]) {
    await render('app-icon.svg', s, path.join(iconset, `icon_${s}x${s}.png`));
    await render('app-icon.svg', s * 2, path.join(iconset, `icon_${s}x${s}@2x.png`));
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(ROOT, 'build/macos/icon.icns')]);
  await render('app-icon.svg', 512, path.join(ROOT, 'assets/brand/app-icon-512.png'));
  for (const [svg, name] of [['tray-idle.svg', 'trayIdle'], ['tray-listening.svg', 'trayListening']]) {
    await render(svg, 18, path.join(ROOT, `assets/tray/${name}Template.png`));
    await render(svg, 36, path.join(ROOT, `assets/tray/${name}Template@2x.png`));
  }
  console.log('icons rendered');
  app.quit();
});
