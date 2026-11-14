import { APP_STRINGS } from '../../app/strings';
import { AuthPageShell } from '../../shared/components/AuthPageShell';
import { CredentialsStep } from './components/CredentialsStep';
import { TotpStep } from './components/TotpStep';
import { useLoginFlow } from './hooks/useLoginFlow';
import { LOGIN_PAGE_STRINGS } from './strings';

export default function LoginPage() {
  const flow = useLoginFlow();

  const title = flow.isTotpStep ? LOGIN_PAGE_STRINGS.tfaTitle : LOGIN_PAGE_STRINGS.title;
  const subtitle = flow.isTotpStep
    ? `${LOGIN_PAGE_STRINGS.tfaSubtitlePrefix} ${flow.tfaEmail}`
    : LOGIN_PAGE_STRINGS.subtitle;

  return (
    <AuthPageShell
      title={title}
      subtitle={subtitle}
      brandLabel={APP_STRINGS.brand}
      themeSwitcherLabel={APP_STRINGS.themeSwitcherLabel}
    >
      {flow.isTotpStep ? (
        <TotpStep
          errorMessage={flow.errorMessage}
          submitting={flow.submitting}
          onSubmit={(input) => void flow.handleTotpSubmit(input)}
          onBack={flow.handleBackToCredentials}
        />
      ) : (
        <CredentialsStep
          errorMessage={flow.errorMessage}
          submitting={flow.submitting}
          onSubmit={(input) => void flow.handleCredentialsSubmit(input)}
        />
      )}
    </AuthPageShell>
  );
}
