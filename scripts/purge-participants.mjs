/**
 * Removes a participant and every trace of their attempt.
 *
 * A participant is scattered across five places (see server/store.ts): the
 * participants document, one attempt per section with an `answers` subcollection
 * under it, and a standing plus a cut membership per stage. Deleting only the
 * participants document leaves the score on the leaderboard, because the board is
 * built from `standings`, not from `participants`.
 *
 *   node --env-file=.env.local scripts/purge-participants.mjs someone@example.com
 *   node --env-file=.env.local scripts/purge-participants.mjs --yes a@x.com b@y.com
 *
 * Without --yes it only prints what it would delete. Pass --auth to also delete
 * the Firebase Auth account, which is what makes the person a genuinely new
 * sign-up next time rather than the same uid walking back in.
 */
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

// Mirrors server/quiz.ts. Kept literal so the script needs no TS toolchain.
const SECTION_IDS = ['s1a', 's1b', 's2a'];
const STAGE_IDS = ['stage1', 'stage2'];

const args = process.argv.slice(2);
const commit = args.includes('--yes');
const alsoAuth = args.includes('--auth');
const targets = args.filter(a => !a.startsWith('--'));

if (!targets.length) {
  console.error('usage: node --env-file=.env.local scripts/purge-participants.mjs [--yes] [--auth] <email|uid>...');
  process.exit(1);
}

const projectId = process.env.FIREBASE_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
// The key survives an env file as literal \n escapes; undo them, as server/env.ts does.
const privateKey = (process.env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
if (!projectId || !clientEmail || !privateKey) {
  console.error('missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY');
  process.exit(1);
}

const app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId }, 'purge');
const db = getFirestore(app);
const auth = getAuth(app);

/** Resolves an email or a raw uid to the uid everything is keyed on. */
async function resolveUid(target) {
  if (!target.includes('@')) return target;
  const email = target.toLowerCase();
  const snap = await db.collection('participants').where('email', '==', email).limit(2).get();
  if (snap.size === 1) return snap.docs[0].id;
  if (snap.size > 1) throw new Error(`${email} matches ${snap.size} participants; pass the uid instead`);
  // No participants document — they may still hold an Auth account from a
  // sign-in that never reached the quiz.
  try {
    return (await auth.getUserByEmail(email)).uid;
  } catch {
    return null;
  }
}

for (const target of targets) {
  const uid = await resolveUid(target);
  if (!uid) {
    console.log(`${target}: nothing found`);
    continue;
  }

  const refs = [
    db.collection('participants').doc(uid),
    ...SECTION_IDS.map(id => db.collection('sections').doc(id).collection('attempts').doc(uid)),
    ...STAGE_IDS.map(id => db.collection('stages').doc(id).collection('standings').doc(uid)),
    ...STAGE_IDS.map(id => db.collection('stages').doc(id).collection('cutMembers').doc(uid))
  ];

  const snaps = await db.getAll(...refs);
  const present = refs.filter((_, i) => snaps[i].exists);
  console.log(`${target} (${uid}): ${present.length} document(s)`);
  for (const ref of present) console.log(`  ${ref.path}`);

  if (!commit) continue;

  for (const ref of refs) {
    // recursiveDelete rather than delete: an attempt owns an `answers`
    // subcollection, and deleting the parent document leaves it orphaned but
    // readable. It is a no-op on a document that does not exist.
    await db.recursiveDelete(ref);
  }
  if (alsoAuth) {
    await auth.deleteUser(uid).catch(err => console.log(`  auth: ${err.message}`));
    console.log('  auth account deleted');
  }
  console.log('  deleted');
}

if (!commit) console.log('\ndry run — nothing deleted. Re-run with --yes to commit.');
process.exit(0);
