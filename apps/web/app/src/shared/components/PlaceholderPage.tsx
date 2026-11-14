import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

export interface PlaceholderPageProps {
  title: string;
  description: string;
  milestone: string;
}

export function PlaceholderPage({ title, description, milestone }: PlaceholderPageProps) {
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
      <Paper variant="outlined" sx={{ maxWidth: 520, width: '100%', p: 4 }}>
        <Stack spacing={2}>
          <Stack
            direction="row"
            spacing={1.5}
            sx={{ alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Typography variant="h2" component="h1">
              {title}
            </Typography>
            <Chip label={milestone} size="small" color="primary" variant="outlined" />
          </Stack>
          <Typography variant="body1" color="text.secondary">
            {description}
          </Typography>
        </Stack>
      </Paper>
    </Box>
  );
}
