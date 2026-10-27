import { z } from 'zod';

export function normalizeText(value: string) {
  return value.normalize('NFC').replace(/\r\n?/g, '\n').trim();
}

export function plainText(maximum: number, minimum = 1) {
  return z.string().transform(normalizeText).pipe(z.string().min(minimum).max(maximum)
    .refine((value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u.test(value), 'Unsupported control characters')
    .refine((value) => !/<\/?[a-z!][^>]*>/iu.test(value), 'HTML is not allowed; enter plain text'));
}
