import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Meta Ads Optimizer',
  description: 'Internal control panel for Meta Ads budget optimization',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-950 text-gray-100">
        {/* Top navigation bar */}
        <header className="border-b border-gray-800 bg-gray-900 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold uppercase tracking-widest text-indigo-400">
              META ADS
            </span>
            <span className="text-gray-600">|</span>
            <span className="text-xs text-gray-400">Optimizer v0.1</span>
          </div>
          <nav className="flex items-center gap-4 text-xs text-gray-400">
            <a href="/dashboard" className="hover:text-gray-100 transition-colors">
              Dashboard
            </a>
            <span className="text-gray-700">·</span>
            <span className="text-gray-600 text-[10px]">Internal Tool</span>
          </nav>
        </header>

        {/* Page content */}
        <main className="px-6 py-6 max-w-7xl mx-auto">{children}</main>
      </body>
    </html>
  );
}
