// ─── EDIT ME ─────────────────────────────────────────────────────────────────
// Question copy lives here. Nothing in the renderers needs touching to add,
// remove, or reword a question.
//
// The correct option and its explanation are NOT here — they live in
// server/answers.ts and reach the browser only after a pick has been recorded.
// This file is bundled and served to every visitor, so anything added to it is
// public. Adding a question means editing BOTH files, keyed by the same `id`
// and in the same order; the server refuses to boot if the two drift apart.
//
// `accent` drives more than the panel: it is also the colour of the point light
// on the asteroid you are parked at and of the warp streaks you fly through, so
// the whole field changes hue per question the way each event chapter does on
// the main page. Keep new accents inside the site's muted palette, and keep them
// clear of the two signal colours (--color-signal-ok / --color-signal-off) or a
// correct/incorrect read becomes ambiguous.

export interface QuizQuestion {
  id: string;
  /** Short topic label, sits where an event's tagline sits. */
  topic: string;
  /** The question itself. Rendered as display type, so keep it short. */
  prompt: string;
  options: string[];
  accent: string;
}

const PINK = '#ff9ffc';
const PURPLE = '#b497cf';
const GOLD = '#d9bf6b';
const PERIWINKLE = '#8fa9e8';

export const quizQuestions: QuizQuestion[] = [
  {
    id: 'q1',
    topic: 'Complexity',
    prompt: 'Binary search over a sorted array of n items runs in',
    options: ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'],
    accent: PINK
  },
  {
    id: 'q2',
    topic: 'HTTP',
    prompt: 'Signed in, still not allowed. Which status?',
    options: ['400 Bad Request', '401 Unauthorized', '403 Forbidden', '404 Not Found'],
    accent: PURPLE
  },
  {
    id: 'q3',
    topic: 'JavaScript',
    prompt: 'What does typeof null return?',
    options: ['"null"', '"object"', '"undefined"', 'It throws'],
    accent: GOLD
  },
  {
    id: 'q4',
    topic: 'REST',
    prompt: 'Which method is not idempotent?',
    options: ['GET', 'PUT', 'DELETE', 'POST'],
    accent: PERIWINKLE
  },
  {
    id: 'q5',
    topic: 'Git',
    prompt: 'You pushed a broken commit to main. Safest undo?',
    options: ['git revert', 'git reset --hard', 'git commit --amend', 'git rebase -i'],
    accent: PINK
  },
  {
    id: 'q6',
    topic: 'Networking',
    prompt: 'Which one guarantees your packets arrive in order?',
    options: ['UDP', 'TCP', 'IP', 'ICMP'],
    accent: PURPLE
  },
  {
    id: 'q7',
    topic: 'Floating point',
    prompt: 'In JavaScript, 0.1 + 0.2 === 0.3 evaluates to',
    options: ['true', 'false', 'NaN', 'Depends on the engine'],
    accent: GOLD
  },
  {
    id: 'q8',
    topic: 'DNS',
    prompt: 'Which record points one name at another name?',
    options: ['A', 'MX', 'CNAME', 'TXT'],
    accent: PERIWINKLE
  },
  {
    id: 'q9',
    topic: 'Databases',
    prompt: 'What does adding an index actually cost you?',
    options: [
      'Slower reads, less storage',
      'Slower writes, more storage',
      'Nothing, indexes are free',
      'Slower writes, less storage'
    ],
    accent: PINK
  },
  {
    id: 'q10',
    topic: 'Space, and code',
    prompt: 'The Apollo 11 guidance computer flew with roughly',
    options: ['4 KB of RAM', '64 KB of RAM', '1 MB of RAM', '16 MB of RAM'],
    accent: PURPLE
  }
];
