import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { ApiTokensSection } from './components/ApiTokensSection';
import { DangerZoneSection } from './components/DangerZoneSection';
import { DesktopSection } from './components/DesktopSection';
import { NotificationsSection } from './components/NotificationsSection';
import { ProfileSection } from './components/ProfileSection';
import { ServerSection } from './components/ServerSection';
import { SessionsSection } from './components/SessionsSection';
import { TwoFactorSection } from './components/TwoFactorSection';
import { SETTINGS_PAGE_STRINGS as S } from './strings';

type SettingsTab = 'profile' | 'security' | 'notifications' | 'tokens';

export default function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>('profile');

  return (
    <Stack spacing={3} data-testid="settings-page">
      <Typography variant="h4">{S.title}</Typography>
      <Tabs
        value={tab}
        onChange={(_, next: SettingsTab) => setTab(next)}
        data-testid="settings-tabs"
      >
        <Tab value="profile" label={S.tabs.profile} />
        <Tab value="security" label={S.tabs.security} />
        <Tab value="notifications" label={S.tabs.notifications} />
        <Tab value="tokens" label={S.tabs.tokens} />
      </Tabs>
      <Box>
        {tab === 'profile' ? (
          <Stack spacing={3}>
            <ProfileSection />
            <ServerSection />
            <DesktopSection />
          </Stack>
        ) : null}
        {tab === 'security' ? (
          <Stack spacing={3}>
            <TwoFactorSection />
            <SessionsSection />
          </Stack>
        ) : null}
        {tab === 'notifications' ? <NotificationsSection /> : null}
        {tab === 'tokens' ? <ApiTokensSection /> : null}
      </Box>
      <DangerZoneSection />
    </Stack>
  );
}
