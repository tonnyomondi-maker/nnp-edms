import { useAuth, UserRole } from '@/contexts/AuthContext';
import { Link } from 'react-router-dom';
import { Bell, LogOut, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUnreadNotificationCount } from '@/hooks/useNotifications';
import polytechnicLogo from '@/assets/polytechnic-logo.jpg';


const roleLabels: Record<UserRole, string> = {
  TRAINER: 'Trainer',
  HOD: 'Head of Dept',
  DP_ACADEMICS: 'DP Academics',
  IQA: 'IQAO',
  SUPER_ADMIN: 'Super Admin',
};

export function TopBar() {
  const { currentUser, activeRole, setActiveRole, signOut } = useAuth();
  const unread = useUnreadNotificationCount();

  if (!currentUser) return null;

  return (
    <header className="sticky top-0 z-50 bg-card border-b px-4 py-3">
      <div className="flex items-center justify-between max-w-screen-lg mx-auto">
        <Link to="/" className="flex items-center gap-2 min-w-0">
          <img src={polytechnicLogo} alt="Nyamira National Polytechnic" className="w-8 h-8 object-contain shrink-0" />
          <div className="flex flex-col leading-tight min-w-0">
            <span className="font-bold text-xs text-primary truncate">Nyamira Polytechnic</span>
            <span className="text-[10px] text-muted-foreground truncate">EDMS</span>
          </div>
        </Link>
        <div className="flex items-center gap-2">
          <Link to="/notifications" className="relative p-2" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
            <Bell className="w-5 h-5 text-muted-foreground" />
            {unread > 0 && (
              <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[9px] font-semibold flex items-center justify-center">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
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
