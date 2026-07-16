import 'reflect-metadata';
import helmet from 'helmet';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { loadEnv, parseCorsOrigins } from '@vcp/config';
import { AppModule } from './app.module.js';
import { AppErrorFilter } from './common/app-error.filter.js';
import { requestLogger } from './common/request-logger.js';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  // rawBody wird für die Signaturprüfung von Zahlungs-Webhooks (Stripe) benötigt.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log'],
    rawBody: true,
  });

  // Hinter Proxy/Load-Balancer (Cloud Run) korrekte Client-IP fürs Rate-Limit.
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(requestLogger);

  const origins = parseCorsOrigins(env);
  app.enableCors({ origin: origins === '*' ? true : origins, credentials: false });

  app.useGlobalFilters(new AppErrorFilter());
  app.enableShutdownHooks();

  if (env.NODE_ENV === 'production') {
    const log = new Logger('bootstrap');
    if (env.AUTH_PROVIDER === 'mock') {
      log.warn('AUTH_PROVIDER=mock in Produktion — echte Auth (firebase) dringend empfohlen.');
    }
    if (env.PAYMENTS_PROVIDER === 'mock') {
      log.warn('PAYMENTS_PROVIDER=mock in Produktion — echter Zahlungsanbieter empfohlen.');
    }
  }

  await app.listen(env.PORT);
  // eslint-disable-next-line no-console
  console.log(`[api] hört auf Port ${env.PORT}`);
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
