import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Video-Challenges',
  description: 'Challenges entdecken, teilnehmen und gewinnen.',
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
