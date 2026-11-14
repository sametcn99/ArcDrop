import { PlaceholderPage } from '../../shared/components/PlaceholderPage';
import { ADMIN_PAGE_STRINGS } from './strings';

export default function AdminPage() {
  return (
    <PlaceholderPage
      title={ADMIN_PAGE_STRINGS.title}
      description={ADMIN_PAGE_STRINGS.description}
      milestone={ADMIN_PAGE_STRINGS.milestone}
    />
  );
}
