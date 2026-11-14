import BookmarksOutlinedIcon from '@mui/icons-material/BookmarksOutlined';
import CheckCircleOutlineOutlinedIcon from '@mui/icons-material/CheckCircleOutlineOutlined';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import type { ReactNode } from 'react';
import { AUTH_SHELL_STRINGS } from '../strings';
import { ThemeSwitcher } from './ThemeSwitcher';

export interface AuthPageShellProps {
  title: string;
  subtitle: string;
  brandLabel?: string;
  themeSwitcherLabel?: string;
  children: ReactNode;
}

/**
 * Split-screen auth layout: a themed brand panel (desktop) beside a centered
 * form card, with the theme switcher available on every breakpoint.
 */
export function AuthPageShell({
  title,
  subtitle,
  brandLabel = 'ArcDrop',
  themeSwitcherLabel = 'Switch theme',
  children,
}: AuthPageShellProps) {
  const theme = useTheme();

  return (
    <Box
      component="main"
      sx={{ minHeight: '100vh', display: 'flex', bgcolor: 'background.default' }}
    >
      <Stack
        aria-hidden
        sx={{
          display: { xs: 'none', lg: 'flex' },
          width: '44%',
          maxWidth: 640,
          flexShrink: 0,
          flexDirection: 'column',
          justifyContent: 'space-between',
          p: { lg: 5, xl: 7 },
          color: 'primary.contrastText',
          background: `linear-gradient(155deg, ${theme.palette.primary.dark} 0%, ${theme.palette.primary.main} 55%, ${theme.palette.secondary.main} 130%)`,
          position: 'relative',
          overflow: 'hidden',
          '&::after': {
            content: '""',
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(circle at 85% 15%, rgba(255,255,255,0.14) 0%, transparent 42%), radial-gradient(circle at 10% 90%, rgba(255,255,255,0.10) 0%, transparent 48%)',
            pointerEvents: 'none',
          },
        }}
      >
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <BookmarksOutlinedIcon fontSize="large" />
          <Typography variant="h6" component="span" sx={{ fontWeight: 700 }}>
            {brandLabel}
          </Typography>
        </Stack>

        <Stack spacing={2.5} sx={{ position: 'relative' }}>
          <Typography variant="h3" component="p" sx={{ fontWeight: 700, lineHeight: 1.15 }}>
            {AUTH_SHELL_STRINGS.tagline}
          </Typography>
          <Typography variant="body1" sx={{ color: 'rgba(255,255,255,0.82)', maxWidth: 460 }}>
            {AUTH_SHELL_STRINGS.taglineSupport}
          </Typography>
          <Divider sx={{ borderColor: 'rgba(255,255,255,0.28)', width: 72, mt: 0.5 }} />
          <Stack spacing={1.5} sx={{ mt: 1 }}>
            {AUTH_SHELL_STRINGS.highlights.map((item) => (
              <Stack key={item} direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                <CheckCircleOutlineOutlinedIcon fontSize="small" />
                <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.9)' }}>
                  {item}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Stack>

        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.65)' }}>
          {AUTH_SHELL_STRINGS.footerNote}
        </Typography>
      </Stack>

      <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Box
          component="header"
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: { xs: 'space-between', lg: 'flex-end' },
            gap: 1.5,
            px: { xs: 2, sm: 3 },
            py: 2,
          }}
        >
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center', display: { xs: 'flex', lg: 'none' } }}
          >
            <BookmarksOutlinedIcon color="primary" />
            <Typography variant="h6" component="span">
              {brandLabel}
            </Typography>
          </Stack>
          <ThemeSwitcher label={themeSwitcherLabel} />
        </Box>

        <Container
          maxWidth="sm"
          sx={{
            flexGrow: 1,
            display: 'flex',
            alignItems: { xs: 'flex-start', sm: 'center' },
            justifyContent: 'center',
            py: { xs: 3, sm: 5 },
          }}
        >
          <Paper
            variant="outlined"
            sx={{ width: '100%', maxWidth: 440, p: { xs: 3, sm: 4 }, borderRadius: 3 }}
          >
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
    </Box>
  );
}
