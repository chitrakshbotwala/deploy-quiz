import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The quiz shape: two stages, three sections, and the answer key.
 *
 * Questions are JSON on disk under data/questions/, read once per process. That
 * directory is the only place a question or its answer is written down, and it is
 * NEVER imported by a client component — the browser is served a stripped copy
 * (`PublicQuestion`) with `answer` and `note` removed. Keeping the two shapes in
 * one file is deliberate: the strip happens here, in the same place the file is
 * read, so there is no route that can forget to do it.
 *
 * `process.cwd()` rather than `import.meta.url`: Next bundles this module into
 * .next/server, so a path relative to the emitted chunk points nowhere. `next
 * start` runs from the project root, which is where data/ sits.
 */

/** One question as it lives on disk, answer included. Server-only. */
export interface KeyedQuestion {
  id: string;
  topic: string;
  prompt: string;
  options: string[];
  /** Index into `options`. Never serialised to the client. */
  answer: number;
  /** Why it is the answer. For the organisers' export, not for the visitor. */
  note: string;
  accent: string;
}

/** What the browser is allowed to know. */
export interface PublicQuestion {
  id: string;
  topic: string;
  prompt: string;
  options: string[];
  accent: string;
}

export interface SectionConfig {
  id: string;
  stageId: string;
  label: string;
  blurb: string;
  /** Per-question budget. The server enforces it; the client only draws it. */
  secondsPerQuestion: number;
  questions: KeyedQuestion[];
}

export interface StageConfig {
  id: string;
  label: string;
  /** Sections in the order they must be attempted. */
  sectionIds: string[];
  /**
   * How many advance out of this stage. Stage 1 cuts to 150, stage 2 to 75 —
   * the finalists. Overridable per deploy so a smaller event does not need a
   * code change.
   */
  cutoff: number;
}

const FILES = ['s1a.json', 's1b.json', 's2a.json'];

/**
 * The file's own shape. It says `sectionId` where the config says `id`, because
 * in the file the field is a label on the thing and in memory it is the key
 * everything else looks it up by; the mapping below is the one place the two
 * spellings meet.
 */
interface SectionFile {
  sectionId: string;
  stageId: string;
  label: string;
  blurb: string;
  secondsPerQuestion: number;
  questions: KeyedQuestion[];
}

function loadSections(): SectionConfig[] {
  const dir = path.join(process.cwd(), 'data', 'questions');
  return FILES.map(file => {
    const raw = JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as SectionFile;
    const { sectionId, ...rest } = raw;
    return { id: sectionId, ...rest };
  });
}

/**
 * Read at import, cached on `globalThis`. Dev-mode hot reload re-evaluates this
 * module on every edit; without the cache each edit re-reads three files, and
 * more importantly a question list that changed under a live run would change
 * mid-attempt. One read per process is the honest lifetime.
 */
const CACHE = Symbol.for('dor-quiz.sections');
type SectionCache = typeof globalThis & { [CACHE]?: SectionConfig[] };

function sections(): SectionConfig[] {
  const cache = globalThis as SectionCache;
  if (!cache[CACHE]) cache[CACHE] = loadSections();
  return cache[CACHE];
}

function cutoff(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isInteger(raw) && raw > 0 ? raw : fallback;
}

/**
 * The stage ladder, and the one place the flow is written down.
 *
 * Stage 1 is two sections, both attempted by everyone, and the cut is taken on
 * the stage total — score first, summed answer time second. Stage 2 is one
 * section and is open only to the 150 the cut kept. Its own cut of 75 is the
 * finalists.
 *
 * The cut is a moment, not a live query: an admin freezes it once stage 1 is
 * closed (POST /api/admin/cut), which is what stops a participant's eligibility
 * from flickering as later attempts land. Until it is frozen, stage 2 is shut.
 */
export const STAGES: StageConfig[] = [
  { id: 'stage1', label: 'Stage 1', sectionIds: ['s1a', 's1b'], cutoff: cutoff('STAGE1_CUTOFF', 150) },
  { id: 'stage2', label: 'Stage 2', sectionIds: ['s2a'], cutoff: cutoff('STAGE2_CUTOFF', 75) }
];

export function stageById(stageId: string): StageConfig | null {
  return STAGES.find(s => s.id === stageId) ?? null;
}

export function sectionById(sectionId: string): SectionConfig | null {
  return sections().find(s => s.id === sectionId) ?? null;
}

export function sectionsOfStage(stageId: string): SectionConfig[] {
  const stage = stageById(stageId);
  if (!stage) return [];
  return stage.sectionIds.map(id => sectionById(id)!).filter(Boolean);
}

/** The stage a section belongs to, or null for an id nobody serves. */
export function stageOfSection(sectionId: string): StageConfig | null {
  const section = sectionById(sectionId);
  return section ? stageById(section.stageId) : null;
}

/** Question ids in run order. Progress and resume both count against this. */
export function questionOrder(sectionId: string): string[] {
  return sectionById(sectionId)?.questions.map(q => q.id) ?? [];
}

export function questionOf(sectionId: string, qId: string): KeyedQuestion | null {
  return sectionById(sectionId)?.questions.find(q => q.id === qId) ?? null;
}

/** Strips the answer key. Every question that reaches the browser goes through here. */
export function publicQuestions(sectionId: string): PublicQuestion[] {
  return (sectionById(sectionId)?.questions ?? []).map(({ id, topic, prompt, options, accent }) => ({
    id,
    topic,
    prompt,
    options,
    accent
  }));
}

/**
 * Boot guard. A malformed or half-edited question file would otherwise fail at
 * the moment a visitor reaches that question, mid-event. Fail at startup, where
 * someone is watching.
 */
export function assertQuizWellFormed(): void {
  const seen = new Set<string>();
  for (const stage of STAGES) {
    for (const sectionId of stage.sectionIds) {
      const section = sectionById(sectionId);
      if (!section) throw new Error(`stage ${stage.id} references unknown section ${sectionId}`);
      if (section.stageId !== stage.id) {
        throw new Error(`section ${sectionId} claims stage ${section.stageId}, listed under ${stage.id}`);
      }
      if (!section.questions.length) throw new Error(`section ${sectionId} has no questions`);
      if (!Number.isFinite(section.secondsPerQuestion) || section.secondsPerQuestion <= 0) {
        throw new Error(`section ${sectionId} has no usable secondsPerQuestion`);
      }
      for (const q of section.questions) {
        if (seen.has(q.id)) throw new Error(`duplicate question id ${q.id}`);
        seen.add(q.id);
        if (!Array.isArray(q.options) || q.options.length < 2) {
          throw new Error(`question ${q.id} needs at least two options`);
        }
        if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) {
          throw new Error(`question ${q.id} has answer ${q.answer}, outside its ${q.options.length} options`);
        }
      }
    }
  }
  // Sections on disk that no stage lists would silently never be served.
  const listed = new Set(STAGES.flatMap(s => s.sectionIds));
  for (const section of sections()) {
    if (!listed.has(section.id)) throw new Error(`section ${section.id} is on disk but no stage lists it`);
  }
}
