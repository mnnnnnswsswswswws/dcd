import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loadEnv } from '@vcp/config';
import { AppModule } from './app.module.js';
import { AppErrorFilter } from './common/app-error.filter.js';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.useGlobalFilters(new AppErrorFilter());
  await app.listen(env.PORT);
  // eslint-disable-next-line no-console
  console.log(`[api] hört auf Port ${env.PORT}`);
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
