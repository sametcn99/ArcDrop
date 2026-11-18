// Runtime host-permission helpers (optional_host_permissions: ["*://*/*"]).
// The user's own server origin is granted at setup time only, so the
// extension never asks for "all sites" and API fetches go out CORS-free.
//
// permissions.request must run while a user gesture is active, so the POPUP
// calls requestOriginPermission directly from its submit handler — messages
// to the background do not carry the gesture.

/** Match pattern granting exactly this origin's paths ("origin/*"). */
export function originPattern(origin: string): string {
  return `${origin}/*`;
}

export interface PermissionsLike {
  request(popup: { origins?: string[] }): Promise<boolean>;
  contains(popup: { origins?: string[] }): Promise<boolean>;
}

export async function requestOriginPermission(
  permissions: PermissionsLike,
  origin: string,
): Promise<boolean> {
  return permissions.request({ origins: [originPattern(origin)] });
}

export async function hasOriginPermission(
  permissions: PermissionsLike,
  origin: string,
): Promise<boolean> {
  return permissions.contains({ origins: [originPattern(origin)] });
}

export function chromePermissions(): PermissionsLike {
  return chrome.permissions;
}
