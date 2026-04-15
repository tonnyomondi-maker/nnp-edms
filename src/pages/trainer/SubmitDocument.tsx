import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useAssignment } from '@/hooks/useAssignments';
import { useDocumentsByAssignment, useSubmitDocument } from '@/hooks/useDocuments';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DocumentCard } from '@/components/common/DocumentCard';
import { Upload, FileText, AlertCircle, Loader2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import type { Database } from '@/integrations/supabase/types';

type DocumentType = Database['public']['Enums']['document_type'];

const ONE_TIME_DOCS: DocumentType[] = ['Learning Plan', 'Personal Timetable', 'Workload Allocation', 'Scheme of Work'];
const WEEKLY_DOCS: DocumentType[] = ['Session Plan', 'Class Attendance'];

export default function SubmitDocument() {
  const { assignmentId } = useParams();
  const navigate = useNavigate();
  const { data: assignment, isLoading: loadingAssignment } = useAssignment(assignmentId || '');
  const { data: existingDocs, isLoading: loadingDocs } = useDocumentsByAssignment(assignmentId || '');
  const submitDoc = useSubmitDocument();

  const [docType, setDocType] = useState<DocumentType | ''>('');
  const [weekNumber, setWeekNumber] = useState('');
  const [file, setFile] = useState<File | null>(null);

  if (loadingAssignment || loadingDocs) {
    return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  if (!assignment) {
    return <div className="p-4 text-center text-muted-foreground">Assignment not found</div>;
  }

  const docs = existingDocs || [];
  const isWeekly = WEEKLY_DOCS.includes(docType as DocumentType);
  const isDuplicate = docType && !isWeekly && docs.some(d => d.document_type === docType && d.status !== 'REJECTED');
  const isWeekDuplicate = isWeekly && weekNumber && docs.some(d => d.document_type === docType && d.week_number === parseInt(weekNumber) && d.status !== 'REJECTED');
  const canSubmit = docType && file && !isDuplicate && (!isWeekly || (weekNumber && !isWeekDuplicate));

  const handleSubmit = () => {
    if (!file || !docType) return;
    submitDoc.mutate(
      {
        file,
        assignmentId: assignment.id,
        documentType: docType as DocumentType,
        submissionType: isWeekly ? 'WEEKLY' : 'ONE_TIME',
        weekNumber: isWeekly ? parseInt(weekNumber) : undefined,
        department: assignment.department,
      },
      {
        onSuccess: () => {
          toast({ title: 'Document Submitted', description: `${docType} for ${assignment.unit_code} has been submitted for review.` });
          navigate('/submissions');
        },
        onError: (e) => {
          toast({ title: 'Upload failed', description: e.message, variant: 'destructive' });
        },
      }
    );
  };

  return (
    <div>
      <PageHeader title="Submit Document" subtitle={`${assignment.unit_code} - ${assignment.unit_name}`} />

      <Card className="mb-4">
        <CardContent className="p-4 space-y-4">
          <div>
            <Label className="text-sm font-medium">Document Type</Label>
            <Select value={docType} onValueChange={(v) => { setDocType(v as DocumentType); setWeekNumber(''); }}>
              <SelectTrigger className="mt-1.5 touch-target">
                <SelectValue placeholder="Select document type" />
              </SelectTrigger>
              <SelectContent>
                <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">One-Time Documents</div>
                {ONE_TIME_DOCS.map(dt => (
                  <SelectItem key={dt} value={dt}>{dt}</SelectItem>
                ))}
                <div className="px-2 py-1 text-xs font-semibold text-muted-foreground mt-1">Weekly Documents</div>
                {WEEKLY_DOCS.map(dt => (
                  <SelectItem key={dt} value={dt}>{dt}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isWeekly && (
            <div>
              <Label className="text-sm font-medium">Week Number</Label>
              <Input
                type="number"
                min="1"
                max="16"
                value={weekNumber}
                onChange={(e) => setWeekNumber(e.target.value)}
                placeholder="Enter week number (1-16)"
                className="mt-1.5 touch-target"
              />
            </div>
          )}

          <div>
            <Label className="text-sm font-medium">Upload File (PDF only)</Label>
            <div className="mt-1.5 border-2 border-dashed rounded-lg p-6 text-center">
              {file ? (
                <div className="flex items-center justify-center gap-2">
                  <FileText className="w-5 h-5 text-primary" />
                  <span className="text-sm font-medium">{file.name}</span>
                  <button onClick={() => setFile(null)} className="text-xs text-destructive ml-2">Remove</button>
                </div>
              ) : (
                <label className="cursor-pointer">
                  <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Tap to upload PDF</p>
                  <input
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f && f.type === 'application/pdf') setFile(f);
                      else toast({ title: 'Invalid file', description: 'Only PDF files are allowed', variant: 'destructive' });
                    }}
                  />
                </label>
              )}
            </div>
          </div>

          {(isDuplicate || isWeekDuplicate) && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{isDuplicate ? 'This document has already been submitted for this unit.' : `Week ${weekNumber} ${docType} already submitted.`}</span>
            </div>
          )}

          <Button onClick={handleSubmit} disabled={!canSubmit || submitDoc.isPending} className="w-full touch-target text-base">
            {submitDoc.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Submit Document
          </Button>
        </CardContent>
      </Card>

      <h2 className="text-sm font-semibold mb-3">Submitted Documents</h2>
      <div className="space-y-3">
        {docs.length > 0 ? (
          docs.map(doc => <DocumentCard key={doc.id} doc={doc} />)
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">No documents submitted yet</p>
        )}
      </div>
    </div>
  );
}
