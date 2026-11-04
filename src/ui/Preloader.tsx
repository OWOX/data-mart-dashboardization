export interface PreloaderState {
  label: string;
  done?: number;
  total?: number;
}

/** Spinner, step label and, once the total is known, a determinate bar. */
export function Preloader({ label, done, total }: PreloaderState) {
  const known = total !== undefined && total > 0 && done !== undefined;
  return (
    <div className="gy-preloader" role="status" aria-live="polite">
      <span className="gy-preloader-ring" aria-hidden="true" />
      <p className="gy-preloader-label">{label}</p>
      {known && (
        <>
          <div className="gy-preloader-bar" role="progressbar" aria-label="Loading data" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
            <span style={{ width: `${Math.min(100, (done / total) * 100)}%` }} />
          </div>
          <p className="gy-preloader-count">{done} of {total}</p>
        </>
      )}
    </div>
  );
}
