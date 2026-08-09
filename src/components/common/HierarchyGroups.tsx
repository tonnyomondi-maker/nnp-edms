// Multi-level document grouping used by every queue.
// Each role gets a default hierarchy (always starting with the training
// session) so long queues stay readable instead of one flat list.

import { ReactNode, useState, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { sessionLabel, type SessionTerm } from '@/lib/sessions';
import { useCourses } from '@/hooks/useCourses';

export type HierarchyLevel = 'SESSION' | 'DEPARTMENT' | 'TRAINER' | 'COURSE' | 'UNIT' | 'DOC_TYPE' | 'STAGE';

export interface HierarchyDoc {
  id: string;
  department?: string | null;
  document_type?: string | null;
  unit_code?: string | null;
  unit_name?: string | null;
  course_id?: string | null;
  session_year?: number | null;
  session_term?: string | null;
  term_number?: number | null;
  course_type?: string | null;
  module_number?: number | null;
  trainer_id?: string;
  profiles?: { full_name?: string | null; pf_number?: string | null } | null;
}

/** Default hierarchies per role — session first, everywhere. */
export const ROLE_HIERARCHY: Record<string, HierarchyLevel[]> = {
  TRAINER: ['SESSION', 'COURSE', 'UNIT'],
  HOD: ['SESSION', 'TRAINER', 'COURSE', 'UNIT'],
  IQA: ['SESSION', 'DEPARTMENT', 'TRAINER', 'COURSE', 'UNIT'],
  DP_ACADEMICS: ['SESSION', 'DEPARTMENT', 'TRAINER', 'COURSE', 'UNIT'],
  SUPER_ADMIN: ['SESSION', 'DEPARTMENT', 'TRAINER', 'COURSE', 'UNIT'],
};

export function hierarchyFor(role?: string | null): HierarchyLevel[] {
  return ROLE_HIERARCHY[role || ''] || ['SESSION', 'TRAINER', 'UNIT'];
}

type CourseMap = Record<string, string>;

function bucketOf(d: HierarchyDoc, level: HierarchyLevel, courses: CourseMap) {
  switch (level) {
    case 'SESSION': {
      const y = d.session_year ?? 0;
      const t = (d.session_term as SessionTerm) || null;
      const termOrder = t === 'JAN_APR' ? 1 : t === 'MAY_AUG' ? 2 : t === 'SEP_DEC' ? 3 : 9;
      return {
        key: `${y}_${t || 'NA'}`,
        label: y && t ? sessionLabel(y, t) : 'Unspecified session',
        order: y ? -(y * 10 + (10 - termOrder)) : 9999,
      };
    }
    case 'DEPARTMENT':
      return { key: d.department || 'unspecified', label: d.department || 'Unspecified department', order: 0 };
    case 'TRAINER': {
      const nm = d.profiles?.full_name || 'Unknown trainer';
      const pf = d.profiles?.pf_number ? ` (${d.profiles.pf_number})` : '';
      return { key: d.trainer_id || nm, label: `${nm}${pf}`, order: 0 };
    }
    case 'COURSE': {
      const id = d.course_id || '';
      return { key: id || 'nocourse', label: courses[id] || 'Unassigned course', order: 0 };
    }
    case 'UNIT': {
      const code = d.unit_code || 'unspecified';
      return { key: code, label: d.unit_name ? `${code} — ${d.unit_name}` : code, order: 0 };
    }
    case 'DOC_TYPE':
      return { key: d.document_type || 'unspecified', label: d.document_type || 'Unspecified type', order: 0 };
    case 'STAGE': {
      if (d.course_type === 'MODULAR' && d.module_number)
        return { key: `M${d.module_number}`, label: `Module ${d.module_number}`, order: 100 + d.module_number };
      if (d.term_number) return { key: `T${d.term_number}`, label: `Term ${d.term_number}`, order: d.term_number };
      return { key: 'UNSPEC', label: 'Unspecified stage', order: 999 };
    }
  }
}

export interface HierarchyNode<T> {
  key: string;
  label: string;
  level: HierarchyLevel;
  docs: T[];
  children: HierarchyNode<T>[];
}

export function buildHierarchy<T extends HierarchyDoc>(
  docs: T[],
  levels: HierarchyLevel[],
  courses: CourseMap = {},
): HierarchyNode<T>[] {
  if (!levels.length) return [];
  const [level, ...rest] = levels;
  const buckets = new Map<string, { label: string; order: number; docs: T[] }>();
  for (const d of docs) {
    const b = bucketOf(d, level, courses);
    const cur = buckets.get(b.key) || { label: b.label, order: b.order, docs: [] };
    cur.docs.push(d);
    buckets.set(b.key, cur);
  }
  return Array.from(buckets.entries())
    .sort((a, b) => (a[1].order - b[1].order) || a[1].label.localeCompare(b[1].label))
    .map(([key, v]) => ({
      key,
      label: v.label,
      level,
      docs: v.docs,
      children: rest.length ? buildHierarchy(v.docs, rest, courses) : [],
    }));
}

const LEVEL_TINT: Record<HierarchyLevel, string> = {
  SESSION: 'bg-primary/10',
  DEPARTMENT: 'bg-muted',
  TRAINER: 'bg-muted/60',
  COURSE: 'bg-muted/40',
  UNIT: 'bg-muted/30',
  DOC_TYPE: 'bg-muted/30',
  STAGE: 'bg-muted/30',
};

function NodeView<T extends HierarchyDoc>({
  node,
  depth,
  renderDoc,
  pendingOf,
}: {
  node: HierarchyNode<T>;
  depth: number;
  renderDoc: (doc: T) => ReactNode;
  pendingOf?: (doc: T) => boolean;
}) {
  const [open, setOpen] = useState(depth === 0);
  const pending = pendingOf ? node.docs.filter(pendingOf).length : 0;
  return (
    <div className="border rounded-md overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center gap-2 px-2 sm:px-3 py-2.5 text-xs font-medium text-left ${LEVEL_TINT[node.level]} hover:brightness-95`}
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
        <span className="truncate">{node.label}</span>
        <span className="ml-auto flex items-center gap-2 shrink-0 text-muted-foreground">
          {pending > 0 && (
            <span className="rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 px-2 py-0.5">
              {pending} pending
            </span>
          )}
          <span>{node.docs.length}</span>
        </span>
      </button>
      {open && (
        <div className="p-1.5 sm:p-2 space-y-2">
          {node.children.length
            ? node.children.map((c) => (
                <NodeView key={c.key} node={c} depth={depth + 1} renderDoc={renderDoc} pendingOf={pendingOf} />
              ))
            : node.docs.map((d) => <div key={d.id}>{renderDoc(d)}</div>)}
        </div>
      )}
    </div>
  );
}

interface HierarchyViewProps<T extends HierarchyDoc> {
  docs: T[];
  levels: HierarchyLevel[];
  renderDoc: (doc: T) => ReactNode;
  pendingOf?: (doc: T) => boolean;
  emptyLabel?: string;
}

export function HierarchyView<T extends HierarchyDoc>({
  docs,
  levels,
  renderDoc,
  pendingOf,
  emptyLabel = 'No documents match the current filters',
}: HierarchyViewProps<T>) {
  const { data: courseRows } = useCourses();
  const courseMap = useMemo(() => {
    const m: CourseMap = {};
    (courseRows || []).forEach((c) => { m[c.id] = `${c.code} — ${c.name}`; });
    return m;
  }, [courseRows]);

  const tree = useMemo(() => buildHierarchy(docs, levels, courseMap), [docs, levels, courseMap]);

  if (!docs.length) {
    return <p className="text-sm text-muted-foreground text-center py-8">{emptyLabel}</p>;
  }
  return (
    <div className="space-y-2">
      {tree.map((n) => (
        <NodeView key={n.key} node={n} depth={0} renderDoc={renderDoc} pendingOf={pendingOf} />
      ))}
    </div>
  );
}
