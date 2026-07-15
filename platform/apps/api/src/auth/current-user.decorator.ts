import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.guard.js';

/** Extrahiert die authentifizierte User-ID aus dem Request (via AuthGuard gesetzt). */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const id = request.user?.id;
    if (id === undefined) {
      throw new Error('CurrentUserId ohne AuthGuard verwendet.');
    }
    return id;
  },
);
