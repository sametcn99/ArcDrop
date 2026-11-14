import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import ReactMarkdown, { type Components } from 'react-markdown';

export interface MarkdownPreviewProps {
  markdown: string;
}

const markdownComponents: Components = {
  h1: ({ children }) => (
    <Typography variant="h5" component="h1" gutterBottom sx={{ fontWeight: 700, mt: 1 }}>
      {children}
    </Typography>
  ),
  h2: ({ children }) => (
    <Typography variant="h6" component="h2" gutterBottom sx={{ fontWeight: 600, mt: 1 }}>
      {children}
    </Typography>
  ),
  h3: ({ children }) => (
    <Typography variant="subtitle1" component="h3" gutterBottom sx={{ fontWeight: 600, mt: 1 }}>
      {children}
    </Typography>
  ),
  h4: ({ children }) => (
    <Typography variant="subtitle2" component="h4" gutterBottom sx={{ fontWeight: 600, mt: 0.75 }}>
      {children}
    </Typography>
  ),
  h5: ({ children }) => (
    <Typography variant="subtitle2" component="h5" gutterBottom sx={{ fontWeight: 600 }}>
      {children}
    </Typography>
  ),
  h6: ({ children }) => (
    <Typography
      variant="caption"
      component="h6"
      gutterBottom
      sx={{ fontWeight: 600, display: 'block' }}
    >
      {children}
    </Typography>
  ),
  p: ({ children }) => (
    <Typography variant="body2" component="p" sx={{ mb: 1, '&:last-child': { mb: 0 } }}>
      {children}
    </Typography>
  ),
  a: ({ href, children }) => (
    <Link href={href} target="_blank" rel="noopener noreferrer" underline="hover">
      {children}
    </Link>
  ),
  ul: ({ children }) => (
    <Box component="ul" sx={{ pl: 2.5, my: 0.75 }}>
      {children}
    </Box>
  ),
  ol: ({ children }) => (
    <Box component="ol" sx={{ pl: 2.5, my: 0.75 }}>
      {children}
    </Box>
  ),
  li: ({ children }) => (
    <Typography component="li" variant="body2" sx={{ mb: 0.25 }}>
      {children}
    </Typography>
  ),
  blockquote: ({ children }) => (
    <Paper
      variant="outlined"
      sx={{
        px: 1.5,
        py: 0.75,
        my: 1,
        borderLeftWidth: 3,
        borderLeftColor: 'primary.main',
        bgcolor: 'action.hover',
      }}
    >
      {children}
    </Paper>
  ),
  pre: ({ children }) => (
    <Paper
      variant="outlined"
      component="pre"
      sx={{
        p: 1.25,
        my: 1,
        overflowX: 'auto',
        bgcolor: 'action.hover',
        fontFamily: 'monospace',
        fontSize: '0.8125rem',
      }}
    >
      {children}
    </Paper>
  ),
  code: ({ children }) => (
    <Typography
      component="code"
      variant="body2"
      sx={{
        fontFamily: 'monospace',
        bgcolor: 'action.hover',
        px: 0.5,
        borderRadius: 0.5,
      }}
    >
      {children}
    </Typography>
  ),
  hr: () => <Divider sx={{ my: 1.5 }} />,
  strong: ({ children }) => (
    <Typography component="strong" variant="inherit" sx={{ fontWeight: 700 }}>
      {children}
    </Typography>
  ),
  em: ({ children }) => (
    <Typography component="em" variant="inherit" sx={{ fontStyle: 'italic' }}>
      {children}
    </Typography>
  ),
};

export function MarkdownPreview({ markdown }: MarkdownPreviewProps) {
  return (
    <Box data-testid="markdown-preview" sx={{ wordBreak: 'break-word' }}>
      <ReactMarkdown components={markdownComponents}>{markdown}</ReactMarkdown>
    </Box>
  );
}
