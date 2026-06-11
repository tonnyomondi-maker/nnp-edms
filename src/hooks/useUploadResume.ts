// Persists the UploadDocuments per-file state to localStorage so the trainer
// can refresh the page and continue retrying / managing in-flight uploads.
// We intentionally do NOT persist the raw File blob (browsers can't serialise
// it). Files that already reached storage have a documentId and can be
// retried for Drive without re-uploading; pending files come back marked
// `needsReattach=true` so the trainer can re-pick them.

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export type UploadStage =
  | 'idle'
  | 'compressing'
  | 'uploading_storage'
  | 'storage_ok'
  | 'mirroring_gdrive'
  | 'gdrive_ok'
  | 'gdrive_failed'
  | 'failed';

export interface ResumeEntry {
  id: string;
  fileName: string;
  originalSize: number;
  estimatedSize?: number;
  compressed?: boolean;
  eligibility: 'OK' | 'OVERSIZE' | 'CHECKING';
  documentType: string;
  weekNumber?: number;
  sessionIndex?: number;
  stage: UploadStage;
  documentId?: string;
  stageMessage?: string;
  gdriveAttempts?: number;
  needsReattach?: boolean;
}

export interface ResumeHeader {
  sessionYear?: number;
  sessionTerm?: string;
  department?: string;
  unitCode?: string;
  unitName?: string;
  classCode?: string;
  courseType?: string;
  termNumber?: number;
  moduleNumber?: number;
  sessionsPerWeek?: number;
}

export interface ResumeSnapshot {
  header: ResumeHeader;
  entries: ResumeEntry[];
  savedAt: number;
}

const KEY = (uid: string) => `upload-resume:v1:${uid}`;

export function useUploadResume() {
  const { user } = useAuth();
  const [hydrated, setHydrated] = useState<ResumeSnapshot | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!user) return;
    try {
      const raw = localStorage.getItem(KEY(user.id));
      if (raw) {
        const snap = JSON.parse(raw) as ResumeSnapshot;
        // Mark non-terminal entries (without docId) as needing re-attach.
        snap.entries = snap.entries.map((e) => {
          const terminal = e.stage === 'gdrive_ok' || e.stage === 'gdrive_failed' || e.stage === 'storage_ok';
          if (!terminal && !e.documentId) {
            return { ...e, needsReattach: true, stage: 'idle', stageMessage: 'Re-attach the file to resume' };
          }
          return e;
        });
        setHydrated(snap);
      }
    } catch { /* corrupted snapshot — ignore */ }
  }, [user]);

  const save = (snapshot: Omit<ResumeSnapshot, 'savedAt'>) => {
    if (!user) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      try {
        // Only persist when there's something worth resuming.
        const hasResumable = snapshot.entries.some((e) =>
          e.stage !== 'gdrive_ok' && e.stage !== 'idle',
        ) || snapshot.entries.length > 0;
        if (!hasResumable) {
          localStorage.removeItem(KEY(user.id));
          return;
        }
        const payload: ResumeSnapshot = { ...snapshot, savedAt: Date.now() };
        localStorage.setItem(KEY(user.id), JSON.stringify(payload));
      } catch { /* quota or serialisation issue — ignore */ }
    }, 250);
  };

  const clear = () => {
    if (!user) return;
    try { localStorage.removeItem(KEY(user.id)); } catch { /* ignore */ }
    setHydrated(null);
  };

  return { hydrated, save, clear };
}
