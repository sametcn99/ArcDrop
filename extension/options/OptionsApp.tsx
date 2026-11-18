import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Container,
  CssBaseline,
  Stack,
  Switch,
  TextField,
  ThemeProvider,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMemo, useState } from 'react';
import { sendAuthMessage } from '../shared/messages';
import { sendLibraryMessage } from '../shared/libraryMessages';
import { errorString, strings } from '../shared/strings';
import { getAppTheme, listPalettes, resolveThemeMode } from '../shared/theme';
import {
  chromeStorageLocal,
  writeVault,
  type ThemeModeSetting as VaultThemeModeSetting,
  type VaultSettings,
} from '../shared/vault';
import type { CollectionNode } from '../shared/api/collections';
import { LoginStep } from '../popup/LoginStep';
import { SetupStep } from '../popup/SetupStep';
import { TotpStep } from '../popup/TotpStep';

export interface OptionsBoot {
  settings: VaultSettings;
  baseUrl: string | null;
  email: string | null;
}

type ConnectionStep =
  | { name: 'connected' }
  | { name: 'setup'; baseUrl: string }
  | { name: 'login'; baseUrl: string }
  | { name: 'totp'; baseUrl: string; challenge: string; expiresAt: string };

function versionLabel(): string {
  try {
    return `v${chrome.runtime.getManifest().version}`;
  } catch {
    return '';
  }
}

/**
 * The options page (E5): connection, quick-save destination, behavior
 * toggles and appearance — every change writes the vault immediately, so
 * the popup and embedded app pick settings up on their next read.
 */
