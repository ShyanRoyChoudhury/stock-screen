import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router'
import { Shell } from './components/Shell'
import { Loading } from './ds'

const TodayPage = lazy(() => import('./pages/today'))
const SignalsPage = lazy(() => import('./pages/signals'))
const SymbolPage = lazy(() => import('./pages/symbol'))
const PositionsPage = lazy(() => import('./pages/positions'))
const TradesPage = lazy(() => import('./pages/trades'))
const BrokersPage = lazy(() => import('./pages/brokers'))
const OpsPage = lazy(() => import('./pages/ops'))
const OptionsPage = lazy(() => import('./pages/options'))
const SettingsPage = lazy(() => import('./pages/settings'))

function NotFound() {
  return (
    <div>
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="text-sm text-muted">There's no page at this address.</p>
    </div>
  )
}

export default function App() {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<TodayPage />} />
          <Route path="/signals" element={<SignalsPage />} />
          <Route path="/symbols/:symbol" element={<SymbolPage />} />
          <Route path="/positions" element={<PositionsPage />} />
          <Route path="/positions/:id" element={<PositionsPage />} />
          <Route path="/trades" element={<TradesPage />} />
          <Route path="/brokers" element={<BrokersPage />} />
          <Route path="/ops" element={<OpsPage />} />
          <Route path="/options" element={<OptionsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </Shell>
  )
}
