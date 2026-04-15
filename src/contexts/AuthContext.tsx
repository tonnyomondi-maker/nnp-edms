import React, { createContext, useContext, useState, useCallback } from 'react';
import { User, UserRole, mockUsers } from '@/data/mockData';

interface AuthContextType {
  currentUser: User;
  activeRole: UserRole;
  setActiveRole: (role: UserRole) => void;
  switchUser: (userId: string) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User>(mockUsers[0]);
  const [activeRole, setActiveRole] = useState<UserRole>(mockUsers[0].roles[0]);

  const switchUser = useCallback((userId: string) => {
    const user = mockUsers.find(u => u.id === userId);
    if (user) {
      setCurrentUser(user);
      setActiveRole(user.roles[0]);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ currentUser, activeRole, setActiveRole, switchUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
