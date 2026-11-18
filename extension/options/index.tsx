import { createRoot } from 'react-dom/client';
import { OptionsApp, type OptionsBoot } from './OptionsApp';
import { readVault, chromeStorageLocal } from '../shared/vault';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Options root element is missing');
}

void (async (): Promise<void> => {
  // Hydrate before mount so the page renders with the saved theme.
  const vault = await readVault(chromeStorageLocal());
  const boot: OptionsBoot = {
    settings: vault.settings,
    baseUrl: vault.baseUrl,
    email: vault.user?.email ?? null,
  };
  createRoot(container).render(<OptionsApp boot={boot} />);
})();
