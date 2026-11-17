import { Box, Stack, Typography } from '@mui/material';
import { strings } from '../shared/strings';

export function App() {
  return (
    <Box sx={{ p: 2, width: 320 }}>
      <Stack spacing={1}>
        <Typography variant="h6" component="h1">
          {strings.appName}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {strings.popup.placeholderBody}
        </Typography>
      </Stack>
    </Box>
  );
}
