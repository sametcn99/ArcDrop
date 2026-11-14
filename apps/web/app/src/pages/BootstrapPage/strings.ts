export const BOOTSTRAP_PAGE_STRINGS = {
  title: 'Initial setup',
  subtitle: 'Create the first administrator account for this ArcDrop instance.',
  emailLabel: 'Admin email',
  passwordLabel: 'Password',
  confirmPasswordLabel: 'Confirm password',
  passwordHelper: 'Must be 8–128 characters.',
  passwordMismatchError: 'Passwords do not match.',
  submitLabel: 'Create admin account',
  submittingLabel: 'Creating account…',
  toggleVisibilityLabel: 'Toggle input visibility',
  signInLinkPrompt: 'Already initialized?',
  signInLinkLabel: 'Go to sign in',
  closedAlertTitle: 'Setup already completed',
  closedAlertBody:
    'This ArcDrop instance already has an administrator account. Initial setup can only run once.',
  closedActionLabel: 'Go to sign in',
  bootstrappedSnackbar: 'Administrator account created.',
} as const;
