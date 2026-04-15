import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { AppShell } from "@/components/layout/AppShell";
import Dashboard from "./pages/Dashboard";
import MyTeaching from "./pages/trainer/MyTeaching";
import SubmitDocument from "./pages/trainer/SubmitDocument";
import MySubmissions from "./pages/trainer/MySubmissions";
import DepartmentQueue from "./pages/hod/DepartmentQueue";
import ApprovalQueue from "./pages/dp/ApprovalQueue";
import ArchiveScreen from "./pages/iqa/ArchiveScreen";
import Reports from "./pages/Reports";
import Notifications from "./pages/Notifications";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <AppShell>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/teaching" element={<MyTeaching />} />
              <Route path="/teaching/:assignmentId" element={<SubmitDocument />} />
              <Route path="/submissions" element={<MySubmissions />} />
              <Route path="/hod/queue" element={<DepartmentQueue />} />
              <Route path="/dp/queue" element={<ApprovalQueue />} />
              <Route path="/iqa/archive" element={<ArchiveScreen />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AppShell>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
