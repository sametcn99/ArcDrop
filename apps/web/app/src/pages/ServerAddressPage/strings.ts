export const SERVER_ADDRESS_PAGE_STRINGS = {
  title: 'Connect to your server',
  subtitle:
    'Enter the address of your ArcDrop server to continue. You can change it later in Settings.',
  addressLabel: 'Server address',
  addressPlaceholder: 'https://arcdrop.example.com',
  addressHelper: 'Example: https://arcdrop.example.com',
  connectLabel: 'Connect',
  connectingLabel: 'Connecting…',
  errorInvalidUrl: 'Enter a valid server address, e.g. https://arcdrop.example.com.',
  errorUnreachable: 'Could not reach the server. Check the address and your network connection.',
  errorNotArcDrop: 'The server answered, but it does not look like an ArcDrop server.',
} as const;
