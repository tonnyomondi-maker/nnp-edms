import { useAuth } from '@/contexts/AuthContext';
import { UserRole, mockUsers } from '@/data/mockData';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Bell, GraduationCap, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { mockNotifications } from '@/data/mockData';

const roleLabels: Record<UserRole, string> = {
  TRAINER: 'Trainer',
  HOD: 'Head of Dept',
  DP_ACADEMICS: 'DP Academics',
  IQA: 'IQA Officer',
};

export function TopBar() {
  const { currentUser, activeRole, setActiveRole, switchUser } = useAuth();
  const unread = mockNotifications.filter(n => n.userId === currentUser.id && !n.read).length;

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
            {unread > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-destructive text-destructive-foreground text-[10px] flex items-center justify-center font-bold">
                {unread}
              </span>
            )}
          </Link>
          <Select value={currentUser.id} onValueChange={switchUser}>
            <SelectTrigger className="w-auto gap-1 h-8 text-xs border-0 bg-secondary">
              <Users className="w-3.5 h-3.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {mockUsers.map(u => (
                <SelectItem key={u.id} value={u.id} className="text-xs">
                  {u.name} ({u.roles.map(r => roleLabels[r]).join(', ')})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
