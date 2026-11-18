// Central place for user-facing strings (English).
// Keep every popup/options label here so UI components stay free of
// hardcoded copy; new milestones extend this object.

export const strings = {
  appName: 'ArcDrop',
  popup: {
    connecting: 'Connecting…',
    stateLabel: 'Server',
    accountLabel: 'Account',
    openApp: 'Open ArcDrop',
    openAppCaption: 'Opens your full ArcDrop library in a new tab.',
    disconnect: 'Disconnect',
    // Setup step
    setupTitle: 'Connect your server',
    setupBody: 'Enter the address of your self-hosted ArcDrop server.',
    serverFieldLabel: 'Server address',
    serverFieldPlaceholder: 'arcdrop.example.com',
    serverFieldHelp: 'Include https:// for non-HTTPS local addresses.',
    continueButton: 'Continue',
    permissionDeniedTitle: 'Server access was denied',
    permissionDeniedBody:
      'ArcDrop needs permission to talk to your server. Retry, or grant it under ' +
      'chrome://extensions → ArcDrop → Details → Permissions.',
    // Login step
    loginTitle: 'Sign in',
    loginBody: 'Use your ArcDrop account credentials.',
    emailFieldLabel: 'Email',
    passwordFieldLabel: 'Password',
    signInButton: 'Sign in',
    changeServer: 'Use a different server',
    // TOTP step
    totpTitle: 'Two-factor authentication',
    totpBody: 'Enter the 6-digit code from your authenticator app, or a recovery code.',
    totpFieldLabel: 'Authentication code',
    recoverCodeFieldLabel: 'Recovery code',
    useRecoveryCode: 'Use a recovery code',
    useTotpCode: 'Use an authentication code',
    verifyButton: 'Verify',
    backButton: 'Back',
    // Editor (E2)
    editorTitleField: 'Title',
    editorExcerptField: 'Description',
    editorTagsField: 'Tags',
    editorTagsPlaceholder: 'Add tags…',
    editorCollectionField: 'Collection',
    editorCollectionNew: '+ New collection…',
    editorCollectionKeep: 'Keep current collection',
    editorCollectionUnsorted: 'Unsorted',
    newCollectionTitle: 'New collection',
    newCollectionFieldLabel: 'Collection name',
    createButton: 'Create',
    cancelButton: 'Cancel',
    quickSave: 'Quick save',
    quickSaved: 'Saved silently to your library.',
    quickAlreadySaved: 'Already saved — found in your library.',
    editorLoadFailed: 'This page cannot be saved.',
    editorLoadFailedBody: 'ArcDrop can only save http(s) pages. Navigate to a website and retry.',
    savedNew: 'Saved.',
    savedUpdate: 'Changes saved.',
    movedToTrash: 'Moved to trash.',
    deleteButton: 'Delete',
    saveButton: 'Save',
    closeButton: 'Close',
    // Context menus (E4) — labels shown in the browser context menu
    menus: {
      page: 'Save to ArcDrop',
      link: 'Save link to ArcDrop',
      image: 'Save image to ArcDrop',
      selection: 'Save selection to ArcDrop',
    },
    menuSavedPage: 'Page saved.',
    menuAlreadySaved: 'Already in your library.',
    menuSavedLink: 'Link saved.',
    menuSavedSelectionNew: 'Page saved with your selection.',
    menuSavedSelectionAppend: 'Selection added to the saved page.',
    menuSavedImage: 'Image saved.',
    menuFailedGeneric: 'Could not save — try again from the ArcDrop popup.',
    // Save all tabs (E4)
    saveAllTabs: 'Save all tabs',
    saveAllTabsTitle: 'Save all tabs',
    saveAllTabsCount: (count: number): string => `${count} savable tab(s) found.`,
    saveAllTabsDuplicates: (count: number): string => `${count} duplicate tab(s) will be skipped.`,
    saveAllTabsWarning: 'More than 50 tabs — this can take a while.',
    saveAllTabsConfirm: 'I understand, save them all',
    saveAllTabsCollection: 'Target collection',
    saveAllTabsRun: 'Save all tabs',
    saveAllTabsRunning: 'Saving tabs…',
    saveAllTabsDone: (saved: number, skipped: number, failed: number): string =>
      `Done — ${saved} saved, ${skipped} already in library, ${failed} failed.`,
    saveAllTabsDuplicatesNote: (count: number): string =>
      count > 0 ? ` (${count} duplicate tab(s) skipped)` : '',
    // Image permission flow (E4)
    permissionBannerTitle: 'Image access needed',
    permissionBannerBody: (origin: string): string =>
      `Grant access to ${origin} to finish saving that image.`,
    permissionGrantButton: 'Grant access',
    permissionGrantedSavedImage: 'Access granted — image saved.',
    coverCaption: 'Covers are picked automatically by your server from the page metadata.',
    errors: {
      NETWORK_ERROR: 'The server could not be reached. Check the address and your connection.',
      NOT_ARCDROP: 'That address is not an ArcDrop server.',
      UNAUTHORIZED: 'Wrong email or password — or the code was rejected.',
      SESSION_EXPIRED: 'Your session expired. Please sign in again.',
      HOST_PERMISSION_DENIED: 'Server access permission is missing. Grant it to continue.',
      RATE_LIMITED: 'Too many attempts. Wait a moment and try again.',
      VALIDATION: 'Please check the entered values.',
      UNKNOWN: 'Something went wrong. Please try again.',
    },
  },
  options: {
    placeholderBody: 'ArcDrop — options coming in E5.',
  },
} as const;

export type Strings = typeof strings;

/** Maps an ApiError/broker code to its display string, falling back to UNKNOWN. */
export function errorString(code: string): string {
  const errors = strings.popup.errors as Record<string, string | undefined>;
  return errors[code] ?? strings.popup.errors.UNKNOWN;
}
