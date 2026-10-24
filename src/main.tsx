import { createRoot } from 'react-dom/client';
import { connect } from '@owox/plugin-sdk';
import { App } from './App';
import './styles.css';

const root = createRoot(document.getElementById('root')!);

connect().then(
  (ctx) => {
    document.documentElement.classList.toggle('light', ctx.theme === 'light');
    root.render(<App ctx={ctx} />);
  },
  () => {
    root.render(<p style={{ padding: 24 }}>Open Gyroscope from Plugins in OWOX Data Marts.</p>);
  },
);
