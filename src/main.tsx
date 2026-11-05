import { createRoot } from 'react-dom/client';
import { connect } from '@owox/plugin-sdk';
import { App } from './App';
import { HostLoadingContext } from './ui/LoadingBar';
import './styles.css';

const root = createRoot(document.getElementById('root')!);

connect().then(
  (ctx) => {
    document.documentElement.classList.toggle('dark', ctx.theme === 'dark');
    root.render(<HostLoadingContext value={ctx.ui.startLoading}><App ctx={ctx} /></HostLoadingContext>);
  },
  () => {
    root.render(<p style={{ padding: 24 }}>Open Gyroscope from Plugins in OWOX Data Marts.</p>);
  },
);
