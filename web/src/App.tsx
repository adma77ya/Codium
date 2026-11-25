import { Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Leaderboard } from './pages/Leaderboard'
import { Login } from './pages/Login'
import { Problems } from './pages/Problems'
import { Workspace } from './pages/Workspace'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Problems />} />
        <Route path="problems/:slug" element={<Workspace />} />
        <Route path="login" element={<Login />} />
        <Route path="leaderboard" element={<Leaderboard />} />
        <Route path="*" element={<Problems />} />
      </Route>
    </Routes>
  )
}
