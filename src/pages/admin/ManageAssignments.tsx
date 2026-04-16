import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/common/PageHeader';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Link } from 'react-router-dom';
import { Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import type { Tables } from '@/integrations/supabase/types';

type Assignment = Tables<'teaching_assignments'>;
type Profile = Tables<'profiles'>;

const EMPTY_FORM = {
  trainer_id: '',
  unit_code: '',
  unit_name: '',
  class_code: '',
  department: '',
  term: 'Term 1',
  academic_year: '2024/2025',
};

export default function ManageAssignments() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    const [aRes, pRes] = await Promise.all([
      supabase.from('teaching_assignments').select('*').order('created_at', { ascending: false }),
      supabase.from('profiles').select('*'),
    ]);
    if (aRes.data) setAssignments(aRes.data);
    if (pRes.data) setProfiles(pRes.data);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const trainerName = (id: string) => profiles.find(p => p.user_id === id)?.full_name || 'Unknown';

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (a: Assignment) => {
    setEditingId(a.id);
    setForm({
      trainer_id: a.trainer_id,
      unit_code: a.unit_code,
      unit_name: a.unit_name,
      class_code: a.class_code,
      department: a.department,
      term: a.term,
      academic_year: a.academic_year,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.trainer_id || !form.unit_code || !form.unit_name || !form.class_code || !form.department) {
      toast({ title: 'Missing fields', description: 'Please fill all required fields', variant: 'destructive' });
      return;
    }
    setSaving(true);
    if (editingId) {
      const { error } = await supabase.from('teaching_assignments').update(form).eq('id', editingId);
      if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
      else toast({ title: 'Assignment updated' });
    } else {
      const { error } = await supabase.from('teaching_assignments').insert(form);
      if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
      else toast({ title: 'Assignment created' });
    }
    setSaving(false);
    setDialogOpen(false);
    fetchData();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('teaching_assignments').delete().eq('id', id);
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Assignment deleted' }); fetchData(); }
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Admin Panel" subtitle="Manage users, roles, and assignments" />

      <Tabs defaultValue="assignments">
        <TabsList className="w-full">
          <TabsTrigger value="users" className="flex-1" asChild>
            <Link to="/admin/users">Users & Roles</Link>
          </TabsTrigger>
          <TabsTrigger value="assignments" className="flex-1" asChild>
            <Link to="/admin/assignments">Assignments</Link>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <Button onClick={openCreate} size="sm" className="gap-1">
        <Plus className="w-4 h-4" /> New Assignment
      </Button>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Trainer</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Dept</TableHead>
                <TableHead>Term</TableHead>
                <TableHead className="w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.map(a => (
                <TableRow key={a.id}>
                  <TableCell className="text-sm">{trainerName(a.trainer_id)}</TableCell>
                  <TableCell>
                    <div className="text-sm font-medium">{a.unit_code}</div>
                    <div className="text-xs text-muted-foreground">{a.unit_name}</div>
                  </TableCell>
                  <TableCell className="text-sm">{a.class_code}</TableCell>
                  <TableCell className="text-sm">{a.department}</TableCell>
                  <TableCell className="text-xs">{a.term} {a.academic_year}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(a)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(a.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {assignments.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No assignments yet
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit' : 'Create'} Assignment</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Trainer</Label>
              <Select value={form.trainer_id} onValueChange={v => setForm(f => ({ ...f, trainer_id: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select trainer" /></SelectTrigger>
                <SelectContent>
                  {profiles.map(p => (
                    <SelectItem key={p.user_id} value={p.user_id}>{p.full_name} ({p.email})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Unit Code</Label>
                <Input className="mt-1" value={form.unit_code} onChange={e => setForm(f => ({ ...f, unit_code: e.target.value }))} placeholder="CS101" />
              </div>
              <div>
                <Label>Class Code</Label>
                <Input className="mt-1" value={form.class_code} onChange={e => setForm(f => ({ ...f, class_code: e.target.value }))} placeholder="DIT-Y1" />
              </div>
            </div>
            <div>
              <Label>Unit Name</Label>
              <Input className="mt-1" value={form.unit_name} onChange={e => setForm(f => ({ ...f, unit_name: e.target.value }))} placeholder="Intro to CS" />
            </div>
            <div>
              <Label>Department</Label>
              <Input className="mt-1" value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} placeholder="Computer Science" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Term</Label>
                <Select value={form.term} onValueChange={v => setForm(f => ({ ...f, term: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Term 1">Term 1</SelectItem>
                    <SelectItem value="Term 2">Term 2</SelectItem>
                    <SelectItem value="Term 3">Term 3</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Academic Year</Label>
                <Input className="mt-1" value={form.academic_year} onChange={e => setForm(f => ({ ...f, academic_year: e.target.value }))} placeholder="2024/2025" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editingId ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
