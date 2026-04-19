import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { lovable } from '@/integrations/lovable/index';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import polytechnicLogo from '@/assets/polytechnic-logo.jpg';
import { Footer } from '@/components/layout/Footer';

export default function Auth() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [resetEmail, setResetEmail] = useState('');

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [pfNumber, setPfNumber] = useState('');
  const [department, setDepartment] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password: loginPassword,
    });
    setLoading(false);
    if (error) {
      toast({ title: 'Login failed', description: error.message, variant: 'destructive' });
    } else {
      navigate('/');
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName || !department) {
      toast({ title: 'Missing fields', description: 'Please fill in all fields', variant: 'destructive' });
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email: signupEmail,
      password: signupPassword,
      options: {
        data: {
          full_name: fullName,
          pf_number: pfNumber,
          department: department,
        },
      },
    });
    setLoading(false);
    if (error) {
      toast({ title: 'Signup failed', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Check your email', description: 'A verification link has been sent to your email.' });
    }
  };

  const handleResetRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) {
      toast({ title: 'Reset failed', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Check your email', description: 'A password reset link has been sent.' });
      setResetMode(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });

    if (result.error) {
      toast({ title: 'Google sign-in failed', description: String(result.error), variant: 'destructive' });
      setGoogleLoading(false);
      return;
    }

    if (result.redirected) {
      return;
    }

    navigate('/');
    setGoogleLoading(false);
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex-1 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <img src={polytechnicLogo} alt="Nyamira National Polytechnic" className="w-20 h-20 mx-auto object-contain mb-2" />
          <CardTitle className="text-xl font-bold text-primary">The Nyamira National Polytechnic</CardTitle>
          <p className="text-xs text-secondary font-medium">Home of Innovation</p>
          <p className="text-sm text-muted-foreground mt-2">Academic Document Management System</p>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            className="w-full touch-target mb-4 gap-2"
            onClick={handleGoogleSignIn}
            disabled={googleLoading}
          >
            {googleLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
            )}
            Continue with Google
          </Button>

          <div className="relative mb-4">
            <Separator />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
              or
            </span>
          </div>

          <Tabs defaultValue="login">
            <TabsList className="w-full mb-4">
              <TabsTrigger value="login" className="flex-1">Login</TabsTrigger>
              <TabsTrigger value="signup" className="flex-1">Sign Up</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              {resetMode ? (
                <form onSubmit={handleResetRequest} className="space-y-4">
                  <div>
                    <Label>Email</Label>
                    <Input type="email" value={resetEmail} onChange={e => setResetEmail(e.target.value)} placeholder="you@institution.ac.ke" required className="mt-1" />
                    <p className="text-xs text-muted-foreground mt-2">
                      We'll send a password reset link to this email.
                    </p>
                  </div>
                  <Button type="submit" className="w-full touch-target" disabled={loading}>
                    {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Send reset link
                  </Button>
                  <button
                    type="button"
                    onClick={() => setResetMode(false)}
                    className="w-full text-sm text-muted-foreground hover:text-foreground"
                  >
                    Back to login
                  </button>
                </form>
              ) : (
                <form onSubmit={handleLogin} className="space-y-4">
                  <div>
                    <Label>Email</Label>
                    <Input type="email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} placeholder="you@institution.ac.ke" required className="mt-1" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <Label>Password</Label>
                      <button
                        type="button"
                        onClick={() => { setResetEmail(loginEmail); setResetMode(true); }}
                        className="text-xs text-primary hover:underline"
                      >
                        Forgot password?
                      </button>
                    </div>
                    <Input type="password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} placeholder="••••••••" required className="mt-1" />
                  </div>
                  <Button type="submit" className="w-full touch-target" disabled={loading}>
                    {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Login
                  </Button>
                </form>
              )}
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignup} className="space-y-4">
                <div>
                  <Label>Full Name</Label>
                  <Input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="John Doe" required className="mt-1" />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input type="email" value={signupEmail} onChange={e => setSignupEmail(e.target.value)} placeholder="you@institution.ac.ke" required className="mt-1" />
                </div>
                <div>
                  <Label>PF Number</Label>
                  <Input value={pfNumber} onChange={e => setPfNumber(e.target.value)} placeholder="PF001" className="mt-1" />
                </div>
                <div>
                  <Label>Department</Label>
                  <Input value={department} onChange={e => setDepartment(e.target.value)} placeholder="Computer Science" required className="mt-1" />
                </div>
                <div>
                  <Label>Password</Label>
                  <Input type="password" value={signupPassword} onChange={e => setSignupPassword(e.target.value)} placeholder="Min 6 characters" required minLength={6} className="mt-1" />
                </div>
                <Button type="submit" className="w-full touch-target" disabled={loading}>
                  {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Sign Up
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
      </div>
      <Footer />
    </div>
  );
}
