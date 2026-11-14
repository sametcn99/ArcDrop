import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import type { AuditLogFilters } from '../../../api/schemas/admin';
import { useAuditLog } from '../hooks/useAdminData';
import { ADMIN_PAGE_STRINGS as S } from '../strings';

interface FilterDraft {
  action: string;
  actorType: '' | 'jwt' | 'pat';
  outcome: '' | 'ok' | 'error';
  subject: string;
}

const EMPTY_FILTERS: FilterDraft = { action: '', actorType: '', outcome: '', subject: '' };

export function AuditSection() {
  const { entries, totalCount, page, pageSize, loading, error, fetchPage } = useAuditLog();
  const [draft, setDraft] = useState<FilterDraft>(EMPTY_FILTERS);

  const buildFilters = (nextPage?: number): AuditLogFilters => {
    const filters: AuditLogFilters = {};
    if (draft.action.trim()) filters.action = draft.action.trim();
    if (draft.actorType) filters.actorType = draft.actorType;
    if (draft.outcome) filters.outcome = draft.outcome;
    if (draft.subject.trim()) filters.subject = draft.subject.trim();
    if (nextPage !== undefined) filters.page = nextPage;
    return filters;
  };

  return (
    <Card variant="outlined" data-testid="admin-audit-section">
      <CardContent>
        <Typography variant="h6">{S.audit.heading}</Typography>
        <Stack direction="row" spacing={2} sx={{ mt: 2, rowGap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            size="small"
            label={S.audit.filterAction}
            value={draft.action}
            onChange={(e) => setDraft((prev) => ({ ...prev, action: e.target.value }))}
            sx={{ minWidth: 200 }}
            data-testid="admin-audit-filter-action"
          />
          <TextField
            size="small"
            select
            label={S.audit.filterActorType}
            value={draft.actorType}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, actorType: e.target.value as FilterDraft['actorType'] }))
            }
            sx={{ minWidth: 120 }}
          >
            <MenuItem value="">any</MenuItem>
            <MenuItem value="jwt">jwt</MenuItem>
            <MenuItem value="pat">pat</MenuItem>
          </TextField>
          <TextField
            size="small"
            select
            label={S.audit.filterOutcome}
            value={draft.outcome}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, outcome: e.target.value as FilterDraft['outcome'] }))
            }
            sx={{ minWidth: 120 }}
          >
            <MenuItem value="">any</MenuItem>
            <MenuItem value="ok">ok</MenuItem>
            <MenuItem value="error">error</MenuItem>
          </TextField>
          <TextField
            size="small"
            label={S.audit.filterSubject}
            value={draft.subject}
            onChange={(e) => setDraft((prev) => ({ ...prev, subject: e.target.value }))}
            sx={{ minWidth: 180 }}
            data-testid="admin-audit-filter-subject"
          />
          <Button
            size="small"
            variant="contained"
            onClick={() => void fetchPage(buildFilters())}
            data-testid="admin-audit-apply"
          >
            {S.audit.apply}
          </Button>
          <Button
            size="small"
            onClick={() => {
              setDraft(EMPTY_FILTERS);
              void fetchPage({});
            }}
          >
            {S.audit.clear}
          </Button>
        </Stack>
        {error ? (
          <Typography color="error" variant="body2" sx={{ mt: 1 }}>
            {error}
          </Typography>
        ) : null}
        <TableContainer sx={{ mt: 2 }}>
          <Table size="small" data-testid="admin-audit-table">
            <TableHead>
              <TableRow>
                <TableCell>Time</TableCell>
                <TableCell>Actor</TableCell>
                <TableCell>Action</TableCell>
                <TableCell>Subject</TableCell>
                <TableCell>Outcome</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? null : entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Typography variant="body2" color="text.secondary">
                      {S.audit.empty}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{new Date(entry.createdAt).toLocaleString()}</TableCell>
                    <TableCell>{entry.actorType}</TableCell>
                    <TableCell>{entry.action}</TableCell>
                    <TableCell>{entry.subject ?? '—'}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={entry.outcome === 'ok' ? 'success' : 'error'}
                        label={entry.outcome}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={totalCount}
          page={page - 1}
          onPageChange={(_, nextPage) => void fetchPage(buildFilters(nextPage + 1))}
          rowsPerPage={pageSize}
          rowsPerPageOptions={[pageSize]}
          data-testid="admin-audit-pagination"
        />
      </CardContent>
    </Card>
  );
}
