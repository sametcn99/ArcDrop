// Session device label shown in the ArcDrop "Sessions" list, mirroring the
// plan's "Extension · <browser>" convention.

export function detectBrowserName(userAgent: string): string {
  if (userAgent.includes('Edg/')) return 'Edge';
  if (userAgent.includes('Firefox')) return 'Firefox';
  if (userAgent.includes('OPR/')) return 'Opera';
  return 'Chrome';
}

export function deviceLabel(userAgent: string = navigator.userAgent): string {
  return `Extension · ${detectBrowserName(userAgent)}`;
}
