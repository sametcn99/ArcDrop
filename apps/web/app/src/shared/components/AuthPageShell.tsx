import BookmarksOutlinedIcon from '@mui/icons-material/BookmarksOutlined';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import { ThemeSwitcher } from './ThemeSwitcher';

export interface AuthPageShellProps {
  title: string;
  subtitle: string;
  brandLabel?: string;
  themeSwitcherLabel?: string;
  children: ReactNode;
}

export function AuthPageShell({
  title,
  subtitle,
  brandLabel = 'ArcDrop',
  themeSwitcherLabel = 'Switch theme',
  children,
}: AuthPageShellProps) {
  return (
    <Box
      component="main"
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.default',
      }}
    >
      <Box
        component="header"
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: { xs: 2, sm: 3 },
          py: 2,
        }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <BookmarksOutlinedIcon color="primary" />
          <Typography variant="h6" component="span">
            {brandLabel}
          </Typography>
        </Stack>
        <ThemeSwitcher label={themeSwitcherLabel} />
      </Box>

      <Container
        maxWidth="xs"
        sx={{
          flexGrow: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          py: 4,
        }}
      >
        <Paper variant="outlined" sx={{ width: '100%', p: { xs: 3, sm: 4 } }}>
          <Stack spacing={3}>
            <Stack spacing={0.75}>
              <Typography variant="h2" component="h1">
                {title}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {subtitle}
              </Typography>
            </Stack>
            {children}
          </Stack>
        </Paper>
      </Container>
    </Box>
  );
}
