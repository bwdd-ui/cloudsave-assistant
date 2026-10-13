// Load covers near the viewport, through the shared disk cache, rather than
// launching one network request for every off-screen card in a catalogue.
(() => {
  const waiting = new Set(), metadata = new WeakMap(), targets = new WeakMap();
  async function load(image) {
    const item = metadata.get(image);
    waiting.delete(image); if (item) observer?.unobserve(item.target);
    if (!item || !image.isConnected || item.loading) return;
    item.loading = true;
    try {
      const data = await window.cloudsave.posterData(item.url, item.site);
      if (!image.isConnected || metadata.get(image) !== item) return;
      image.src = data; image.style.display = 'block'; item.fallback.style.display = 'none';
    } catch (_) {
      if (image.isConnected && metadata.get(image) === item) {
        image.style.display = 'none'; item.fallback.style.display = 'flex';
      }
    }
  }
  const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) { const image = targets.get(entry.target); if (image) load(image); }
  }, { rootMargin: '240px' }) : null;
  const cleanup = () => {
    for (const image of waiting) if (!image.isConnected) { observer?.unobserve(metadata.get(image)?.target); waiting.delete(image); }
  };
  if (typeof MutationObserver === 'function') new MutationObserver(cleanup).observe(document.documentElement, { childList: true, subtree: true });
  function posters(root, site = 'butailing') {
    if (!root) return;
    cleanup();
    root.querySelectorAll('.cloud-poster-card').forEach(card => {
      if (card.tagName === 'BUTTON' || card.dataset.keyboardReady) return;
      card.dataset.keyboardReady = '1'; card.tabIndex = 0; card.setAttribute('role', 'button');
      const title = card.querySelector('.cloud-poster-title')?.textContent || '';
      if (title) { card.setAttribute('aria-label', '查看 ' + title); card.title = title; }
      card.addEventListener('keydown', event => {
        if (event.target !== card || !['Enter', ' '].includes(event.key)) return;
        event.preventDefault(); card.click();
      });
    });
    root.querySelectorAll('img').forEach(image => {
      const url = image.dataset.posterUrl || image.getAttribute('src');
      if (!url || url.startsWith('data:') || metadata.has(image)) return;
      let fallback = image.nextElementSibling;
      if (!fallback?.classList.contains('cloud-poster-fallback')) {
        fallback = document.createElement('div'); fallback.className = 'cloud-poster-fallback'; image.after(fallback);
      }
      fallback.textContent = image.alt || '暂无海报'; fallback.style.display = 'flex';
      image.removeAttribute('src'); image.style.display = 'none'; image.decoding = 'async';
      image.onerror = () => { image.style.display = 'none'; fallback.style.display = 'flex'; };
      // Hidden images have no intersection box. Observe the visible poster
      // container so the name placeholder can remain visible while waiting.
      const target = image.closest?.('.cloud-poster') || image.parentElement || image;
      metadata.set(image, { url, site, fallback, target, loading: false }); targets.set(target, image);
      if (observer) { waiting.add(image); observer.observe(target); } else load(image);
    });
  }
  window.cloudsaveUI = { posters };
})();
