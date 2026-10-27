import { z } from 'zod';
import { timeZoneSchema } from '../../config/env.ts';
import { plainText } from '../../shared/validation.ts';

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const registerSchema = z.strictObject({
  email,
  password: z.string().min(12).max(128),
  displayName: plainText(80),
  timeZone: timeZoneSchema.optional(),
  website: z.string().max(0, 'Automated submissions are not allowed').optional(),
});
export const loginSchema = z.strictObject({ email, password: z.string().min(1).max(128), website: z.string().max(0, 'Automated submissions are not allowed').optional() });
export type Registration = z.infer<typeof registerSchema>;
export type Login = z.infer<typeof loginSchema>;
