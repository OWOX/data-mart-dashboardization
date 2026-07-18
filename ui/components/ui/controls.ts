// Shared control class strings, built from the plugin's shadcn tokens (see ui/styles.src.css) so
// buttons/menus look identical across pages — one source of truth instead of ad-hoc inline markup.
// Mirrors the host's controls.ts, adjusted for the plugin's Tailwind 3.4 (shadow-sm, not v4's -xs).

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const BTN_BASE =
  'inline-flex items-center justify-center gap-2 rounded-md px-4 h-9 text-sm font-medium shadow-sm ' +
  `transition-colors cursor-pointer disabled:pointer-events-none disabled:opacity-50 ${FOCUS}`;

/** Outline / secondary button — the default CTA (matches the host's "New …" buttons). */
export const BTN = `${BTN_BASE} border border-muted bg-card text-foreground hover:bg-accent hover:text-accent-foreground`;

/** Text input (search, forms) — mirrors the host's INPUT. */
export const INPUT =
  `h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm ` +
  `transition-[color,box-shadow] placeholder:text-muted-foreground ${FOCUS}`;

/** Square ghost icon button — the kebab trigger. */
export const ICON_BTN =
  `inline-flex size-8 items-center justify-center rounded-md text-muted-foreground cursor-pointer ` +
  `transition-colors hover:bg-accent hover:text-foreground ${FOCUS}`;

/** Floating menu surface (popover). */
export const MENU = 'z-50 min-w-[9rem] rounded-lg border border-border bg-popover p-1 text-left shadow-md';
/** A menu row. */
export const MENU_ITEM = `flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm cursor-pointer hover:bg-accent ${FOCUS}`;
/** A destructive menu row (Delete). `bg-destructive-soft` is a solid token — opacity modifiers
 *  (e.g. `bg-destructive/10`) don't compile on the plugin's bare-var() oklch colors. */
export const MENU_ITEM_DANGER =
  `flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm cursor-pointer text-destructive hover:bg-destructive-soft ${FOCUS}`;
/** Divider above a destructive action. */
export const MENU_DIVIDER = 'my-1 h-px bg-border';
