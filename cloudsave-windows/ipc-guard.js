const path = require('path');
const { fileURLToPath } = require('url');

function createSenderChecker(appDir) {
  const root = path.resolve(appDir);
  const insideApp = (rawUrl) => {
    if (!rawUrl || !rawUrl.startsWith('file:')) return false;
    let target;
    try { target = path.resolve(fileURLToPath(rawUrl)); } catch (_) { return false; }
    return target === root || target.startsWith(root + path.sep);
  };
  return function isTrustedSender(event) {
    const contents = event?.sender;
    // Electron always supplies the invoking WebContents; a listener called directly in process has no frame to check.
    if (!contents) return true;
    if (contents.isDestroyed?.()) return false;
    const frame = event.senderFrame;
    if (frame) {
      if (contents.mainFrame && frame !== contents.mainFrame) return false;
      return insideApp(frame.url);
    }
    return insideApp(contents.getURL?.());
  };
}

// Every privileged channel is only ever invoked through preload.js, which Electron attaches to the
// main window alone; a remote page reaching these handlers must first navigate that frame.
function installIpcGuard(ipcMain, isTrustedSender, onReject) {
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) => handle(channel, (event, ...args) => {
    if (!isTrustedSender(event)) {
      onReject?.(channel, event);
      throw new Error('操作来源校验失败，已拒绝执行');
    }
    return listener(event, ...args);
  });
  return handle;
}

module.exports = { createSenderChecker, installIpcGuard };
