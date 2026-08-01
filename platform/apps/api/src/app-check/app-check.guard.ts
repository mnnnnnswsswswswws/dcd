import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { loadEnv } from '@vcp/config';
import { APP_CHECK_VERIFIER } from './app-check.module.js';
import type { AppCheckVerifier } from './app-check-verifier.js';

const HEADER = 'x-firebase-appcheck';

// Server-zu-Server bzw. Bootstrap-Pfade: kein App-Check (kommen nicht aus der App).
const SKIP_PREFIXES = ['/health', '/v1/webhooks', '/v1/config'];

/**
 * Globaler App-Check-Guard. Ist `APP_CHECK_ENABLED` aus, passiert alles unverändert
 * (Default). Ist es an, muss jeder App-Request den Header `x-firebase-appcheck` mit
 * gültigem Token führen — außer Webhooks/Health/Config.
 */
@Injectable()
export class AppCheckGuard implements CanActivate {
  private readonly enabled = loadEnv().APP_CHECK_ENABLED;

  constructor(@Inject(APP_CHECK_VERIFIER) private readonly verifier: AppCheckVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.enabled) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const path = request.path ?? request.url ?? '';
    if (SKIP_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      return true;
    }

    const header = request.headers[HEADER];
    const token = Array.isArray(header) ? header[0] : header;
    if (!token) {
      throw new UnauthorizedException('App-Check-Token fehlt.');
    }
    try {
      await this.verifier.verify(token);
      return true;
    } catch {
      throw new UnauthorizedException('App-Check-Verifikation fehlgeschlagen.');
    }
  }
}
