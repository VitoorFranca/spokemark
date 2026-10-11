// Spike A: Electron getDisplayMedia + audio:'loopback' on macOS. Prints RMS of 10 s.
const { app, BrowserWindow, session, desktopCapturer } = require('electron');
app.whenReady().then(async () => {
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      console.log('[spikeA] sources:', sources.length);
      cb({ video: sources[0], audio: 'loopback' });
    } catch (e) { console.log('[spikeA] getSources error', e.message); cb({}); }
  });
  const w = new BrowserWindow({ show: false, webPreferences: { contextIsolation: false, nodeIntegration: true } });
  w.webContents.on('console-message', (e) => console.log('[renderer]', e.message ?? e));
  await w.loadFile(require('path').join(__dirname,'index.html'));
  w.on('closed', () => app.quit());
});
