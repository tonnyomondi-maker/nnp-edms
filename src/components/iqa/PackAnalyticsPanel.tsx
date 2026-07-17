// IQA / Super Admin — analytics panel for verifier packs.
// Shows per-department pack activity so the archivist can throttle new requests.

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { BarChart3, Loader2 } from 'lucide-react';

interface DeptStat {
  department: string;
  total_packs: number;
  active: number;
  expired: number;
  revoked: number;
  total_downloads: number;
  next_expiry: string | null;
  capacity: number;
  remaining_capacity: number;
}

export function PackAnalyticsPanel() {
  const [rows, setRows] = useState<DeptStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      // deno-lint-ignore no-explicit-any
      const { data, error } = await (supabase as any).rpc('verification_pack_stats_by_dept', {});
      setLoading(false);
      if (!error && Array.isArray(data)) setRows(data as DeptStat[]);
    })();
  }, []);

  const totalDownloads = rows.reduce((s, r) => s + Number(r.total_downloads || 0), 0);
  const totalActive = rows.reduce((s, r) => s + Number(r.active || 0), 0);
  const totalExpired = rows.reduce((s, r) => s + Number(r.expired || 0), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" /> Analytics
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        {!loading && rows.length === 0 && (
          <p className="text-xs text-muted-foreground">No packs yet — issue one below to start seeing activity.</p>
        )}
        {!loading && rows.length > 0 && (
          <>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="border rounded p-2">
                <p className="text-muted-foreground">Active</p>
                <p className="text-lg font-semibold">{totalActive}</p>
              </div>
              <div className="border rounded p-2">
                <p className="text-muted-foreground">Downloads</p>
                <p className="text-lg font-semibold">{totalDownloads}</p>
              </div>
              <div className="border rounded p-2">
                <p className="text-muted-foreground">Expired</p>
                <p className="text-lg font-semibold">{totalExpired}</p>
              </div>
            </div>
            <div className="space-y-2">
              {rows.map((r) => {
                const active = Number(r.active);
                const cap = Number(r.capacity) || 10;
                const used = Math.min(active, cap);
                const pct = cap > 0 ? Math.round((used / cap) * 100) : 0;
                return (
                  <div key={r.department} className="border rounded p-2 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap text-xs">
                      <span className="font-medium">{r.department}</span>
                      <Badge variant="secondary" className="text-[10px]">{active} active</Badge>
                      <Badge variant="outline" className="text-[10px]">{r.total_downloads} DL</Badge>
                      {Number(r.expired) > 0 && <Badge variant="outline" className="text-[10px]">{r.expired} expired</Badge>}
                      {Number(r.revoked) > 0 && <Badge variant="destructive" className="text-[10px]">{r.revoked} revoked</Badge>}
                      <span className="ml-auto text-muted-foreground">
                        {r.remaining_capacity} / {cap} remaining
                      </span>
                    </div>
                    <Progress value={pct} className="h-1.5" />
                    {r.next_expiry && (
                      <p className="text-[10px] text-muted-foreground">
                        Next expiry: {new Date(r.next_expiry).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
