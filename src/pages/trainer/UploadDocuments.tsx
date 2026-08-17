import { useMemo, useState, useEffect, useRef } from 'react';

import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Upload, FileText, X, Loader2, AlertCircle, CheckCircle2, Cloud, CloudOff, Lock, History, Paperclip, BookOpen, ChevronRight, CalendarDays, ClipboardCheck, ListChecks, ChevronDown } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useSubmitDocument, useMyDocumentsBySession } from '@/hooks/useDocuments';
import { compressForUpload, formatBytes } from '@/lib/compressUpload';
import { useMyUnitConfigs, useUpsertUnitConfig } from '@/hooks/useUnitSessionConfig';
import { useSystemLock } from '@/hooks/useSystemLock';
import { useRoleGuard } from '@/hooks/useRoleGuard';
import { ActionGuardButton } from '@/components/common/ActionGuardButton';
import { TemplateLibraryPanel } from '@/components/common/TemplateLibraryPanel';
import { ApprovalSheetPreview } from '@/components/common/ApprovalSheetPreview';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { checkSubmissionWindow, useCurrentSession } from '@/hooks/useAcademicSession';

import { supabase } from '@/integrations/supabase/client';
import { useSearchParams, Link } from 'react-router-dom';
import { useCourses } from '@/hooks/useCourses';
import { useProfileCompleteness } from '@/hooks/useProfileCompleteness';
import { useAuth } from '@/contexts/AuthContext';
import {
  DEPARTMENTS,
  ONE_TIME_DOC_TYPES,
  SESSION_LEVEL_DOC_TYPES,
  WEEKLY_DOC_TYPES,
  SESSION_RECORD_DOC_TYPES,
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
  const { currentUser } = useAuth();

  const current = getCurrentSession();
  const sessionOptions = useMemo(() => getSessionOptions(), []);
  // The admin-configured current session governs uploads.
  const { data: adminSession } = useCurrentSession();
  const isResubmit = !!new URLSearchParams(window.location.search).get('resubmit');

  const [sessionYear, setSessionYear] = useState<number>(current.year);
  const [sessionTerm, setSessionTerm] = useState<SessionTerm>(current.term);
  const sessionLockedByAdmin = !!adminSession && !isResubmit;
  useEffect(() => {
    if (!adminSession || isResubmit) return;
    setSessionYear(adminSession.session_year);
    setSessionTerm(adminSession.session_term);
  }, [adminSession, isResubmit]);


  const [department, setDepartment] = useState('');
  const [courseId, setCourseId] = useState('');
  const [unitCode, setUnitCode] = useState('');
  const [unitName, setUnitName] = useState('');
  const [classCode, setClassCode] = useState('');
  const [sessionsPerWeek, setSessionsPerWeek] = useState<number>(1);
  const [courseType, setCourseType] = useState<CourseType>('CYCLE');
  const [termNumber, setTermNumber] = useState<number>(1);
  const [moduleNumber, setModuleNumber] = useState<number>(1);
  const [files, setFiles] = useState<FileEntry[]>([]);
  // Files the browser refused before they ever entered the queue — shown
  // inline (not just as a toast) with the exact filename and the fix.
  const [rejectedFiles, setRejectedFiles] = useState<{ id: string; name: string; reason: string; fix: string }[]>([]);

  useEffect(() => {
    if (currentUser?.department && !department) setDepartment(currentUser.department);
  }, [currentUser?.department, department]);


  // Resume state was removed: restored entries lost their file handle and
  // confused trainers. Clear any snapshot left over from the old behaviour.
  useEffect(() => {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('upload-resume:'))
        .forEach((k) => localStorage.removeItem(k));
    } catch { /* ignore */ }
  }, []);

  // --- Resubmit prefill: /trainer/upload?resubmit=<docId> ---
  const [searchParams] = useSearchParams();
  const resubmitId = searchParams.get('resubmit');
  const [resubmissionNote, setResubmissionNote] = useState('');
  const [rejectedReasonPrefill, setRejectedReasonPrefill] = useState<string | null>(null);
  const resubmitLoadedRef = useRef(false);

  useEffect(() => {
    if (!resubmitId || resubmitLoadedRef.current) return;
    resubmitLoadedRef.current = true;
    (async () => {
      const { data, error } = await supabase.from('documents').select('*').eq('id', resubmitId).single();
      if (error || !data) {
        toast({ title: 'Could not load rejected document', description: error?.message, variant: 'destructive' });
        return;
      }
      if (data.department) setDepartment(data.department);
      if (data.unit_code) setUnitCode(data.unit_code);
      if (data.unit_name) setUnitName(data.unit_name);
      if (data.class_code) setClassCode(data.class_code);
      if (data.session_year) setSessionYear(data.session_year);
      if (data.session_term) setSessionTerm(data.session_term as SessionTerm);
      if (data.sessions_per_week) setSessionsPerWeek(data.sessions_per_week);
      if (data.course_type) setCourseType(data.course_type as CourseType);
      if (data.term_number) setTermNumber(data.term_number);
      if (data.module_number) setModuleNumber(data.module_number);
      setFiles([{
        id: `resubmit-${data.id}`,
        file: undefined,
        fileName: data.file_name || 'attach-updated-file.pdf',
        documentType: data.document_type as DocumentType,
        weekNumber: data.week_number ?? undefined,
        sessionIndex: data.session_index ?? undefined,
        originalSize: 0,
        eligibility: 'OK',
        stage: 'idle',
        needsReattach: true,
      }]);
      setRejectedReasonPrefill(data.rejection_reason || null);
      toast({
        title: 'Editing rejected submission',
        description: `Rejection reason: ${data.rejection_reason || '—'}. Re-attach the corrected PDF and submit — this updates the same document record so its history stays continuous.`,
      });

    })();
  }, [resubmitId]);


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
      setCourseId(cfg.course_id ?? '');
      const ct = (cfg.course_type as CourseType) || 'CYCLE';
      setCourseType(ct);
      if (ct === 'MODULAR' && cfg.module_number) setModuleNumber(cfg.module_number);
      if (ct !== 'MODULAR' && cfg.term_number) setTermNumber(cfg.term_number);
    }
  }

  // --- Unit / document-type prefill from My Units: /upload?unit=XX&type=Workload%20Allocation
  const prefillUnit = searchParams.get('unit');
  const prefillType = searchParams.get('type') as DocumentType | null;
  const prefillAppliedRef = useRef(false);
  useEffect(() => {
    if (resubmitId || prefillAppliedRef.current || !prefillUnit || configs.length === 0) return;
    const cfg = configs.find((c) => c.unit_code.toLowerCase() === prefillUnit.toLowerCase());
    if (!cfg) return;
    prefillAppliedRef.current = true;
    setUnitCode(cfg.unit_code);
    applyConfig(cfg.unit_code);
    toast({
      title: prefillType ? `Uploading ${prefillType}` : `Uploading for ${cfg.unit_code}`,
      description: 'Unit details filled in from My Units — attach the PDF to continue.',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configs, prefillUnit, prefillType, resubmitId]);


  const { data: deptCourses = [] } = useCourses(department || null);
  const courseName = useMemo(() => {
    const c = deptCourses.find((x) => x.id === courseId);
    return c ? `${c.code} — ${c.name}` : null;
  }, [deptCourses, courseId]);


  const previousUnits = useMemo(() => {
    const map = new Map<string, { code: string; name: string | null; class_code: string | null }>();
    configs.forEach((c) => map.set(c.unit_code, { code: c.unit_code, name: c.unit_name, class_code: c.class_code }));
    return Array.from(map.values());
  }, [configs]);

  function addFiles(newFiles: FileList | null) {
    if (!newFiles) return;
    const valid: FileEntry[] = [];
    const rejected: { id: string; name: string; reason: string; fix: string }[] = [];
    Array.from(newFiles).forEach((f) => {
      const ext = (f.name.match(/\.[^.]+$/)?.[0] || '').toLowerCase();
      const isWord = /\.docx?$/i.test(f.name) || f.type.includes('word') || f.type.includes('officedocument.wordprocessing');
      if (isWord) {
        rejected.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: f.name,
          reason: `Word document (${ext || '.doc'}) — Word files cannot carry approval signatures or stamps.`,
          fix: 'Open the file in Word, choose File → Save As / Export → PDF (or print to "Microsoft Print to PDF"), then add the resulting .pdf here.',
        });
        return;
      }
      if (f.type !== 'application/pdf') {
        rejected.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: f.name,
          reason: `Unsupported file type${ext ? ` (${ext})` : ''} — only PDF files are accepted.`,
          fix: 'Export or scan the document as a PDF and add it again. Images can be combined into one PDF before uploading.',
        });
        return;
      }
      if (f.size > MAX_ELIGIBLE_BYTES * 3) {
        rejected.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: f.name,
          reason: `PDF is ${formatBytes(f.size)} — far above the ${formatBytes(MAX_ELIGIBLE_BYTES)} limit, even after compression.`,
          fix: 'Re-scan at 150–200 dpi in black & white, or split the document and upload the parts separately.',
        });
        return;
      }

      valid.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file: f,
        fileName: f.name,
        documentType: (prefillType as DocumentType) || '',
        originalSize: f.size,
        eligibility: 'CHECKING',
        stage: 'idle',
        gdriveAttempts: 0,
      });
    });
    setFiles((prev) => [...prev, ...valid]);
    if (rejected.length > 0) {
      setRejectedFiles((prev) => [...prev, ...rejected]);
      toast({
        title: `${rejected.length} file(s) not added`,
        description: rejected.map((r) => r.name).join(', ') + ' — see the details below the file picker.',
        variant: 'destructive',
      });
    }
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
  const isWorkCoveredType = (t: string) => (SESSION_RECORD_DOC_TYPES as readonly string[]).includes(t);

  const isSessionLevel = (t: string) => (SESSION_LEVEL_DOC_TYPES as readonly string[]).includes(t);

  // Validation per file
  function validateFile(entry: FileEntry): string | null {
    if (!entry.documentType) return 'Pick a document type';
    const isWeekly = WEEKLY_DOC_TYPES.includes(entry.documentType as typeof WEEKLY_DOC_TYPES[number]);
    const isWorkCovered = isWorkCoveredType(entry.documentType);
    if (isWeekly) {
      if (!entry.weekNumber || entry.weekNumber < 1 || entry.weekNumber > 16) return 'Week 1-16 required';
      if (!entry.sessionIndex || entry.sessionIndex < 1 || entry.sessionIndex > sessionsPerWeek) {
        return `Session 1-${sessionsPerWeek} required`;
      }
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
    } else if (isWorkCovered) {
      // Two records per training session: milestone 1 = mid-session, milestone 2 = end-session.
      const milestone = entry.sessionIndex;
      if (!milestone || milestone < 1 || milestone > 2) return 'Select Mid-session or End-session';
      const dup = existingDocs.some((d) => {
        const docAny = d as unknown as Record<string, unknown>;
        return docAny.unit_code === unitCode && d.document_type === entry.documentType &&
          docAny.session_index === milestone && d.status !== 'REJECTED';
      });
      if (dup) return 'That Records of Work Covered milestone is already submitted';
      const sameBatch = files.filter((f) => f.documentType === entry.documentType && f.sessionIndex === milestone).length > 1;
      if (sameBatch) return 'Only one file is allowed for this milestone';
    } else if (isSessionLevel(entry.documentType)) {
      // Session-level: ONE submission covers every unit taught this session.
      // Blocked while an existing one is in progress or already approved; a
      // rejected one must go through "Edit & resubmit".
      const existing = existingDocs.find(
        (d) => d.document_type === entry.documentType && d.status !== 'REJECTED' && d.id !== resubmitId,
      );
      if (existing) {
        return existing.status === 'SUBMITTED'
          ? 'Already submitted for this training session — awaiting verification'
          : 'Already on file for this training session';
      }
      // Only one copy per batch.
      const twice = files.filter((f) => f.documentType === entry.documentType).length > 1;
      if (twice) return 'Only one copy is filed per training session';
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
  const profile = useProfileCompleteness();
  const profileBlocked = !profile.loading && !profile.complete;

  // Session-level documents belong directly to the active training session and
  // therefore do not require a unit. Unit-level/weekly documents do. A mixed
  // batch is allowed, but the unit fields are required because at least one
  // selected document is unit-scoped.
  const requiresUnit = files.some((f) => f.documentType && !isSessionLevel(f.documentType));
  const headerValid = !!department && (!requiresUnit || (!!unitCode && !!classCode)) && (!hasWeeklyType || sessionsPerWeek >= 1);
  const fileErrors = files.map((f) => ({ id: f.id, error: validateFile(f) }));
  const allFilesValid = files.length > 0 && fileErrors.every((e) => !e.error);
  const anyInFlight = files.some((f) => ['compressing', 'uploading_storage', 'mirroring_gdrive'].includes(f.stage));
  // Continuity lock: a rejected document for the same unit + type must be fixed
  // through "Edit & resubmit", never re-uploaded as a brand new submission.
  const rejectedBlocks = useMemo(() => {
    if (resubmitId) return [] as { id: string; documentType: string; reason: string | null }[];
    return (existingDocs || [])
      .filter((d) => {
        if (d.status !== 'REJECTED') return false;
        if (!files.some((f) => f.documentType === d.document_type)) return false;
        // Session-level documents (workload allocation) are not tied to a unit.
        if (isSessionLevel(d.document_type as string)) return true;
        return (d.unit_code || '').toLowerCase() === unitCode.toLowerCase();
      })
      .map((d) => ({ id: d.id, documentType: d.document_type as string, reason: d.rejection_reason }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingDocs, unitCode, files, resubmitId]);

  const canSubmit = rejectedBlocks.length === 0 && headerValid && allFilesValid && !submitDoc.isPending && !anyInFlight && canUpload && !writesBlocked && !profileBlocked;

  const submitReasons = useMemo(() => {
    const r: string[] = [];
    if (!canUpload) r.push('Your active role can\'t upload documents. Switch to Trainer.');
    if (profileBlocked) r.push(`Complete your profile first — missing ${profile.missing.join(', ')}.`);
    if (writesBlocked) r.push(`System is locked${lock_reason ? `: ${lock_reason}` : ''}. Writes are disabled.`);
    if (!headerValid) {
      const missing: string[] = [];
      if (requiresUnit && !unitCode) missing.push('unit');
      if (!department) missing.push('department');
      if (requiresUnit && !classCode) missing.push('class code');
      if (hasWeeklyType && sessionsPerWeek < 1) missing.push('sessions per week');
      r.push(`Fill required header fields: ${missing.join(', ')}.`);
    }
    if (files.length === 0) r.push('Add at least one PDF file.');
    fileErrors.filter((e) => e.error).forEach((e) => {
      const f = files.find((x) => x.id === e.id);
      r.push(`${f?.fileName || 'File'}: ${e.error}`);
    });
    rejectedBlocks.forEach((b) => r.push(`${b.documentType} was rejected for this unit — use "Edit & resubmit" instead of a new upload.`));
    if (anyInFlight) r.push('Wait for in-flight uploads to finish.');
    if (submitDoc.isPending) r.push('Submission in progress…');
    return r;
  }, [rejectedBlocks, canUpload, profileBlocked, profile.missing, writesBlocked, lock_reason, headerValid, department, unitCode, classCode, requiresUnit, hasWeeklyType, sessionsPerWeek, files, fileErrors, anyInFlight, submitDoc.isPending]);


  function setStage(id: string, patch: Partial<FileEntry>) {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  // New submissions are Google-Drive-primary. There is no post-upload mirror step.

  async function processEntry(entry: FileEntry): Promise<{ ok: boolean; error?: string }> {
    if (!entry.file) {
      setStage(entry.id, { stage: 'failed', stageMessage: 'Re-attach the file to continue' });
      return { ok: false, error: 'Re-attach the file to continue' };
    }
    const isWeekly = WEEKLY_DOC_TYPES.includes(entry.documentType as typeof WEEKLY_DOC_TYPES[number]);
    const entryIsSessionLevel = isSessionLevel(entry.documentType);
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
      setStage(entry.id, { stage: 'uploading_storage', stageMessage: 'Uploading directly to Google Drive…' });
      const submitted = await submitDoc.mutateAsync({
        file: optimised,
        documentType: entry.documentType as DocumentType,
        submissionType: isWeekly || isWorkCoveredType(entry.documentType) ? 'WEEKLY' : 'ONE_TIME',
        weekNumber: isWeekly ? entry.weekNumber : undefined,
        sessionIndex: (isWeekly || isWorkCoveredType(entry.documentType)) ? entry.sessionIndex : undefined,
        sessionsPerWeek: isWeekly ? sessionsPerWeek : undefined,
        department,
        unitCode: entryIsSessionLevel ? undefined : unitCode,
        unitName: entryIsSessionLevel ? undefined : unitName,
        classCode: entryIsSessionLevel ? undefined : classCode,
        sessionYear,
        sessionTerm,
        termNumber: courseType === 'MODULAR' ? null : termNumber,
        courseType,
        moduleNumber: courseType === 'MODULAR' ? moduleNumber : null,
        courseId: entryIsSessionLevel ? null : (courseId || null),
        resubmitOf: entry.id.startsWith('resubmit-') ? resubmitId : null,
        resubmissionNote: entry.id.startsWith('resubmit-') ? resubmissionNote : null,

      });
      setStage(entry.id, { stage: 'gdrive_ok', documentId: submitted.id, stageMessage: 'Stored in Google Drive', gdriveAttempts: 1 });
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed';
      setStage(entry.id, { stage: 'failed', stageMessage: msg });
      return { ok: false, error: msg };
    }
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    try {
      // Unit configuration is only relevant when this batch contains a
      // unit-scoped document. Session-level documents (Workload Allocation and
      // Personal Timetable) must never create a blank/dummy unit record.
      if (requiresUnit) {
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
          course_id: courseId || null,
        });
      }

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
          description: `${success} of ${files.length} document(s) submitted directly to Google Drive.`,
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
        title: requiresUnit ? 'Could not save unit configuration' : 'Could not submit documents',
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

      {profileBlocked && (
        <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-xs p-3 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <strong>Complete your profile before uploading.</strong> Missing: {profile.missing.join(', ')}.{' '}
            <Link to="/profile" className="underline font-medium">Update profile</Link> — every document and
            approval record is keyed to these details.
          </div>
        </div>
      )}

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

      <TemplateLibraryPanel
        department={department || undefined}
        documentType={files.find((f) => f.documentType)?.documentType || undefined}
      />


      {!isResubmit && !prefillType && !prefillUnit && files.length === 0 && (
        <div className="mb-4 space-y-3">
          <div>
            <h2 className="text-sm font-semibold">What do you want to upload?</h2>
            <p className="text-xs text-muted-foreground mt-1">Choose a document type. The system will ask only for the information that document actually needs.</p>
          </div>

          <UploadCategory title="Session Documents" description="One-time documents for the active training session." defaultOpen>
            <UploadChoice to="/upload?type=Personal%20Timetable" icon={<CalendarDays className="w-5 h-5" />} title="Personal Timetable" description="One timetable for the whole training session." />
            <UploadChoice to="/upload?type=Workload%20Allocation" icon={<ClipboardCheck className="w-5 h-5" />} title="Workload Allocation" description="One workload form covering all units you teach." />
          </UploadCategory>

          <UploadCategory title="Unit Documents — Once per Unit" description="Prepared once for each unit you teach.">
            <UploadChoice to="/upload?type=Learning%20Plan" icon={<BookOpen className="w-5 h-5" />} title="Learning Plan" description="One learning plan linked to a specific unit." />
            <UploadChoice to="/upload?type=Course%20Outline" icon={<FileText className="w-5 h-5" />} title="Course Outline" description="One course outline linked to a specific unit." />
          </UploadCategory>

          <UploadCategory title="Teaching Records — Recurring" description="Session Plans and Class Attendance are weekly. Records of Work Covered is submitted twice per training session.">
            <UploadChoice to="/upload?type=Session%20Plan" icon={<ListChecks className="w-5 h-5" />} title="Session Plan" description="Upload the week's session plans; multiple sessions can be combined into one PDF." />
            <UploadChoice to="/upload?type=Class%20Attendance" icon={<ClipboardCheck className="w-5 h-5" />} title="Class Attendance" description="Upload the week's attendance records; multiple sessions can be combined into one PDF." />
            <UploadChoice to="/upload?type=Records%20of%20Work%20Covered" icon={<FileText className="w-5 h-5" />} title="Records of Work Covered" description="Two submissions per training session: mid-session and end-session." />
          </UploadCategory>
        </div>
      )}

      <Card className="mb-4">

        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-sm font-medium">Training Session</Label>
              {sessionLockedByAdmin ? (
                <div className="mt-1.5 rounded-md border bg-muted/40 px-3 py-2">
                  <p className="text-sm font-semibold">{sessionLabel(sessionYear, sessionTerm)}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Set by the administrator as the open training session. Past sessions stay available
                    read-only under My Submissions.
                  </p>
                </div>
              ) : (
                <Select
                  value={`${sessionYear}_${sessionTerm}`}
                  onValueChange={(v) => {
                    const yy = Number(v.split('_')[0]);
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
              )}
            </div>


            {(files.length === 0 || requiresUnit) && (
              <>
            <div>
              <Label className="text-sm font-medium">Unit</Label>
              <Select value={unitCode} onValueChange={(v) => { setUnitCode(v); applyConfig(v); }}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder={configs.length ? 'Select one of your units' : 'No units keyed in yet'} />
                </SelectTrigger>
                <SelectContent>
                  {configs.map((c) => (
                    <SelectItem key={c.id} value={c.unit_code}>
                      {c.unit_name ? `${c.unit_name} — ${c.unit_code}` : c.unit_code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {configs.length === 0 ? (
                <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                  You have not keyed in any units for this session.{' '}
                  <Link to="/teaching" className="underline font-medium">Add your units first</Link>.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">
                  Only units you keyed in under <Link to="/teaching" className="underline">My Units</Link> for this session are listed.
                </p>
              )}
            </div>

            <div>
              <Label className="text-sm font-medium">Unit details</Label>
              <div className="mt-1.5 rounded-md border bg-muted/40 px-3 py-2 text-xs space-y-0.5">
                <p><span className="text-muted-foreground">Department:</span> <strong>{department || '—'}</strong></p>
                <p><span className="text-muted-foreground">Course:</span> <strong>{courseName || '—'}</strong></p>
                <p><span className="text-muted-foreground">Class:</span> <strong>{classCode || '—'}</strong></p>
                <p className="text-[11px] text-muted-foreground">Derived from the unit you selected. Edit it under My Units.</p>
              </div>
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
            ) : null}


              </>
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
          <div className="flex items-center justify-between gap-2">
            <Label className="text-sm font-medium">Files (PDF only)</Label>
            <ApprovalSheetPreview
              docLabel={unitCode ? `${unitCode}${unitName ? ' — ' + unitName : ''}` : undefined}
              className="h-7 text-[11px]"
            />
          </div>
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px] text-amber-900 dark:text-amber-200 flex items-start gap-2">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <div>
              <strong>Word files (.doc / .docx) are rejected.</strong> Only PDFs can carry the HOD, IQAO and
              DP Academics signatures and stamps. In Word use <em>File → Save As / Export → PDF</em>
              {' '}(or print to “Microsoft Print to PDF”), then upload the PDF here.
            </div>
          </div>
          {rejectedFiles.length > 0 && (
            <div className="space-y-2">
              {rejectedFiles.map((r) => (
                <div key={r.id} className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-[11px] flex items-start gap-2">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-destructive" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium break-all text-destructive">{r.name} was not added</p>
                    <p className="text-muted-foreground mt-0.5">{r.reason}</p>
                    <p className="mt-1"><strong>How to fix:</strong> {r.fix}</p>
                  </div>
                  <button
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setRejectedFiles((prev) => prev.filter((x) => x.id !== r.id))}
                    aria-label={`Dismiss error for ${r.name}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
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
                        <History className="w-3 h-3" /> Attach corrected PDF
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
                    <span>Attach the corrected version of <strong>{entry.fileName}</strong></span>
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
                    <span className="w-full px-2 py-1.5 rounded bg-destructive/10 border border-destructive/40 text-destructive flex items-start gap-1.5">
                      <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                      <span>
                        <strong className="break-all">{entry.fileName}</strong> is {formatBytes(entry.estimatedSize ?? entry.originalSize)} after
                        compression — over the {formatBytes(MAX_ELIGIBLE_BYTES)} limit, so signatures and stamps may fail to embed.
                        <br />
                        <strong>How to fix:</strong> re-scan at 150–200 dpi (black &amp; white), remove large embedded images,
                        or split it into smaller PDFs and upload each part.
                      </span>
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
                      <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground mt-1">Weekly teaching records</div>
                      {WEEKLY_DOC_TYPES.map((dt) => <SelectItem key={dt} value={dt}>{dt}</SelectItem>)}
                      <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground mt-1">Session milestone</div>
                      {SESSION_RECORD_DOC_TYPES.map((dt) => <SelectItem key={dt} value={dt}>{dt}</SelectItem>)}
                    </SelectContent>
                  </Select>

                  {isWeekly && (
                    <>
                      <Input type="number" min={1} max={16} placeholder="Week" value={entry.weekNumber ?? ''}
                        onChange={(e) => updateFile(entry.id, { weekNumber: Number(e.target.value) || undefined })} className="text-xs" />
                      <Input type="number" min={1} max={sessionsPerWeek} placeholder={`Session (1-${sessionsPerWeek})`}
                        value={entry.sessionIndex ?? ''} onChange={(e) => updateFile(entry.id, { sessionIndex: Number(e.target.value) || undefined })} className="text-xs" />
                    </>
                  )}
                  {isWorkCoveredType(entry.documentType) && (
                    <Select value={entry.sessionIndex ? String(entry.sessionIndex) : ''} onValueChange={(v) => updateFile(entry.id, { sessionIndex: Number(v), weekNumber: undefined })}>
                      <SelectTrigger className="text-xs"><SelectValue placeholder="Submission point" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">Mid-session</SelectItem>
                        <SelectItem value="2">End-session</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {err && (
                  <div className="flex items-center gap-1.5 text-xs text-destructive">
                    <AlertCircle className="w-3 h-3" /> {err}
                  </div>
                )}

                {/* Google Drive primary-storage status — visible per file so the trainer
                    can confirm where the PDF was stored. */}
                {entry.stage !== 'idle' && (
                  <div className="flex flex-wrap items-center gap-2 text-[11px] border-t pt-2">
                    {entry.stage === 'compressing' && <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" />Compressing…</span>}
                    {entry.stage === 'uploading_storage' && <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" />Uploading directly to Google Drive…</span>}
                    {entry.stage === 'storage_ok' && <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="w-3 h-3" />Metadata saved</span>}
                    {entry.stage === 'gdrive_ok' && <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300"><Cloud className="w-3 h-3" />Stored in Google Drive</span>}
                    {entry.stage === 'gdrive_failed' && (
                      <span className="flex items-center gap-1 text-amber-700 dark:text-amber-300">
                        <CloudOff className="w-3 h-3" />Google Drive storage failed. Check the connection and submit again.
                      </span>
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
              <Button variant="ghost" size="sm" className="h-9 text-xs gap-1 text-muted-foreground" onClick={() => { setFiles([]); setRejectedFiles([]); }}>
                <X className="w-3 h-3" /> Clear list
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {resubmitId && (
        <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs space-y-2">
          <p className="font-semibold text-amber-800 dark:text-amber-300">Resubmitting a rejected document</p>
          {rejectedReasonPrefill && (
            <p className="text-amber-900/90 dark:text-amber-200/90">
              <span className="font-medium">Reason given: </span>{rejectedReasonPrefill}
            </p>
          )}
          <p className="text-muted-foreground">
            The earlier file is kept as a read-only previous version — it cannot be edited or approved again.
          </p>
          <div className="space-y-1">
            <Label className="text-xs">What did you correct? (shown to the verifier)</Label>
            <Textarea
              value={resubmissionNote}
              onChange={(e) => setResubmissionNote(e.target.value.slice(0, 500))}
              placeholder="e.g. Added the missing week 5 session plan and corrected the unit code."
              className="text-xs min-h-[64px]"
            />
          </div>
        </div>
      )}


      {rejectedBlocks.length > 0 && (
        <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs space-y-2">
          <p className="font-semibold text-destructive">Rejected document must be resubmitted, not re-uploaded</p>
          {rejectedBlocks.map((b) => (
            <div key={b.id} className="space-y-1">
              <p><strong>{b.documentType}</strong> for {unitCode} was rejected{b.reason ? `: ${b.reason}` : ''}.</p>
              <Link to={`/upload?resubmit=${b.id}`} className="underline font-medium">Edit &amp; resubmit this document</Link>
            </div>
          ))}
        </div>
      )}

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
      {!canSubmit && submitReasons.length > 0 && (
        <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs">
          <p className="font-medium mb-1 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> Can't submit yet:</p>
          <ul className="list-disc pl-5 space-y-0.5">
            {submitReasons.slice(0, 8).map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function UploadCategory({ title, description, defaultOpen = false, children }: { title: string; description: string; defaultOpen?: boolean; children: React.ReactNode }) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="rounded-xl border bg-card overflow-hidden">
      <CollapsibleTrigger className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-muted/40">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>
        </div>
        <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 pt-0">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function UploadChoice({ to, icon, title, description }: { to: string; icon: React.ReactNode; title: string; description: string }) {
  return (
    <Link to={to} className="group rounded-lg border p-3 flex items-center gap-3 hover:border-primary/50 hover:bg-primary/5 transition-colors">
      <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary shrink-0" />
    </Link>
  );
}

