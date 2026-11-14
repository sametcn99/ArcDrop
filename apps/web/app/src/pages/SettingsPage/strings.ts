export const SETTINGS_PAGE_STRINGS = {
  title: 'Settings',
  tabs: {
    profile: 'Profile',
    security: 'Security',
    notifications: 'Notifications',
    tokens: 'API tokens',
  },
  profile: {
    heading: 'Profile',
    emailLabel: 'Email',
    changePasswordHeading: 'Change password',
    currentPassword: 'Current password',
    newPassword: 'New password',
    confirmPassword: 'Confirm new password',
    submit: 'Change password',
    sessionWarning:
      'Changing your password signs out every other session. You stay signed in here.',
    successToast: 'Password changed. Other sessions were signed out.',
    mismatchError: 'New passwords do not match.',
    emailDisplayTitle: 'Signed in as',
  },
  security: {
    heading: 'Security',
    sessionsHeading: 'Active sessions',
    sessionsEmpty: 'No other active sessions.',
    revoke: 'Revoke',
    currentSession: 'This device',
    revokedToast: 'Session revoked.',
    tfaHeading: 'Two-factor authentication',
    tfaEnabled: 'Enabled',
    tfaDisabled: 'Not enabled',
    tfaSetupButton: 'Set up 2FA',
    tfaDisableButton: 'Disable 2FA',
    tfaOffDescription:
      'Add a second step at sign-in with an authenticator app (TOTP). Recovery codes let you back in if you lose the device.',
    tfaOnDescription:
      'Sign-in requires a code from your authenticator app after your password. Disabling requires a code or a recovery code.',
  },
  notifications: {
    heading: 'Notifications',
    description:
      'Reminders arrive as toasts while you are connected and pile up here for later.',
    unreadCount: (count: number) => `${count} unread`,
    markAll: 'Mark all as read',
    empty: 'No notifications yet.',
    openCenter: 'Open notification center',
  },
  tokens: {
    heading: 'API tokens (agents)',
    description:
      'Personal access tokens let agents (Claude Desktop, Cursor, scripts) use your ArcDrop through the MCP server. Treat tokens like passwords.',
    createButton: 'Create token',
    nameField: 'Token name',
    readOnlyField: 'Read-only (mutations refused)',
    createdOnce:
      'This token is shown exactly once. Copy it into your agent configuration now — it cannot be retrieved again.',
    revoke: 'Revoke',
    revoked: 'Revoked',
    neverUsed: 'Never used',
    empty: 'No tokens yet.',
    snippetTitle: 'Agent connection snippet',
    snippetCopy: 'Copy snippet',
    snippetFor: (name: string) => `Snippet for ${name}`,
    createdToast: (name: string) => `Token "${name}" created.`,
    revokedToast: 'Token revoked.',
  },
} as const;
