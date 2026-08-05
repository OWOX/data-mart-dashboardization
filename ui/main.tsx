import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initializePlugin } from './lib/plugin-runtime';
import './styles.css';

async function bootstrap(): Promise<void> {
  const root = createRoot(document.getElementById('root')!);
  try {
    await initializePlugin();
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
