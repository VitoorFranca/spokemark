// Composites transparent overlay screenshots onto a neutral desktop-like gradient for the docs
// (the overlay is translucent: on its own it looks grey). Run: npx electron tests/ui/compose-overlay.cjs <png>...
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 400, height: 300 });
  await w.loadURL('data:text/html,<html></html>');
  for (const file of process.argv.slice(2).filter((f) => f.endsWith('.png'))) {
    const b64 = fs.readFileSync(file).toString('base64');
    const out = await w.webContents.executeJavaScript(`new Promise((res) => {
      const img = new Image();
      img.onload = () => {
        const pad = 48, c = document.createElement('canvas');
        c.width = img.width + pad * 2; c.height = img.height + pad * 2;
        const x = c.getContext('2d');
        const g = x.createLinearGradient(0, 0, c.width, c.height);
        g.addColorStop(0, '#2b3550'); g.addColorStop(0.5, '#4a3f5c'); g.addColorStop(1, '#7a5548');
        x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
        x.drawImage(img, pad, pad);
        res(c.toDataURL('image/png').split(',')[1]);
      };
      img.src = 'data:image/png;base64,${b64}';
    })`);
    fs.writeFileSync(file, Buffer.from(out, 'base64'));
    console.log('composed', path.basename(file));
  }
  app.exit(0);
});
