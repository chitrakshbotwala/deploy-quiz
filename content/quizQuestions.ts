// ─── EDIT ME ─────────────────────────────────────────────────────────────────
// All quiz copy lives here. Nothing in the renderers needs touching to add,
// remove, or reword a question.
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
  /** Index into `options`. */
  answer: number;
  /** One line, shown after answering and again in the end-of-run review. */
  note: string;
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
    answer: 1,
    note: 'Each comparison throws away half of what is left, so the work grows with the number of halvings.',
    accent: PINK
  },
  {
    id: 'q2',
    topic: 'HTTP',
    prompt: 'Signed in, still not allowed. Which status?',
    options: ['400 Bad Request', '401 Unauthorized', '403 Forbidden', '404 Not Found'],
    answer: 2,
    note: '401 means the server does not know who you are. 403 means it knows, and the answer is still no.',
    accent: PURPLE
  },
  {
    id: 'q3',
    topic: 'JavaScript',
    prompt: 'What does typeof null return?',
    options: ['"null"', '"object"', '"undefined"', 'It throws'],
    answer: 1,
    note: 'A tagging bug from 1995 that was never fixed, because fixing it would break the web.',
    accent: GOLD
  },
  {
    id: 'q4',
    topic: 'REST',
    prompt: 'Which method is not idempotent?',
    options: ['GET', 'PUT', 'DELETE', 'POST'],
    answer: 3,
    note: 'Send the same POST twice and you get two rows. PUT and DELETE land on the same end state every time.',
    accent: PERIWINKLE
  },
  {
    id: 'q5',
    topic: 'Git',
    prompt: 'You pushed a broken commit to main. Safest undo?',
    options: ['git revert', 'git reset --hard', 'git commit --amend', 'git rebase -i'],
    answer: 0,
    note: 'revert writes a new commit that undoes the old one. The other three rewrite history everyone already pulled.',
    accent: PINK
  },
  {
    id: 'q6',
    topic: 'Networking',
    prompt: 'Which one guarantees your packets arrive in order?',
    options: ['UDP', 'TCP', 'IP', 'ICMP'],
    answer: 1,
    note: 'TCP buys ordering and delivery with sequence numbers and retransmits. UDP trades both away for latency.',
    accent: PURPLE
  },
  {
    id: 'q7',
    topic: 'Floating point',
    prompt: 'In JavaScript, 0.1 + 0.2 === 0.3 evaluates to',
    options: ['true', 'false', 'NaN', 'Depends on the engine'],
    answer: 1,
    note: 'Neither 0.1 nor 0.2 is exact in binary64. The sum lands at 0.30000000000000004, and every IEEE 754 language agrees.',
    accent: GOLD
  },
  {
    id: 'q8',
    topic: 'DNS',
    prompt: 'Which record points one name at another name?',
    options: ['A', 'MX', 'CNAME', 'TXT'],
    answer: 2,
    note: 'A maps a name to an address. CNAME maps a name to a name, and the resolver then chases that one.',
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
    answer: 1,
    note: 'The index is a second structure on disk, and every insert, update, and delete has to maintain it.',
    accent: PINK
  },
  {
    id: 'q10',
    topic: 'Space, and code',
    prompt: 'The Apollo 11 guidance computer flew with roughly',
    options: ['4 KB of RAM', '64 KB of RAM', '1 MB of RAM', '16 MB of RAM'],
    answer: 0,
    note: '2048 words of erasable memory, about 4 KB, and 36 KB of rope core. It landed two people on the Moon.',
    accent: PURPLE
  }
];
