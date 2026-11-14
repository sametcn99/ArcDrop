import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { SHARED_SEARCH_STRINGS } from '../strings';

export interface SearchEmptyStateProps {
  onClearSearchAndFilters: () => void;
  onSelectExample?: (example: string) => void;
}

const GRAMMAR_HINTS = [
  'match:OR',
  '#tag',
  '-exclude',
  '"exact phrase"',
  'type:video',
  'title:guide',
  'notag:true',
  'created:>=2026-01-01',
] as const;

export function SearchEmptyState({
  onClearSearchAndFilters,
  onSelectExample,
}: SearchEmptyStateProps) {
  return (
    <Paper variant="outlined" data-testid="search-empty-state" sx={{ p: 4, textAlign: 'center' }}>
      <Stack spacing={1.5} sx={{ alignItems: 'center', maxWidth: 560, mx: 'auto' }}>
        <Typography variant="h6">{SHARED_SEARCH_STRINGS.emptyResultsTitle}</Typography>
        <Typography variant="body2" color="text.secondary">
          {SHARED_SEARCH_STRINGS.emptyResultsDescription}
        </Typography>

        <Typography variant="caption" color="text.secondary" sx={{ pt: 1, fontWeight: 600 }}>
          {SHARED_SEARCH_STRINGS.emptyHintsHeading}
        </Typography>

        <Stack
          direction="row"
          spacing={0.75}
          sx={{ justifyContent: 'center', flexWrap: 'wrap', gap: 0.75 }}
        >
          {GRAMMAR_HINTS.map((hint) => (
            <Chip
              key={hint}
              size="small"
              variant="outlined"
              label={hint}
              onClick={onSelectExample ? () => onSelectExample(hint) : undefined}
              sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
            />
          ))}
        </Stack>

        <Button variant="outlined" size="small" onClick={onClearSearchAndFilters} sx={{ mt: 1 }}>
          {SHARED_SEARCH_STRINGS.emptyClearAction}
        </Button>
      </Stack>
    </Paper>
  );
}
