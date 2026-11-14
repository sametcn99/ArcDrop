import { APP_STRINGS } from '../../app/strings';
import { AuthPageShell } from '../../shared/components/AuthPageShell';
import { BootstrapClosedNotice } from './components/BootstrapClosedNotice';
import { BootstrapForm } from './components/BootstrapForm';
import { useBootstrapForm } from './hooks/useBootstrapForm';
import { BOOTSTRAP_PAGE_STRINGS } from './strings';

export default function BootstrapPage() {
  const form = useBootstrapForm();

  return (
    <AuthPageShell
      title={BOOTSTRAP_PAGE_STRINGS.title}
      subtitle={BOOTSTRAP_PAGE_STRINGS.subtitle}
      brandLabel={APP_STRINGS.brand}
      themeSwitcherLabel={APP_STRINGS.themeSwitcherLabel}
    >
      {form.bootstrapClosed ? (
        <BootstrapClosedNotice detail={form.errorMessage} />
      ) : (
        <BootstrapForm
          email={form.email}
          onEmailChange={form.setEmail}
          password={form.password}
          onPasswordChange={form.setPassword}
          confirmPassword={form.confirmPassword}
          onConfirmPasswordChange={form.setConfirmPassword}
          fieldErrors={form.fieldErrors}
          errorMessage={form.errorMessage}
          submitting={form.submitting}
          onSubmit={(e) => void form.handleSubmit(e)}
        />
      )}
    </AuthPageShell>
  );
}
