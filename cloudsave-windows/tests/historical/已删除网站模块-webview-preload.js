const { ipcRenderer } = require('electron');
function report(event) {
  const anchor = event.target.closest && event.target.closest('a');
  if (!anchor) return;
  const href = anchor.href || anchor.getAttribute('href') || '';
  if (/^(magnet:|ed2k:\/\/)/i.test(href)) {
    event.preventDefault();
    event.stopPropagation();
    ipcRenderer.sendToHost('magnet-clicked', href);
    return;
  }
  if (anchor.target === '_blank' && /^https?:/i.test(href)) {
    event.preventDefault();
    event.stopPropagation();
    ipcRenderer.sendToHost('open-link', href);
  }
}
document.addEventListener('click', report, true);
document.addEventListener('auxclick', report, true);
const originalOpen = window.open;
window.open = (url, ...args) => {
  try {
    const href = new URL(String(url || ''), location.href).href;
    if (/^https?:/i.test(href)) {
      ipcRenderer.sendToHost('open-link', href);
      return null;
    }
  } catch (_) {}
  return originalOpen(url, ...args);
};
