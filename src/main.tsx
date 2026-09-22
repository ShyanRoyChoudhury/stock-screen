import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'
import { SettingsProvider } from './lib/settings'
import { ThemeProvider } from './lib/theme'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SettingsProvider>
          <ThemeProvider>
            <App />
          </ThemeProvider>
        </SettingsProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
