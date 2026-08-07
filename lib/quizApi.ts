/**
 * Thin fetch layer over the API.
 *
 * Types come from server/types.ts via `import type`, which TypeScript erases at
 * compile time — no server code is pulled into the bundle, and the two sides
 * cannot drift without a type error. Keep these imports type-only.
 */
import { BASE_PATH } from './basePath';
import type {
  ApiError,
  BootResponse,
  FinishResponse,
  LeaderboardResponse,
  PickResponse,
  StartResponse
} from '@/server/types';

export type {
  AnsweredQuestion,
  BootResponse,
  FinishResponse,
  LeaderboardResponse,
  PickResponse,
  StartResponse
} from '@/server/types';

/** A failed call, carrying the server's error code so callers can branch on it. */
export class QuizApiError extends Error {
  readonly code: ApiError['error'];
  readonly status: number;
  constructor(code: ApiError['error'], message: string, status: number) {
    super(message);
    this.name = 'QuizApiError';
    this.code = code;
    this.status = status;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    // Absolute from the domain root, not relative: the app is mounted at
    // /dor/quiz and a bare `api/...` would resolve against whatever segment the
    // page happens to sit on.
    res = await fetch(`${BASE_PATH}/api${path}`, {
      // The run cookie is httpOnly and same-origin; `same-origin` credentials is
      // the default for fetch, but it is stated here because every route below
      // is meaningless without it.
      credentials: 'same-origin',
      headers: init?.body ? { 'content-type': 'application/json' } : undefined,
      ...init
    });
  } catch {
    // Offline, DNS, proxy down — no response to read a code out of.
    throw new QuizApiError('server-error', 'Could not reach the server. Check your connection.', 0);
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new QuizApiError(body?.error ?? 'server-error', body?.message ?? 'Something went wrong.', res.status);
  }
  return (await res.json()) as T;
}

/** The Google ID token from the sign-in button. The server does the verifying. */
export interface StartRequest {
  credential: string;
}

export const quizApi = {
  /**
   * Mount-time probe: resumes from the run cookie if there is one, and carries
   * the sign-up policy the gate draws itself against.
   */
  boot: () => call<BootResponse>('/run/current'),

  start: (fields: StartRequest) =>
    call<StartResponse>('/run/start', { method: 'POST', body: JSON.stringify(fields) }),

  pick: (qId: string, choice: number) =>
    call<PickResponse>('/run/pick', { method: 'POST', body: JSON.stringify({ qId, choice }) }),

  finish: () => call<FinishResponse>('/run/finish', { method: 'POST' }),

  leaderboard: (limit = 20) => call<LeaderboardResponse>(`/leaderboard?limit=${limit}`)
};

/** mm:ss, shared by the readout and the board. */
export function formatSeconds(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
