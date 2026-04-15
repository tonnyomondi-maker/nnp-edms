import { useLocation, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { LayoutDashboard, BookOpen, ClipboardCheck, BarChart3, Archive } from 'lucide-react';
import { cn } from '@/lib/utils';

export function BottomNav() {
  const { pathname } = useLocation();
  const { activeRole } = useAuth();

  const trainerItems = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/teaching', icon: BookOpen, label: 'Teaching' },
    { to: '/submissions', icon: ClipboardCheck, label: 'My Docs' },
    { to: '/reports', icon: BarChart3, label: 'Reports' },
  ];

  const hodItems = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/hod/queue', icon: ClipboardCheck, label: 'Queue' },
    { to: '/reports', icon: BarChart3, label: 'Reports' },
  ];

  const dpItems = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/dp/queue', icon: ClipboardCheck, label: 'Approvals' },
    { to: '/reports', icon: BarChart3, label: 'Reports' },
  ];

  const iqaItems = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/iqa/archive', icon: Archive, label: 'Archive' },
    { to: '/reports', icon: BarChart3, label: 'Reports' },
  ];

  const navMap = {
    TRAINER: trainerItems,
    HOD: hodItems,
    DP_ACADEMICS: dpItems,
    IQA: iqaItems,
  };

  const items = navMap[activeRole];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t safe-area-pb">
      <div className="flex items-center justify-around max-w-screen-lg mx-auto">
        {items.map(item => {
          const active = pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                'flex flex-col items-center gap-0.5 py-2 px-3 touch-target transition-colors',
                active ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              <item.icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
