import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Not, type Repository } from 'typeorm';
import { OneTimeToken } from '@api/database/entities/one-time-token.entity';
import { RefreshToken } from '@api/database/entities/refresh-token.entity';
import { TfaRecoveryCode } from '@api/database/entities/tfa-recovery-code.entity';
import { User } from '@api/database/entities/user.entity';
import { SettingsService } from '@api/settings/settings.service';
import { JwtService } from './crypto/jwt.service';
import { PasswordService } from './crypto/password.service';
import { REFRESH_TOKEN_TTL_MS, TokenService } from './crypto/token.service';
import { TFA_CHALLENGE_TTL_MS, TotpService } from './crypto/totp.service';
import {
  AuthSessionResponseDto,
  BootstrapDto,
  ChangePasswordDto,
  ClaimDto,
  DisableTfaDto,
  EnableTfaDto,
  LoginDto,
  LoginTfaDto,
  RefreshDto,
  RegisterDto,
  SessionDto,
  TfaEnableResponseDto,
  TfaSetupResponseDto,
  UserDto,
} from './auth.dto';
import type { RequestUser } from './decorators/current-user.decorator';

const GENERIC_LOGIN_FAILURE = 'Invalid email or password';

/**
 * Auth flows (plan D2/D3/D15, extended M15 with TOTP 2FA): first-run
 * bootstrap, bearer login (single-step or two-step challenge), refresh rotation
 * with reuse detection, logout, password change, sessions, TOTP setup/enable/
 * disable, invite/reset claim and the registration gate.
 *
 * Refresh-token discipline: every login/refresh/claim mints a fresh opaque
 * token in a `familyId`; the previous token is revoked in the same
 * transaction. Presenting an already-revoked token is reuse — the whole
 * family is revoked (device logged out everywhere it used that family).
 */
