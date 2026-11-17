import { Container, Stack, Typography } from '@mui/material';
import { strings } from '../shared/strings';

export function App() {
  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Stack spacing={1}>
        <Typography variant="h5" component="h1">
          {strings.appName}
        </Typography>
        <Typography variant="body1" color="text.secondary">
          {strings.options.placeholderBody}
        </Typography>
      </Stack>
    </Container>
  );
}
