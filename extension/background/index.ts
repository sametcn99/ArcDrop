// ArcDrop background service worker (placeholder).
// Context menus and tab workflows arrive in E4; quick-save wiring and
// badge feedback arrive in E2. This registration exists so the worker
// is built and loads cleanly from day one.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.info('[ArcDrop] installed — connecting to your server arrives in E1.');
  }
});
