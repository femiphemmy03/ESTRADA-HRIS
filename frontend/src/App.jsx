import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/layout/Layout.jsx';
import ProtectedRoute from './components/shared/ProtectedRoute.jsx';

import Login from './pages/auth/Login.jsx';
import SetPassword from './pages/auth/SetPassword.jsx';
import Dashboard from './pages/dashboard/Dashboard.jsx';
import EmployeesList from './pages/employees/EmployeesList.jsx';
import EmployeeProfile from './pages/employees/EmployeeProfile.jsx';
import Onboarding from './pages/onboarding/Onboarding.jsx';
import Documents from './pages/documents/Documents.jsx';
import Attendance from './pages/attendance/Attendance.jsx';
import Leave from './pages/leave/Leave.jsx';
import Payroll from './pages/payroll/Payroll.jsx';
import Clients from './pages/clients/Clients.jsx';
import Exit from './pages/exit/Exit.jsx';
import Admin from './pages/admin/Admin.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/onboarding/set-password" element={<SetPassword />} />

      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/employees" element={<ProtectedRoute roles={['SUPER_ADMIN', 'HR_ADMIN', 'PAYROLL_OFFICER', 'TEAM_LEAD']}><EmployeesList /></ProtectedRoute>} />
        <Route path="/employees/:id" element={<EmployeeProfile />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/documents" element={<Documents />} />
        <Route path="/attendance" element={<Attendance />} />
        <Route path="/leave" element={<Leave />} />
        <Route path="/payroll" element={<Payroll />} />
        <Route path="/clients" element={<ProtectedRoute roles={['SUPER_ADMIN', 'HR_ADMIN', 'TEAM_LEAD']}><Clients /></ProtectedRoute>} />
        <Route path="/exit" element={<ProtectedRoute roles={['SUPER_ADMIN', 'HR_ADMIN']}><Exit /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute roles={['SUPER_ADMIN', 'HR_ADMIN']}><Admin /></ProtectedRoute>} />
      </Route>

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
