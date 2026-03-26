import { redirect } from 'next/navigation';

/**
 * Root page: redirect users directly to the dashboard.
 * This is an internal tool, no public landing page needed.
 */
export default function RootPage() {
  redirect('/dashboard');
}
