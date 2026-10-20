import { z } from 'zod';
import { timeZoneSchema } from '../../config/env.ts';

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const registerSchema = z.strictObject({
  email,
  password: z.string().min(12).max(128),
  displayName: z.string().trim().min(1).max(80),
  timeZone: timeZoneSchema.optional(),
});
export const loginSchema = z.strictObject({ email, password: z.string().min(1).max(128) });
export type Registration = z.infer<typeof registerSchema>;
export type Login = z.infer<typeof loginSchema>;
