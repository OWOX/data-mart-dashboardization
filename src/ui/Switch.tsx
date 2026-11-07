/** OWOX's Switch: a track with a thumb. A button with role switch, so it is named by a label or `aria-label` and toggles with Space or Enter. */
export function Switch({ checked, onChange, id, label, describedBy }: {
  checked: boolean; onChange: (next: boolean) => void; id?: string; label?: string; describedBy?: string;
}) {
  return (
    <button type="button" role="switch" id={id} aria-checked={checked} aria-label={label} aria-describedby={describedBy} data-state={checked ? 'checked' : 'unchecked'} className="gy-switch" onClick={() => onChange(!checked)}>
      <span className="gy-switch-thumb" aria-hidden="true" />
    </button>
  );
}
