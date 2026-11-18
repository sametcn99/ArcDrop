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
    openAppCaption: 'The embedded library opens in a new tab (coming in E3).',
    disconnect: 'Disconnect',
    disconnectConfirm: 'Sign out and remove stored tokens?',
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
    // Error messages keyed by broker/api codes
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
