// Apply the requested layout before the large model bundle is downloaded.
// This separate same-origin script also works with script-src 'self'.
(() => {
  const params = new URLSearchParams(location.search);
  const root = document.documentElement;
  root.classList.toggle('is-embedded', params.get('embed') === '1');
  root.classList.toggle('is-compact', params.get('compact') === '1');
  root.dataset.mode = params.get('mode') === 'atlas' || params.has('muscle') || params.has('structure') ? 'atlas' : 'motion';
})();
