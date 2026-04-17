import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/common/PageHeader';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { Loader2, Save, Upload } from 'lucide-react';

export default function ProfileSettings() {
  const { currentUser, activeRole } = useAuth();
  const [fullName, setFullName] = useState('');
  const [pfNumber, setPfNumber] = useState('');
  const [department, setDepartment] = useState('');
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [stampUrl, setStampUrl] = useState<string | null>(null);
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
        setFullName(data.full_name || '');
        setPfNumber(data.pf_number || '');
        setDepartment(data.department || '');
        setSignatureUrl(data.signature_url || null);
        setStampUrl(data.stamp_url || null);
      }
      setInitialLoading(false);
    };
    fetchProfile();
  }, [currentUser]);

  const handleAssetUpload = async (kind: 'signature' | 'stamp', file: File) => {
    if (!currentUser) return;
    const setUploading = kind === 'signature' ? setUploadingSig : setUploadingStamp;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
      const path = `${currentUser.id}/${kind}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('signatures')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('signatures').getPublicUrl(path);
      const cacheBusted = `${urlData.publicUrl}?t=${Date.now()}`;
      const column = kind === 'signature' ? 'signature_url' : 'stamp_url';
      const { error: dbErr } = await supabase
        .from('profiles')
        .update({ [column]: urlData.publicUrl })
        .eq('user_id', currentUser.id);
      if (dbErr) throw dbErr;
      if (kind === 'signature') setSignatureUrl(cacheBusted); else setStampUrl(cacheBusted);
      toast({ title: `${kind === 'signature' ? 'Signature' : 'Stamp'} updated` });
    } catch (e) {
      toast({ title: 'Upload failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

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

      {isApprover && (
        <Card>
          <CardContent className="pt-6 space-y-5">
            <div>
              <h3 className="font-semibold text-sm">Signature & Stamp</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Required to approve documents. Both will be applied automatically when you approve.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Signature (PNG with transparent background recommended)</Label>
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
                  onChange={(e) => e.target.files?.[0] && handleAssetUpload('signature', e.target.files[0])}
                />
                <Button variant="outline" size="sm" disabled={uploadingSig} onClick={() => sigInputRef.current?.click()} className="gap-1">
                  {uploadingSig ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  {signatureUrl ? 'Replace' : 'Upload'}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Stamp</Label>
              <div className="flex items-center gap-3">
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
                  onChange={(e) => e.target.files?.[0] && handleAssetUpload('stamp', e.target.files[0])}
                />
                <Button variant="outline" size="sm" disabled={uploadingStamp} onClick={() => stampInputRef.current?.click()} className="gap-1">
                  {uploadingStamp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  {stampUrl ? 'Replace' : 'Upload'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
