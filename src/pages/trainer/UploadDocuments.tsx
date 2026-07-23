import { useMemo, useState, useEffect, useRef } from 'react';

import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Upload, FileText, X, Loader2, AlertCircle, CheckCircle2, RotateCw, Cloud, CloudOff, Lock, History, Paperclip } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useSubmitDocument, useMyDocumentsBySession } from '@/hooks/useDocuments';
import { compressForUpload, formatBytes } from '@/lib/compressUpload';
import { useMyUnitConfigs, useUpsertUnitConfig } from '@/hooks/useUnitSessionConfig';
import { useSystemLock } from '@/hooks/useSystemLock';
import { useRoleGuard } from '@/hooks/useRoleGuard';
import { useUploadResume } from '@/hooks/useUploadResume';
import { ActionGuardButton } from '@/components/common/ActionGuardButton';
import { TemplateLibraryPanel } from '@/components/common/TemplateLibraryPanel';
import { checkSubmissionWindow } from '@/hooks/useAcademicSession';

import { supabase } from '@/integrations/supabase/client';
import {
  DEPARTMENTS,
  ONE_TIME_DOC_TYPES,
  WEEKLY_DOC_TYPES,
  COURSE_TYPES,
  MODULE_NUMBERS,
  getCurrentSession,
  getSessionOptions,
  sessionLabel,
  type SessionTerm,
  type CourseType,
} from '@/lib/sessions';
import type { Database } from '@/integrations/supabase/types';

type DocumentType = Database['public']['Enums']['document_type'];

type UploadStage = 'idle' | 'compressing' | 'uploading_storage' | 'storage_ok' | 'mirroring_gdrive' | 'gdrive_ok' | 'gdrive_failed' | 'failed';

interface FileEntry {
  id: string;
  // After rehydrate, file may be undefined and needsReattach is true.
  file?: File;
  fileName: string;
  documentType: DocumentType | '';
  weekNumber?: number;
  sessionIndex?: number;
  originalSize: number;
  estimatedSize?: number;
  compressed?: boolean;
  eligibility: 'OK' | 'OVERSIZE' | 'CHECKING';
  // Resume / retry state
  stage: UploadStage;
  documentId?: string;
  stageMessage?: string;
  gdriveAttempts?: number;
  needsReattach?: boolean;
}

// 20 MB hard cap to keep documents eligible for embedding signatures + stamps.
const MAX_ELIGIBLE_BYTES = 20 * 1024 * 1024;

