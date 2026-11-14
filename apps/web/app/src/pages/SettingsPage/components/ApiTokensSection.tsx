import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { apiClient } from '../../../api/client';
import { OnceTokenDialog } from '../../../shared/components/OnceTokenDialog';
import { createTokenAction, revokeTokenAction } from '../actions/settingsActions';
import { usePersonalTokens } from '../hooks/useSettingsData';
import { SETTINGS_PAGE_STRINGS as S } from '../strings';

function agentSnippet(token: string): string {
  const base = apiClient.getBaseUrl() || window.location.origin;
  const url = `${base}/api/v1/mcp`;
  return JSON.stringify(
    {
      mcpServers: {
        arcdrop: {
          type: 'http',
          url,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
}

export function ApiTokensSection() {
  const { tokens, loading, error, refresh } = usePersonalTokens();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [readOnly, setReadOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [snippetOpen, setSnippetOpen] = useState(false);

  const handleSnippetClose = () => {
    setSnippetOpen(false);
    setCreated(null);
  };

  const handleCreate = async () => {
    setBusy(true);
    const result = await createTokenAction({ name: name.trim(), readOnly });
    setBusy(false);
    if (result) {
      setCreated(result.token);
      setCreateOpen(false);
      setName('');
      setReadOnly(false);
      await refresh();
    }
  };

  const handleRevoke = async (tokenId: string) => {
    const ok = await revokeTokenAction(tokenId);
    if (ok) {
      await refresh();
    }
  };

  return (
    <Card variant="outlined" data-testid="settings-tokens-section">
      <CardContent>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
        >
          <Typography variant="h6">{S.tokens.heading}</Typography>
          <Button
            variant="contained"
            size="small"
            startIcon={<AddOutlinedIcon />}
            onClick={() => setCreateOpen(true)}
            data-testid="settings-tokens-create"
          >
            {S.tokens.createButton}
          </Button>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {S.tokens.description}
        </Typography>
        {error ? (
          <Typography color="error" variant="body2" sx={{ mt: 1 }}>
            {error}
          </Typography>
        ) : null}
        {loading ? (
          <Stack spacing={1} sx={{ mt: 2 }}>
            <Skeleton variant="rounded" height={48} />
            <Skeleton variant="rounded" height={48} />
          </Stack>
        ) : tokens.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            {S.tokens.empty}
          </Typography>
        ) : (
          <List sx={{ mt: 1 }}>
            {tokens.map((token, index) => (
              <Stack key={token.id}>
                {index > 0 ? <Divider component="li" /> : null}
                <ListItem
                  secondaryAction={
                    token.revokedAt ? (
                      <Chip size="small" label={S.tokens.revoked} />
                    ) : (
                      <Button
                        size="small"
                        color="error"
                        onClick={() => void handleRevoke(token.id)}
                        data-testid={`settings-tokens-revoke-${token.id}`}
                      >
                        {S.tokens.revoke}
                      </Button>
                    )
                  }
                >
                  <Stack spacing={0.5}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <Typography variant="body1">{token.name}</Typography>
                      {token.readOnly ? (
                        <Chip size="small" variant="outlined" label="read-only" />
                      ) : null}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {token.lastUsedAt
                        ? `Last used ${new Date(token.lastUsedAt).toLocaleString()}`
                        : S.tokens.neverUsed}
                    </Typography>
                  </Stack>
                </ListItem>
              </Stack>
            ))}
          </List>
        )}
      </CardContent>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{S.tokens.createButton}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label={S.tokens.nameField}
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
              autoFocus
            />
            <FormControlLabel
              control={
                <Switch checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} />
              }
              label={S.tokens.readOnlyField}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={busy || name.trim() === ''}
            data-testid="settings-tokens-create-confirm"
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {created !== null ? (
        <OnceTokenDialog
          open={!snippetOpen}
          title={S.tokens.heading}
          description={S.tokens.createdOnce}
          secrets={[created]}
          onConfirm={() => setSnippetOpen(true)}
        />
      ) : null}
      {created !== null ? (
        <Dialog
          open={snippetOpen}
          onClose={handleSnippetClose}
          maxWidth="sm"
          fullWidth
          data-testid="settings-tokens-snippet-dialog"
        >
          <DialogTitle>{S.tokens.snippetTitle}</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Paste this into Claude Desktop or Cursor MCP settings:
            </Typography>
            <Box
              sx={{
                p: 1.5,
                borderRadius: 1,
                bgcolor: 'action.hover',
                fontFamily: 'mono.fontFamily',
                fontSize: '0.8rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
              data-testid="settings-tokens-snippet"
            >
              {agentSnippet(created)}
            </Box>
          </DialogContent>
          <DialogActions>
            <Button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(agentSnippet(created));
                } catch {
                  // clipboard may be unavailable; the block stays selectable
                }
              }}
              data-testid="settings-tokens-snippet-copy"
            >
              {S.tokens.snippetCopy}
            </Button>
            <Button variant="contained" onClick={handleSnippetClose}>
              Done
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}
    </Card>
  );
}
