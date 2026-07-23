import './globals.css';
import type { ReactNode } from 'react';
import { DemoBanner } from './demo-banner';
import { BottomNav } from './bottom-nav';

export const metadata = {
  title: 'Video-Challenges',
  description: 'Challenges entdecken, teilnehmen und gewinnen.',
  applicationName: 'Video-Challenges',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent' as const, title: 'Challenges' },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#100d0b',
  viewportFit: 'cover' as const,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body>
        <DemoBanner />
        <main>{children}</main>
        <BottomNav />
      </body>
    </html>
  );
}
