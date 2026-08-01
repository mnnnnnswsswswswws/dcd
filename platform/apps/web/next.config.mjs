const dev = process.env.NODE_ENV !== 'production';

/**
 * Content-Security-Policy der Teilnehmer-App.
 * - Skripte/Styles: Next.js braucht Inline-Bootstrapping ('unsafe-inline'; im Dev
 *   zusätzlich 'unsafe-eval' für React-Refresh).
 * - Fonts: Google Fonts (Figtree/Unbounded) via CSS-@import.
 * - connect-src: eigene Origin + HTTPS-APIs (Launch) + localhost (Entwicklung).
 * - media/img: blob:-URLs für die In-App-Beweisaufnahme (MediaRecorder-Preview).
 * - frame-ancestors 'none': kein Clickjacking/Embedding.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self' https: http://localhost:* ws://localhost:*",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Kamera/Mikro nur für die eigene Origin (In-App-Beweisaufnahme), Rest aus.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(), payment=()' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
