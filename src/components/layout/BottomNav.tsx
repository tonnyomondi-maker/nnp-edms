import { useAuth, UserRole } from '@/contexts/AuthContext';
import { useLocation, Link } from 'react-router-dom';
import { Home, BookOpen, FileText, Users, Shield, ClipboardList, BarChart3, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

const trainerItems = [
  { to: '/', icon: Home, label: 'Home' },
  { to: '/teaching', icon: BookOpen, label: 'Teaching' },
  { to: '/submissions', icon: FileText, label: 'Submissions' },
  { to: '/reports', icon: BarChart3, label: 'Reports' },
];

const hodItems = [
  { to: '/', icon: Home, label: 'Home' },
  { to: '/hod/queue', icon: Users, label: 'Queue' },
  { to: '/reports', icon: BarChart3, label: 'Reports' },
];

const dpItems = [
  { to: '/', icon: Home, label: 'Home' },
  { to: '/dp/queue', icon: Shield, label: 'Approvals' },
  { to: '/admin/users', icon: Settings, label: 'Admin' },
  { to: '/reports', icon: BarChart3, label: 'Reports' },
];

const iqaItems = [
  { to: '/', icon: Home, label: 'Home' },
  { to: '/iqa/archive', icon: ClipboardList, label: 'Archive' },
  { to: '/reports', icon: BarChart3, label: 'Reports' },
];

const navMap: Record<UserRole, typeof trainerItems> = {
  TRAINER: trainerItems,
  HOD: hodItems,
  DP_ACADEMICS: dpItems,
  IQA: iqaItems,
};

export function BottomNav() {
  const { pathname } = useLocation();
  const { activeRole, currentUser } = useAuth();

  if (!currentUser) return null;

  const items = navMap[activeRole] || trainerItems;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border safe-area-bottom">
      <div className="flex justify-around items-center h-16">
        {items.map(item => {
          const active = pathname === item.to;
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                'flex flex-col items-center justify-center flex-1 h-full text-xs gap-0.5 transition-colors',
                active ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              <Icon className="w-5 h-5" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
