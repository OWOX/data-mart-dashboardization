import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initializePlugin } from './lib/plugin-runtime';
import './styles.css';

/**
 * Framed by the host, the page stays transparent so the host's rounded content surface shows
 * through (see styles.src.css); standalone there is nothing behind it, so it paints its own.
 */
const STANDALONE = window.self === window.top;

async function bootstrap(): Promise<void> {
  document.documentElement.classList.toggle('dm-standalone', STANDALONE);
  const root = createRoot(document.getElementById('root')!);
  try {
    const ctx = await initializePlugin();
    // Adopt the host's theme before first paint — with no surface of our own, dark-mode text on the
    // host's dark surface is unreadable until `.dark` is on.
    document.documentElement.classList.toggle('dark', ctx.theme === 'dark');
    root.render(<App />);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown plugin initialization error';
    root.render(
      <main className="grid min-h-screen place-items-center p-6 text-sm text-red-700">
        <div>
          <h1 className="mb-2 text-base font-semibold">Couldn&rsquo;t start Dashboards</h1>
          <p>{message}</p>
        </div>
      </main>,
    );
  }
}

void bootstrap();
