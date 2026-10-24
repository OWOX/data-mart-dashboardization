import type { PluginContext } from '@owox/plugin-sdk';

export function App(_props: { ctx: PluginContext }) {
  return (
    <div className="gy-page">
      <main className="gy-main"><h1>Gyroscope</h1></main>
    </div>
  );
}