export function OptionsApp({ boot }: { boot: OptionsBoot }) {
  const [settings, setSettings] = useState<VaultSettings>(boot.settings);
  const [baseUrl, setBaseUrl] = useState<string | null>(boot.baseUrl);
  const [email, setEmail] = useState<string | null>(boot.email);
  const [connectionStep, setConnectionStep] = useState<ConnectionStep>({ name: 'connected' });
  const [collections, setCollections] = useState<CollectionNode[]>([]);
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const mode = resolveThemeMode(settings.themeMode);
  const theme = useMemo(
    () => getAppTheme(mode, settings.themePaletteId),
    [mode, settings.themePaletteId],
  );
  const palettes = useMemo(() => listPalettes(), []);

  const patchSettings = (patch: Partial<VaultSettings>): void => {
    setSettings((current) => ({ ...current, ...patch }));
    void writeVault(chromeStorageLocal(), { settings: { ...settings, ...patch } }).catch(() => {
      setStatus({ kind: 'error', text: errorString('NETWORK_ERROR') });
    });
  };

  const refreshConnection = (): void => {
    void (async (): Promise<void> => {
      const response = await sendAuthMessage({ type: 'auth/state' }).catch(() => null);
      if (response === null) {
        setStatus({ kind: 'error', text: errorString('NETWORK_ERROR') });
        return;
      }
      if (response.ok && response.kind === 'state') {
        setBaseUrl(response.baseUrl);
        setEmail(response.email);
        if (!response.connected) {
          // The server/session side is gone — re-run sign-in (address kept).
          setConnectionStep({ name: 'login', baseUrl: response.baseUrl ?? '' });
          return;
        }
        setConnectionStep({ name: 'connected' });
      }
    })();
  };

  const loadCollections = (): void => {
    void sendLibraryMessage({ type: 'library/collections' })
      .then((response) => {
        if (response.ok && response.kind === 'collections') {
          setCollections(response.nodes);
        }
      })
      .catch(() => {
        /* picker simply stays empty */
      });
  };

  const disconnect = (): void => {
    void sendAuthMessage({ type: 'auth/disconnect' })
      .then(() => {
        setConnectionStep({ name: 'setup', baseUrl: baseUrl ?? '' });
        refreshConnection();
      })
      .catch(() => refreshConnection());
  };

  const openAppSettings = (): void => {
    void chrome.tabs.create({ url: `${chrome.runtime.getURL('pages/app/index.html')}#/settings` });
  };

  const collectionOptions = flattenCollections(collections);
  const pinnedCollection = collectionOptions.find(
    (option) => option.id === settings.quickSaveCollectionId,
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box component="main" sx={{ py: 4 }}>
        <Container maxWidth="sm">
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography variant="h4" component="h1">
                {strings.appName}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {versionLabel()}
              </Typography>
            </Stack>

            {status !== null ? (
              <Alert severity={status.kind === 'error' ? 'error' : 'success'}>{status.text}</Alert>
            ) : null}

            <Card>
              <CardContent>
                <Section title={strings.options.connectionTitle}>
                  {connectionStep.name === 'connected' ? (
                    <Stack spacing={1.5}>
                      <FieldRow label={strings.popup.stateLabel} value={baseUrl ?? '—'} />
                      <FieldRow
                        label={strings.popup.accountLabel}
                        value={email ?? strings.options.notSignedIn}
                      />
                      <Stack direction="row" spacing={1}>
                        <Button
                          variant="outlined"
                          onClick={() =>
                            setConnectionStep({ name: 'setup', baseUrl: baseUrl ?? '' })
                          }
                        >
                          {strings.popup.changeServer}
                        </Button>
                        <Button variant="text" color="error" onClick={disconnect}>
                          {strings.popup.disconnect}
                        </Button>
                      </Stack>
                      <Button
                        variant="text"
                        onClick={openAppSettings}
                        sx={{ alignSelf: 'flex-start' }}
                      >
                        {strings.options.manageSessions}
                      </Button>
                    </Stack>
                  ) : connectionStep.name === 'setup' ? (
                    <SetupStep
                      initialUrl={connectionStep.baseUrl}
                      onValidated={(validatedUrl) =>
                        setConnectionStep({ name: 'login', baseUrl: validatedUrl })
                      }
                    />
                  ) : connectionStep.name === 'login' ? (
                    <LoginStep
                      baseUrl={connectionStep.baseUrl}
                      onAuthenticated={() => refreshConnection()}
                      onTotpRequired={(authUrl, challenge, expiresAt) =>
                        setConnectionStep({
                          name: 'totp',
                          baseUrl: authUrl,
                          challenge,
                          expiresAt,
                        })
                      }
                      onChangeServer={(authUrl) =>
                        setConnectionStep({ name: 'setup', baseUrl: authUrl })
                      }
                    />
                  ) : (
                    <TotpStep
                      baseUrl={connectionStep.baseUrl}
                      challenge={connectionStep.challenge}
                      onAuthenticated={() => refreshConnection()}
                      onBack={(authUrl) => setConnectionStep({ name: 'login', baseUrl: authUrl })}
                    />
                  )}
                </Section>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Section title={strings.options.quickSaveTitle}>
                  <Stack spacing={1.5}>
                    <ToggleButtonGroup
                      exclusive
                      size="small"
                      value={settings.quickSaveTarget}
                      onChange={(_event, value) => {
                        if (value !== null) {
                          patchSettings({ quickSaveTarget: value });
                          if (value === 'collection') {
                            loadCollections();
                          }
                        }
                      }}
                      aria-label={strings.popup.quickSave}
                    >
                      <ToggleButton value="last-used">
                        {strings.options.quickSaveLastUsed}
                      </ToggleButton>
                      <ToggleButton value="collection">
                        {strings.options.quickSaveCollection}
                      </ToggleButton>
                      <ToggleButton value="unsorted">
                        {strings.options.quickSaveUnsorted}
                      </ToggleButton>
                    </ToggleButtonGroup>
                    {settings.quickSaveTarget === 'collection' ? (
                      collections.length === 0 ? (
                        <Alert severity="info">{strings.options.collectionsLoading}</Alert>
                      ) : (
                        <Autocomplete
                          options={collectionOptions}
                          value={pinnedCollection ?? null}
                          getOptionLabel={(option) => option.title}
                          isOptionEqualToValue={(option, value) => option.id === value.id}
                          onChange={(_event, value) =>
                            patchSettings({ quickSaveCollectionId: value?.id ?? null })
                          }
                          renderOption={(props, option) => {
                            const { key, ...optionProps } = props;
                            return (
                              <Box
                                key={key}
                                component="li"
                                sx={{ pl: 2 + option.depth * 2 }}
                                {...optionProps}
                              >
                                {option.title}
                              </Box>
                            );
                          }}
                          renderInput={(params) => (
                            <TextField
                              {...params}
                              label={strings.popup.saveAllTabsCollection}
                              size="small"
                            />
                          )}
                        />
                      )
                    ) : null}
                    <Typography variant="caption" color="text.secondary">
                      {strings.options.quickSaveHint}
                    </Typography>
                  </Stack>
                </Section>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Section title={strings.options.behaviorTitle}>
                  <SettingSwitch
                    label={strings.options.autoQueryLabel}
                    hint={strings.options.autoQueryHint}
                    checked={settings.autoQueryOnOpen}
                    onChange={(checked) => patchSettings({ autoQueryOnOpen: checked })}
                  />
                  <SettingSwitch
                    label={strings.options.badgeLabel}
                    hint={strings.options.badgeHint}
                    checked={settings.badgeEnabled}
                    onChange={(checked) => patchSettings({ badgeEnabled: checked })}
                  />
                </Section>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Section title={strings.options.appearanceTitle}>
                  <Stack spacing={1.5}>
                    <ToggleButtonGroup
                      exclusive
                      size="small"
                      value={settings.themeMode}
                      onChange={(_event, value) => {
                        if (value !== null) {
                          patchSettings({ themeMode: value as VaultThemeModeSetting });
                        }
                      }}
                      aria-label={strings.options.appearanceTitle}
                    >
                      <ToggleButton value="system">{strings.options.themeSystem}</ToggleButton>
                      <ToggleButton value="light">{strings.options.themeLight}</ToggleButton>
                      <ToggleButton value="dark">{strings.options.themeDark}</ToggleButton>
                    </ToggleButtonGroup>
                    <Autocomplete
                      options={palettes}
                      value={
                        palettes.find((palette) => palette.id === settings.themePaletteId) ??
                        palettes[0] ??
                        null
                      }
                      getOptionLabel={(option) => option.label}
                      isOptionEqualToValue={(option, value) => option.id === value.id}
                      onChange={(_event, value) =>
                        patchSettings({ themePaletteId: value?.id ?? null })
                      }
                      renderOption={(props, option) => {
                        const { key, ...optionProps } = props;
                        return (
                          <Box key={key} component="li" {...optionProps}>
                            <Box
                              sx={{
                                width: 16,
                                height: 16,
                                borderRadius: '50%',
                                mr: 1,
                                background: `linear-gradient(135deg, ${option.swatch[0]} 50%, ${option.swatch[1]} 50%)`,
                              }}
                            />
                            {option.label}
                          </Box>
                        );
                      }}
                      renderInput={(params) => (
                        <TextField {...params} label={strings.options.paletteLabel} size="small" />
                      )}
                    />
                    <Typography variant="caption" color="text.secondary">
                      {strings.options.themeHint}
                    </Typography>
                  </Stack>
                </Section>
              </CardContent>
            </Card>

            <Typography variant="caption" color="text.secondary">
              {strings.appName} {versionLabel()}
            </Typography>
          </Stack>
        </Container>
      </Box>
    </ThemeProvider>
  );
}

function flattenCollections(
  nodes: CollectionNode[],
  depth = 0,
): Array<{ id: string; title: string; depth: number }> {
  const flat: Array<{ id: string; title: string; depth: number }> = [];
  for (const node of nodes) {
    flat.push({ id: node.id, title: node.title, depth });
    if (node.children.length > 0) {
      flat.push(...flattenCollections(node.children, depth + 1));
    }
  }
  return flat;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Stack spacing={1.5}>
      <Typography variant="h6" component="h2">
        {title}
      </Typography>
      {children}
    </Stack>
  );
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" spacing={2} sx={{ alignItems: 'baseline' }}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 96 }}>
        {label}
      </Typography>
      <Typography variant="body2" noWrap>
        {value}
      </Typography>
    </Stack>
  );
}

interface SettingSwitchProps {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function SettingSwitch({ label, hint, checked, onChange }: SettingSwitchProps) {
  return (
    <Stack
      direction="row"
      spacing={2}
      sx={{ alignItems: 'center', justifyContent: 'space-between' }}
    >
      <Box>
        <Typography variant="body2">{label}</Typography>
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      </Box>
      <Tooltip title={label}>
        <Switch
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          aria-label={label}
        />
      </Tooltip>
    </Stack>
  );
}
