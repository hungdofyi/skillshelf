import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster, toast } from 'sonner';
import './styles/theme.css';
import { ApiError } from './api/client';
import { EventsProvider } from './api/events-provider';
import { TooltipProvider } from './components/ui/tooltip';
import { useIsDark } from './lib/theme';
import { AppShell } from './app-shell';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      // 4xx answers are final; only retry network / 5xx failures.
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
  // Mutations report failures as toasts unless the caller opts out (`meta: { silent: true }`).
  mutationCache: new MutationCache({
    onError: (err, _vars, _ctx, mutation) => {
      if (mutation.meta?.silent) return;
      toast.error(err instanceof Error ? err.message : 'Request failed');
    },
  }),
});

function Root() {
  const dark = useIsDark();
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <EventsProvider>
          <AppShell />
        </EventsProvider>
      </TooltipProvider>
      <Toaster position="bottom-right" theme={dark ? 'dark' : 'light'} closeButton toastOptions={{ style: { fontFamily: 'var(--font-ui)', fontSize: '13px' } }} />
    </QueryClientProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
