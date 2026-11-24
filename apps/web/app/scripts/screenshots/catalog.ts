export interface Screenshot {
  name: string;
  path: string;
  text: string;
  tab?: string;
}

export const guestPages: Screenshot[] = [
  { name: 'server-address', path: '/server', text: 'Connect to your server' },
  { name: 'server-unreachable', path: '/server-unreachable', text: 'Retry connection' },
  { name: 'initial-setup', path: '/bootstrap', text: 'Create admin account' },
  { name: 'claim-token', path: '/claim?token=screenshot-invite', text: 'Confirm new password' },
  { name: 'login', path: '/login', text: 'Sign in' },
  { name: 'public-collection', path: '/s/screenshot-demo', text: 'Design research' },
];

export const accountPages: Screenshot[] = [
  { name: 'library', path: '/', text: 'ArcDrop Architecture Guide' },
  {
    name: 'quick-add',
    path: '/quick-add?url=https%3A%2F%2Fexample.test%2Fresearch',
    text: 'Quick add bookmark',
  },
  { name: 'collection', path: '/collections/col-1', text: 'Design research' },
  {
    name: 'bookmark-details',
    path: '/bookmarks/bm-1',
    text: 'Keep research material searchable and easy to revisit.',
  },
  { name: 'trash', path: '/trash', text: 'An older research draft' },
  { name: 'health-duplicates', path: '/health', tab: 'Duplicates', text: 'Normalized URL:' },
  { name: 'health-broken-links', path: '/health', tab: 'Broken links', text: 'HTTP 404' },
  { name: 'portability', path: '/portability', text: 'Export' },
  { name: 'settings-profile', path: '/settings', tab: 'Profile', text: 'Change password' },
  { name: 'settings-security', path: '/settings', tab: 'Security', text: 'Active sessions' },
  {
    name: 'settings-notifications',
    path: '/settings',
    tab: 'Notifications',
    text: 'Open notification center',
  },
  { name: 'settings-api-tokens', path: '/settings', tab: 'API tokens', text: 'Research assistant' },
  { name: 'admin-users', path: '/admin', tab: 'Users', text: 'researcher@arcdrop.test' },
  {
    name: 'admin-instance-settings',
    path: '/admin',
    tab: 'Instance settings',
    text: 'Trash retention',
  },
  { name: 'admin-audit-log', path: '/admin', tab: 'Audit log', text: 'admin.user.create' },
  { name: 'not-found', path: '/unrecognized-screenshot-page', text: 'Page not found' },
];

export const webShotNames = [
  ...guestPages.map(({ name }) => name),
  'login-two-factor',
  ...accountPages.map(({ name }) => name),
];

export const extensionShotNames = [
  ...webShotNames,
  'extension-popup-setup',
  'extension-popup-login',
  'extension-popup-two-factor',
  'extension-popup-editor',
  'extension-popup-save-all-tabs',
  'extension-options',
];

export const targets = [
  'web-desktop',
  'web-mobile',
  'extension-chromium',
  'extension-firefox',
  'desktop-linux',
  'desktop-macos',
  'desktop-windows',
  'android-emulator',
  'ios-simulator',
] as const;