export default function UploadDocuments() {
  
  const submitDoc = useSubmitDocument();
  const upsertConfig = useUpsertUnitConfig();

  const current = getCurrentSession();
  const sessionOptions = useMemo(() => getSessionOptions(), []);

  const [sessionYear, setSessionYear] = useState<number>(current.year);
  const [sessionTerm, setSessionTerm] = useState<SessionTerm>(current.term);
  const [department, setDepartment] = useState('');
  const [unitCode, setUnitCode] = useState('');
  const [unitName, setUnitName] = useState('');
  const [classCode, setClassCode] = useState('');
  const [sessionsPerWeek, setSessionsPerWeek] = useState<number>(1);
  const [courseType, setCourseType] = useState<CourseType>('CYCLE');
  const [termNumber, setTermNumber] = useState<number>(1);
  const [moduleNumber, setModuleNumber] = useState<number>(1);
  const [files, setFiles] = useState<FileEntry[]>([]);

  // --- Resume across page reloads ---
  const resume = useUploadResume();
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current || !resume.hydrated) return;
    hydratedRef.current = true;
    const snap = resume.hydrated;
    if (snap.header.sessionYear) setSessionYear(snap.header.sessionYear);
    if (snap.header.sessionTerm) setSessionTerm(snap.header.sessionTerm as SessionTerm);
    if (snap.header.department) setDepartment(snap.header.department);
    if (snap.header.unitCode) setUnitCode(snap.header.unitCode);
    if (snap.header.unitName) setUnitName(snap.header.unitName);
    if (snap.header.classCode) setClassCode(snap.header.classCode);
    if (snap.header.courseType) setCourseType(snap.header.courseType as CourseType);
    if (snap.header.termNumber) setTermNumber(snap.header.termNumber);
    if (snap.header.moduleNumber) setModuleNumber(snap.header.moduleNumber);
    if (snap.header.sessionsPerWeek) setSessionsPerWeek(snap.header.sessionsPerWeek);
    setFiles(snap.entries.map((e) => ({
      id: e.id,
      file: undefined,
      fileName: e.fileName,
      documentType: e.documentType as DocumentType | '',
      weekNumber: e.weekNumber,
      sessionIndex: e.sessionIndex,
      originalSize: e.originalSize,
      estimatedSize: e.estimatedSize,
      compressed: e.compressed,
      eligibility: e.eligibility,
      stage: e.stage,
      documentId: e.documentId,
      stageMessage: e.stageMessage,
      gdriveAttempts: e.gdriveAttempts,
      needsReattach: e.needsReattach,
    })));
    if (snap.entries.some((e) => e.needsReattach)) {
      toast({ title: 'Resumed previous upload session', description: 'Re-attach pending files to continue, or retry Drive mirrors for already-stored files.' });
    }
  }, [resume]);


  const { data: existingDocs = [] } = useMyDocumentsBySession(sessionYear, sessionTerm);
  const { data: configs = [] } = useMyUnitConfigs(sessionYear, sessionTerm);

  // Auto-load sessions_per_week from saved config when unit_code changes
  const matchingConfig = configs.find(
    (c) => c.unit_code.toLowerCase() === unitCode.toLowerCase(),
  );
  // If user picks an existing unit, prefill
  function applyConfig(code: string) {
    const cfg = configs.find((c) => c.unit_code.toLowerCase() === code.toLowerCase());
    if (cfg) {
      setUnitName(cfg.unit_name || '');
      setClassCode(cfg.class_code || '');
      setSessionsPerWeek(cfg.sessions_per_week);
      setDepartment(cfg.department);
      const ct = (cfg.course_type as CourseType) || 'CYCLE';
      setCourseType(ct);
      if (ct === 'MODULAR' && cfg.module_number) setModuleNumber(cfg.module_number);
      if (ct !== 'MODULAR' && cfg.term_number) setTermNumber(cfg.term_number);
    }
  }

  const previousUnits = useMemo(() => {
    const map = new Map<string, { code: string; name: string | null; class_code: string | null }>();
    configs.forEach((c) => map.set(c.unit_code, { code: c.unit_code, name: c.unit_name, class_code: c.class_code }));
    return Array.from(map.values());
  }, [configs]);

  function addFiles(newFiles: FileList | null) {
    if (!newFiles) return;
    const valid: FileEntry[] = [];
    Array.from(newFiles).forEach((f) => {
      if (f.type !== 'application/pdf') {
        toast({ title: 'Skipped', description: `${f.name} is not a PDF`, variant: 'destructive' });
        return;
      }
      valid.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file: f,
        fileName: f.name,
        documentType: '',
        originalSize: f.size,
        eligibility: 'CHECKING',
        stage: 'idle',
        gdriveAttempts: 0,
      });
    });
    setFiles((prev) => [...prev, ...valid]);
    // Compute compression preview for each so the trainer sees pre/post sizes
    // and an eligibility tag BEFORE they submit.
    valid.forEach(async (entry) => {
      if (!entry.file) return;
      try {
        const { finalSize } = await compressForUpload(entry.file);
        const compressed = finalSize < entry.originalSize;
        const eligibility: FileEntry['eligibility'] = finalSize > MAX_ELIGIBLE_BYTES ? 'OVERSIZE' : 'OK';
        setFiles((prev) => prev.map((f) => f.id === entry.id ? { ...f, estimatedSize: finalSize, compressed, eligibility } : f));
      } catch {
        setFiles((prev) => prev.map((f) => f.id === entry.id ? { ...f, eligibility: 'OK' } : f));
      }
    });
  }

  // Re-attach a file that was lost after refresh: keep all metadata, just
  // bind a fresh File handle.
  function reattachFile(id: string, file: File) {
    setFiles((prev) => prev.map((f) => f.id === id ? {
      ...f, file, fileName: file.name, originalSize: file.size,
      needsReattach: false, stage: 'idle', stageMessage: undefined, eligibility: 'CHECKING',
    } : f));
  }

  function updateFile(id: string, patch: Partial<FileEntry>) {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  function removeFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  const hasWeeklyType = files.some((f) => WEEKLY_DOC_TYPES.includes(f.documentType as typeof WEEKLY_DOC_TYPES[number]));

  // Validation per file
  function validateFile(entry: FileEntry): string | null {
    if (!entry.documentType) return 'Pick a document type';
    const isWeekly = WEEKLY_DOC_TYPES.includes(entry.documentType as typeof WEEKLY_DOC_TYPES[number]);
    if (isWeekly) {
      if (!entry.weekNumber || entry.weekNumber < 1 || entry.weekNumber > 16) return 'Week 1-16 required';
      if (!entry.sessionIndex || entry.sessionIndex < 1 || entry.sessionIndex > sessionsPerWeek) {
        return `Session 1-${sessionsPerWeek} required`;
      }
      // duplicate weekly check
      const dup = existingDocs.some((d) => {
        const docAny = d as unknown as Record<string, unknown>;
        return (
          docAny.unit_code === unitCode &&
          d.document_type === entry.documentType &&
          d.week_number === entry.weekNumber &&
          docAny.session_index === entry.sessionIndex &&
          d.status !== 'REJECTED'
        );
      });
      if (dup) return 'Already submitted';
    } else {
      // one-time duplicate check
      const dup = existingDocs.some((d) => {
        const docAny = d as unknown as Record<string, unknown>;
        return (
          docAny.unit_code === unitCode &&
          d.document_type === entry.documentType &&
          d.status !== 'REJECTED'
        );
      });
      if (dup) return 'Already submitted this session';
    }
    return null;
  }

  const { writesBlocked, lock_active, lock_reason } = useSystemLock();
  const guard = useRoleGuard();
  const canUpload = guard.canUploadAsTrainer();

  const headerValid = department && unitCode && classCode && (!hasWeeklyType || sessionsPerWeek >= 1);
  const fileErrors = files.map((f) => ({ id: f.id, error: validateFile(f) }));
  const allFilesValid = files.length > 0 && fileErrors.every((e) => !e.error);
  const anyInFlight = files.some((f) => ['compressing', 'uploading_storage', 'mirroring_gdrive'].includes(f.stage));
  const canSubmit = headerValid && allFilesValid && !submitDoc.isPending && !anyInFlight && canUpload && !writesBlocked;

  function setStage(id: string, patch: Partial<FileEntry>) {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  async function mirrorToGDrive(entry: FileEntry, documentId: string) {
    setStage(entry.id, { stage: 'mirroring_gdrive', stageMessage: 'Mirroring to Google Drive…' });
    const attempt = (entry.gdriveAttempts ?? 0) + 1;
    const { data, error } = await supabase.functions.invoke('gdrive-upload', { body: { documentId } });
    if (error || (data as { error?: string })?.error) {
      setStage(entry.id, {
        stage: 'gdrive_failed',
        stageMessage: error?.message || (data as { error?: string })?.error || 'Google Drive upload failed',
        gdriveAttempts: attempt,
      });
      return false;
    }
    setStage(entry.id, { stage: 'gdrive_ok', stageMessage: 'Mirrored to Google Drive', gdriveAttempts: attempt });
    return true;
  }

  async function processEntry(entry: FileEntry): Promise<{ ok: boolean; error?: string }> {
    if (!entry.file) {
      setStage(entry.id, { stage: 'failed', stageMessage: 'Re-attach the file to continue' });
      return { ok: false, error: 'Re-attach the file to continue' };
    }
    const isWeekly = WEEKLY_DOC_TYPES.includes(entry.documentType as typeof WEEKLY_DOC_TYPES[number]);
    try {
      const window = await checkSubmissionWindow(sessionYear, sessionTerm);
      if (!window.allowed) {
        setStage(entry.id, { stage: 'failed', stageMessage: window.reason || 'Session closed' });
        return { ok: false, error: window.reason || 'Session closed' };
      }
      setStage(entry.id, { stage: 'compressing', stageMessage: 'Compressing…' });
      const { file: optimised, originalSize, finalSize } = await compressForUpload(entry.file);

      if (finalSize < originalSize) {
        toast({ title: 'Optimised', description: `${entry.file.name}: ${formatBytes(originalSize)} → ${formatBytes(finalSize)}` });
      }
      setStage(entry.id, { stage: 'uploading_storage', stageMessage: 'Uploading to secure storage…' });
      const submitted = await submitDoc.mutateAsync({
        file: optimised,
        documentType: entry.documentType as DocumentType,
        submissionType: isWeekly ? 'WEEKLY' : 'ONE_TIME',
        weekNumber: isWeekly ? entry.weekNumber : undefined,
        sessionIndex: isWeekly ? entry.sessionIndex : undefined,
        sessionsPerWeek: isWeekly ? sessionsPerWeek : undefined,
        department,
        unitCode,
        unitName,
        classCode,
        sessionYear,
        sessionTerm,
        termNumber: courseType === 'MODULAR' ? null : termNumber,
        courseType,
        moduleNumber: courseType === 'MODULAR' ? moduleNumber : null,
      });
      setStage(entry.id, { stage: 'storage_ok', documentId: submitted.id, stageMessage: 'Uploaded — mirroring…' });
      // Mirror in the same loop so the user sees Drive status before navigating away.
      await mirrorToGDrive({ ...entry, documentId: submitted.id }, submitted.id);
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed';
      setStage(entry.id, { stage: 'failed', stageMessage: msg });
      return { ok: false, error: msg };
    }
  }

  async function retryGDrive(entry: FileEntry) {
    if (!entry.documentId) return;
    await mirrorToGDrive(entry, entry.documentId);
  }

  // Persist resume snapshot whenever something material changes.
  useEffect(() => {
    if (!hydratedRef.current && !resume.hydrated && files.length === 0) return;
    resume.save({
      header: { sessionYear, sessionTerm, department, unitCode, unitName, classCode, courseType, termNumber, moduleNumber, sessionsPerWeek },
      entries: files.map((f) => ({
        id: f.id,
        fileName: f.fileName,
        originalSize: f.originalSize,
        estimatedSize: f.estimatedSize,
        compressed: f.compressed,
        eligibility: f.eligibility,
        documentType: f.documentType || '',
        weekNumber: f.weekNumber,
        sessionIndex: f.sessionIndex,
        stage: f.stage,
        documentId: f.documentId,
        stageMessage: f.stageMessage,
        gdriveAttempts: f.gdriveAttempts,
        needsReattach: f.needsReattach,
      })),
    });
    // Auto-clear when nothing is left to resume.
    if (files.length === 0 || files.every((f) => f.stage === 'gdrive_ok')) {
      resume.clear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, sessionYear, sessionTerm, department, unitCode, unitName, classCode, courseType, termNumber, moduleNumber, sessionsPerWeek]);

  async function handleSubmit() {
    if (!canSubmit) return;
    try {
      // Save / update unit config first
      await upsertConfig.mutateAsync({
        department,
        unit_code: unitCode,
        unit_name: unitName,
        class_code: classCode,
        session_year: sessionYear,
        session_term: sessionTerm,
        sessions_per_week: sessionsPerWeek,
        term_number: courseType === 'MODULAR' ? null : termNumber,
        course_type: courseType,
        module_number: courseType === 'MODULAR' ? moduleNumber : null,
      });

      let success = 0;
      const failures: string[] = [];
      // Only process files not already uploaded to storage
      for (const entry of files.filter((f) => f.stage !== 'storage_ok' && f.stage !== 'gdrive_ok' && f.stage !== 'gdrive_failed' && !f.needsReattach)) {
        const r = await processEntry(entry);
        if (r.ok) success++;
        else failures.push(`${entry.fileName}: ${r.error}`);
      }

      if (success > 0) {
        toast({
          title: 'Upload complete',
          description: `${success} of ${files.length} document(s) submitted. Check the Drive mirror status per file below.`,
        });
      }
      if (failures.length > 0) {
        toast({
          title: 'Some uploads failed',
          description: failures.slice(0, 3).join('; '),
          variant: 'destructive',
        });
      }
    } catch (e) {
      toast({
        title: 'Could not save unit config',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  }

  return (
    <div className="pb-8">
      <PageHeader
        title="Upload Documents"
        subtitle={sessionLabel(sessionYear, sessionTerm)}
      />

      {(!canUpload || writesBlocked) && (
        <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200 text-xs p-3 flex items-start gap-2">
          <Lock className="w-4 h-4 mt-0.5" />
          <div>
            {writesBlocked
              ? <>Uploads are temporarily blocked: <strong>{lock_reason || 'system maintenance'}</strong>.</>
              : guard.reasonFor('upload')}
          </div>
        </div>
      )}

      <TemplateLibraryPanel department={department || undefined} />

      <Card className="mb-4">

        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-sm font-medium">Training Session</Label>
              <Select
                value={`${sessionYear}_${sessionTerm}`}
                onValueChange={(v) => {
                  const [y, t] = v.split('_');
                  // session keys are like JAN_APR which has underscore — handle properly
                  const yy = Number(y);
                  const tt = v.substring(v.indexOf('_') + 1) as SessionTerm;
                  setSessionYear(yy);
                  setSessionTerm(tt);
                }}
              >
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {sessionOptions.map((o) => (
                    <SelectItem key={`${o.year}_${o.term}`} value={`${o.year}_${o.term}`}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-sm font-medium">Department</Label>
              <Select value={department} onValueChange={setDepartment}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>
                  {DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-sm font-medium">Unit Code</Label>
              <Input
                list="unit-codes"
                value={unitCode}
                onChange={(e) => {
                  setUnitCode(e.target.value);
                  applyConfig(e.target.value);
                }}
                placeholder="e.g. ICT/CU/CS/CR/01/6"
                className="mt-1.5"
              />
              <datalist id="unit-codes">
                {previousUnits.map((u) => <option key={u.code} value={u.code}>{u.name || ''}</option>)}
              </datalist>
              <p className="text-xs text-muted-foreground mt-1">Type any unit you teach — no pre-assignment needed.</p>
            </div>

            <div>
              <Label className="text-sm font-medium">Unit Name</Label>
              <Input
                value={unitName}
                onChange={(e) => setUnitName(e.target.value)}
                placeholder="e.g. Computer Networks"
                className="mt-1.5"
              />
            </div>

            <div>
              <Label className="text-sm font-medium">Class Code</Label>
              <Input
                value={classCode}
                onChange={(e) => setClassCode(e.target.value)}
                placeholder="e.g. DICT 2A"
                className="mt-1.5"
              />
            </div>

            <div>
              <Label className="text-sm font-medium">Course Type</Label>
              <Select value={courseType} onValueChange={(v) => setCourseType(v as CourseType)}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COURSE_TYPES.map((c) => (
                    <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">Cycle 1 / Cycle 2 use Terms; Modular uses Modules 1–8.</p>
            </div>

            {courseType === 'MODULAR' ? (
              <div>
                <Label className="text-sm font-medium">Module</Label>
                <Select value={String(moduleNumber)} onValueChange={(v) => setModuleNumber(Number(v))}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MODULE_NUMBERS.map((n) => (
                      <SelectItem key={n} value={String(n)}>Module {n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">Which module this class is currently doing</p>
              </div>
            ) : (
              <div>
                <Label className="text-sm font-medium">Term (intake stage)</Label>
                <Select value={String(termNumber)} onValueChange={(v) => setTermNumber(Number(v))}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Term 1</SelectItem>
                    <SelectItem value="2">Term 2</SelectItem>
                    <SelectItem value="3">Term 3</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">Which term this class intake is currently in</p>
              </div>
            )}

            {hasWeeklyType && (
              <div>
                <Label className="text-sm font-medium">Sessions per Week</Label>
                <Input
                  type="number"
                  min={1}
                  max={7}
                  value={sessionsPerWeek}
                  onChange={(e) => setSessionsPerWeek(Math.max(1, Math.min(7, Number(e.target.value) || 1)))}
                  className="mt-1.5"
                />
                {matchingConfig && matchingConfig.sessions_per_week !== sessionsPerWeek && (
                  <p className="text-xs text-muted-foreground mt-1">Will update saved config (was {matchingConfig.sessions_per_week})</p>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardContent className="p-4 space-y-3">
          <Label className="text-sm font-medium">Files (PDF)</Label>
          <label className="block cursor-pointer">
            <div className="border-2 border-dashed rounded-lg p-6 text-center hover:border-primary transition-colors">
              <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Tap to add one or more PDFs</p>
              <input
                type="file"
                accept=".pdf"
                multiple
                className="hidden"
                onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
              />
            </div>
          </label>

          {files.map((entry) => {
            const err = fileErrors.find((e) => e.id === entry.id)?.error;
            const isWeekly = WEEKLY_DOC_TYPES.includes(entry.documentType as typeof WEEKLY_DOC_TYPES[number]);
            return (
              <div key={entry.id} className="border rounded-lg p-3 space-y-2 bg-muted/30">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <FileText className="w-4 h-4 text-primary flex-shrink-0" />
                    <span className="text-sm font-medium truncate">{entry.fileName}</span>
                    {entry.needsReattach && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-200 flex items-center gap-1">
                        <History className="w-3 h-3" /> Needs re-attach
                      </span>
                    )}
                  </div>
                  <button onClick={() => removeFile(entry.id)} className="text-muted-foreground hover:text-destructive">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {entry.needsReattach && (
                  <label className="flex items-center gap-2 text-xs text-amber-900 dark:text-amber-200 border border-dashed border-amber-500/50 rounded px-2 py-2 cursor-pointer hover:bg-amber-500/5">
                    <Paperclip className="w-3.5 h-3.5" />
                    <span>Re-attach <strong>{entry.fileName}</strong> to resume this upload</span>
                    <input
                      type="file"
                      accept=".pdf"
                      className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) reattachFile(entry.id, f); e.target.value = ''; }}
                    />
                  </label>
                )}

                {/* Eligibility & compression preview */}
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="text-muted-foreground">Original: {formatBytes(entry.originalSize)}</span>
                  {entry.eligibility === 'CHECKING' && <span className="text-muted-foreground italic">Checking compression…</span>}
                  {entry.estimatedSize !== undefined && entry.compressed && (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                      Will compress to {formatBytes(entry.estimatedSize)}
                      {' '}(−{Math.round(100 - (entry.estimatedSize / entry.originalSize) * 100)}%)
                    </span>
                  )}
                  {entry.estimatedSize !== undefined && !entry.compressed && (
                    <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Already optimal — no compression applied</span>
                  )}
                  {entry.eligibility === 'OVERSIZE' && (
                    <span className="px-1.5 py-0.5 rounded bg-destructive/15 text-destructive flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      Over 20 MB after compression — signatures &amp; stamps may not embed reliably
                    </span>
                  )}
                  {entry.eligibility === 'OK' && entry.estimatedSize !== undefined && (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">Eligible ✓</span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <Select
                    value={entry.documentType}
                    onValueChange={(v) => updateFile(entry.id, { documentType: v as DocumentType, weekNumber: undefined, sessionIndex: undefined })}
                  >
                    <SelectTrigger className="text-xs"><SelectValue placeholder="Document type" /></SelectTrigger>
                    <SelectContent>
                      <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground">One-Time</div>
                      {ONE_TIME_DOC_TYPES.map((dt) => <SelectItem key={dt} value={dt}>{dt}</SelectItem>)}
                      <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground mt-1">Weekly</div>
                      {WEEKLY_DOC_TYPES.map((dt) => <SelectItem key={dt} value={dt}>{dt}</SelectItem>)}
                    </SelectContent>
                  </Select>

                  {isWeekly && (
                    <>
                      <Input
                        type="number"
                        min={1}
                        max={16}
                        placeholder="Week"
                        value={entry.weekNumber ?? ''}
                        onChange={(e) => updateFile(entry.id, { weekNumber: Number(e.target.value) || undefined })}
                        className="text-xs"
                      />
                      <Input
                        type="number"
                        min={1}
                        max={sessionsPerWeek}
                        placeholder={`Session (1-${sessionsPerWeek})`}
                        value={entry.sessionIndex ?? ''}
                        onChange={(e) => updateFile(entry.id, { sessionIndex: Number(e.target.value) || undefined })}
                        className="text-xs"
                      />
                    </>
                  )}
                </div>

                {err && (
                  <div className="flex items-center gap-1.5 text-xs text-destructive">
                    <AlertCircle className="w-3 h-3" /> {err}
                  </div>
                )}

                {/* Upload / mirror status — visible per file so the trainer can
                    track progress, see failures, and retry the Google Drive
                    step without re-uploading the PDF. */}
                {entry.stage !== 'idle' && (
                  <div className="flex flex-wrap items-center gap-2 text-[11px] border-t pt-2">
                    {entry.stage === 'compressing' && <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" />Compressing…</span>}
                    {entry.stage === 'uploading_storage' && <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" />Uploading to secure storage…</span>}
                    {entry.stage === 'storage_ok' && <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="w-3 h-3" />Stored</span>}
                    {entry.stage === 'mirroring_gdrive' && <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" />Mirroring to Google Drive (attempt {(entry.gdriveAttempts ?? 0) + 1})…</span>}
                    {entry.stage === 'gdrive_ok' && <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300"><Cloud className="w-3 h-3" />Mirrored to Google Drive</span>}
                    {entry.stage === 'gdrive_failed' && (
                      <>
                        <span className="flex items-center gap-1 text-amber-700 dark:text-amber-300">
                          <CloudOff className="w-3 h-3" />Drive mirror failed (attempt {entry.gdriveAttempts ?? 1}). File is safe in storage.
                        </span>
                        <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => retryGDrive(entry)}>
                          <RotateCw className="w-3 h-3 mr-1" />Retry Drive upload
                        </Button>
                      </>
                    )}
                    {entry.stage === 'failed' && (
                      <span className="flex items-center gap-1 text-destructive">
                        <AlertCircle className="w-3 h-3" />{entry.stageMessage || 'Upload failed'}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {files.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-2">No files added yet</p>
          )}
          {files.length > 0 && (
            <div className="flex justify-end pt-1">
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground" onClick={() => { setFiles([]); resume.clear(); }}>
                <X className="w-3 h-3" /> Clear resume state
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <ActionGuardButton
        action="upload"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="w-full touch-target text-base"
        size="lg"
      >
        {submitDoc.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        Submit {files.length > 0 ? `${files.length} Document${files.length > 1 ? 's' : ''}` : ''}
      </ActionGuardButton>
    </div>
  );
}
