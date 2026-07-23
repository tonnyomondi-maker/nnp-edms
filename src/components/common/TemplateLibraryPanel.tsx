import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useTemplates, getTemplateSignedUrl } from '@/hooks/useTemplates';
import { toast } from '@/hooks/use-toast';
import { Download, FileText, ChevronDown, ChevronUp } from 'lucide-react';

interface Props {
  department?: string;
  documentType?: string;
}

export function TemplateLibraryPanel({ department, documentType }: Props) {
  const [open, setOpen] = useState(false);
  const { data: templates, isLoading } = useTemplates({
    department: department || null,
    documentType: documentType || null,
  });

  const download = async (path: string, name: string) => {
    try {
      const url = await getTemplateSignedUrl(path);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      toast({ title: 'Download failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    }
  };

  const count = templates?.length ?? 0;

  return (
    <Card className="mb-3">
      <CardContent className="p-3">
        <button type="button" className="flex items-center justify-between w-full text-sm font-semibold" onClick={() => setOpen(v => !v)}>
          <span className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            Sample templates
            <Badge variant="secondary" className="ml-1">{count}</Badge>
          </span>
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        {open && (
          <div className="mt-2 space-y-1">
            {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
            {!isLoading && count === 0 && (
              <p className="text-xs text-muted-foreground">No samples published yet{documentType ? ` for ${documentType}` : ''}. Ask an administrator.</p>
            )}
            {templates?.map(t => (
              <div key={t.id} className="flex items-center gap-2 p-2 rounded border hover:bg-muted/30">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold truncate">{t.title}</p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {t.document_type} • {t.department || 'All'} • v{t.version}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => download(t.file_path, t.file_name || t.title)}>
                  <Download className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
