import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface Props { docId: string; }

export function RejectedResubmitButton({ docId }: Props) {
  const navigate = useNavigate();
  return (
    <Button
      size="sm"
      variant="outline"
      className="mt-2 gap-1"
      onClick={() => navigate(`/trainer/upload?resubmit=${docId}`)}
    >
      <RefreshCw className="w-3.5 h-3.5" /> Edit & Resubmit
    </Button>
  );
}
