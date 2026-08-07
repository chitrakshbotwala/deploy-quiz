'use client';

/**
 * The boundary of last resort: an error thrown in the root layout itself, which
 * `app/error.tsx` cannot catch because it renders inside that layout.
 *
 * It has to bring its own <html> and <body>, and it cannot rely on the app's fonts
 * or Tailwind — the layout that provides them is the thing that failed. Hence the
 * inline styles, which are not laziness but the only thing guaranteed to render.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          padding: '2rem',
          background: '#050510',
          color: '#f4f4f8',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          textAlign: 'center'
        }}
      >
        <h1 style={{ fontSize: 'clamp(1.3rem, 4vw, 2rem)', margin: 0, lineHeight: 1.2 }}>
          The quiz failed to load.
        </h1>
        <p style={{ maxWidth: '46ch', lineHeight: 1.6, color: 'rgba(244,244,248,0.6)', margin: 0 }}>
          Nothing you answered is lost — every answer is stored server-side as it is locked. Reload to
          carry on, and tell an organiser if this page comes back.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            marginTop: '0.5rem',
            padding: '0.7rem 1.5rem',
            borderRadius: '999px',
            border: 0,
            background: '#ff9ffc',
            color: '#050510',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          Reload
        </button>
        {error.digest && (
          <p style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.7rem', color: 'rgba(244,244,248,0.25)' }}>
            ref {error.digest}
          </p>
        )}
      </body>
    </html>
  );
}
