import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth } from './auth/RequireAuth'
import { LoginPage } from './auth/LoginPage'
import { MagicPage } from './auth/MagicPage'
import { HubPage } from './shell/HubPage'
import { ReportFrame } from './components/ReportFrame'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/magic" element={<MagicPage />} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<HubPage />} />
          <Route
            path="/enrollment"
            element={<ReportFrame src="/reports/enrollment/index.html" title="Enrollment" />}
          />
          <Route
            path="/housing"
            element={<ReportFrame src="/reports/housing/index.html" title="Housing" />}
          />
          <Route
            path="/mas/*"
            element={<ReportFrame src="/reports/mas/index.html" title="MA Follow-on Giving" />}
          />
          <Route
            path="/points/*"
            element={<ReportFrame src="/reports/points/index.html" title="MA Points" />}
          />
          <Route
            path="/alumni/*"
            element={<ReportFrame src="/reports/alumni/index.html" title="Alumni Coverage" />}
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
