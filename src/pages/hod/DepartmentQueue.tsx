import { useState, useMemo, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRoleGuard } from '@/hooks/useRoleGuard';
import { useDocumentsByDepartment, useBulkUpdateDocumentStatus, useUpdateDocumentStatus, type ApprovalPlacement } from '@/hooks/useDocuments';
import { PageHeader } from '@/components/common/PageHeader';
import { TemplateLibraryPanel } from '@/components/common/TemplateLibraryPanel';

import { DocumentCard } from '@/components/common/DocumentCard';
import { BulkActionBar } from '@/components/common/BulkActionBar';
import { PlacementModal } from '@/components/common/PlacementModal';
import { RejectDialog } from '@/components/common/RejectDialog';
import { TermFilter, type TermFilterValue, filterByTerm, termCounts, pickDefaultTerm } from '@/components/common/TermFilter';
import { GroupByControl, groupDocs, GroupSection, type GroupByKey } from '@/components/common/GroupByControl';
import { HierarchyView, hierarchyFor } from '@/components/common/HierarchyGroups';

import { BulkSignButton } from '@/components/common/BulkSignButton';
import { QueueFilterBar, applyQueueFilter, DEFAULT_QUEUE_FILTER, type QueueFilterValue } from '@/components/common/QueueFilterBar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { ActionGuardButton } from '@/components/common/ActionGuardButton';
import { useCourses } from '@/hooks/useCourses';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { getCachedSignedUrl, resolveSignatureUrl } from '@/hooks/useSignedDocUrl';
import { CheckCircle2, XCircle, Loader2, Zap, Search, ArrowUpDown } from 'lucide-react';

type SortKey = 'RECENT' | 'TRAINER' | 'UNIT' | 'STATUS' | 'TYPE';

const STATUS_ORDER: Record<string, number> = {
  SUBMITTED: 0, HOD_APPROVED: 1, IQA_REVIEWED: 2, DP_APPROVED: 3, ARCHIVED: 4, EXPORTED: 5, REJECTED: 6,
};

type QueueDoc = Record<string, unknown> & { id: string; status: string };

const trainerLabel = (d: QueueDoc) => {
  const p = d.profiles as { full_name?: string | null; pf_number?: string | null } | null | undefined;
  return [p?.full_name, p?.pf_number].filter(Boolean).join(' ').trim();
};

/** Free-text search across trainer, unit, class, type and status. */
function searchDocs<T extends QueueDoc>(docs: T[], q: string): T[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return docs;
  return docs.filter((d) => [
    trainerLabel(d), d.unit_code, d.unit_name, d.class_code,
    d.document_type, d.status, d.file_name,
  ].filter(Boolean).some((v) => String(v).toLowerCase().includes(needle)));
}

function sortDocs<T extends QueueDoc>(docs: T[], key: SortKey): T[] {
  const arr = [...docs];
  const str = (v: unknown) => String(v ?? '').toLowerCase();
  switch (key) {
    case 'TRAINER': return arr.sort((a, b) => trainerLabel(a).localeCompare(trainerLabel(b)));
    case 'UNIT': return arr.sort((a, b) => str(a.unit_code || a.unit_name).localeCompare(str(b.unit_code || b.unit_name)));
    case 'STATUS': return arr.sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9));
    case 'TYPE': return arr.sort((a, b) => str(a.document_type).localeCompare(str(b.document_type)));
    default: return arr.sort((a, b) => str(b.submitted_at).localeCompare(str(a.submitted_at)));
  }
}

