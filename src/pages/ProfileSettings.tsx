import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/common/PageHeader';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/hooks/use-toast';
import { Loader2, Save, Upload, CheckCircle2, AlertCircle, Trash2 } from 'lucide-react';
import { SignatureCreator } from '@/components/common/SignatureCreator';

export default function ProfileSettings() {
  const { currentUser, activeRole } = useAuth();
  const [fullName, setFullName] = useState('');
  const [pfNumber, setPfNumber] = useState('');
  const [department, setDepartment] = useState('');
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [stampUrl, setStampUrl] = useState<string | null>(null);
  const [stampRequired, setStampRequired] = useState(true);
  const [uploadingSig, setUploadingSig] = useState(false);
  const [uploadingStamp, setUploadingStamp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const sigInputRef = useRef<HTMLInputElement>(null);
  const stampInputRef = useRef<HTMLInputElement>(null);

  const isApprover = currentUser?.roles.some(r => r === 'HOD' || r === 'DP_ACADEMICS' || r === 'IQA');

  useEffect(() => {
    if (!currentUser) return;
    const fetchProfile = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', currentUser.id)
        .single();
      if (data) {
        const d = data as unknown as Record<string, unknown>;
        setFullName((d.full_name as string) || '');
        setPfNumber((d.pf_number as string) || '');
        setDepartment((d.department as string) || '');
        setSignatureUrl((d.signature_url as string) || null);
        setStampUrl((d.stamp_url as string) || null);
        setStampRequired(d.stamp_required !== false);
      }
      setInitialLoading(false);
    };
    fetchProfile();
  }, [currentUser]);

  const persistAsset = async (kind: 'signature' | 'stamp', blob: Blob, ext = 'png', contentType = 'image/png') => {
    if (!currentUser) return null;
    const path = `${currentUser.id}/${kind}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('signatures')
      .upload(path, blob, { upsert: true, contentType });
    if (upErr) throw upErr;
    const { data: urlData } = supabase.storage.from('signatures').getPublicUrl(path);
    const updates = kind === 'signature'
      ? { signature_url: urlData.publicUrl }
      : { stamp_url: urlData.publicUrl };
    const { error: dbErr } = await supabase
      .from('profiles')
      .update(updates)
      .eq('user_id', currentUser.id);
    if (dbErr) throw dbErr;
    return `${urlData.publicUrl}?t=${Date.now()}`;
  };

  const handleUploadAsset = async (kind: 'signature' | 'stamp', file: File) => {
    const setUploading = kind === 'signature' ? setUploadingSig : setUploadingStamp;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
      const cb = await persistAsset(kind, file, ext, file.type);
      if (kind === 'signature') setSignatureUrl(cb); else setStampUrl(cb);
      toast({ title: `${kind === 'signature' ? 'Signature' : 'Stamp'} updated` });
    } catch (e) {
      toast({ title: 'Upload failed', description: (e as Error).message, variant: 'destructive' });
    } finally { setUploading(false); }
  };

  const handleCreatedSignature = async (blob: Blob) => {
    setUploadingSig(true);
    try {
      const cb = await persistAsset('signature', blob, 'png', 'image/png');
      setSignatureUrl(cb);
      toast({ title: 'Signature saved' });
    } catch (e) {
      toast({ title: 'Save failed', description: (e as Error).message, variant: 'destructive' });
    } finally { setUploadingSig(false); }
  };

  const handleRemoveStamp = async () => {
    if (!currentUser) return;
    try {
      await supabase.from('profiles').update({ stamp_url: null }).eq('user_id', currentUser.id);
      setStampUrl(null);
      toast({ title: 'Stamp removed' });
    } catch (e) {
      toast({ title: 'Failed to remove stamp', description: (e as Error).message, variant: 'destructive' });
    }
  };

  const handleToggleStampRequired = async (val: boolean) => {
    if (!currentUser) return;
    setStampRequired(val);
    await supabase
      .from('profiles')
      .update({ stamp_required: val } as never)
      .eq('user_id', currentUser.id);
    toast({ title: val ? 'Stamp now required' : 'Stamp now optional', description: val ? 'Approvals will need both signature and stamp.' : 'You can approve with just your signature.' });
  };

  const handleSave = async () => {
    if (!currentUser) return;
    setLoading(true);
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName, pf_number: pfNumber, department })
      .eq('user_id', currentUser.id);
    setLoading(false);
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else toast({ title: 'Profile updated successfully' });
  };

  if (initialLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  // Approval readiness summary
  const sigReady = !!signatureUrl;
  const stampReady = !!stampUrl;
  const ready = sigReady && (!stampRequired || stampReady);

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
            <Input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Your full name" className="mt-1" />
          </div>
          <div>
            <Label>PF Number</Label>
            <Input value={pfNumber} onChange={e => setPfNumber(e.target.value)} placeholder="PF001" className="mt-1" />
          </div>
          <div>
            <Label>Department</Label>
            <Input value={department} onChange={e => setDepartment(e.target.value)} placeholder="Computer Science" className="mt-1" />
          </div>
          <div>
            <Label>Roles</Label>
            <div className="flex flex-wrap gap-1 mt-1">
              {currentUser?.roles.map(role => (
                <Badge key={role} variant={role === activeRole ? 'default' : 'secondary'}>{role}</Badge>
              ))}
            </div>
          </div>
          <Button onClick={handleSave} disabled={loading} className="w-full touch-target gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </Button>
        </CardContent>
      </Card>

      {isApprover && (
        <Card>
          <CardContent className="pt-6 space-y-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold text-sm">Signature & Stamp</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Used when you approve, verify, or archive documents.</p>
              </div>
              {ready ? (
                <Badge variant="default" className="gap-1"><CheckCircle2 className="w-3 h-3" /> Ready</Badge>
              ) : (
                <Badge variant="destructive" className="gap-1"><AlertCircle className="w-3 h-3" /> Needs setup</Badge>
              )}
            </div>

            {/* Signature — upload, draw, or type */}
            <div className="space-y-2">
              <Label>Signature</Label>
              <Tabs defaultValue="upload">
                <TabsList className="w-full">
                  <TabsTrigger value="upload" className="flex-1">Upload image</TabsTrigger>
                  <TabsTrigger value="create" className="flex-1">Draw or type</TabsTrigger>
                </TabsList>
                <TabsContent value="upload" className="pt-3">
                  <div className="flex items-center gap-3">
                    <div className="w-32 h-16 rounded border border-border bg-muted flex items-center justify-center overflow-hidden">
                      {signatureUrl ? (
                        <img src={signatureUrl} alt="signature" className="max-h-full max-w-full object-contain" />
                      ) : (
                        <span className="text-[10px] text-muted-foreground">No signature</span>
                      )}
                    </div>
                    <input
                      ref={sigInputRef}
                      type="file"
                      accept="image/png,image/jpeg"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && handleUploadAsset('signature', e.target.files[0])}
                    />
                    <Button variant="outline" size="sm" disabled={uploadingSig} onClick={() => sigInputRef.current?.click()} className="gap-1">
                      {uploadingSig ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                      {signatureUrl ? 'Replace' : 'Upload'}
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-2">Transparent PNG recommended for cleanest embedding.</p>
                </TabsContent>
                <TabsContent value="create" className="pt-3">
                  <SignatureCreator defaultName={fullName} onSave={handleCreatedSignature} saving={uploadingSig} />
                </TabsContent>
              </Tabs>
              {signatureUrl && (
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-[10px] text-muted-foreground">Current preview:</span>
                  <img src={signatureUrl} alt="current sig" className="h-8 max-w-[140px] object-contain bg-white rounded border" />
                </div>
              )}
            </div>

            {/* Stamp settings — per-document-type policy controls when stamp is mandatory.
                The approver can still upload/replace/remove a stamp image. */}
            <div className="space-y-2 border-t pt-4">
              <div className="flex items-center justify-between gap-2">
                <Label className="flex flex-col">
                  <span>Use signature-only when policy allows</span>
                  <span className="text-[10px] font-normal text-muted-foreground">
                    Super Admin sets per-document-type rules. When a document type allows it and this is on, your approvals skip the stamp.
                  </span>
                </Label>
                <Switch checked={!stampRequired} onCheckedChange={(v) => handleToggleStampRequired(!v)} />
              </div>

              <div className="flex items-center gap-3 pt-1">
                <div className="w-20 h-20 rounded border border-border bg-muted flex items-center justify-center overflow-hidden">
                  {stampUrl ? (
                    <img src={stampUrl} alt="stamp" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <span className="text-[10px] text-muted-foreground">No stamp</span>
                  )}
                </div>
                <input
                  ref={stampInputRef}
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleUploadAsset('stamp', e.target.files[0])}
                />
                <Button variant="outline" size="sm" disabled={uploadingStamp} onClick={() => stampInputRef.current?.click()} className="gap-1">
                  {uploadingStamp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  {stampUrl ? 'Replace' : 'Upload'}
                </Button>
                {stampUrl && (
                  <Button variant="ghost" size="sm" onClick={handleRemoveStamp} className="gap-1 text-destructive">
                    <Trash2 className="w-3.5 h-3.5" /> Remove
                  </Button>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">
                Document types that require a stamp will still need one regardless of this toggle.
              </p>
            </div>

            {!ready && (
              <div className="rounded border border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200 text-xs p-2">
                {!sigReady
                  ? 'Add a signature to unlock the “Sign & Approve” action. You can still use Quick Verify (text-only) without one.'
                  : 'Upload a stamp, or turn off “Stamp required” to approve with just your signature.'}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
