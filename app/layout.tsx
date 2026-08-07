import type { Metadata, Viewport } from 'next';
import { Archivo, JetBrains_Mono, Space_Grotesk } from 'next/font/google';
import './globals.css';

/**
 * Three families, self-hosted.
 *
 * The Vite site loaded these from fonts.googleapis.com with a <link>, which
 * costs a render-blocking stylesheet on a third-party origin before a single
 * glyph is requested. `next/font` downloads them at build time and serves them
 * from our own origin instead, which also means the Content-Security-Policy in
 * deploy/Caddyfile no longer has to allow Google's font hosts at all.
 *
 * Each exposes a CSS variable rather than a class, because the type scale is
 * driven by Tailwind's `--font-*` theme tokens in globals.css, not by a class on
 * <body>.
 */
const archivo = Archivo({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  variable: '--font-archivo',
  display: 'swap'
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-jetbrains',
  display: 'swap'
});

const grotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-grotesk-src',
  display: 'swap'
});

export const metadata: Metadata = {
  // Open Graph images have to be absolute URLs for a crawler, and a crawler does
  // not know what `basePath` is. This is what Next resolves the relative paths
  // below against.
  metadataBase: new URL(process.env.NEXT_PUBLIC_QUIZ_URL ?? 'https://gdgkiit.in/dor/quiz'),
  title: 'GDG KIIT — Deploy or [REDACTED]: The Quiz',
  description:
    'Two rounds on code, protocols, and one guidance computer. Ten seconds a question. Fly the asteroid field and answer as you go.',
  openGraph: {
    title: 'GDG KIIT — Deploy or [REDACTED]: The Quiz',
    description: 'Two rounds, ten seconds a question. One rock per question.',
    type: 'website',
    images: ['/og-image.svg']
  },
  icons: { icon: '/favicon.svg' }
};

export const viewport: Viewport = {
  themeColor: '#050510'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${jetbrains.variable} ${grotesk.variable}`}>
      <body>{children}</body>
    </html>
  );
}
