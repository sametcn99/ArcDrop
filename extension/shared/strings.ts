// Central place for user-facing strings (English).
// Keep every popup/options label here so UI components stay free of
// hardcoded copy; new milestones extend this object.
export const strings = {
  appName: 'ArcDrop',
  popup: {
    placeholderBody: 'ArcDrop — setup coming in E1.',
  },
  options: {
    placeholderBody: 'ArcDrop — options coming in E5.',
  },
} as const;

export type Strings = typeof strings;
