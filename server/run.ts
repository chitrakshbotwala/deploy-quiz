import type { Pool, PoolClient } from 'pg';
import { db } from './db';
import { answerKey, questionOrder } from './answers';
import type { AnsweredQuestion, FinishResponse } from './types';

/**
 * Scoring, and the only place it happens.
 *
 * Every number the readout and the leaderboard show is derived here from the
 * `picks` rows, never from anything the client sent. The client posts a choice
 * and nothing else; it cannot post a score.
 */

export interface PickRow {
  q_id: string;
  choice: number;
  correct: boolean;
}

export async function loadPicks(runId: string, client: PoolClient | Pool = db()): Promise<PickRow[]> {
  const { rows } = await client.query<PickRow>(
    'select q_id, choice, correct from picks where run_id = $1',
    [runId]
  );
  return rows;
}

/** Picks in run order, decorated with the answer key. Unanswered ids are skipped. */
export function toAnswered(picks: PickRow[]): AnsweredQuestion[] {
  const byId = new Map(picks.map(p => [p.q_id, p]));
  return questionOrder
    .filter(qId => byId.has(qId))
    .map(qId => {
      const pick = byId.get(qId)!;
      return {
        qId,
        choice: pick.choice,
        correct: pick.correct,
        answer: answerKey[qId].answer,
        note: answerKey[qId].note
      };
    });
}

export function scoreOf(picks: PickRow[]): number {
  return picks.reduce((n, p) => n + (p.correct ? 1 : 0), 0);
}

/**
 * Longest run of consecutive correct answers in question order. Walks the full
 * order rather than the pick rows, so a skipped question breaks the streak the
 * same way a wrong one does.
 */
export function bestStreakOf(picks: PickRow[]): number {
  const byId = new Map(picks.map(p => [p.q_id, p]));
  let best = 0;
  let run = 0;
  for (const qId of questionOrder) {
    if (byId.get(qId)?.correct) {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}

/** Current streak — the tail of the run, which is what the live rail shows. */
export function currentStreakOf(picks: PickRow[]): number {
  const byId = new Map(picks.map(p => [p.q_id, p]));
  let run = 0;
  for (const qId of questionOrder) {
    if (!byId.has(qId)) break;
    run = byId.get(qId)!.correct ? run + 1 : 0;
  }
  return run;
}

/**
 * Position on the board: how many finished runs beat this one, plus one. Ranked
 * by score first and elapsed time second, matching the leaderboard query.
 */
export async function rankOf(runId: string, client: PoolClient | Pool = db()): Promise<number> {
  const { rows } = await client.query<{ rank: string }>(
    `select count(*) + 1 as rank
       from runs other, runs self
      where self.id = $1
        and other.finished_at is not null
        and other.id <> self.id
        and ( other.score > self.score
           or (other.score = self.score
               and other.finished_at - other.started_at < self.finished_at - self.started_at) )`,
    [runId]
  );
  return Number(rows[0]?.rank ?? 1);
}

export async function buildFinishResponse(
  runId: string,
  client: PoolClient | Pool = db()
): Promise<FinishResponse | null> {
  const { rows } = await client.query<{ score: number; best_streak: number; seconds: string }>(
    `select score, best_streak, extract(epoch from (finished_at - started_at)) as seconds
       from runs where id = $1 and finished_at is not null`,
    [runId]
  );
  if (!rows.length) return null;
  const picks = await loadPicks(runId, client);
  return {
    score: rows[0].score,
    total: questionOrder.length,
    bestStreak: rows[0].best_streak,
    seconds: Math.max(0, Math.round(Number(rows[0].seconds))),
    rank: await rankOf(runId, client),
    review: toAnswered(picks)
  };
}
