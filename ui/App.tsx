import { Routes, Route, MemoryRouter } from 'react-router-dom';
import { DashboardList } from './components/DashboardList';
import { DashboardView } from './components/DashboardView';

export function App() {
  return (
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<DashboardList />} />
        <Route path="/d/:id" element={<DashboardView />} />
      </Routes>
    </MemoryRouter>
  );
}
