import { useRef, useState } from 'react';
import { QuizApiError, adminApi } from '@/lib/quizApi';
import type { AdminBoardResponse } from '@/lib/quizApi';

/**
 * Telling the people a cut kept.
 *
 * This is the one control in the app that does something to a person that cannot be
 * undone, and the design follows from that:
 *
 *  - **A test send first.** The most likely mistake is an EmailJS template whose
 *    "To Email" field is a fixed address rather than `{{to_email}}`, which fails by
 *    quietly sending all 75 copies to one inbox. A test catches it in ten seconds;
 *    a real send does not catch it at all.
 *  - **Nobody is mailed twice.** The server marks a recipient only on success, and
 *    only ever picks up unmarked ones, so a double-clicked button or a reloaded page
 *    sends nothing extra. "Sent 40 of 75" is a resumable position, not a lost job.
 *  - **Progress is visible.** Sending is paced against EmailJS's rate limit, so 75
 *    is about a minute. The loop here asks for a batch at a time and counts up, both
 *    so no single request hangs long enough to be cut by a proxy and so an organiser
 *    can watch it happen.
 *  - **Failures are shown, not swallowed.** A failed address stays unsent and is
 *    picked up by pressing send again.
 */
const ACCENT = '#ff9ffc';
const BATCH = 8;

