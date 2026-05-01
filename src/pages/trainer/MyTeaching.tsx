import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BookOpen, ChevronRight, Loader2, Plus } from 'lucide-react';
import { useMyDocumentsBySession } from '@/hooks/useDocuments';
import { useMyUnitConfigs } from '@/hooks/useUnitSessionConfig';
import {
  ONE_TIME_DOC_TYPES,
  WEEKLY_DOC_TYPES,
  getCurrentSession,
  getSessionOptions,
  type SessionTerm,
} from '@/lib/sessions';

export default function MyTeaching() {
  const current = getCurrentSession();
  const sessionOptions = useMemo(() => getSessionOptions(), []);
  const [year, setYear] = useState<number>(current.year);
  const [term, setTerm] = useState<SessionTerm>(current.term);

  const { data: docs, isLoading } = useMyDocumentsBySession(year, term);
  const { data: configs = [] } = useMyUnitConfigs(year, term);

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  const allDocs = (docs || []) as unknown as Array<Record<string, unknown> & {
    id: string;
    document_type: string;
    week_number: number | null;
  }>;

  // Group docs by unit_code
  const unitMap = new Map<string, {
    unit_code: string;
    unit_name: string;
    class_code: string;
    sessionsPerWeek: number;
    termNumber: number | null;
    docs: typeof allDocs;
  }>();

  // Seed from configs (units the trainer has set up)
  configs.forEach((c) => {
    unitMap.set(c.unit_code, {
      unit_code: c.unit_code,
      unit_name: c.unit_name || '',
      class_code: c.class_code || '',
      sessionsPerWeek: c.sessions_per_week,
      termNumber: c.term_number,
      docs: [],
    });
  });

  // Add any docs whose unit isn't in configs
  allDocs.forEach((d) => {
    const code = (d.unit_code as string) || 'Unknown';
    if (!unitMap.has(code)) {
      unitMap.set(code, {
        unit_code: code,
        unit_name: (d.unit_name as string) || '',
        class_code: (d.class_code as string) || '',
        sessionsPerWeek: (d.sessions_per_week as number) || 1,
        docs: [],
      });
    }
    unitMap.get(code)!.docs.push(d);
  });

  const units = Array.from(unitMap.values()).sort((a, b) => a.unit_code.localeCompare(b.unit_code));

  return (
    <div>
      <PageHeader title="My Teaching" subtitle={`${units.length} unit(s) this session`} />

      <div className="flex items-center gap-3 mb-4">
        <Select
          value={`${year}_${term}`}
          onValueChange={(v) => {
            const yy = Number(v.split('_')[0]);
            const tt = v.substring(v.indexOf('_') + 1) as SessionTerm;
            setYear(yy);
            setTerm(tt);
          }}
        >
          <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {sessionOptions.map((o) => (
              <SelectItem key={`${o.year}_${o.term}`} value={`${o.year}_${o.term}`}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button asChild size="sm">
          <Link to="/upload"><Plus className="w-4 h-4 mr-1" /> Upload</Link>
        </Button>
      </div>

      <div className="space-y-3">
        {units.map((u) => {
          const oneTimeDone = ONE_TIME_DOC_TYPES.filter((dt) =>
            u.docs.some((d) => d.document_type === dt),
          ).length;
          // Weekly: count distinct (week, session_index) tuples submitted
          const weeklyKeys = new Set<string>();
          u.docs.forEach((d) => {
            if (WEEKLY_DOC_TYPES.includes(d.document_type as typeof WEEKLY_DOC_TYPES[number]) && d.week_number) {
              weeklyKeys.add(`${d.document_type}_${d.week_number}_${d.session_index || 1}`);
            }
          });
          const oneTimeTotal = ONE_TIME_DOC_TYPES.length;
          const completedDocs = oneTimeDone + weeklyKeys.size;
          const totalDocs = oneTimeTotal + weeklyKeys.size; // dynamic — show progress against current submissions
          const pct = totalDocs > 0 ? (completedDocs / totalDocs) * 100 : 0;

          return (
            <Link key={u.unit_code} to="/upload">
              <Card className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <BookOpen className="w-5 h-5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">{u.unit_code}{u.unit_name ? ` — ${u.unit_name}` : ''}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {u.class_code || '—'} • {u.sessionsPerWeek} session(s)/week
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </div>
                  <div className="mt-3">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground">One-time docs</span>
                      <span className="font-medium">{oneTimeDone}/{oneTimeTotal}</span>
                    </div>
                    <Progress value={pct} className="h-2" />
                    <p className="text-xs text-muted-foreground mt-1">{u.docs.length} document(s) submitted</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}

        {units.length === 0 && (
          <div className="text-center py-8 space-y-3">
            <p className="text-sm text-muted-foreground">No units yet for this session</p>
            <Button asChild>
              <Link to="/upload"><Plus className="w-4 h-4 mr-1" /> Upload your first document</Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
