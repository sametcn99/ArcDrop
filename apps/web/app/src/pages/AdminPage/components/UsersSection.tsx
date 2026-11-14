import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import Table from '@mui/material/Table';
import type { OneTimeToken } from '../../../api/schemas/admin';
import { OnceTokenDialog } from '../../../shared/components/OnceTokenDialog';
import {
  createUserAction,
  resetUserPasswordAction,
  updateUserStatusAction,
} from '../actions/adminActions';
import { useAdminUsers } from '../hooks/useAdminData';
import { ADMIN_PAGE_STRINGS as S } from '../strings';

export function UsersSection() {
  const { users, loading, error, refresh } = useAdminUsers();
  const [createOpen, setCreateOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>('user');
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<OneTimeToken | null>(null);
  const [resetToken, setResetToken] = useState<OneTimeToken | null>(null);

  const handleCreate = async () => {
    setBusy(true);
    const result = await createUserAction({ email: email.trim(), role });
    setBusy(false);
    if (result.ok && result.invite) {
      setInvite(result.invite);
      setCreateOpen(false);
      setEmail('');
      setRole('user');
      await refresh();
    }
  };

  const handleToggleStatus = async (
    userId: string,
    status: 'active' | 'disabled',
    userEmail: string,
  ) => {
    const ok = await updateUserStatusAction(
      userId,
      status === 'active' ? 'disabled' : 'active',
      userEmail,
    );
    if (ok) {
      await refresh();
    }
  };

  const handleReset = async (userId: string, userEmail: string) => {
    const token = await resetUserPasswordAction(userId, userEmail);
    if (token) {
      setResetToken(token);
    }
  };

  return (
    <Card variant="outlined" data-testid="admin-users-section">
      <CardContent>
        <Stack
          direction="row"
          sx={{ justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'center' }}
        >
          <Typography variant="h6">{S.users.heading}</Typography>
          <Button
            variant="contained"
            size="small"
            startIcon={<AddOutlinedIcon />}
            onClick={() => setCreateOpen(true)}
            data-testid="admin-users-create"
          >
            {S.users.createButton}
          </Button>
        </Stack>
        {error ? (
          <Typography color="error" variant="body2" sx={{ mt: 1 }}>
            {error}
          </Typography>
        ) : null}
        {loading ? (
          <Stack spacing={1} sx={{ mt: 2 }}>
            <Skeleton variant="rounded" height={52} />
            <Skeleton variant="rounded" height={52} />
          </Stack>
        ) : (
          <TableContainer sx={{ mt: 2 }}>
            <Table size="small" data-testid="admin-users-table">
              <TableHead>
                <TableRow>
                  <TableCell>{S.users.emailField}</TableCell>
                  <TableCell>{S.users.roleField}</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <Typography variant="body2">{user.email}</Typography>
                        {user.totpEnabled ? (
                          <Chip size="small" variant="outlined" label={S.users.totpOn} />
                        ) : null}
                      </Stack>
                    </TableCell>
                    <TableCell>{user.role}</TableCell>
                    <TableCell>
                      {user.status === 'disabled' ? (
                        <Chip size="small" color="default" label={S.users.disabled} />
                      ) : (
                        user.status
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                        <Button
                          size="small"
                          onClick={() => void handleReset(user.id, user.email)}
                          data-testid={`admin-users-reset-${user.id}`}
                        >
                          {S.users.reset}
                        </Button>
                        <Button
                          size="small"
                          color={user.status === 'active' ? 'error' : 'success'}
                          onClick={() => void handleToggleStatus(user.id, user.status, user.email)}
                          data-testid={`admin-users-toggle-${user.id}`}
                        >
                          {user.status === 'active' ? S.users.disable : S.users.enable}
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{S.users.createButton}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label={S.users.emailField}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              fullWidth
              autoFocus
            />
            <TextField
              select
              label={S.users.roleField}
              value={role}
              onChange={(e) => setRole(e.target.value as 'admin' | 'user')}
              fullWidth
            >
              <MenuItem value="user">user</MenuItem>
              <MenuItem value="admin">admin</MenuItem>
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={busy || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())}
            data-testid="admin-users-create-confirm"
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      <OnceTokenDialog
        open={invite !== null}
        title="Invite token"
        description={S.users.inviteOnce}
        secrets={invite ? [invite.token] : []}
        expiresAt={invite?.expiresAt}
        onConfirm={() => setInvite(null)}
      />
      <OnceTokenDialog
        open={resetToken !== null}
        title="Password reset token"
        description={S.users.resetOnce}
        secrets={resetToken ? [resetToken.token] : []}
        expiresAt={resetToken?.expiresAt}
        onConfirm={() => setResetToken(null)}
      />
    </Card>
  );
}
