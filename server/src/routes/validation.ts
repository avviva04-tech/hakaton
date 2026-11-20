import { z } from 'zod';
export const fail = (status: number, message: string): never => {
  throw Object.assign(new Error(message), { status });
};
export const id = (value: unknown) => z.string().min(1).max(100).parse(value);
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    'Некоректна дата',
  )
  .transform((v) => new Date(v));
