import { TopBar } from './TopBar';
import { BottomNav } from './BottomNav';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <TopBar />
      <main className="flex-1 px-4 py-4 pb-24 max-w-screen-lg mx-auto w-full">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