@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(RefreshToken) private readonly refreshTokens: Repository<RefreshToken>,
    @InjectRepository(OneTimeToken) private readonly oneTimeTokens: Repository<OneTimeToken>,
    @InjectRepository(TfaRecoveryCode) private readonly recoveryCodes: Repository<TfaRecoveryCode>,
    private readonly dataSource: DataSource,
    private readonly jwt: JwtService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly totp: TotpService,
    private readonly settings: SettingsService,
  ) {}

  /** Creates the first admin; refuses once any user exists (plan D3). */
  async bootstrap(dto: BootstrapDto, deviceLabel: string): Promise<AuthSessionResponseDto> {
    const userCount = await this.users.count();
    if (userCount > 0) {
      throw new ConflictException('This instance already has a user — bootstrap is closed');
    }
    return this.createUserWithTokens({
      email: dto.email,
      password: dto.password,
      role: 'admin',
      deviceLabel,
    });
  }

  async login(dto: LoginDto, deviceLabel: string): Promise<AuthSessionResponseDto> {
    const email = normalizeEmail(dto.email);
    const user = await this.users.findOneBy({ email });

    if (!user || !user.passwordHash) {
      await this.equalizeLoginTiming(dto.password);
      throw new UnauthorizedException(GENERIC_LOGIN_FAILURE);
    }
    const passwordOk = await this.passwords.verify(user.passwordHash, dto.password);
    if (!passwordOk || user.status !== 'active') {
      // Same generic failure for wrong password and disabled accounts —
      // the response never reveals which one it was.
      throw new UnauthorizedException(GENERIC_LOGIN_FAILURE);
    }

    if (user.totpEnabled) {
      const challenge = this.tokens.issue(TFA_CHALLENGE_TTL_MS);
      const row = this.oneTimeTokens.create({
        userId: user.id,
        type: 'tfa_challenge',
        tokenHash: challenge.hash,
        expiresAt: challenge.expiresAt,
        usedAt: null,
      });
      await this.oneTimeTokens.save(row);

      throw new UnauthorizedException({
        code: 'TOTP_REQUIRED',
        message: 'Two-factor authentication code required',
        challenge: challenge.raw,
        expiresAt: challenge.expiresAt.toISOString(),
      });
    }

    return this.issueSessionFor(user, undefined, deviceLabel);
  }

  /**
   * Completes a two-step login (M15) using the short-lived `challenge` token
   * from `401 TOTP_REQUIRED` plus either a 6-digit TOTP `code` or a single-use
   * `recoveryCode`.
   */
  async loginTfa(dto: LoginTfaDto, deviceLabel: string): Promise<AuthSessionResponseDto> {
    const method = resolveSecondFactorInput(dto);

    type LoginTfaOutcome =
      | { kind: 'invalid_challenge' }
      | { kind: 'bad_code' }
      | { kind: 'ok'; session: AuthSessionResponseDto };

    const tokenHash = this.tokens.hashRaw(dto.challenge);
    const outcome = await this.dataSource.transaction(async (manager): Promise<LoginTfaOutcome> => {
      const oneTime = await manager.findOne(OneTimeToken, {
        where: { tokenHash, type: 'tfa_challenge' },
        lock: { mode: 'pessimistic_write' },
      });
      if (!oneTime || oneTime.usedAt !== null || oneTime.expiresAt.getTime() <= Date.now()) {
        return { kind: 'invalid_challenge' };
      }

      const user = await manager.findOne(User, {
        where: { id: oneTime.userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user || user.status !== 'active' || !user.totpEnabled || !user.totpSecret) {
        return { kind: 'invalid_challenge' };
      }

      if (method.kind === 'totp') {
        const secret = this.totp.decryptSecret(user.totpSecret);
        if (!this.totp.verifyCode(secret, method.value)) {
          return { kind: 'bad_code' };
        }
      } else {
        const codeHash = this.totp.hashRecoveryCode(method.value);
        const consumedCode = await manager.update(
          TfaRecoveryCode,
          { userId: user.id, codeHash, usedAt: IsNull() },
          { usedAt: new Date() },
        );
        if (consumedCode.affected !== 1) {
          return { kind: 'bad_code' };
        }
      }

      const consumedChallenge = await manager.update(
        OneTimeToken,
        { id: oneTime.id, usedAt: IsNull() },
        { usedAt: new Date() },
      );
      if (consumedChallenge.affected !== 1) {
        return { kind: 'invalid_challenge' };
      }

      return {
        kind: 'ok',
        session: await this.issueSessionFor(user, undefined, deviceLabel, manager),
      };
    });

    switch (outcome.kind) {
      case 'invalid_challenge':
        throw new UnauthorizedException('Invalid or expired 2FA challenge');
      case 'bad_code':
        throw new UnauthorizedException('Invalid two-factor authentication or recovery code');
      case 'ok':
        return outcome.session;
    }
  }

  /**
   * Generates a pending TOTP secret + `otpauth://` URI for the caller (M15).
   * Does NOT enable 2FA yet — `POST /auth/tfa/enable` confirms it.
   */
  async setupTfa(user: RequestUser): Promise<TfaSetupResponseDto> {
    const row = await this.users.findOneByOrFail({ id: user.id });
    if (row.totpEnabled) {
      throw new ConflictException('Two-factor authentication is already enabled');
    }

    const secret = this.totp.generateSecret();
    row.totpSecret = this.totp.encryptSecret(secret);
    row.totpEnabled = false;
    await this.users.save(row);

    return {
      secret,
      otpauthUri: this.totp.buildOtpauthUri({
        accountName: row.email,
        secretBase32: secret,
      }),
    };
  }

  /**
   * Verifies a TOTP code against the pending secret, enables 2FA, mints 10
   * single-use recovery codes (returned once, hashed at rest), and revokes ALL
   * existing refresh-token sessions for the user (M15).
   */
  async enableTfa(user: RequestUser, dto: EnableTfaDto): Promise<TfaEnableResponseDto> {
    const generated = this.totp.generateRecoveryCodes();

    await this.dataSource.transaction(async (manager) => {
      const row = await manager.findOne(User, {
        where: { id: user.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) {
        throw new UnauthorizedException('User not found');
      }
      if (row.totpEnabled) {
        throw new ConflictException('Two-factor authentication is already enabled');
      }
      if (!row.totpSecret) {
        throw new BadRequestException('Run POST /auth/tfa/setup before enabling 2FA');
      }

      const secret = this.totp.decryptSecret(row.totpSecret);
      if (!this.totp.verifyCode(secret, dto.code)) {
        throw new UnauthorizedException('Invalid two-factor verification code');
      }

      row.totpEnabled = true;
      await manager.save(row);

      await manager.delete(TfaRecoveryCode, { userId: row.id });
      const recoveryRows = generated.map((item) =>
        manager.create(TfaRecoveryCode, {
          userId: row.id,
          codeHash: item.hash,
          usedAt: null,
        }),
      );
      await manager.save(recoveryRows);

      await manager.update(
        RefreshToken,
        { userId: row.id, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
    });

    return { recoveryCodes: generated.map((item) => item.raw) };
  }

  /**
   * Disables 2FA after verifying either a valid TOTP code or a valid unconsumed
   * recovery code, deletes all recovery codes, and revokes ALL sessions (M15).
   */
  async disableTfa(user: RequestUser, dto: DisableTfaDto): Promise<void> {
    const method = resolveSecondFactorInput(dto);

    type DisableOutcome = { kind: 'not_enabled' } | { kind: 'bad_code' } | { kind: 'ok' };

    const outcome = await this.dataSource.transaction(async (manager): Promise<DisableOutcome> => {
      const row = await manager.findOne(User, {
        where: { id: user.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row || !row.totpEnabled || !row.totpSecret) {
        return { kind: 'not_enabled' };
      }

      if (method.kind === 'totp') {
        const secret = this.totp.decryptSecret(row.totpSecret);
        if (!this.totp.verifyCode(secret, method.value)) {
          return { kind: 'bad_code' };
        }
      } else {
        const codeHash = this.totp.hashRecoveryCode(method.value);
        const consumed = await manager.update(
          TfaRecoveryCode,
          { userId: row.id, codeHash, usedAt: IsNull() },
          { usedAt: new Date() },
        );
        if (consumed.affected !== 1) {
          return { kind: 'bad_code' };
        }
      }

      row.totpEnabled = false;
      row.totpSecret = null;
      await manager.save(row);

      await manager.delete(TfaRecoveryCode, { userId: row.id });
      await manager.update(
        OneTimeToken,
        { userId: row.id, type: 'tfa_challenge', usedAt: IsNull() },
        { usedAt: new Date() },
      );
      await manager.update(
        RefreshToken,
        { userId: row.id, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );

      return { kind: 'ok' };
    });

    switch (outcome.kind) {
      case 'not_enabled':
        throw new BadRequestException('Two-factor authentication is not enabled');
      case 'bad_code':
        throw new UnauthorizedException('Invalid two-factor authentication or recovery code');
      case 'ok':
        return;
    }
  }

  /** Open registration — served only while the instance setting is on (D3/D16). */
  async register(dto: RegisterDto, deviceLabel: string): Promise<AuthSessionResponseDto> {
    const settings = await this.settings.getAll();
    if (!settings.registrationOpen) {
      throw new ForbiddenException('Registration is closed on this instance');
    }
    return this.createUserWithTokens({
      email: dto.email,
      password: dto.password,
      role: 'user',
      deviceLabel,
    });
  }

  /**
   * Consumes an invite/reset token, sets the password and issues a fresh
   * session (plan D15). Single-use and expiring; all of the user's previous
   * sessions are revoked — a password (re)set must not leave strangers
   * logged in.
   */
  async claim(dto: ClaimDto, deviceLabel: string): Promise<AuthSessionResponseDto> {
    const tokenHash = this.tokens.hashRaw(dto.token);

    return this.dataSource.transaction(async (manager) => {
      const oneTime = await manager.findOne(OneTimeToken, {
        where: { tokenHash },
        lock: { mode: 'pessimistic_write' },
      });
      if (!oneTime || oneTime.type === 'tfa_challenge') {
        throw new UnauthorizedException('Invalid invite or reset token');
      }
      if (oneTime.usedAt) {
        throw new GoneException('Token was already used');
      }
      if (oneTime.expiresAt.getTime() <= Date.now()) {
        throw new GoneException('Token is expired');
      }

      const user = await manager.findOneByOrFail(User, { id: oneTime.userId });
      if (user.status !== 'active') {
        throw new ForbiddenException('Account is disabled');
      }

      // Atomically flip the token to used so a concurrent second claim loses.
      const consumed = await manager.update(
        OneTimeToken,
        { id: oneTime.id, usedAt: IsNull() },
        { usedAt: new Date() },
      );
      if (consumed.affected !== 1) {
        throw new GoneException('Token was already used');
      }

      user.passwordHash = await this.passwords.hash(dto.password);
      await manager.save(user);

      // Any session that predates the credential change is void.
      await manager.update(RefreshToken, { userId: user.id }, { revokedAt: new Date() });

      return this.issueSessionFor(user, undefined, deviceLabel, manager);
    });
  }

  /**
   * Rotates a refresh token (plan D2). Reuse of a rotated token revokes the
   * entire family before failing.
   *
   * The transaction returns a discriminable outcome and ALL problem throws
   * happen AFTER it commits — throwing inside the transaction would roll
   * back the family revocation that reuse detection just performed.
   */
  async refresh(dto: RefreshDto): Promise<AuthSessionResponseDto> {
    const tokenHash = this.tokens.hashRaw(dto.refreshToken);

    type RefreshOutcome =
      | { kind: 'invalid' }
      | { kind: 'reuse' }
      | { kind: 'expired' }
      | { kind: 'inactive' }
      | { kind: 'ok'; session: AuthSessionResponseDto };

    const outcome = await this.dataSource.transaction(async (manager): Promise<RefreshOutcome> => {
      const row = await manager.findOne(RefreshToken, {
        where: { tokenHash },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) {
        return { kind: 'invalid' };
      }

      if (row.revokedAt) {
        // REUSE DETECTED — this token was already rotated away or revoked.
        // Committing via the transaction return (not a throw) is what makes
        // the family revocation stick.
        await manager.update(RefreshToken, { familyId: row.familyId }, { revokedAt: new Date() });
        return { kind: 'reuse' };
      }
      if (row.expiresAt.getTime() <= Date.now()) {
        return { kind: 'expired' };
      }

      const user = await manager.findOneByOrFail(User, { id: row.userId });
      if (user.status !== 'active') {
        return { kind: 'inactive' };
      }

      const now = new Date();
      row.revokedAt = now;
      row.lastUsedAt = now;
      await manager.save(row);

      return {
        kind: 'ok',
        session: await this.issueSessionFor(user, row.familyId, row.deviceLabel, manager),
      };
    });

    switch (outcome.kind) {
      case 'invalid':
        throw new UnauthorizedException('Invalid refresh token');
      case 'reuse':
        throw new UnauthorizedException(
          'Refresh token reuse detected — the session was revoked on all devices',
        );
      case 'expired':
        throw new UnauthorizedException('Refresh token expired');
      case 'inactive':
        throw new UnauthorizedException(GENERIC_LOGIN_FAILURE);
      case 'ok':
        return outcome.session;
    }
  }

  /**
   * Revokes the presented refresh token (its family dies with it, since a
   * family only lives while it has an active token). Idempotent: unknown or
   * already-revoked tokens still succeed — logout never leaks state.
   */
  async logout(dto: RefreshDto): Promise<void> {
    const tokenHash = this.tokens.hashRaw(dto.refreshToken);
    const row = await this.refreshTokens.findOneBy({ tokenHash });
    if (row && !row.revokedAt) {
      await this.refreshTokens.update({ id: row.id }, { revokedAt: new Date() });
    }
  }

  /**
   * Changes the caller's password and revokes every OTHER session
   * (plan M2) — the current device stays logged in via its refresh family.
   */
  async changePassword(user: RequestUser, dto: ChangePasswordDto): Promise<void> {
    const row = await this.users.findOneByOrFail({ id: user.id });
    if (!row.passwordHash) {
      throw new BadRequestException('Account has no password yet — claim your invite first');
    }
    const currentOk = await this.passwords.verify(row.passwordHash, dto.currentPassword);
    if (!currentOk) {
      throw new BadRequestException('Current password is incorrect');
    }

    row.passwordHash = await this.passwords.hash(dto.newPassword);
    await this.users.save(row);
    await this.refreshTokens.update(
      { userId: user.id, familyId: Not(user.fam) },
      { revokedAt: new Date() },
    );
  }

  /** One row per refresh-token family = one device/session (plan M2). */
  async listSessions(user: RequestUser): Promise<SessionDto[]> {
    const rows = await this.refreshTokens.find({
      where: { userId: user.id },
      order: { createdAt: 'ASC' },
    });

    const byFamily = new Map<string, RefreshToken[]>();
    for (const row of rows) {
      const family = byFamily.get(row.familyId) ?? [];
      family.push(row);
      byFamily.set(row.familyId, family);
    }

    const now = Date.now();
    const sessions = [...byFamily.entries()].map(([familyId, familyRows]) => {
      const first = familyRows[0]!;
      const isActive = familyRows.some((row) => !row.revokedAt && row.expiresAt.getTime() > now);
      return {
        id: familyId,
        deviceLabel: first.deviceLabel,
        createdAt: first.createdAt,
        lastUsedAt: latest(familyRows.map((row) => row.lastUsedAt)),
        current: familyId === user.fam,
        revokedAt: isActive
          ? null
          : (latest(familyRows.map((row) => row.revokedAt)) ?? first.createdAt),
      };
    });

    return sessions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /** Revokes a whole session (family). 404 unless the family is the caller's. */
  async revokeSession(user: RequestUser, familyId: string): Promise<void> {
    const rows = await this.refreshTokens.findBy({ userId: user.id, familyId });
    if (rows.length === 0) {
      throw new NotFoundException('Session not found');
    }
    await this.refreshTokens.update({ familyId }, { revokedAt: new Date() });
  }

  // -- internals -----------------------------------------------------------

  private async createUserWithTokens(input: {
    email: string;
    password: string;
    role: 'admin' | 'user';
    deviceLabel: string;
  }): Promise<AuthSessionResponseDto> {
    const email = normalizeEmail(input.email);
    const duplicate = await this.users.findOneBy({ email });
    if (duplicate) {
      throw new ConflictException('A user with this email already exists');
    }

    const user = this.users.create({
      email,
      passwordHash: await this.passwords.hash(input.password),
      role: input.role,
      status: 'active',
    });
    try {
      await this.users.save(user);
    } catch {
      // Lost a race against the unique index.
      throw new ConflictException('A user with this email already exists');
    }
    return this.issueSessionFor(user, undefined, input.deviceLabel);
  }

  private async issueSessionFor(
    user: User,
    familyId: string | undefined,
    deviceLabel: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<AuthSessionResponseDto> {
    const family = familyId ?? this.tokens.newFamilyId();
    const refresh = this.tokens.issue(REFRESH_TOKEN_TTL_MS);

    const row = manager.create(RefreshToken, {
      userId: user.id,
      tokenHash: refresh.hash,
      familyId: family,
      deviceLabel,
      expiresAt: refresh.expiresAt,
      revokedAt: null,
      lastUsedAt: null,
    });
    await manager.save(row);

    return {
      user: toUserDto(user),
      accessToken: this.jwt.sign({ sub: user.id, fam: family }),
      refreshToken: refresh.raw,
    };
  }

  /**
   * Makes "unknown email" and "known email, wrong password" indistinguishable
   * by wall-clock: both paths run one argon2 verification against a dummy
   * hash (lazily generated once per process).
   */
  private dummyHash: Promise<string> | null = null;

  private async equalizeLoginTiming(password: string): Promise<void> {
    this.dummyHash ??= this.passwords.hash('arcdrop-timing-equalizer');
    await this.passwords.verify(await this.dummyHash, password);
  }
}

function resolveSecondFactorInput(dto: {
  code?: string;
  recoveryCode?: string;
}): { kind: 'totp'; value: string } | { kind: 'recovery'; value: string } {
  const hasCode = dto.code !== undefined;
  const hasRecovery = dto.recoveryCode !== undefined;
  if (hasCode === hasRecovery) {
    throw new BadRequestException('Provide either a TOTP code or a recoveryCode');
  }
  return hasCode
    ? { kind: 'totp', value: dto.code! }
    : { kind: 'recovery', value: dto.recoveryCode! };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function latest(dates: Array<Date | null>): Date | null {
  let result: Date | null = null;
  for (const date of dates) {
    if (date && (!result || date.getTime() > result.getTime())) result = date;
  }
  return result;
}

function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    hasPassword: user.passwordHash !== null,
    totpEnabled: user.totpEnabled,
    createdAt: user.createdAt,
  };
}

export { toUserDto };
