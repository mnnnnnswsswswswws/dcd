'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IconBell, IconHome, IconPlus, IconSearch, IconUser } from './icons';

/** Untere Tab-Leiste (Feed / Entdecken / Erstellen / Aktivität / Profil). */
export function BottomNav() {
  const path = usePathname();
  const is = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));

  return (
    <nav className="tabbar">
      <Link href="/" className={`tab${is('/') ? ' active' : ''}`}>
        <IconHome />
        Feed
      </Link>
      <Link href="/entdecken" className={`tab${is('/entdecken') ? ' active' : ''}`}>
        <IconSearch />
        Entdecken
      </Link>
      <Link href="/create" className={`tab${is('/create') ? ' active' : ''}`}>
        <span className="plus">
          <IconPlus />
        </span>
        Erstellen
      </Link>
      <Link href="/notifications" className={`tab${is('/notifications') ? ' active' : ''}`}>
        <IconBell />
        Aktivität
      </Link>
      <Link href="/profile" className={`tab${is('/profile') || is('/me') ? ' active' : ''}`}>
        <IconUser />
        Profil
      </Link>
    </nav>
  );
}
