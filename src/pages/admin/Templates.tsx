import { useState } from 'react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { useTemplates, useUpsertTemplate, useToggleTemplate, useDeleteTemplate, getTemplateSignedUrl } from '@/hooks/useTemplates';
import { useAllDocuments } from '@/hooks/useDocuments';
import { DEPARTMENTS, ONE_TIME_DOC_TYPES, WEEKLY_DOC_TYPES } from '@/lib/sessions';
import { useRoleGuard } from '@/hooks/useRoleGuard';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Upload, Trash2, Eye, EyeOff, ExternalLink, Copy } from 'lucide-react';

const DOC_TYPES = [...ONE_TIME_DOC_TYPES, ...WEEKLY_DOC_TYPES];

export default function Templates() {
  const guard = useRoleGuard();
  const { data: templates, isLoading } = useTemplates({ includeInactive: true });
  const upsert = useUpsertTemplate();
  const toggle = useToggleTemplate();
  const del = useDeleteTemplate();

  const [documentType, setDocumentType] = useState<string>('Scheme of Work');
  const [department, setDepartment] = useState<string>('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>('');


  const [showPromote, setShowPromote] = useState(false);
  const { data: allDocs } = useAllDocuments();
  const archived = (allDocs || []).filter(d => d.status === 'ARCHIVED');

  if (!guard.isSuperAdmin) {
    return <p className="p-6 text-sm text-muted-foreground">Only Super Admin can manage templates.</p>;
  }

  const upload = async () => {
    if (!file || !title) {
      toast({ title: 'Missing fields', description: 'Pick a file and enter a title.', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      const path = `${documentType.replace(/\W+/g, '_')}/${Date.now()}_${file.name}`;
      const { error: uErr } = await supabase.storage.from('templates').upload(path, file, { contentType: file.type || 'application/pdf' });
      if (uErr) throw uErr;
      await upsert.mutateAsync({
        document_type: documentType,
        department: department || null,
        title,
        description: description || null,
        file_path: path,
        file_name: file.name,
      });
      toast({ title: 'Template uploaded' });
      setTitle(''); setDescription(''); setFile(null);
    } catch (e) {
      toast({ title: 'Upload failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const promoteFromArchive = async (docId: string) => {
    setBusy(true);
    try {
      const doc = archived.find(d => d.id === docId);
      if (!doc) throw new Error('Doc not found');
      const src = doc.signed_file_url || doc.file_url;
      if (!src) throw new Error('Doc has no file');
      // Parse storage ref
      const m = src.match(/\/storage\/v1\/object\/(?:public\/|sign\/)?([^/]+)\/(.+?)(?:\?|$)/);
      let bytes: ArrayBuffer;
      if (m) {
        const { data, error } = await supabase.storage.from(decodeURIComponent(m[1])).download(decodeURIComponent(m[2]));
        if (error || !data) throw error || new Error('download failed');
        bytes = await data.arrayBuffer();
      } else {
        const { data, error } = await supabase.storage.from('documents').download(src);
        if (error || !data) throw error || new Error('download failed');
        bytes = await data.arrayBuffer();
      }
      const path = `${doc.document_type.replace(/\W+/g, '_')}/promoted_${Date.now()}_${doc.file_name || 'template.pdf'}`;
      const { error: uErr } = await supabase.storage.from('templates').upload(path, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' });
      if (uErr) throw uErr;
      await upsert.mutateAsync({
        document_type: doc.document_type,
        department: doc.department,
        title: `${doc.document_type} — ${doc.unit_code || doc.file_name || 'sample'}`,
        description: `Promoted from archived document ${doc.id.slice(0, 8)}`,
        file_path: path,
        file_name: doc.file_name || 'template.pdf',
        source_document_id: doc.id,
      });
      toast({ title: 'Template created from archive' });
    } catch (e) {
      toast({ title: 'Promote failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const openTemplate = async (path: string) => {
    try {
      const url = await getTemplateSignedUrl(path);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      toast({ title: 'Cannot open', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    }
  };

  return (
    <div>
      <PageHeader title="Document Templates" subtitle="Sample approved documents trainers can download" />

      <Card>
        <CardContent className="p-4 space-y-3">
          <p className="text-sm font-semibold">Upload new template</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>Document type</Label>
              <Select value={documentType} onValueChange={setDocumentType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOC_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Department (optional — leave blank for all)</Label>
              <Select value={department || 'ALL'} onValueChange={(v) => setDepartment(v === 'ALL' ? '' : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All departments</SelectItem>
                  {DEPARTMENTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Scheme of Work — CDACC compliant sample" />
            </div>
            <div className="md:col-span-2">
              <Label>Description</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </div>
            <div className="md:col-span-2">
              <Label>PDF file</Label>
              <Input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={upload} disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />} Upload
            </Button>
            <Button variant="outline" onClick={() => setShowPromote(v => !v)}>
              <Copy className="w-4 h-4 mr-2" /> Promote from archive
            </Button>
          </div>

          {showPromote && (
            <div className="mt-2 border rounded p-2 max-h-64 overflow-auto space-y-1">
              <p className="text-xs text-muted-foreground">Pick an archived document to copy into the template library.</p>
              {archived.slice(0, 100).map(d => (
                <div key={d.id} className="flex items-center gap-2 text-xs p-1 hover:bg-muted rounded">
                  <span className="flex-1 truncate">{d.document_type} • {d.unit_code || d.file_name} • {d.department}</span>
                  <Button size="sm" variant="outline" onClick={() => promoteFromArchive(d.id)} disabled={busy}>Copy</Button>
                </div>
              ))}
              {archived.length === 0 && <p className="text-xs text-muted-foreground">No archived documents yet.</p>}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 space-y-2">
        <p className="text-sm font-semibold">Templates ({templates?.length ?? 0})</p>
        {isLoading && <Loader2 className="w-5 h-5 animate-spin" />}
        {templates?.map(t => (
          <Card key={t.id}>
            <CardContent className="p-3 flex items-center gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">{t.title}</p>
                <p className="text-xs text-muted-foreground">
                  {t.document_type} • {t.department || 'All departments'} • v{t.version}
                </p>
                {t.description && <p className="text-xs mt-1">{t.description}</p>}
              </div>
              <Badge variant={t.is_active ? 'default' : 'secondary'}>{t.is_active ? 'Active' : 'Hidden'}</Badge>
              <Button size="sm" variant="outline" onClick={() => openTemplate(t.file_path)}>
                <ExternalLink className="w-3.5 h-3.5" />
              </Button>
              <Button size="sm" variant="outline" onClick={() => toggle.mutate({ id: t.id, is_active: !t.is_active })}>
                {t.is_active ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </Button>
              <Button size="sm" variant="destructive" onClick={() => { if (confirm('Delete template?')) del.mutate(t.id); }}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
