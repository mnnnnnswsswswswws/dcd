'use client';

import { useEffect, useState } from 'react';
import { getConfig, setConfig } from '../lib/api';

/**
 * Leiste zum Hinterlegen von API-Basis-URL und Admin-Token (im localStorage).
 * Im Mock-Auth-Setup ist der Token `admin:<user-uuid>`.
 */
export function SettingsBar({ onChange }: { onChange?: () => void }) {
  const [apiBase, setApiBase] = useState('');
  const [token, setToken] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const c = getConfig();
    setApiBase(c.apiBase);
    setToken(c.token);
  }, []);

  function save() {
    setConfig({ apiBase, token });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    onChange?.();
  }

  return (
    <div className="settings">
      <label style={{ flex: '1 1 260px' }}>
        API-Basis-URL
        <input value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="http://localhost:8080" />
      </label>
      <label style={{ flex: '1 1 260px' }}>
        Admin-Token (z. B. admin:&lt;uuid&gt;)
        <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="admin:..." />
      </label>
      <button className="primary" onClick={save}>
        {saved ? 'Gespeichert ✓' : 'Speichern'}
      </button>
    </div>
  );
}
