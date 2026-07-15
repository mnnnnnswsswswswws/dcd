import { z } from 'zod';

/**
 * Zentrales Env-Schema mit Flag-Konsistenz-Guards.
 *
 * Alle Feature-Flags sind default `false`. Echtgeld darf nur aktiviert werden,
 * wenn die abhängigen Flags konsistent gesetzt sind — das Schema lehnt inkonsistente
 * Kombinationen hart ab, damit ein Fehlkonfigurieren nicht bis in die Laufzeit gelangt.
 */

const booleanFromEnv = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const baseSchema = z.object({
  DATABASE_URL: z.string().url(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  SLOT_RESERVATION_TTL_MS: z.coerce.number().int().positive().default(600_000),

  REAL_MONEY_ENABLED: booleanFromEnv,
  STRIPE_LIVE_MODE: booleanFromEnv,
  PAYOUTS_ENABLED: booleanFromEnv,
  PUBLIC_FEED_ENABLED: booleanFromEnv,
  LONG_CAPTURE_ENABLED: booleanFromEnv,
  PHYSICAL_FULFILLMENT_ENABLED: booleanFromEnv,
});

export const envSchema = baseSchema.superRefine((env, ctx) => {
  // Auszahlungen setzen Echtgeld voraus.
  if (env.PAYOUTS_ENABLED && !env.REAL_MONEY_ENABLED) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['PAYOUTS_ENABLED'],
      message: 'PAYOUTS_ENABLED erfordert REAL_MONEY_ENABLED=true.',
    });
  }
  // Stripe-Livemodus setzt Echtgeld voraus.
  if (env.STRIPE_LIVE_MODE && !env.REAL_MONEY_ENABLED) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['STRIPE_LIVE_MODE'],
      message: 'STRIPE_LIVE_MODE erfordert REAL_MONEY_ENABLED=true.',
    });
  }
});

export type Env = z.infer<typeof envSchema>;

/** Validiert `process.env` (oder eine übergebene Quelle) gegen das Schema. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
