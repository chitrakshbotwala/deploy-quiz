import type { Metadata } from 'next';
import AdminApp from '@/components/admin/AdminApp';

/**
 * /admin — the organisers' board.
 *
 * A page rather than a mode of the quiz, so the participant bundle never contains
 * it and a stray state transition cannot land anyone here. The gate is the API's:
 * this route renders a password form and fetches nothing until the server has
 * issued an admin cookie, so knowing the URL buys nothing.
 *
 * `noindex` because a crawler finding a login form on an event site is noise at
 * best, and `force-dynamic` because everything under it is a live read.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'GDG KIIT — quiz leaderboard (organisers)',
  robots: { index: false, follow: false }
};

export default function Page() {
  return <AdminApp />;
}
