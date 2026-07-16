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
  /** Gemeinsames Secret zur Verifikation eingehender Zahlungs-Webhooks (Mock-Provider). */
  WEBHOOK_SECRET: z.string().min(1).default('dev-webhook-secret'),

  /** Erlaubte CORS-Origins (kommagetrennt). Leer = keine Cross-Origin-Freigabe. `*` erlaubt alle. */
  CORS_ORIGINS: z.string().optional(),
  /** Rate-Limit: Zeitfenster (ms) und maximale Requests pro IP im Fenster. */
  RATE_LIMIT_TTL_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),

  // --- Provider-Auswahl (Default jeweils Mock; echte Provider brauchen Credentials) ---
  AUTH_PROVIDER: z.enum(['mock', 'firebase']).default('mock'),
  FIREBASE_PROJECT_ID: z.string().optional(),

  PAYMENTS_PROVIDER: z.enum(['mock', 'stripe']).default('mock'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

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
  // Provider-Auswahl braucht die jeweilige Konfiguration.
  if (env.AUTH_PROVIDER === 'firebase' && env.FIREBASE_PROJECT_ID === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['FIREBASE_PROJECT_ID'],
      message: 'AUTH_PROVIDER=firebase erfordert FIREBASE_PROJECT_ID.',
    });
  }
  if (env.PAYMENTS_PROVIDER === 'stripe' && env.STRIPE_SECRET_KEY === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['STRIPE_SECRET_KEY'],
      message: 'PAYMENTS_PROVIDER=stripe erfordert STRIPE_SECRET_KEY.',
    });
  }
  // In Produktion dürfen keine Default-/Platzhalter-Secrets verwendet werden.
  if (env.NODE_ENV === 'production') {
    const insecure = ['dev-webhook-secret', 'change-me', 'change-me-in-production'];
    if (insecure.includes(env.WEBHOOK_SECRET)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WEBHOOK_SECRET'],
        message: 'In Produktion muss WEBHOOK_SECRET auf einen echten, nicht-Default-Wert gesetzt sein.',
      });
    }
  }
});

/** Parst die erlaubten CORS-Origins in eine Liste (bzw. `'*'`). */
export function parseCorsOrigins(env: Pick<Env, 'CORS_ORIGINS'>): string[] | '*' {
  const raw = env.CORS_ORIGINS?.trim();
  if (!raw) return [];
  if (raw === '*') return '*';
  return raw.split(',').map((o) => o.trim()).filter((o) => o.length > 0);
}

export type Env = z.infer<typeof envSchema>;

/** Validiert `process.env` (oder eine übergebene Quelle) gegen das Schema. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
