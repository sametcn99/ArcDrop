import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router';
import { APP_STRINGS } from './strings';

export function RouteLoader() {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '50vh',
      }}
    >
      <CircularProgress aria-label={APP_STRINGS.loadingRouteLabel} />
    </Box>
  );
}

export function NotFoundPage() {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
        p: 2,
      }}
    >
      <Paper variant="outlined" sx={{ maxWidth: 480, width: '100%', p: 4 }}>
        <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
          <Typography variant="h2" component="h1">
            {APP_STRINGS.notFoundTitle}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {APP_STRINGS.notFoundDescription}
          </Typography>
          <Button component={RouterLink} to="/" variant="contained">
            {APP_STRINGS.notFoundAction}
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
