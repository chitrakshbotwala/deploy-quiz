import { useCallback, useEffect, useRef, useState } from 'react';

type MenuItem =
  | { type: 'separator' }
  | {
      type: 'item';
      label: string;
      icon: string;
      onSelect: () => void;
      disabled?: boolean;
    };

const MENU_WIDTH = 224; // px, matches w-56
const EDGE_PAD = 8; // keep menu off the viewport edge

/**
 * Site-wide custom right-click menu. Replaces the browser's native menu (which
 * varies depending on whether the click lands on the full-bleed canvas, text,
 * or empty background) with a consistent set of page actions — most notably a
 * Refresh option, which the native content menu often omits.
 */
export default function ContextMenu() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [hasSelection, setHasSelection] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      // Allow the native menu on form fields so users keep spellcheck/paste.
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;

      e.preventDefault();
      const selection = window.getSelection()?.toString() ?? '';
      setHasSelection(selection.trim().length > 0);

      // Clamp so the menu never spills past the viewport. Height is unknown
      // before render, so estimate generously and correct after mount.
      const x = Math.min(e.clientX, window.innerWidth - MENU_WIDTH - EDGE_PAD);
      const y = Math.min(e.clientY, window.innerHeight - 320 - EDGE_PAD);
      setPos({ x: Math.max(EDGE_PAD, x), y: Math.max(EDGE_PAD, y) });
      setOpen(true);
    };

    window.addEventListener('contextmenu', onContextMenu);
    return () => window.removeEventListener('contextmenu', onContextMenu);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    // Dismiss on outside pointerdown only — an inside click must reach the
    // button's onClick before the menu unmounts.
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('wheel', close, { passive: true });
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, { passive: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('wheel', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close);
    };
  }, [open, close]);

  // After mount, nudge the menu up if it overflows the real (now-known) height.
  useEffect(() => {
    if (!open || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const overflowY = rect.bottom - (window.innerHeight - EDGE_PAD);
    if (overflowY > 0) setPos(p => ({ ...p, y: Math.max(EDGE_PAD, p.y - overflowY) }));
  }, [open]);

  const run = (fn: () => void) => () => {
    close();
    fn();
  };

  const items: MenuItem[] = [
    {
      type: 'item',
      label: 'Refresh',
      icon: '↻',
      onSelect: run(() => window.location.reload()),
    },
    {
      type: 'item',
      label: 'Back',
      icon: '←',
      onSelect: run(() => window.history.back()),
    },
    {
      type: 'item',
      label: 'Forward',
      icon: '→',
      onSelect: run(() => window.history.forward()),
    },
    { type: 'separator' },
    {
      type: 'item',
      label: 'Copy selection',
      icon: '⧉',
      disabled: !hasSelection,
      onSelect: run(() => {
        const text = window.getSelection()?.toString() ?? '';
        if (text) navigator.clipboard?.writeText(text);
      }),
    },
    {
      type: 'item',
      label: 'Copy page link',
      icon: '🔗',
      onSelect: run(() => navigator.clipboard?.writeText(window.location.href)),
    },
    { type: 'separator' },
    {
      type: 'item',
      label: 'Back to top',
      icon: '↑',
      onSelect: run(() => window.scrollTo({ top: 0, behavior: 'smooth' })),
    },
  ];

  if (!open) return null;

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Page actions"
      className="context-menu-in fixed z-[100] w-56 select-none overflow-hidden rounded-xl border border-white/10 bg-space-soft/90 p-1.5 text-sm text-gray-100 shadow-2xl shadow-black/60 backdrop-blur-xl"
      style={{ left: pos.x, top: pos.y }}
      // Stop the wrapper's own contextmenu from re-opening on right-click inside.
      onContextMenu={e => e.preventDefault()}
    >
      {items.map((item, i) =>
        item.type === 'separator' ? (
          <div key={`sep-${i}`} className="my-1 h-px bg-white/10" />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={item.onSelect}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-blast-purple/20 hover:text-white focus-visible:bg-blast-purple/20 focus-visible:outline-none disabled:cursor-not-allowed disabled:text-gray-500 disabled:hover:bg-transparent"
          >
            <span aria-hidden className="w-4 text-center text-blast-purple">
              {item.icon}
            </span>
            {item.label}
          </button>
        )
      )}
    </div>
  );
}
