import { Controller, Get } from '@nestjs/common';
import { loadEnv } from '@vcp/config';

/**
 * Öffentliche Laufzeit-Konfiguration für die Frontends. Nur unkritische Feature-Flags,
 * damit die Oberfläche ihr Verhalten (z. B. In-App-Aufnahme, öffentlicher Feed) an den
 * tatsächlichen Serverzustand anpassen kann. Keine Secrets.
 */
@Controller('v1/config')
export class ConfigController {
  private readonly env = loadEnv();

  @Get()
  get() {
    return {
      longCaptureEnabled: this.env.LONG_CAPTURE_ENABLED,
      publicFeedEnabled: this.env.PUBLIC_FEED_ENABLED,
      payoutsEnabled: this.env.PAYOUTS_ENABLED,
    };
  }
}
