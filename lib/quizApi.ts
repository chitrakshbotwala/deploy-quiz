/**
 * Thin fetch layer over the API.
 *
 * Types come from server/types.ts via `import type`, which TypeScript erases at
 * compile time — no server code is pulled into the bundle, and the two sides
 * cannot drift without a type error. Keep these imports type-only.
 */
import { BASE_PATH } from './basePath';
import type {
  AdminStagesResponse,
  ApiError,
  CutSummaryResponse,
  EventState,
  FinishResponse,
  LockResponse,
  SectionRunResponse,
  ServeEnvelope,
  StateResponse
} from '@/server/types';

export type {
  AdminBoardResponse,
  AdminRow,
  AdminStagesResponse,
  CutSummaryResponse,
  EventState,
  EventStatus,
  FinishResponse,
  LockResponse,
  PublicQuestion,
  SectionResult,
  SectionRunResponse,
  SectionState,
  SectionStatus,
  ServeResponse,
  SessionUser,
  StageState,
  StageStatus,
  StateResponse
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
      // The session cookie is httpOnly and same-origin; `same-origin` credentials
      // is the default for fetch, but it is stated here because every route below
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
    throw new QuizApiError(
      body?.error ?? 'server-error',
      body?.message ?? 'Something went wrong.',
      res.status
    );
  }
  return (await res.json()) as T;
}

const post = <T>(path: string, body?: unknown) =>
  call<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const quizApi = {
  /** Mount-time probe: who is signed in and where they stand on the ladder. */
  state: () => call<StateResponse>('/state'),

  /**
   * Just the event's state. Cheap by design — this is what a waiting page polls,
   * because /state builds the whole ladder and nobody waiting needs that yet.
   */
  event: () => call<EventState>('/event'),

  /** The Firebase ID token from the Google popup. The server does the verifying. */
  login: (idToken: string) => post<StateResponse>('/auth/login', { idToken }),

  logout: () => post<{ ok: true }>('/auth/logout'),

  openSection: (sectionId: string) => post<SectionRunResponse>(`/section/${sectionId}/open`),

  /** Asks for the next question. The server picks which one and stamps the deadline. */
  serve: (sectionId: string) => post<ServeEnvelope>(`/section/${sectionId}/serve`),

  /** `choice` is null when the clock ran out with nothing selected. */
  lock: (sectionId: string, qId: string, choice: number | null) =>
    post<LockResponse>(`/section/${sectionId}/lock`, { qId, choice }),

  finish: (sectionId: string) => post<FinishResponse>(`/section/${sectionId}/finish`)
};

export const adminApi = {
  session: () => call<{ admin: boolean }>('/admin/session'),
  login: (password: string) => post<{ ok: true }>('/admin/login', { password }),
  logout: () => post<{ ok: true }>('/admin/logout'),
  board: () => call<AdminStagesResponse>('/admin/board'),
  /** `restart` re-stamps the start time, for a false start. */
  startQuiz: (restart = false) => post<EventState>('/admin/event/start', { restart }),
  stopQuiz: () => post<EventState>('/admin/event/stop'),
  cut: (stageId: string) => post<CutSummaryResponse>('/admin/cut', { stageId }),
  clearCut: (stageId: string) => post<{ ok: true }>('/admin/cut/clear', { stageId }),
  /** A link rather than a fetch: the browser saves the file itself. */
  exportUrl: `${BASE_PATH}/api/admin/export`
};

/** mm:ss, shared by the readout and the board. */
export function formatSeconds(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
