import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/common/PageHeader';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { Loader2, Save } from 'lucide-react';

export default function ProfileSettings() {
  const { currentUser, activeRole } = useAuth();
  const [fullName, setFullName] = useState('');
  const [pfNumber, setPfNumber] = useState('');
  const [department, setDepartment] = useState('');
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) return;
    const fetchProfile = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', currentUser.id)
        .single();
      if (data) {
        setFullName(data.full_name || '');
        setPfNumber(data.pf_number || '');
        setDepartment(data.department || '');
      }
      setInitialLoading(false);
    };
    fetchProfile();
  }, [currentUser]);

  const handleSave = async () => {
    if (!currentUser) return;
    setLoading(true);
    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: fullName,
        pf_number: pfNumber,
        department: department,
      })
      .eq('user_id', currentUser.id);
    setLoading(false);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Profile updated successfully' });
    }
  };

  if (initialLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Profile Settings" subtitle="Update your personal information" />

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div>
            <Label>Email</Label>
            <Input value={currentUser?.email || ''} disabled className="mt-1 bg-muted" />
            <p className="text-xs text-muted-foreground mt-1">Email cannot be changed</p>
          </div>

          <div>
            <Label>Full Name</Label>
            <Input
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Your full name"
              className="mt-1"
            />
          </div>

          <div>
            <Label>PF Number</Label>
            <Input
              value={pfNumber}
              onChange={e => setPfNumber(e.target.value)}
              placeholder="PF001"
              className="mt-1"
            />
          </div>

          <div>
            <Label>Department</Label>
            <Input
              value={department}
              onChange={e => setDepartment(e.target.value)}
              placeholder="Computer Science"
              className="mt-1"
            />
          </div>

          <div>
            <Label>Roles</Label>
            <div className="flex flex-wrap gap-1 mt-1">
              {currentUser?.roles.map(role => (
                <Badge key={role} variant={role === activeRole ? 'default' : 'secondary'}>
                  {role}
                </Badge>
              ))}
            </div>
          </div>

          <Button onClick={handleSave} disabled={loading} className="w-full touch-target gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
