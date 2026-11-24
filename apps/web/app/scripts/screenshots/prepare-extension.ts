import { resolve } from 'node:path';
import { origin } from './fixtures';

// Modify only disposable extension builds used by the screenshot job.
// Popup automation uses a regular extension tab, so give it two sample pages
// and designate the first one as the active page presented by the toolbar.
for (const browser of ['chromium', 'firefox']) {
  const dir = resolve('extension/dist', browser);
  const manifestPath = resolve(dir, 'manifest.json');
  const manifest = await Bun.file(manifestPath).json();
  manifest.host_permissions = [
    ...(manifest.host_permissions ?? []),
    `${origin.replace(/:\d+$/, '')}/*`,
  ];
  await Bun.write(manifestPath, JSON.stringify(manifest, null, 2));

  const popupPath = resolve(dir, manifest.action.default_popup);
  const html = await Bun.file(popupPath).text();
  await Bun.write(
    resolve(dir, 'screenshot-tabs.js'),
    `
    const queryTabs = chrome.tabs.query.bind(chrome.tabs);
    const fixtureUrl = ${JSON.stringify(`${origin}/sample/1`)};
    const tabsReady = queryTabs({ currentWindow: true }).then(async (tabs) => {
      const existing = tabs.find((tab) => tab.url === fixtureUrl);
      if (existing) return existing;
      const tab = await chrome.tabs.create({ url: fixtureUrl, active: false });
      await chrome.tabs.create({ url: ${JSON.stringify(`${origin}/sample/2`)}, active: false });
      for (let attempt = 0; attempt < 50; attempt++) {
        const loaded = await chrome.tabs.get(tab.id);
        if (loaded.url === fixtureUrl && loaded.status === 'complete') return loaded;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('The sample tab did not load');
    });
    chrome.tabs.query = async (info) => {
      const active = await tabsReady;
      return info.active ? [active] : queryTabs(info);
    };
  `,
  );
  await Bun.write(
    popupPath,
    html.replace('<head>', '<head><script src="../screenshot-tabs.js"></script>'),
  );
}
