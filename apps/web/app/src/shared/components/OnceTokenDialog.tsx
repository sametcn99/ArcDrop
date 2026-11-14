import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

export interface OnceTokenDialogStrings {
  copyButton: string;
  copiedButton: string;
  confirm: string;
  expiresAt: (expiresAt: string) => string;
}

export interface OnceTokenDialogProps {
  open: boolean;
  title: string;
  /** Shown above the secrets; explains what they are and that they never return. */
  description: string;
  /** One or more single-use secrets (a reset token, or the 10 recovery codes). */
  secrets: string[];
  expiresAt?: string;
  onConfirm: () => void;
  strings?: OnceTokenDialogStrings;
}

/**
 * Show-once secret dialog (invite/reset tokens, PAT value, 2FA recovery codes):
 * copyable secrets, explicit "I saved it" confirmation, no close-on-backdrop
 * escape before confirmation.
 */
export function OnceTokenDialog({
  open,
  title,
  description,
  secrets,
  expiresAt,
  onConfirm,
}: OnceTokenDialogProps) {
  const [copied, setCopied] = useState(false);

  const allSecrets = secrets.join('\n');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(allSecrets);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Dialog open={open} onClose={onConfirm} maxWidth="sm" fullWidth data-testid="once-token-dialog">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Alert
            severity="warning"
            iconMapping={{ warning: <WarningAmberOutlinedIcon /> }}
            data-testid="once-token-warning"
          >
            {description}
          </Alert>
          {expiresAt ? (
            <Typography variant="body2" color="text.secondary">
              {`Expires ${new Date(expiresAt).toLocaleString()}`}
            </Typography>
          ) : null}
          <Box
            sx={{
              p: 1.5,
              borderRadius: 1,
              bgcolor: 'action.hover',
              fontFamily: 'mono.fontFamily',
              fontSize: '0.85rem',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              maxHeight: 260,
              overflow: 'auto',
            }}
            data-testid="once-token-secrets"
          >
            {secrets.map((secret, index) => (
              <Chip
                key={secret}
                label={secret}
                variant="outlined"
                sx={{ m: 0.25, fontFamily: 'mono.fontFamily', maxWidth: '100%' }}
                data-testid={`once-token-secret-${index}`}
              />
            ))}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button
          onClick={handleCopy}
          startIcon={<ContentCopyOutlinedIcon />}
          data-testid="once-token-copy"
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button onClick={onConfirm} variant="contained" data-testid="once-token-confirm">
          {'I saved it'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
