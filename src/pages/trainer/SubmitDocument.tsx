import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { mockAssignments, mockDocuments, ONE_TIME_DOCS, WEEKLY_DOCS, DocumentType } from '@/data/mockData';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DocumentCard } from '@/components/common/DocumentCard';
import { Upload, FileText, AlertCircle } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

export default function SubmitDocument() {
  const { assignmentId } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const assignment = mockAssignments.find(a => a.id === assignmentId);

  const [docType, setDocType] = useState<DocumentType | ''>('');
  const [weekNumber, setWeekNumber] = useState('');
  const [file, setFile] = useState<File | null>(null);

  if (!assignment) {
    return <div className="p-4 text-center text-muted-foreground">Assignment not found</div>;
  }

  const existingDocs = mockDocuments.filter(d => d.assignmentId === assignmentId);
  const isWeekly = WEEKLY_DOCS.includes(docType as DocumentType);
  const allDocTypes = [...ONE_TIME_DOCS, ...WEEKLY_DOCS];

  // Check for duplicates
  const isDuplicate = docType && !isWeekly && existingDocs.some(d => d.documentType === docType && d.status !== 'REJECTED');
  const isWeekDuplicate = isWeekly && weekNumber && existingDocs.some(d => d.documentType === docType && d.weekNumber === parseInt(weekNumber) && d.status !== 'REJECTED');

  const canSubmit = docType && file && !isDuplicate && (!isWeekly || (weekNumber && !isWeekDuplicate));

  const handleSubmit = () => {
    toast({ title: 'Document Submitted', description: `${docType} for ${assignment.unitCode} has been submitted for review.` });
    navigate('/submissions');
  };

  return (
    <div>
      <PageHeader title="Submit Document" subtitle={`${assignment.unitCode} - ${assignment.unitName}`} />

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

          <Button onClick={handleSubmit} disabled={!canSubmit} className="w-full touch-target text-base">
            Submit Document
          </Button>
        </CardContent>
      </Card>

      {/* Existing docs for this assignment */}
      <h2 className="text-sm font-semibold mb-3">Submitted Documents</h2>
      <div className="space-y-3">
        {existingDocs.length > 0 ? (
          existingDocs.map(doc => <DocumentCard key={doc.id} doc={doc} />)
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">No documents submitted yet</p>
        )}
      </div>
    </div>
  );
}
