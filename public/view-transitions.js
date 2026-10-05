// Match the existing energy-enter fade and gentle upward movement.
const activeEntries = new Map();
const pendingEntries = new WeakMap();
const motionPreference = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
motionPreference?.addEventListener('change', () => {
  if (motionPreference.matches) cancelViewEntries();
});

export function cancelViewEntries(root) {
  for (const [element, animation] of activeEntries) {
    if (!root || root.contains(element)) animation.cancel();
  }
}

export function animateViewEntry(element) {
  if (!element?.isConnected || !element.animate || motionPreference?.matches || element.closest('.motion-paused')) return;
  const dialog = element.closest('dialog');
  if (dialog && dialog !== element && dialog.getAnimations().some(animation => animation.animationName === 'energy-enter' && animation.playState === 'running')) return;
  for (const [target, animation] of activeEntries) {
    if (target !== element && target.contains(element)) return;
    if (target === element || element.contains(target)) animation.cancel();
  }
  const animation = element.animate([
    {opacity: 0, translate: '0 9px'},
    {opacity: 1, translate: '0 0'},
  ], {duration: 500, easing: 'ease'});
  animation.id = 'view-entry';
  activeEntries.set(element, animation);
  const cleanup = () => {
    if (activeEntries.get(element) === animation) activeEntries.delete(element);
  };
  animation.finished.then(cleanup, cleanup);
}

// Start when the new view reaches the DOM, including renderers that await data.
// Observe the view root only so streaming, typing and list updates do not replay it.
export function transitionView(element, update) {
  if (!element || !element.animate || motionPreference?.matches || element.closest('.motion-paused')) return update();
  pendingEntries.get(element)?.();
  const cleanup = () => {
    observer.disconnect();
    if (pendingEntries.get(element) === cleanup) pendingEntries.delete(element);
  };
  const begin = () => {
    cleanup();
    animateViewEntry(element);
  };
  const observer = new MutationObserver(begin);
  pendingEntries.set(element, cleanup);
  observer.observe(element, {childList: true});
  try {
    const result = update();
    if (observer.takeRecords().length) begin();
    if (result?.then) return Promise.resolve(result).finally(cleanup);
    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}
