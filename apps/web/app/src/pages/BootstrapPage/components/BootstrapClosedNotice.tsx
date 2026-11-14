import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import { Link as RouterLink } from 'react-router';
import { BOOTSTRAP_PAGE_STRINGS } from '../strings';

export interface BootstrapClosedNoticeProps {
  detail?: string | null;
}

export function BootstrapClosedNotice({ detail }: BootstrapClosedNoticeProps) {
  return (
    <Stack spacing={2.5}>
      <Alert severity="warning" role="status">
        <AlertTitle>{BOOTSTRAP_PAGE_STRINGS.closedAlertTitle}</AlertTitle>
        {detail || BOOTSTRAP_PAGE_STRINGS.closedAlertBody}
      </Alert>

      <Button component={RouterLink} to="/login" variant="contained" size="large" fullWidth>
        {BOOTSTRAP_PAGE_STRINGS.closedActionLabel}
      </Button>
    </Stack>
  );
}
