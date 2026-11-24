import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { decodeBase32, generateTotp } from '../apps/api/src/auth/crypto/totp.service';

const mode = process.env['ARCDROP_BACKUP_SMOKE_MODE'];
const stateFile = process.env['ARCDROP_BACKUP_SMOKE_STATE'];
assert.ok(stateFile, 'Set a private state file for this disposable backup test');
const address = process.env['ARCDROP_SMOKE_URL'] ?? 'http://127.0.0.1:3000';
const email = 'compose-smoke@arcdrop.test';
const password = 'arcdrop-compose-smoke-disposable-password';
const codeFor = (secret: string) => generateTotp(decodeBase32(secret));
const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

function api(path: string, request: RequestInit) {
  return fetch(`${address}/api/v1${path}`, request);
}

function json(body: object, token?: string): RequestInit {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  };
}

if (mode === 'seed') {
  const login = await api('/auth/login', json({ email, password }));
  assert.equal(login.status, 201);
  const { accessToken } = (await login.json()) as { accessToken: string };
  const bytes = new TextEncoder().encode('Disposable ArcDrop backup verification file.');
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'text/plain' }), 'backup-check.txt');
  const upload = await api('/bookmarks/file', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  assert.equal(upload.status, 201);
  const { id } = (await upload.json()) as { id: string };
  const setup = await api('/auth/tfa/setup', json({}, accessToken));
  assert.equal(setup.status, 200);
  const { secret } = (await setup.json()) as { secret: string };
  const enable = await api('/auth/tfa/enable', json({ code: codeFor(secret) }, accessToken));
  assert.equal(enable.status, 200);
  await Bun.write(stateFile, JSON.stringify({ id, secret, sha256: hash(bytes) }));
} else if (mode === 'restore') {
  const { id, secret, sha256 } = (await Bun.file(stateFile).json()) as {
    id: string;
    secret: string;
    sha256: string;
  };
  const challengeResponse = await api('/auth/login', json({ email, password }));
  assert.equal(challengeResponse.status, 401);
  const { challenge, code } = (await challengeResponse.json()) as {
    challenge: string;
    code: string;
  };
  assert.equal(code, 'TOTP_REQUIRED');
  const login = await api('/auth/login/tfa', json({ challenge, code: codeFor(secret) }));
  assert.equal(login.status, 201);
  const { accessToken } = (await login.json()) as { accessToken: string };
  const download = await api(`/files/${id}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  assert.equal(download.status, 200);
  assert.equal(hash(new Uint8Array(await download.arrayBuffer())), sha256);
  console.log('The restored database and data volume preserve TOTP login and uploaded bytes.');
} else {
  throw new Error('Set ARCDROP_BACKUP_SMOKE_MODE to seed or restore');
}
