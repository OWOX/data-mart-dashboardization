import { Calendar as CalendarIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { addDays, anchorFor, compareOptions, controlLabel, diffDays, resolveRange } from '../lib/dates';
import { formatPeriod } from '../lib/format';
import { PRESET_GROUPS, PRESET_LABELS, type CompareChoice, type ComparePreset, type DateWindow, type Day, type RangeChoice, type WeekStart } from '../types';
import { Calendar, monthStart } from './Calendar';

type Props = {
  range: RangeChoice; compare: CompareChoice; now: Date; weekStart?: WeekStart;
  onChange: (range: RangeChoice, compare: CompareChoice) => void;
};

/** The month to open on: the window's end, or yesterday when the end is past the current month. */
const openMonth = (w: DateWindow | null, anchor: Day): Day => monthStart(!w || w.to.slice(0, 7) > addDays(anchor, 1).slice(0, 7) ? anchor : w.to);

/** Picker wording; the cards use the Title Case names from dates.ts. */
const compareChipLabel = (preset: ComparePreset, days: number): string =>
  preset === 'previous_period' ? 'Previous period' : preset === 'preceding_days' ? `Previous ${days} days` : 'Same period last year';

export function DateRangePicker(props: Props) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(false); trigger.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !trigger.current?.contains(t)) close();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const labelId = useId();
  return (
    <div className="gy-drp">
      <button ref={trigger} type="button" className="gy-select gy-drp-trigger" aria-label="Date range" aria-describedby={labelId} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}>
        <CalendarIcon size={14} aria-hidden />
        <span id={labelId}>{controlLabel(props.range, props.compare)}</span>
      </button>
      {open && <Panel {...props} panelRef={panel} onClose={close} />}
    </div>
  );
}

