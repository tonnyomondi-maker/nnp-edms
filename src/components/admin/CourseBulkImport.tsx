// Bulk course import from an Excel/CSV template, with a row-level validation
// preview before anything is written.

import { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { DEPARTMENTS } from '@/lib/sessions';
import { useUpsertCourse, type CourseRow } from '@/hooks/useCourses';
import { Download, Loader2, Upload, X } from 'lucide-react';

type RowStatus = 'NEW' | 'UPDATE' | 'ERROR';

interface ParsedRow {
  line: number;
  department: string;
  code: string;
  name: string;
  status: RowStatus;
  error?: string;
}

interface Props {
  /** Existing courses, used to tell "new" from "update". */
  existing: CourseRow[];
  /** When set (HOD), only this department may be imported. */
  lockedDepartment?: string | null;
  onImported?: () => void;
}

export function CourseBulkImport({ existing, lockedDepartment, onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const upsert = useUpsertCourse();

  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['department', 'code', 'name'],
      [lockedDepartment || DEPARTMENTS[0], 'DICT', 'Diploma in Information Communication Technology'],
    ]);
    ws['!cols'] = [{ wch: 38 }, { wch: 14 }, { wch: 48 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Courses');
    const deptSheet = XLSX.utils.aoa_to_sheet([['Valid departments'], ...DEPARTMENTS.map((d) => [d])]);
    deptSheet['!cols'] = [{ wch: 42 }];
    XLSX.utils.book_append_sheet(wb, deptSheet, 'Departments');
    XLSX.writeFile(wb, 'courses-template.xlsx');
  };

  const parse = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

      const seen = new Set<string>();
      const existingKeys = new Set(existing.map((c) => `${c.department}|${c.code.toUpperCase()}`));

      const parsed: ParsedRow[] = raw.map((r, i): ParsedRow => {
        const pick = (k: string) => {
          const key = Object.keys(r).find((kk) => kk.trim().toLowerCase() === k);
          return key ? String(r[key] ?? '').trim() : '';
        };
        const department = pick('department');
        const code = pick('code').toUpperCase();
        const name = pick('name');
        const line = i + 2;

        let error: string | undefined;
        if (!department) error = 'Department is missing';
        else if (!DEPARTMENTS.includes(department)) error = `Unknown department "${department}"`;
        else if (lockedDepartment && department !== lockedDepartment) error = `You may only import courses for ${lockedDepartment}`;
        else if (!code) error = 'Course code is missing';
        else if (code.length > 20) error = 'Course code is longer than 20 characters';
        else if (!name) error = 'Course name is missing';
        else if (name.length > 120) error = 'Course name is longer than 120 characters';
        else if (seen.has(`${department}|${code}`)) error = 'Duplicate of an earlier row in this file';

        if (!error) seen.add(`${department}|${code}`);

        return {
          line, department, code, name,
          status: error ? 'ERROR' : existingKeys.has(`${department}|${code}`) ? 'UPDATE' : 'NEW',
          error,
        };
      }).filter((r) => r.department || r.code || r.name);

      if (parsed.length === 0) {
        toast({ title: 'Nothing to import', description: 'The file has no data rows.', variant: 'destructive' });
        return;
      }
      setRows(parsed);
      setFileName(file.name);
    } catch (e) {
      toast({ title: 'Could not read file', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    }
  };

  const valid = (rows || []).filter((r) => r.status !== 'ERROR');
  const errors = (rows || []).filter((r) => r.status === 'ERROR');
  const creates = valid.filter((r) => r.status === 'NEW').length;
  const updates = valid.filter((r) => r.status === 'UPDATE').length;

  const confirm = async () => {
    setImporting(true);
    setProgress(0);
    let failed = 0;
    for (let i = 0; i < valid.length; i++) {
      const r = valid[i];
      try {
        await upsert.mutateAsync({ department: r.department, code: r.code, name: r.name });
      } catch {
        failed++;
      }
      setProgress(i + 1);
    }
    setImporting(false);
    setRows(null);
    setFileName('');
    if (failed > 0) {
      toast({ title: 'Import finished with errors', description: `${valid.length - failed} saved, ${failed} failed.`, variant: 'destructive' });
    } else {
      toast({ title: 'Courses imported', description: `${creates} created, ${updates} updated.` });
    }
    onImported?.();
  };

  return (
    <Card className="mb-4">
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold flex-1">Bulk import from Excel</p>
          <Button size="sm" variant="outline" onClick={downloadTemplate}>
            <Download className="w-4 h-4 mr-1" /> Download template
          </Button>
          <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
            <Upload className="w-4 h-4 mr-1" /> Choose file
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) parse(f);
              e.target.value = '';
            }}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Columns: <code>department</code>, <code>code</code>, <code>name</code>. Existing courses with the same
          department and code are updated instead of duplicated.
        </p>

        {rows && (
          <div className="border rounded">
            <div className="flex flex-wrap items-center gap-2 p-2 border-b bg-muted/40">
              <span className="text-xs font-semibold truncate flex-1">{fileName}</span>
              <Badge variant="secondary" className="text-[10px]">{creates} new</Badge>
              <Badge variant="secondary" className="text-[10px]">{updates} update</Badge>
              {errors.length > 0 && <Badge variant="destructive" className="text-[10px]">{errors.length} error</Badge>}
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setRows(null)} aria-label="Cancel import">
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
            <div className="max-h-72 overflow-y-auto divide-y">
              {rows.map((r) => (
                <div key={r.line} className="flex items-start gap-2 p-2 text-[11px]">
                  <span className="text-muted-foreground w-10 shrink-0">#{r.line}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{r.code || '(no code)'} — {r.name || '(no name)'}</p>
                    <p className="text-muted-foreground truncate">{r.department || '(no department)'}</p>
                    {r.error && <p className="text-destructive">{r.error}</p>}
                  </div>
                  <Badge
                    variant={r.status === 'ERROR' ? 'destructive' : 'secondary'}
                    className="text-[10px] shrink-0"
                  >
                    {r.status === 'ERROR' ? 'Error' : r.status === 'UPDATE' ? 'Update' : 'New'}
                  </Badge>
                </div>
              ))}
            </div>
            <div className="p-2 border-t flex items-center gap-2">
              <Button size="sm" onClick={confirm} disabled={importing || valid.length === 0}>
                {importing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                {importing ? `Importing ${progress}/${valid.length}…` : `Import ${valid.length} course(s)`}
              </Button>
              {errors.length > 0 && (
                <span className="text-[11px] text-muted-foreground">
                  {errors.length} row(s) with errors will be skipped.
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
