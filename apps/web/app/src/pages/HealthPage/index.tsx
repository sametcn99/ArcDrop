import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { BrokenLinksSection } from './components/BrokenLinksSection';
import { DuplicatesSection } from './components/DuplicatesSection';
import { useHealthPage } from './hooks/useHealthPage';
import { HEALTH_PAGE_STRINGS } from './strings';

type HealthTab = 'duplicates' | 'broken';

export default function HealthPage() {
  const {
    duplicateGroups,
    brokenBookmarks,
    checkMode,
    modeFromSettings,
    loading,
    error,
    resolvingUrl,
    recheckingId,
    resolvedBanner,
    dismissResolvedBanner,
    refresh,
    resolveGroup,
    recheckBrokenBookmark,
  } = useHealthPage();

  const [activeTab, setActiveTab] = useState<HealthTab>('duplicates');

  return (
    <Stack spacing={3}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
      >
        <Box>
          <Typography variant="h4" component="h1">
            {HEALTH_PAGE_STRINGS.title}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {HEALTH_PAGE_STRINGS.subtitle}
          </Typography>
        </Box>

        <Button
          variant="outlined"
          startIcon={<RefreshOutlinedIcon fontSize="small" />}
          disabled={loading}
          onClick={refresh}
        >
          {HEALTH_PAGE_STRINGS.refreshLabel}
        </Button>
      </Stack>

      {resolvedBanner ? (
        <Alert
          severity="success"
          onClose={dismissResolvedBanner}
          data-testid="health-resolved-alert"
        >
          {resolvedBanner}
        </Alert>
      ) : null}

      {error ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={refresh}>
              {HEALTH_PAGE_STRINGS.errorRetryLabel}
            </Button>
          }
        >
          {error}
        </Alert>
      ) : null}

      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs
          value={activeTab}
          onChange={(_e, next: HealthTab) => setActiveTab(next)}
          aria-label={HEALTH_PAGE_STRINGS.title}
        >
          <Tab
            value="duplicates"
            label={`${HEALTH_PAGE_STRINGS.tabDuplicates} (${duplicateGroups.length})`}
          />
          <Tab
            value="broken"
            label={`${HEALTH_PAGE_STRINGS.tabBrokenLinks} (${brokenBookmarks.length})`}
          />
        </Tabs>
      </Box>

      {loading ? (
        <Stack spacing={1.5} data-testid="health-loading">
          <Skeleton variant="rounded" height={120} />
          <Skeleton variant="rounded" height={120} />
        </Stack>
      ) : activeTab === 'duplicates' ? (
        <DuplicatesSection
          groups={duplicateGroups}
          resolvingUrl={resolvingUrl}
          onResolve={resolveGroup}
        />
      ) : (
        <BrokenLinksSection
          items={brokenBookmarks}
          checkMode={checkMode}
          modeFromSettings={modeFromSettings}
          recheckingId={recheckingId}
          onRecheck={recheckBrokenBookmark}
        />
      )}
    </Stack>
  );
}
