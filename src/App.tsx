import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AppShell } from "@/components/layout/AppShell";
import Auth from "./pages/Auth";
import ResetPassword from "./pages/ResetPassword";
import Dashboard from "./pages/Dashboard";
import MyTeaching from "./pages/trainer/MyTeaching";
import UploadDocuments from "./pages/trainer/UploadDocuments";
import MySubmissions from "./pages/trainer/MySubmissions";
import DepartmentQueue from "./pages/hod/DepartmentQueue";
import HodDashboard from "./pages/hod/Dashboard";
import ApprovalQueue from "./pages/dp/ApprovalQueue";
import ArchiveScreen from "./pages/iqa/ArchiveScreen";
import ManageUsers from "./pages/admin/ManageUsers";
import ManageAssignments from "./pages/admin/ManageAssignments";
import SessionExports from "./pages/admin/SessionExports";
import SystemSetup from "./pages/admin/SystemSetup";
import SystemBackups from "./pages/admin/SystemBackups";
import ApprovalPolicies from "./pages/admin/ApprovalPolicies";
import AuditLog from "./pages/admin/AuditLog";
import OffloadSchedules from "./pages/admin/OffloadSchedules";
import StorageAudit from "./pages/admin/StorageAudit";
import Reports from "./pages/Reports";
import ProfileSettings from "./pages/ProfileSettings";
import Notifications from "./pages/Notifications";
import VerifyDocument from "./pages/VerifyDocument";
import VerifyPack from "./pages/VerifyPack";
import VerifierPacks from "./pages/iqa/VerifierPacks";
import Verifiers from "./pages/iqa/Verifiers";
import PackReviews from "./pages/iqa/PackReviews";
import PackCapacity from "./pages/iqa/PackCapacity";
import BulkAssign from "./pages/iqa/BulkAssign";
import NotFound from "./pages/NotFound";
import { Loader2 } from "lucide-react";

const queryClient = new QueryClient();

function ProtectedRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/teaching" element={<MyTeaching />} />
        <Route path="/upload" element={<UploadDocuments />} />
        <Route path="/teaching/:assignmentId" element={<UploadDocuments />} />
        <Route path="/submissions" element={<MySubmissions />} />
        <Route path="/hod/queue" element={<DepartmentQueue />} />
        <Route path="/hod/dashboard" element={<HodDashboard />} />
        <Route path="/dp/queue" element={<ApprovalQueue />} />
        <Route path="/iqa/archive" element={<ArchiveScreen />} />
        <Route path="/iqa/verifier-packs" element={<VerifierPacks />} />
        <Route path="/iqa/verifiers" element={<Verifiers />} />
        <Route path="/iqa/packs/:packId/reviews" element={<PackReviews />} />
        <Route path="/iqa/pack-capacity" element={<PackCapacity />} />
        <Route path="/iqa/bulk-assign" element={<BulkAssign />} />
        <Route path="/admin/users" element={<ManageUsers />} />
        <Route path="/admin/assignments" element={<ManageAssignments />} />
        <Route path="/admin/exports" element={<SessionExports />} />
        <Route path="/admin/setup" element={<SystemSetup />} />
        <Route path="/admin/backups" element={<SystemBackups />} />
        <Route path="/admin/policies" element={<ApprovalPolicies />} />
        <Route path="/admin/audit" element={<AuditLog />} />
        <Route path="/admin/offload-schedules" element={<OffloadSchedules />} />
        <Route path="/admin/storage-audit" element={<StorageAudit />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/profile" element={<ProfileSettings />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/verify/:documentId" element={<VerifyDocument />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AppShell>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/verify/pack" element={<VerifyPack />} />
          <Route path="/*" element={<ProtectedRoutes />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
