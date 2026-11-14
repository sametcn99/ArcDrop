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
          code={flow.code}
          onCodeChange={flow.setCode}
          useRecoveryCode={flow.useRecoveryCode}
          onToggleRecoveryMode={flow.handleToggleRecoveryMode}
          fieldErrors={flow.fieldErrors}
          errorMessage={flow.errorMessage}
          submitting={flow.submitting}
          onSubmit={(e) => void flow.handleTotpSubmit(e)}
          onBack={flow.handleBackToCredentials}
        />
      ) : (
        <CredentialsStep
          email={flow.email}
          onEmailChange={flow.setEmail}
          password={flow.password}
          onPasswordChange={flow.setPassword}
          fieldErrors={flow.fieldErrors}
          errorMessage={flow.errorMessage}
          submitting={flow.submitting}
          onSubmit={(e) => void flow.handleCredentialsSubmit(e)}
        />
      )}
    </AuthPageShell>
  );
}
