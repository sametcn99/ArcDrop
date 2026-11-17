import { createRoot } from 'react-dom/client';
import { App } from './App';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Options root element is missing');
}

createRoot(container).render(<App />);
