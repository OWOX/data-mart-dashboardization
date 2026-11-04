export interface LoadingProgress { done: number; total: number }

/** A 2px line: filled to done / total once the total is known, a sliding bar until then. */
export function LoadingLine({ progress }: { progress?: LoadingProgress | null }) {
  const known = !!progress && progress.total > 0;
  return (
    <div
      className="gy-loadline" role="progressbar" aria-label="Loading data" data-determinate={known}
      aria-valuemin={known ? 0 : undefined} aria-valuemax={known ? progress.total : undefined} aria-valuenow={known ? progress.done : undefined}
    >
      {known && <span style={{ width: `${Math.min(100, (progress.done / progress.total) * 100)}%` }} />}
    </div>
  );
}
