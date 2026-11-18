import { Box, CircularProgress, Stack, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { sendAuthMessage } from '../shared/messages';
import { strings } from '../shared/strings';
import { ConnectedStep } from './ConnectedStep';
import { LoginStep } from './LoginStep';
import { SetupStep } from './SetupStep';
import { TotpStep } from './TotpStep';

type Step =
  | { name: 'loading' }
  | { name: 'setup'; baseUrl: string }
  | { name: 'login'; baseUrl: string }
  | { name: 'totp'; baseUrl: string; challenge: string; expiresAt: string }
  | { name: 'connected'; baseUrl: string; email: string };

export function App() {
  const [step, setStep] = useState<Step>({ name: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void sendAuthMessage({ type: 'auth/state' })
      .then((response) => {
        if (cancelled || !response.ok || response.kind !== 'state') return;
        if (response.connected && response.baseUrl && response.email) {
          setStep({ name: 'connected', baseUrl: response.baseUrl, email: response.email });
        } else if (response.baseUrl) {
          setStep({ name: 'login', baseUrl: response.baseUrl });
        } else {
          setStep({ name: 'setup', baseUrl: '' });
        }
      })
      .catch(() => {
        if (!cancelled) setStep({ name: 'setup', baseUrl: '' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Box sx={{ p: 2, width: 320 }}>
      {step.name === 'loading' ? (
        <Stack spacing={1} sx={{ py: 4, alignItems: 'center' }}>
          <CircularProgress size={28} />
          <Typography variant="body2" color="text.secondary">
            {strings.popup.connecting}
          </Typography>
        </Stack>
      ) : step.name === 'setup' ? (
        <SetupStep
          initialUrl={step.baseUrl}
          onValidated={(baseUrl) => setStep({ name: 'login', baseUrl })}
        />
      ) : step.name === 'login' ? (
        <LoginStep
          baseUrl={step.baseUrl}
          onAuthenticated={(baseUrl, email) => setStep({ name: 'connected', baseUrl, email })}
          onTotpRequired={(baseUrl, challenge, expiresAt) =>
            setStep({ name: 'totp', baseUrl, challenge, expiresAt })
          }
          onChangeServer={(baseUrl) => setStep({ name: 'setup', baseUrl })}
        />
      ) : step.name === 'totp' ? (
        <TotpStep
          baseUrl={step.baseUrl}
          challenge={step.challenge}
          onAuthenticated={(baseUrl, email) => setStep({ name: 'connected', baseUrl, email })}
          onBack={(baseUrl) => setStep({ name: 'login', baseUrl })}
        />
      ) : (
        <ConnectedStep
          baseUrl={step.baseUrl}
          email={step.email}
          onDisconnected={() =>
            setStep((current) => ({
              name: 'setup',
              baseUrl: current.name === 'connected' ? current.baseUrl : '',
            }))
          }
        />
      )}
    </Box>
  );
}