export default function NotifyPanel({
  board,
  onDone
}: {
  board: AdminBoardResponse;
  /** Called when a run finishes, so the board's counts refresh. */
  onDone: () => void;
}) {
  const { email, cut, label, stageId, cutoff } = board;
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(0);
  const [errors, setErrors] = useState<{ email: string; message: string }[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);
  // Set when the organiser asks to stop between batches. The batch in flight is
  // allowed to finish — abandoning it mid-send would leave a message sent and
  // unmarked, which is the one state that could mail somebody twice.
  const cancelled = useRef(false);

  const outstanding = Math.max(0, email.eligible - email.sent);

  const run = async () => {
    if (
      !window.confirm(
        `Email ${outstanding} of the ${email.eligible} who came through ${label}?\n\n` +
          'This cannot be undone. Anyone already emailed is skipped, so this is safe to ' +
          'repeat if it fails partway.'
      )
    ) {
      return;
    }
    setSending(true);
    setErrors([]);
    setNote(null);
    setSent(0);
    cancelled.current = false;

    let total = 0;
    try {
      // Loop until the server says there is nobody left. The server decides who is
      // left, not this counter — the client is only pacing the calls.
      for (;;) {
        const res = await adminApi.notify(stageId, BATCH);
        total += res.sent;
        setSent(total);
        if (res.errors.length) setErrors(prev => [...prev, ...res.errors]);
        if (cancelled.current) {
          setNote(`Stopped after ${total}. ${res.remaining} still to send — press send again to carry on.`);
          break;
        }
        if (res.remaining === 0) {
          setNote(
            res.errors.length || errors.length
              ? `Finished: ${total} sent, ${res.errors.length} failed. Press send again to retry the failures.`
              : `All ${total} sent.`
          );
          break;
        }
        // A batch that sent nothing and still reports people remaining means every
        // send is failing the same way. Stop rather than spin.
        if (res.sent === 0) {
          setNote(`Nothing is sending — ${res.remaining} still waiting. Fix the error below and try again.`);
          break;
        }
      }
    } catch (err: unknown) {
      setNote(err instanceof QuizApiError ? err.message : 'The send stopped on a network error.');
    } finally {
      setSending(false);
      onDone();
    }
  };

  const test = () => {
    setTesting(true);
    setNote(null);
    adminApi
      .notifyTest(stageId, testTo.trim())
      .then(() => setNote(`Test sent to ${testTo.trim()}. Check it arrived, and that it is addressed to that inbox.`))
      .catch((err: unknown) =>
        setNote(err instanceof QuizApiError ? `Test failed — ${err.message}` : 'Test failed.')
      )
      .finally(() => setTesting(false));
  };

  const reset = () => {
    if (
      !window.confirm(
        'Forget who has been emailed for this round?\n\nThe next send will mail everyone again, ' +
          'including anyone who already got the message.'
      )
    ) {
      return;
    }
    adminApi
      .notifyReset(stageId)
      .then(({ cleared }) => setNote(`Cleared ${cleared} record(s). The next send will mail everyone.`))
      .catch((err: unknown) =>
        setNote(err instanceof QuizApiError ? err.message : 'Could not clear the records.')
      )
      .finally(onDone);
  };

  return (
    <div className="mt-5 rounded-2xl border border-white/[0.09] bg-white/[0.02] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h3 className="text-[0.95rem] font-semibold text-white">Tell the {cutoff} who got through</h3>
        <p className="font-mono text-[0.6875rem] tracking-[0.06em] text-white/45">
          {email.sent} of {email.eligible} emailed
          {email.failed > 0 ? ` · ${email.failed} failed` : ''}
        </p>
      </div>

      {!email.configured ? (
        <p className="mt-3 max-w-[76ch] text-[0.8125rem] leading-[1.6] text-white/50">
          EmailJS is not configured on the server. Set <code className="text-white/70">EMAILJS_SERVICE_ID</code>,{' '}
          <code className="text-white/70">EMAILJS_TEMPLATE_ID</code>,{' '}
          <code className="text-white/70">EMAILJS_PUBLIC_KEY</code> and{' '}
          <code className="text-white/70">EMAILJS_PRIVATE_KEY</code>, then restart the service. Until then
          this does nothing and the export is the way to get the list out.
        </p>
      ) : !cut ? (
        <p className="mt-3 max-w-[76ch] text-[0.8125rem] leading-[1.6] text-white/50">
          Freeze the cut first — there is no list of who got through yet.
        </p>
      ) : (
        <>
          {/* The test comes first on the page because it should come first in time. */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              type="email"
              value={testTo}
              onChange={e => setTestTo(e.target.value)}
              placeholder="your@address — send one test first"
              aria-label="Address to send a test message to"
              className="min-w-[16rem] flex-1 rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2 font-mono text-[0.8125rem] text-white placeholder:text-white/25 focus:border-white/40 focus:outline-none"
            />
            <button
              type="button"
              onClick={test}
              disabled={testing || sending || !testTo.trim()}
              className="rounded-full border border-white/20 px-5 py-2 font-mono text-[0.8125rem] text-white/70 transition-colors hover:border-white/50 hover:text-white disabled:opacity-40"
            >
              {testing ? 'Sending…' : 'Send test'}
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={run}
              disabled={sending || outstanding === 0}
              className="rounded-full px-5 py-2 text-[0.8125rem] font-semibold text-space transition-transform duration-200 enabled:hover:scale-105 disabled:opacity-40"
              style={{ backgroundColor: ACCENT }}
            >
              {sending
                ? `Sending… ${sent} of ${outstanding}`
                : outstanding === 0
                  ? 'Everyone has been emailed'
                  : `Email ${outstanding} finalist${outstanding === 1 ? '' : 's'}`}
            </button>
            {sending && (
              <button
                type="button"
                onClick={() => {
                  cancelled.current = true;
                }}
                className="rounded-full border border-white/20 px-5 py-2 font-mono text-[0.8125rem] text-white/60 transition-colors hover:border-white/50 hover:text-white"
              >
                Stop after this batch
              </button>
            )}
            {!sending && email.sent > 0 && (
              <button
                type="button"
                onClick={reset}
                className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-white/35 hover:text-white/70"
              >
                Forget who was emailed
              </button>
            )}
          </div>

          {/* A bar rather than only a number: a minute of sending needs something
              that visibly moves, or an organiser will assume it has hung. */}
          {sending && (
            <div className="mt-3 h-px w-full max-w-[32rem] bg-white/[0.08]">
              <div
                className="h-px origin-left transition-transform duration-300"
                style={{
                  transform: `scaleX(${outstanding ? Math.min(1, sent / outstanding) : 1})`,
                  background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT}66)`
                }}
              />
            </div>
          )}

          <div className="mt-3 min-h-[1.25rem]" aria-live="polite">
            {note && <p className="max-w-[76ch] text-[0.8125rem] leading-[1.5] text-white/60">{note}</p>}
          </div>

          {errors.length > 0 && (
            <ul className="mt-2 max-h-[9rem] overflow-y-auto">
              {errors.map((e, i) => (
                <li
                  key={`${e.email}-${i}`}
                  className="border-t border-white/[0.06] py-1.5 font-mono text-[0.6875rem] leading-[1.5]"
                  style={{ color: 'var(--color-signal-off)' }}
                >
                  {e.email} — {e.message}
                </li>
              ))}
            </ul>
          )}

          <p className="mt-3 max-w-[76ch] text-[0.75rem] leading-[1.6] text-white/35">
            Sent from the server, one at a time, so nothing is mailed twice: a recipient is recorded
            only once EmailJS accepts the message, and a send only ever picks up people with no
            record. Safe to stop and resume. If a test message arrives addressed to the wrong inbox,
            the template&apos;s <span className="text-white/55">To&nbsp;Email</span> field is a fixed
            address instead of <code className="text-white/55">{'{{to_email}}'}</code>.
          </p>
        </>
      )}
    </div>
  );
}
