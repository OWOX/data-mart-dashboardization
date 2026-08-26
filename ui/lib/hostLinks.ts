import { getPluginContext } from './plugin-runtime';

/**
 * Open a page of the host app in a new tab.
 *
 * `ui.openExternal` is the only way a sandboxed plugin can open anything, and the host drops
 * anything that is not an absolute `https://` URL — but the frame has an opaque origin and is
 * served from the plugin's own delivery URL, so it cannot read the host's. `document.referrer`
 * supplies it: a cross-origin referrer is trimmed to the embedding page's origin, which is exactly
 * (and only) what is needed here.
 *
 * When there is no usable referrer — a stricter referrer policy, or a direct load outside a host —
 * it falls back to `ui.navigate`, which takes an app-relative path and resolves it host-side. That
 * replaces the dashboard rather than opening beside it, so it is the fallback, not the default.
 */
export async function openHostPage(path: string): Promise<void> {
  const ctx = await getPluginContext();
  const origin = hostOrigin();
  if (origin) {
    await ctx.ui.openExternal(`${origin}${path}`);
    return;
  }
  ctx.ui.navigate(path);
}

function hostOrigin(): string | null {
  try {
    const referrer = document.referrer;
    if (!referrer) return null;
    const url = new URL(referrer);
    return url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

/** The Data Mart's own page in the host app. */
export const dataMartPath = (projectId: string, dataMartId: string) =>
  `/ui/${encodeURIComponent(projectId)}/data-marts/${encodeURIComponent(dataMartId)}/data-setup`;
