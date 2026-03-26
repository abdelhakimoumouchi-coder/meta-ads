"use client";
'use client';

import { useEffect } from 'react';

interface DashboardErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function DashboardError({ error, reset }: DashboardErrorProps) {
  useEffect(() => {
    console.error('[Dashboard] Render error:', error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4 text-center">
      <div className="text-red-400 text-sm font-semibold uppercase tracking-widest">
        Dashboard Error
      </div>
      <p className="text-gray-400 text-sm max-w-sm">
        {error.message || 'An unexpected error occurred while loading the dashboard.'}
      </p>
      <button
        onClick={reset}
        className="mt-2 px-4 py-2 text-xs font-medium rounded bg-indigo-600 hover:bg-indigo-500 transition-colors"
      >
        Retry
      </button>
    </div>
  );
}
