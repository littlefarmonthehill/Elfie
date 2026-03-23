import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle2,
  XCircle,
  Trash2,
  ExternalLink,
  GitMerge,
  Clock,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Edit2,
} from "lucide-react";

interface BoidOverride {
  id: number;
  orgId: string;
  blItemNo: string;
  blItemType: string;
  boColorId: number | null;
  blColorId: number | null;
  proposedBoid: string;
  approvedBoid: string | null;
  status: 'pending_review' | 'approved' | 'rejected';
  resolvedVia: string;
  createdAt: string;
  reviewedAt: string | null;
}

const VIA_LABELS: Record<string, { label: string; color: string }> = {
  bl_item_no: { label: 'Direct match', color: 'bg-green-500/15 text-green-400 border-green-500/30' },
  bo_item_no: { label: 'BO item# fallback', color: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  no_type:    { label: 'No-type fallback', color: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
};

function ViaTag({ via }: { via: string }) {
  const info = VIA_LABELS[via] ?? { label: via, color: 'bg-muted text-muted-foreground border-border' };
  return (
    <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded border ${info.color}`}>
      {info.label}
    </span>
  );
}

interface OverrideRowProps {
  item: BoidOverride;
  onApprove: (id: number, boid?: string) => void;
  onReject: (id: number) => void;
  onDelete: (id: number) => void;
  isPending: boolean;
}

function OverrideRow({ item, onApprove, onReject, onDelete, isPending }: OverrideRowProps) {
  const [editing, setEditing] = useState(false);
  const [customBoid, setCustomBoid] = useState(item.proposedBoid);
  const blUrl = `https://www.bricklink.com/v2/catalog/catalogitem.page?${item.blItemType === 'MINIFIG' ? 'M' : 'P'}=${encodeURIComponent(item.blItemNo)}`;
  const boUrl = `https://www.brickowl.com/catalog/${encodeURIComponent(item.proposedBoid)}`;

  return (
    <div className="rounded-md border border-border bg-card/50 p-3 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className="font-mono text-sm font-semibold text-foreground">{item.blItemNo}</span>
          <Badge variant="outline" className="text-xs shrink-0">{item.blItemType}</Badge>
          {item.boColorId != null && (
            <span className="text-xs text-muted-foreground">BO color {item.boColorId}</span>
          )}
          <ViaTag via={item.resolvedVia} />
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {item.status === 'pending_review' && (
            <>
              <Button
                size="icon"
                variant="ghost"
                title={editing ? "Cancel edit" : "Edit BOID before approving"}
                onClick={() => setEditing(e => !e)}
                disabled={isPending}
                data-testid={`button-boid-edit-${item.id}`}
              >
                <Edit2 className="w-3.5 h-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                title="Approve"
                className="text-green-500"
                onClick={() => onApprove(item.id, editing ? customBoid : undefined)}
                disabled={isPending}
                data-testid={`button-boid-approve-${item.id}`}
              >
                <CheckCircle2 className="w-4 h-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                title="Reject"
                className="text-destructive"
                onClick={() => onReject(item.id)}
                disabled={isPending}
                data-testid={`button-boid-reject-${item.id}`}
              >
                <XCircle className="w-4 h-4" />
              </Button>
            </>
          )}
          <Button
            size="icon"
            variant="ghost"
            title="Remove from queue"
            className="text-muted-foreground"
            onClick={() => onDelete(item.id)}
            disabled={isPending}
            data-testid={`button-boid-delete-${item.id}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Proposed BOID:</span>
        {editing ? (
          <Input
            value={customBoid}
            onChange={e => setCustomBoid(e.target.value)}
            className="h-6 w-40 text-xs font-mono"
            data-testid={`input-boid-custom-${item.id}`}
          />
        ) : (
          <span className="font-mono text-foreground">{item.proposedBoid}</span>
        )}
        <a
          href={blUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 text-blue-400 hover:underline"
          data-testid={`link-bl-${item.id}`}
        >
          BL <ExternalLink className="w-3 h-3" />
        </a>
        <a
          href={boUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 text-blue-400 hover:underline"
          data-testid={`link-bo-${item.id}`}
        >
          BO <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {item.status !== 'pending_review' && (
        <div className="flex items-center gap-2 text-xs">
          {item.status === 'approved' ? (
            <span className="flex items-center gap-1 text-green-400">
              <CheckCircle2 className="w-3 h-3" />
              Approved{item.approvedBoid && item.approvedBoid !== item.proposedBoid
                ? ` with custom BOID: ${item.approvedBoid}`
                : ''}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-destructive">
              <XCircle className="w-3 h-3" />
              Rejected — item will be skipped during sync
            </span>
          )}
          {item.reviewedAt && (
            <span className="text-muted-foreground">
              {new Date(item.reviewedAt).toLocaleDateString()}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

interface Props {
  className?: string;
}

export function BoidReviewPanel({ className = '' }: Props) {
  const { toast } = useToast();
  const [showReviewed, setShowReviewed] = useState(false);

  const { data: allOverrides = [], isLoading, refetch } = useQuery<BoidOverride[]>({
    queryKey: ['/api/boid-overrides'],
  });

  const pending  = allOverrides.filter(o => o.status === 'pending_review');
  const reviewed = allOverrides.filter(o => o.status !== 'pending_review');

  const approveMutation = useMutation({
    mutationFn: ({ id, approvedBoid }: { id: number; approvedBoid?: string }) =>
      apiRequest('POST', `/api/boid-overrides/${id}/approve`, approvedBoid ? { approvedBoid } : {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/boid-overrides'] });
      toast({ title: 'Match approved', description: 'Will be used in the next sync.' });
    },
    onError: () => toast({ title: 'Error', description: 'Could not approve override.', variant: 'destructive' }),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: number) => apiRequest('POST', `/api/boid-overrides/${id}/reject`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/boid-overrides'] });
      toast({ title: 'Match rejected', description: 'Item will be skipped during sync.' });
    },
    onError: () => toast({ title: 'Error', description: 'Could not reject override.', variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/boid-overrides/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/boid-overrides'] });
    },
    onError: () => toast({ title: 'Error', description: 'Could not remove entry.', variant: 'destructive' }),
  });

  const anyPending = approveMutation.isPending || rejectMutation.isPending || deleteMutation.isPending;

  if (isLoading) {
    return (
      <div className={`flex items-center gap-2 text-sm text-muted-foreground p-3 ${className}`}>
        <RefreshCw className="w-4 h-4 animate-spin" />
        Loading catalog matches…
      </div>
    );
  }

  if (allOverrides.length === 0) {
    return null;
  }

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <GitMerge className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-semibold text-foreground">Catalog Match Review</span>
          {pending.length > 0 && (
            <Badge variant="outline" className="text-xs border-amber-500/40 text-amber-400 bg-amber-500/10">
              {pending.length} pending
            </Badge>
          )}
        </div>
        <Button
          size="icon"
          variant="ghost"
          title="Refresh"
          onClick={() => refetch()}
          data-testid="button-boid-refresh"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
      </div>

      {pending.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No pending matches — all uncertain catalog lookups have been reviewed.
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground leading-relaxed">
            The sync engine found these BrickLink items using fallback catalog lookups. Review each match — if the BrickOwl item looks correct, approve it; otherwise reject to skip during sync.
          </p>
          {pending.map(item => (
            <OverrideRow
              key={item.id}
              item={item}
              onApprove={(id, boid) => approveMutation.mutate({ id, approvedBoid: boid })}
              onReject={id => rejectMutation.mutate(id)}
              onDelete={id => deleteMutation.mutate(id)}
              isPending={anyPending}
            />
          ))}
        </div>
      )}

      {reviewed.length > 0 && (
        <>
          <Separator />
          <button
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setShowReviewed(s => !s)}
            data-testid="button-boid-toggle-reviewed"
          >
            {showReviewed ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {showReviewed ? 'Hide' : 'Show'} {reviewed.length} reviewed {reviewed.length === 1 ? 'item' : 'items'}
          </button>
          {showReviewed && (
            <div className="space-y-2">
              {reviewed.map(item => (
                <OverrideRow
                  key={item.id}
                  item={item}
                  onApprove={(id, boid) => approveMutation.mutate({ id, approvedBoid: boid })}
                  onReject={id => rejectMutation.mutate(id)}
                  onDelete={id => deleteMutation.mutate(id)}
                  isPending={anyPending}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function BoidReviewBadge() {
  const { data: overrides = [] } = useQuery<BoidOverride[]>({
    queryKey: ['/api/boid-overrides'],
    refetchInterval: 60_000,
  });
  const pendingCount = overrides.filter(o => o.status === 'pending_review').length;
  if (pendingCount === 0) return null;
  return (
    <Badge variant="outline" className="text-xs border-amber-500/40 text-amber-400 bg-amber-500/10 ml-1" data-testid="badge-boid-pending-count">
      <Clock className="w-3 h-3 mr-1" />
      {pendingCount}
    </Badge>
  );
}
