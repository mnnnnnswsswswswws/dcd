import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { TOKEN_VERIFIER, type TokenVerifier } from './token-verifier.js';

/** Nach erfolgreicher Verifikation an den Request gehängter, authentifizierter Nutzer. */
export interface AuthenticatedUser {
  id: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

/**
 * Prüft das Bearer-Token via `TokenVerifier` und hängt `req.user` an.
 * Analog zum produktiven FirebaseAuthGuard, aber verifier-agnostisch.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Bearer-Token fehlt.');
    }

    try {
      const { userId } = await this.verifier.verify(token);
      request.user = { id: userId };
      return true;
    } catch {
      throw new UnauthorizedException('Ungültiges Token.');
    }
  }
}
