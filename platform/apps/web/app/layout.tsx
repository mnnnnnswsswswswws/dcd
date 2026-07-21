import './globals.css';
import type { ReactNode } from 'react';
import { TopBar } from './top-bar';

export const metadata = {
  title: 'Video-Challenges',
  description: 'Challenges entdecken, teilnehmen und gewinnen.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body>
        <TopBar />
        <main>{children}</main>
      </body>
    </html>
  );
}
