import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Video-Challenge Admin',
  description: 'Admin-Oberfläche für Moderation, Auswahl und Auszahlung.',
};

export const viewport = {
  themeColor: '#100d0b',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
