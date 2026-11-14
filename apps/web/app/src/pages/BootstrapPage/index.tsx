import { PlaceholderPage } from '../../shared/components/PlaceholderPage';
import { BOOTSTRAP_PAGE_STRINGS } from './strings';

export default function BootstrapPage() {
  return (
    <PlaceholderPage
      title={BOOTSTRAP_PAGE_STRINGS.title}
      description={BOOTSTRAP_PAGE_STRINGS.description}
      milestone={BOOTSTRAP_PAGE_STRINGS.milestone}
    />
  );
}
