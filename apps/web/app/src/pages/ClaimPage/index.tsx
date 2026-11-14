import { APP_STRINGS } from '../../app/strings';
import { AuthPageShell } from '../../shared/components/AuthPageShell';
import { ClaimForm } from './components/ClaimForm';
import { useClaimForm } from './hooks/useClaimForm';
import { CLAIM_PAGE_STRINGS } from './strings';

export default function ClaimPage() {
  const form = useClaimForm();

  return (
    <AuthPageShell
      title={CLAIM_PAGE_STRINGS.title}
      subtitle={CLAIM_PAGE_STRINGS.subtitle}
      brandLabel={APP_STRINGS.brand}
      themeSwitcherLabel={APP_STRINGS.themeSwitcherLabel}
    >
      <ClaimForm
        urlToken={form.urlToken}
        hasTokenFromUrl={form.hasTokenFromUrl}
        errorState={form.errorState}
        submitting={form.submitting}
        onSubmit={(input) => void form.handleSubmit(input)}
      />
    </AuthPageShell>
  );
}
