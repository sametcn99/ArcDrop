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
        token={form.token}
        onTokenChange={form.setToken}
        hasTokenFromUrl={form.hasTokenFromUrl}
        password={form.password}
        onPasswordChange={form.setPassword}
        confirmPassword={form.confirmPassword}
        onConfirmPasswordChange={form.setConfirmPassword}
        fieldErrors={form.fieldErrors}
        errorState={form.errorState}
        submitting={form.submitting}
        onSubmit={(e) => void form.handleSubmit(e)}
      />
    </AuthPageShell>
  );
}
