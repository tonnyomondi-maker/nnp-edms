import { useAuth, UserRole } from '@/contexts/AuthContext';
import { Link } from 'react-router-dom';
import { Bell, GraduationCap, LogOut, User } from 'lucide-react';
import { Button } from '@/components/ui/button';

const roleLabels: Record<UserRole, string> = {
  TRAINER: 'Trainer',
  HOD: 'Head of Dept',
  DP_ACADEMICS: 'DP Academics',
  IQA: 'IQA Officer',
};

export function TopBar() {
  const { currentUser, activeRole, setActiveRole, signOut } = useAuth();

  if (!currentUser) return null;

  return (
    <header className="sticky top-0 z-50 bg-card border-b px-4 py-3">
      <div className="flex items-center justify-between max-w-screen-lg mx-auto">
        <div className="flex items-center gap-2">
          <GraduationCap className="w-6 h-6 text-primary" />
          <span className="font-bold text-sm">EDMS</span>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/notifications" className="relative p-2">
            <Bell className="w-5 h-5 text-muted-foreground" />
          </Link>
          <Link to="/profile" className="text-xs font-medium truncate max-w-[100px] flex items-center gap-1 hover:text-primary transition-colors">
            <User className="w-3.5 h-3.5" />
            {currentUser.name}
          </Link>
          <Button variant="ghost" size="icon" onClick={signOut} className="h-8 w-8">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </div>
      {currentUser.roles.length > 1 && (
        <div className="flex gap-1 mt-2 max-w-screen-lg mx-auto">
          {currentUser.roles.map(role => (
            <button
              key={role}
              onClick={() => setActiveRole(role)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors touch-target ${
                activeRole === role
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground'
              }`}
            >
              {roleLabels[role]}
            </button>
          ))}
        </div>
      )}
    </header>
  );
}