export default function DepartmentQueue() {
  const { currentUser, activeRole } = useAuth();
  const guard = useRoleGuard();
  const canAct = guard.canVerifyAsHOD();
  const { data: queue, isLoading } = useDocumentsByDepartment(currentUser?.department || '');
  const updateStatus = useUpdateDocumentStatus();
  const bulkUpdate = useBulkUpdateDocumentStatus();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [placementDoc, setPlacementDoc] = useState<{ id: string; pdfUrl: string; sigUrl: string; stampUrl: string } | null>(null);
  const [rejectDoc, setRejectDoc] = useState<{ id: string; label: string } | null>(null);
  const [termFilter, setTermFilter] = useState<TermFilterValue>('ALL');
  const [termInitialized, setTermInitialized] = useState(false);
  const [filter, setFilter] = useState<QueueFilterValue>({ ...DEFAULT_QUEUE_FILTER, status: 'SUBMITTED' });
  const [groupBy, setGroupBy] = useState<GroupByKey>('HIERARCHY');
  const [courseFilter, setCourseFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('RECENT');
  const { data: deptCourses = [] } = useCourses(currentUser?.department || null);

  // Clear selection if user switches away from HOD role mid-session
  useEffect(() => { if (!canAct) setSelected(new Set()); }, [canAct, activeRole]);

  const baseQueue = useMemo(
    () => (queue || []).filter(d => d.trainer_id !== currentUser?.id),
    [queue, currentUser?.id]
  );

  const myActioned = useMemo(
    () => (queue || []).filter((d) => d.hod_approved_by === currentUser?.id),
    [queue, currentUser?.id],
  );

  useEffect(() => {
    if (!termInitialized && baseQueue.length > 0) {
      setTermFilter(pickDefaultTerm(baseQueue));
      setTermInitialized(true);
    }
  }, [baseQueue, termInitialized]);

  const counts = useMemo(() => termCounts(baseQueue), [baseQueue]);
  const byCourse = useMemo(
    () => (courseFilter === 'ALL'
      ? baseQueue
      : baseQueue.filter((d) => (d as unknown as { course_id?: string | null }).course_id === courseFilter)),
    [baseQueue, courseFilter],
  );
  const termFiltered = useMemo(() => filterByTerm(byCourse, termFilter), [byCourse, termFilter]);
  const filteredQueue = useMemo(
    () => sortDocs(searchDocs(applyQueueFilter(termFiltered, filter) as unknown as QueueDoc[], search), sortKey) as unknown as typeof termFiltered,
    [termFiltered, filter, search, sortKey],
  );
  const myFiltered = useMemo(
    () => sortDocs(
      searchDocs(applyQueueFilter(filterByTerm(myActioned, termFilter), { ...filter, status: 'ALL' }) as unknown as QueueDoc[], search),
      sortKey,
    ) as unknown as typeof myActioned,
    [myActioned, termFilter, filter, search, sortKey],
  );


  const canActOn = (status: string) => status === 'SUBMITTED';

  const toggleOne = (id: string, checked: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      checked ? next.add(id) : next.delete(id);
      return next;
    });
  };
  const actionable = filteredQueue.filter(d => canActOn(d.status));
  const allSelected = actionable.length > 0 && selected.size === actionable.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(actionable.map(d => d.id)));

  const handleBulk = async (status: 'HOD_APPROVED' | 'REJECTED', reason?: string) => {
    const ids = Array.from(selected);
    const res = await bulkUpdate.mutateAsync({ docIds: ids, status, rejectionReason: reason });
    setSelected(new Set());
    toast({
      title: status === 'REJECTED' ? 'Bulk reject complete' : 'Bulk approve complete',
      description: `${res.succeeded} succeeded, ${res.failed} failed${res.firstErrorMessage ? ` — ${res.firstErrorMessage}` : ''}`,
      variant: res.failed > 0 ? 'destructive' : 'default',
    });
  };

  const handleApprove = async (docId: string) => {
    const doc = filteredQueue.find(d => d.id === docId);
    if (!doc) return;
    const { data: profile } = await supabase
      .from('profiles').select('signature_url, stamp_url, stamp_required').eq('user_id', currentUser!.id).single();
    const profAny = profile as unknown as { signature_url?: string; stamp_url?: string; stamp_required?: boolean } | null;
    if (!profAny?.signature_url) {
      toast({ title: 'Setup required', description: 'Add a signature (upload, draw or type one) in Profile Settings first.', variant: 'destructive' });
      return;
    }
    if (profAny.stamp_required !== false && !profAny.stamp_url) {
      toast({ title: 'Stamp required', description: 'Upload a stamp in Profile Settings, or turn off "Stamp required" to sign without one.', variant: 'destructive' });
      return;
    }
    try {
      const [pdfUrl, sigUrl, stampUrl] = await Promise.all([
        getCachedSignedUrl(doc.signed_file_url || doc.file_url || ''),
        resolveSignatureUrl(profAny.signature_url),
        resolveSignatureUrl(profAny.stamp_url),
      ]);
      setPlacementDoc({ id: docId, pdfUrl, sigUrl, stampUrl });
    } catch (e) {
      toast({ title: 'Cannot open document', description: e instanceof Error ? e.message : 'Could not load PDF', variant: 'destructive' });
    }
  };

  const performApproveWithPlacement = (placement: ApprovalPlacement | null) => {
    if (!placementDoc) return;
    const docId = placementDoc.id;
    updateStatus.mutate({ docId, status: 'HOD_APPROVED', placement }, {
      onSuccess: () => {
        setPlacementDoc(null);
        toast({
          title: 'Verified by HOD',
          description: placement && 'sigX' in (placement || {})
            ? 'Signed at your chosen position. Forwarded to IQAO for review.'
            : 'Signed on the approval sheet (slot 1). Forwarded to IQAO for review.',
        });
      },
      onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
    });
  };

  const handleQuickApprove = (docId: string) => {
    updateStatus.mutate({ docId, status: 'HOD_APPROVED', mode: 'TEXT_ONLY' }, {
      onSuccess: () => toast({ title: 'Verified by HOD', description: 'Quick-verified and forwarded to IQAO for review.' }),
      onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
    });
  };

  const openReject = (docId: string) => {
    const doc = filteredQueue.find((d) => d.id === docId);
    setRejectDoc({ id: docId, label: doc ? `${doc.document_type}${doc.unit_code ? ' • ' + doc.unit_code : ''}` : '' });
  };
  const confirmReject = async (reason: string) => {
    if (!rejectDoc) return;
    await updateStatus.mutateAsync({ docId: rejectDoc.id, status: 'REJECTED', rejectionReason: reason });
    setRejectDoc(null);
    toast({ title: 'Document Rejected', description: 'Trainer will see your comment on their rejected card.', variant: 'destructive' });
  };

  type RowDoc = (typeof termFiltered)[number];
  const renderQueueDoc = (doc: RowDoc) => {

    const showActions = canActOn(doc.status) && canAct;
    return (
      <DocumentCard
        key={doc.id}
        doc={doc}
        showTrainer
        selectable={showActions}
        selected={selected.has(doc.id)}
        onSelectChange={(c) => toggleOne(doc.id, c)}
        showAiReview={showActions}
        actions={showActions ? (
          <>
            <ActionGuardButton action="approve" doc={doc} size="sm" onClick={() => handleQuickApprove(doc.id)} disabled={updateStatus.isPending} className="flex-1 touch-target gap-1" title="Stamps 'VERIFIED BY HOD' with name & date">
              <Zap className="w-4 h-4" /> Quick Verify
            </ActionGuardButton>
            <ActionGuardButton action="approve" doc={doc} size="sm" variant="outline" onClick={() => handleApprove(doc.id)} disabled={updateStatus.isPending} className="flex-1 touch-target gap-1" title="Place your signature & stamp on the PDF">
              <CheckCircle2 className="w-4 h-4" /> Sign & Approve
            </ActionGuardButton>
            <ActionGuardButton action="reject" doc={doc} size="sm" variant="destructive" onClick={() => openReject(doc.id)} disabled={updateStatus.isPending} className="flex-1 touch-target gap-1">
              <XCircle className="w-4 h-4" /> Reject
            </ActionGuardButton>
          </>
        ) : undefined}
      />
    );
  };

  if (isLoading) {

    return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <div>
      <PageHeader title="Department Queue" subtitle={`${currentUser?.department || ''} • ${filteredQueue.length} document(s)`} />
      <TemplateLibraryPanel department={currentUser?.department || undefined} />

      {!canAct && (
        <div className="mb-3 p-2 rounded border border-amber-500/40 bg-amber-50 dark:bg-amber-950/20 text-xs text-amber-900 dark:text-amber-100">
          You are viewing as <strong>{activeRole}</strong>. Switch to <strong>HOD</strong> in the top bar to verify documents.
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search trainer, unit, class, type or status"
            className="h-8 pl-7 text-xs"
          />
        </div>
        <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
          <SelectTrigger className="h-8 w-[170px] text-xs">
            <ArrowUpDown className="w-3.5 h-3.5 mr-1 shrink-0" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="RECENT">Newest first</SelectItem>
            <SelectItem value="TRAINER">Trainer (A–Z)</SelectItem>
            <SelectItem value="UNIT">Unit (A–Z)</SelectItem>
            <SelectItem value="STATUS">Status (workflow order)</SelectItem>
            <SelectItem value="TYPE">Document type (A–Z)</SelectItem>
          </SelectContent>
        </Select>
        <Select value={courseFilter} onValueChange={setCourseFilter}>
          <SelectTrigger className="h-8 w-[190px] text-xs"><SelectValue placeholder="All courses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All courses</SelectItem>
            {deptCourses.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <GroupByControl value={groupBy} onChange={setGroupBy} />
        <TermFilter value={termFilter} onChange={(v) => { setTermFilter(v); setTermInitialized(true); }} counts={counts} />
      </div>

      <Tabs defaultValue="queue">
        <TabsList className="w-full mb-3">
          <TabsTrigger value="queue" className="flex-1">Queue ({filteredQueue.length})</TabsTrigger>
          <TabsTrigger value="mine" className="flex-1">Approved by me ({myFiltered.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="queue">
          <QueueFilterBar value={filter} onChange={setFilter} docs={baseQueue} />
          <BulkActionBar
            selectedCount={selected.size}
            totalCount={actionable.length}
            isAllSelected={allSelected}
            onToggleAll={toggleAll}
            onClear={() => setSelected(new Set())}
            approveStatus="HOD_APPROVED"
            approveLabel="Approve all"
            onBulkAction={(s, r) => handleBulk(s as 'HOD_APPROVED' | 'REJECTED', r)}
            isPending={bulkUpdate.isPending}
          />
          {canAct && selected.size > 0 && (
            <div className="mt-2 flex justify-end">
              <BulkSignButton
                docs={actionable.filter((d) => selected.has(d.id))}
                status="HOD_APPROVED"
                stage="HOD"
                label="Sign & verify selected"
                onDone={() => setSelected(new Set())}
              />
            </div>
          )}
          <div className="space-y-3 mt-3">
            {filteredQueue.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No documents match the current filters</p>
            ) : groupBy === 'HIERARCHY' ? (
              <HierarchyView
                docs={filteredQueue}
                levels={hierarchyFor('HOD')}
                pendingOf={(d) => canActOn(d.status)}
                renderDoc={renderQueueDoc}
              />
            ) : (
              groupDocs(filteredQueue, groupBy).map((group) => (
                <GroupSection key={group.key} label={group.label} count={group.docs.length}>
                  {group.docs.map((doc) => renderQueueDoc(doc))}
                </GroupSection>
              ))
            )}
          </div>

        </TabsContent>


        <TabsContent value="mine">
          <QueueFilterBar value={filter} onChange={setFilter} docs={myActioned} showStatus={false} />
          <div className="space-y-3 mt-3">
            {myFiltered.length > 0
              ? myFiltered.map((doc) => <DocumentCard key={doc.id} doc={doc} showTrainer />)
              : <p className="text-sm text-muted-foreground text-center py-8">You have not approved any documents yet</p>}
          </div>
        </TabsContent>
      </Tabs>
      {placementDoc && (
        <PlacementModal
          open={!!placementDoc}
          onOpenChange={(o) => { if (!o) setPlacementDoc(null); }}
          pdfUrl={placementDoc.pdfUrl}
          signatureUrl={placementDoc.sigUrl}
          stampUrl={placementDoc.stampUrl}
          stage="HOD"
          busy={updateStatus.isPending}
          onConfirm={performApproveWithPlacement}
        />
      )}
      {rejectDoc && (
        <RejectDialog
          open={!!rejectDoc}
          onOpenChange={(o) => { if (!o) setRejectDoc(null); }}
          docLabel={rejectDoc.label}
          stage="HOD"
          onConfirm={confirmReject}
          isPending={updateStatus.isPending}
        />
      )}
    </div>
  );
}
