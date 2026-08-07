/**
 * The answer key. This file is the whole reason there is a server.
 *
 * It MUST NOT be imported from any client component — Next would pull it into
 * the browser bundle and the quiz would be back to where it started, with all
 * ten answers sitting in a JS chunk that anyone can open. There is no 'use
 * server' guard on this file, so the only thing keeping it server-side is the
 * import graph: nothing under components/ references it. The client only ever
 * learns an answer from a `/api/run/pick` response, after its own pick has
 * already been recorded.
 *
 * Question text, options, order and accents still live in
 * content/quizQuestions.ts. Only `answer` and `note` moved. Keep the ids in
 * the two files in sync — `assertKeyCoversQuestions()` below is the guard, and
 * the server refuses to boot if they drift.
 */
export interface AnswerEntry {
  /** Index into the question's `options` array. */
  answer: number;
  /** Shown after the pick lands, and again in the end-of-run review. */
  note: string;
}

export const answerKey: Record<string, AnswerEntry> = {
  q1: {
    answer: 1,
    note: 'Each comparison throws away half of what is left, so the work grows with the number of halvings.'
  },
  q2: {
    answer: 2,
    note: '401 means the server does not know who you are. 403 means it knows, and the answer is still no.'
  },
  q3: {
    answer: 1,
    note: 'A tagging bug from 1995 that was never fixed, because fixing it would break the web.'
  },
  q4: {
    answer: 3,
    note: 'Send the same POST twice and you get two rows. PUT and DELETE land on the same end state every time.'
  },
  q5: {
    answer: 0,
    note: 'revert writes a new commit that undoes the old one. The other three rewrite history everyone already pulled.'
  },
  q6: {
    answer: 1,
    note: 'TCP buys ordering and delivery with sequence numbers and retransmits. UDP trades both away for latency.'
  },
  q7: {
    answer: 1,
    note: 'Neither 0.1 nor 0.2 is exact in binary64. The sum lands at 0.30000000000000004, and every IEEE 754 language agrees.'
  },
  q8: {
    answer: 2,
    note: 'A maps a name to an address. CNAME maps a name to a name, and the resolver then chases that one.'
  },
  q9: {
    answer: 1,
    note: 'The index is a second structure on disk, and every insert, update, and delete has to maintain it.'
  },
  q10: {
    answer: 0,
    note: '2048 words of erasable memory, about 4 KB, and 36 KB of rope core. It landed two people on the Moon.'
  }
};

/**
 * Run order. The server needs its own copy rather than importing the client
 * list, because streak and progress are computed here and "question 3" has to
 * mean the same thing on both sides.
 */
export const questionOrder: string[] = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10'];

export const TOTAL = questionOrder.length;

export function isKnownQuestion(qId: string): boolean {
  return Object.prototype.hasOwnProperty.call(answerKey, qId);
}

/**
 * Boot guard. A question added to content/quizQuestions.ts without a matching
 * entry here would otherwise fail at the moment a visitor answers it, mid-event.
 * Fail at startup instead, where someone is watching.
 */
export function assertKeyCoversQuestions(clientIds: string[]): void {
  const missing = clientIds.filter(id => !isKnownQuestion(id));
  const extra = questionOrder.filter(id => !clientIds.includes(id));
  const orderMismatch = clientIds.join(',') !== questionOrder.join(',');
  if (missing.length || extra.length || orderMismatch) {
    throw new Error(
      `answer key out of sync with content/quizQuestions.ts\n` +
        `  missing answers for: ${missing.join(', ') || '(none)'}\n` +
        `  keyed but not asked: ${extra.join(', ') || '(none)'}\n` +
        `  client order: ${clientIds.join(', ')}\n` +
        `  server order: ${questionOrder.join(', ')}`
    );
  }
}
