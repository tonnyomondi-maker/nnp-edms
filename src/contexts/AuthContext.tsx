import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import type { Tables } from '@/integrations/supabase/types';

export type UserRole = 'TRAINER' | 'HOD' | 'DP_ACADEMICS' | 'IQA' | 'SUPER_ADMIN';

export interface AppUser {
  id: string; // auth user id
  profileId: string;
  name: string;
  email: string;
  pfNumber: string | null;
  department: string | null;
  roles: UserRole[];
}

interface AuthContextType {
  user: SupabaseUser | null;
  currentUser: AppUser | null;
  activeRole: UserRole;
  setActiveRole: (role: UserRole) => void;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [activeRole, setActiveRole] = useState<UserRole>('TRAINER');
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (authUser: SupabaseUser) => {
    // Fetch profile (with one retry for fault tolerance)
    let profile = null;
    for (let attempt = 0; attempt < 2 && !profile; attempt++) {
      const { data } = await supabase.from('profiles').select('*').eq('user_id', authUser.id).maybeSingle();
      profile = data;
      if (!profile && attempt === 0) await new Promise(r => setTimeout(r, 600));
    }

    // Auto-bootstrap super admin for designated email
    if (authUser.email?.toLowerCase() === 'tonny.omondi@nyamirapoly.ac.ke') {
      try { await supabase.rpc('bootstrap_super_admin' as never, { target_email: authUser.email } as never); } catch { /* already set */ }
    }

    // Fetch roles
    const { data: roles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', authUser.id);

    const userRoles = (roles?.map(r => r.role) as UserRole[]) || ['TRAINER'];

    setCurrentUser({
      id: authUser.id,
      profileId: profile?.id ?? authUser.id,
      name: profile?.full_name ?? authUser.email ?? 'User',
      email: profile?.email ?? authUser.email ?? '',
      pfNumber: profile?.pf_number ?? null,
      department: profile?.department ?? null,
      roles: userRoles.length > 0 ? userRoles : ['TRAINER'],
    });
    setActiveRole(userRoles[0] || 'TRAINER');
  }, []);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        loadProfile(session.user);
      }
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        loadProfile(session.user);
      } else {
        setCurrentUser(null);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setCurrentUser(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, currentUser, activeRole, setActiveRole, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