function Panel({ range, compare, now, weekStart = 'monday', onChange, panelRef, onClose }: Props & { panelRef: React.RefObject<HTMLDivElement | null>; onClose: () => void }) {
  const anchor = anchorFor(now);
  const [dRange, setDRange] = useState<RangeChoice>(range);
  const [compareOn, setCompareOn] = useState(compare.kind !== 'off');
  const [dCompare, setDCompare] = useState<Exclude<CompareChoice, { kind: 'off' }>>(compare.kind === 'off' ? { kind: 'preset', preset: 'previous_period' } : compare);
  // After a first click the next click closes the window instead of starting a new one.
  const [pendingRange, setPendingRange] = useState(false);
  const [pendingCompare, setPendingCompare] = useState(false);
  const effective: CompareChoice = compareOn ? dCompare : { kind: 'off' };
  const spec = resolveRange(dRange, effective, now, weekStart);
  const drawn = dRange.kind === 'custom' ? dRange.window : spec.range;
  // The resolved (clipped, length-matched) window is what gets queried, so it is what we show; the raw pick goes to onChange.
  const comparison = resolveRange(dRange, dCompare, now, weekStart).comparison;
  const rawCompare = dCompare.kind === 'custom' ? dCompare.window : null;
  const factDays = spec.factWindow ? diffDays(spec.factWindow.from, spec.factWindow.to) + 1 : spec.days;
  const [rangeMonth, setRangeMonth] = useState(() => openMonth(drawn, anchor));
  const [compareMonth, setCompareMonth] = useState(() => openMonth(comparison, anchor));
  const id = useId();
  const options = compareOptions(dRange, now, weekStart);
  const stillOffered = dCompare.kind !== 'preset' || options.some((o) => o.preset === dCompare.preset);
  const compareSeed = dCompare.kind === 'preset' ? dCompare.preset : 'custom';
  const rangeSeed = dRange.kind === 'preset' ? dRange.preset : `${dRange.window.from}_${dRange.window.to}`;

  useEffect(() => { if (!stillOffered) setDCompare({ kind: 'preset', preset: 'previous_period' }); }, [stillOffered]);
  // Follow the comparison when the range or the comparison kind changes; custom picks keep the month the user is looking at.
  useEffect(() => {
    if (compareOn) setCompareMonth(openMonth(comparison, anchor));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareOn, compareSeed, rangeSeed]);
  useEffect(() => {
    // on a custom range no preset is pressed; the panel itself takes focus so Escape still works
    (panelRef.current?.querySelector<HTMLElement>('.gy-drp-preset[aria-pressed="true"]') ?? panelRef.current)?.focus();
  }, []);

  const pick = (cur: DateWindow | null, pending: boolean, d: Day): DateWindow =>
    pending && cur ? (d < cur.from ? { from: d, to: cur.from } : { from: cur.from, to: d }) : { from: d, to: d };

  const pickRange = (d: Day) => {
    setDRange({ kind: 'custom', window: pick(dRange.kind === 'custom' ? dRange.window : null, pendingRange, d) });
    setPendingRange(!pendingRange);
  };
  const pickCompare = (d: Day) => {
    setDCompare({ kind: 'custom', window: pick(rawCompare, pendingCompare, d) });
    setPendingCompare(!pendingCompare);
  };
  const choosePreset = (preset: Extract<RangeChoice, { kind: 'preset' }>['preset']) => {
    const next: RangeChoice = { kind: 'preset', preset };
    setDRange(next); setPendingRange(false);
    setRangeMonth(openMonth(resolveRange(next, { kind: 'off' }, now, weekStart).range, anchor));
  };
  const toggleCompare = (on: boolean) => {
    setCompareOn(on);
    if (on) setCompareMonth(openMonth(comparison, anchor));
  };

  return (
    <div ref={panelRef} className="gy-drp-panel" tabIndex={-1} role="dialog" aria-label="Date range"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <div className="gy-drp-head">
        <span className="gy-drp-windows">
          {formatPeriod(drawn, compareOn ? comparison : null)}
        </span>
        <button type="button" className="gy-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="gy-btn gy-btn-primary" onClick={() => { onChange(dRange, effective); onClose(); }}>Apply</button>
      </div>
      {/* The columns' wrappers don't box their children: each list shares a grid row with its calendar, so it is as tall as the calendar. */}
      <div className="gy-drp-left">
        <div className="gy-drp-presets">
          <div className="gy-drp-list">
            {PRESET_GROUPS.flatMap((g) => g.presets).map((p) => (
              <button key={p} type="button" className="gy-drp-preset" aria-pressed={dRange.kind === 'preset' && dRange.preset === p} onClick={() => choosePreset(p)}>
                {PRESET_LABELS[p]}
              </button>
            ))}
            <span className="gy-drp-preset gy-drp-custom" aria-current={dRange.kind === 'custom' ? 'true' : undefined}>Custom</span>
          </div>
        </div>
        <label className="gy-check gy-drp-compare" htmlFor={`${id}-cmp`}>
          <input id={`${id}-cmp`} type="checkbox" checked={compareOn} onChange={(e) => toggleCompare(e.target.checked)} />
          Compare
        </label>
        {compareOn && (
          <div className="gy-drp-presets gy-drp-cmplist">
            <div className="gy-drp-list">
              {options.map((o) => (
                <button key={o.preset} type="button" className="gy-drp-preset" aria-pressed={dCompare.kind === 'preset' && dCompare.preset === o.preset}
                  onClick={() => { setDCompare({ kind: 'preset', preset: o.preset }); setPendingCompare(false); setCompareMonth(openMonth(o.window, anchor)); }}>
                  {compareChipLabel(o.preset, factDays)}
                </button>
              ))}
              <button type="button" className="gy-drp-preset" aria-pressed={dCompare.kind === 'custom'}
                onClick={() => { if (comparison) { setDCompare({ kind: 'custom', window: comparison }); setPendingCompare(false); } }}>
                Custom
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="gy-drp-right">
        <div className="gy-drp-cal">
          <Calendar month={rangeMonth} selected={drawn} weekStart={weekStart} aria-label="Range calendar" onPick={pickRange} onMonth={setRangeMonth} />
        </div>
        {compareOn && <div className="gy-drp-sep" role="separator" />}
        {compareOn && (
          <div className="gy-drp-cmpcal">
            <Calendar month={compareMonth} selected={comparison} weekStart={weekStart} aria-label="Comparison calendar" isDisabled={(d) => d > anchor} onPick={pickCompare} onMonth={setCompareMonth} />
          </div>
        )}
      </div>
    </div>
  );
}
