export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <div className="h-8 w-48 rounded bg-gray-800 animate-pulse" />

      {/* Cards skeleton */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="h-40 rounded-lg bg-gray-800 animate-pulse" />
        <div className="h-40 rounded-lg bg-gray-800 animate-pulse" />
      </div>

      {/* Table skeleton */}
      <div className="space-y-2">
        <div className="h-6 w-36 rounded bg-gray-800 animate-pulse" />
        <div className="h-48 rounded-lg bg-gray-800 animate-pulse" />
      </div>
    </div>
  );
}
