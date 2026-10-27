import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import type { AuthEnvironment } from '../../config/env.ts';
import { Prisma } from '../../generated/prisma/client.ts';
import { AppError } from '../../shared/errors/app-error.ts';
import type { createAuthRepository } from './auth.repository.ts';
import type { Login, Registration } from './auth.validation.ts';

const passwordOptions = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
const identitySchema = z.object({ sub: z.uuid(), sid: z.uuid() });
export interface Identity { userId: string; sessionId: string }

export function createAuthService(repository: ReturnType<typeof createAuthRepository>, config: AuthEnvironment, defaultTimeZone: string) {
  const secret = new TextEncoder().encode(config.JWT_SECRET);
  const dummyHash = argon2.hash(randomBytes(32), passwordOptions);
  const expiresAt = () => new Date(Date.now() + config.JWT_TTL_SECONDS * 1000);

  async function issueToken(userId: string, sessionId: string, expiration: Date) {
    return new SignJWT({ sid: sessionId })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId).setIssuer(config.JWT_ISSUER).setAudience(config.JWT_AUDIENCE)
      .setIssuedAt().setExpirationTime(Math.floor(expiration.getTime() / 1000)).sign(secret);
  }

  return {
    async register(input: Registration) {
      const passwordHash = await argon2.hash(input.password, passwordOptions);
      try {
        const result = await repository.register({
          email: input.email, displayName: input.displayName, passwordHash,
          timeZone: input.timeZone ?? defaultTimeZone,
        }, expiresAt());
        return {
          accessToken: await issueToken(result.user.id, result.session.id, result.session.expiresAt),
          tokenType: 'Bearer', expiresAt: result.session.expiresAt, user: result.user,
        };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new AppError(409, 'EMAIL_IN_USE', 'This email is already registered');
        }
        throw error;
      }
    },
    async login(input: Login) {
      const user = await repository.findByEmail(input.email);
      const validPassword = await argon2.verify(user?.passwordHash ?? await dummyHash, input.password);
      if (!user || !validPassword) throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
      const session = await repository.createSession(user.id, expiresAt());
      return {
        accessToken: await issueToken(user.id, session.id, session.expiresAt),
        tokenType: 'Bearer', expiresAt: session.expiresAt,
        user: { id: user.id, email: user.email, displayName: user.displayName, timeZone: user.timeZone, createdAt: user.createdAt },
      };
    },
    async authenticate(token: string): Promise<Identity> {
      let identity: z.infer<typeof identitySchema>;
      try {
        const { payload } = await jwtVerify(token, secret, {
          algorithms: ['HS256'], issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE,
          requiredClaims: ['sub', 'sid', 'iat', 'exp'],
        });
        identity = identitySchema.parse(payload);
      } catch {
        throw new AppError(401, 'SESSION_EXPIRED', 'Sign in again to continue');
      }
      const session = await repository.findSession(identity.sid, identity.sub);
      if (!session || session.userId !== identity.sub || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
        throw new AppError(401, 'SESSION_EXPIRED', 'Sign in again to continue');
      }
      return { userId: identity.sub, sessionId: identity.sid };
    },
    logout: (identity: Identity) => repository.revokeSession(identity.sessionId, identity.userId),
  };
}
export type AuthService = ReturnType<typeof createAuthService>;
