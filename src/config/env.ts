import { z } from 'zod';

export const timeZoneSchema = z.string().max(64).refine((value) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return value === 'UTC' || value.includes('/');
  } catch {
    return false;
  }
}, 'Expected an IANA time zone');

const originSchema = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && value === url.origin;
  } catch {
    return false;
  }
}, 'Expected an HTTP origin without a path or trailing slash');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.url().refine((value) => /^postgres(ql)?:\/\//.test(value)),
  CORS_ORIGINS: z.string().default('http://localhost:5173')
    .transform((value) => value.split(',').map((origin) => origin.trim()))
    .pipe(z.array(originSchema).min(1)),
  DEFAULT_TIME_ZONE: timeZoneSchema.default('America/La_Paz'),
  XP_PER_COMPLETION: z.coerce.number().int().min(1).max(1000).default(20),
});

export type Environment = z.infer<typeof envSchema>;

export const authEnvironmentSchema = z.object({
  JWT_SECRET: z.string().min(32).refine((value) => !value.startsWith('REPLACE_'), 'Replace the example secret'),
  JWT_ISSUER: z.string().min(1).default('gamification-api'),
  JWT_AUDIENCE: z.string().min(1).default('gamification-app'),
  JWT_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600),
});
export type AuthEnvironment = z.infer<typeof authEnvironmentSchema>;

export function parseEnvironment(input: NodeJS.ProcessEnv): Environment {
  return envSchema.parse(input);
}
