'use client';

import { useEffect, useState } from 'react';
import { api, type PublicConfig } from '../lib/api';

/** DEMO-Banner: spiegelt die (deaktivierten) Geld-Flags — keine Echtgeld-Produktion. */
export function DemoBanner() {
  const [cfg, setCfg] = useState<PublicConfig | null>(null);

  useEffect(() => {
    api<PublicConfig>('/v1/config', { auth: false })
      .then(setCfg)
      .catch(() => setCfg(null));
  }, []);

  if (cfg && (cfg.realMoneyEnabled || cfg.payoutsEnabled)) return null;

  return (
    <div className="demobar">
      DEMO · REAL_MONEY_ENABLED=false · PAYOUTS_ENABLED=false · Alle Zahlungen simuliert (Mock-Provider)
    </div>
  );
}
