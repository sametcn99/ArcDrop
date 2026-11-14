import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { AuditSection } from './components/AuditSection';
import { SettingsSection } from './components/SettingsSection';
import { UsersSection } from './components/UsersSection';
import { ADMIN_PAGE_STRINGS as S } from './strings';

type AdminTab = 'users' | 'settings' | 'audit';

export default function AdminPage() {
  const [tab, setTab] = useState<AdminTab>('users');

  return (
    <Stack spacing={3} data-testid="admin-page">
      <Typography variant="h4">{S.title}</Typography>
      <Tabs value={tab} onChange={(_, next: AdminTab) => setTab(next)} data-testid="admin-tabs">
        <Tab value="users" label={S.tabs.users} />
        <Tab value="settings" label={S.tabs.settings} />
        <Tab value="audit" label={S.tabs.audit} />
      </Tabs>
      <Box>
        {tab === 'users' ? <UsersSection /> : null}
        {tab === 'settings' ? <SettingsSection /> : null}
        {tab === 'audit' ? <AuditSection /> : null}
      </Box>
    </Stack>
  );
}
