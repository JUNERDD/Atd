import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

// Follow the system appearance: `@atd/ui` themes switch on the `dark` class of <html>.
const scheme = window.matchMedia('(prefers-color-scheme: dark)');
const applyScheme = () => {
  document.documentElement.classList.toggle('dark', scheme.matches);
  document.documentElement.style.colorScheme = scheme.matches ? 'dark' : 'light';
};
applyScheme();
scheme.addEventListener('change', applyScheme);

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element.');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
