import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AlertTriangle, ChevronRight, Copy, Check, X } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

interface SyncIssue {
  id: string;
  syncType: string;
  platform: string;
  itemId?: string | null;
  itemNo?: string | null;
  issueType: string;
  issueDescription: string;
  severity: string;
  status: string;
  createdAt: string;
  metadata?: string | null;
}

interface SyncIssuesResponse {
  success: boolean;
  issues: SyncIssue[];
  count: number;
}

interface DashboardGroup {
  key: string;
  label: string;
  syncTypes: string[];
}

const GROUPS: DashboardGroup[] = [
  {
    key: "orders",
    label: "Orders",
    syncTypes: ["order_sync", "cross_platform_sync", "inventory_deduction"],
  },
  {
    key: "product",
    label: "Inventory",
    syncTypes: ["inventory_sync", "brickowl_lot", "quantity_health", "channel_sync", "priceomatic_sync"],
  },
  {
    key: "dashboard",
    label: "Dashboard",
    syncTypes: ["embedding_sync", "api_health", "forum_sync"],
  },
  {
    key: "tools",
    label: "Tools",
    syncTypes: ["brickanalyzer_scan"],
  },
];

function formatForAgent(issue: SyncIssue): string {
  const group = GROUPS.find(g => g.syncTypes.includes(issue.syncType));
  let text = `E.L.F.I.E. Issue Report\n`;
  text += `Dashboard: ${group?.label ?? "Unknown"}\n`;
  text += `Capability: ${issue.syncType.replace(/_/g, " ")}\n`;
  text += `Issue Type: ${issue.issueType.replace(/_/g, " ")}\n`;
  text += `Platform: ${issue.platform}\n`;
  if (issue.itemNo) text += `Item: ${issue.itemNo}\n`;
  if (issue.itemId && issue.itemId !== issue.itemNo) text += `ID: ${issue.itemId}\n`;
  text += `Severity: ${issue.severity}\n`;
  text += `Description: ${issue.issueDescription}\n`;
  text += `Time: ${new Date(issue.createdAt).toLocaleString()}\n`;
  if (issue.metadata) {
    try {
      const parsed = JSON.parse(issue.metadata);
      text += `Metadata: ${JSON.stringify(parsed, null, 2)}\n`;
    } catch {
      text += `Metadata: ${issue.metadata}\n`;
    }
  }
  return text;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button
      size="icon"
      variant="ghost"
      onClick={handleCopy}
      data-testid="button-copy-for-agent"
      title="Copy for Agent"
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </Button>
  );
}

function IssueRow({ issue }: { issue: SyncIssue }) {
  const severityColor: Record<string, string> = {
    critical: "text-red-400",
    high: "text-orange-400",
    medium: "text-yellow-400",
    low: "text-blue-400",
  };

  const dismissMutation = useMutation({
    mutationFn: () =>
      apiRequest("PATCH", `/api/sync-issues/${issue.id}`, { status: "resolved", resolvedBy: "user" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sync-issues"] });
    },
  });

  return (
    <div className="flex items-start gap-2 py-3 border-b border-border/40 last:border-0" data-testid={`issue-row-${issue.id}`}>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 mb-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {issue.syncType.replace(/_/g, " ")}
          </span>
          <span className="text-[10px] text-muted-foreground">·</span>
          <span className={`text-[10px] font-medium uppercase ${severityColor[issue.severity] ?? "text-muted-foreground"}`}>
            {issue.severity}
          </span>
          <span className="text-[10px] text-muted-foreground">·</span>
          <span className="text-[10px] text-muted-foreground">{issue.platform}</span>
          {issue.itemNo && (
            <>
              <span className="text-[10px] text-muted-foreground">·</span>
              <span className="text-[10px] font-mono text-muted-foreground">{issue.itemNo}</span>
            </>
          )}
        </div>
        <p className="text-xs leading-relaxed">{issue.issueDescription}</p>
        <p className="text-[10px] text-muted-foreground mt-1">
          {new Date(issue.createdAt).toLocaleString()}
        </p>
      </div>
      <div className="flex items-center shrink-0">
        <CopyButton text={formatForAgent(issue)} />
        <Button
          size="icon"
          variant="ghost"
          onClick={() => dismissMutation.mutate()}
          disabled={dismissMutation.isPending}
          data-testid={`button-dismiss-${issue.id}`}
          title="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

function GroupSheet({
  group,
  issues,
  open,
  onClose,
}: {
  group: DashboardGroup;
  issues: SyncIssue[];
  open: boolean;
  onClose: () => void;
}) {
  const clearMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/sync-issues/bulk-resolve", {
        syncTypes: group.syncTypes,
        status: "resolved",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sync-issues"] });
      onClose();
    },
  });

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg flex flex-col gap-0 p-0"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <SheetHeader className="flex flex-row items-center justify-between px-4 py-3 border-b gap-2 flex-wrap flex-shrink-0">
          <SheetTitle className="text-sm font-semibold">
            {group.label} — {issues.length} {issues.length === 1 ? "issue" : "issues"}
          </SheetTitle>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => clearMutation.mutate()}
              disabled={clearMutation.isPending || issues.length === 0}
              data-testid={`button-clear-group-${group.key}`}
            >
              {clearMutation.isPending ? "Clearing…" : "Clear all"}
            </Button>
            <Button size="icon" variant="ghost" onClick={onClose} data-testid="button-close-sheet">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </SheetHeader>
        <div
          className="flex-1 overflow-y-auto px-4"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {issues.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No open issues</p>
          ) : (
            issues.map(issue => <IssueRow key={issue.id} issue={issue} />)
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

const SYNC_ISSUES_QUERY_KEY = ["/api/sync-issues", { status: "open" }];
const fetchSyncIssues = async (): Promise<SyncIssuesResponse> => {
  const response = await fetch("/api/sync-issues?status=open");
  if (!response.ok) throw new Error("Failed to fetch sync issues");
  return response.json();
};

/** Lightweight hook — returns the count of open sync issues for the given group keys. */
export function useSyncIssueCount(groupKeys: string[]): number {
  const { data } = useQuery<SyncIssuesResponse>({
    queryKey: SYNC_ISSUES_QUERY_KEY,
    queryFn: fetchSyncIssues,
    refetchInterval: 30000,
  });
  const issues = data?.issues ?? [];
  const relevant = GROUPS.filter(g => groupKeys.includes(g.key));
  return relevant.reduce((sum, g) => sum + issues.filter(i => g.syncTypes.includes(i.syncType)).length, 0);
}

interface DashboardNotificationsProps {
  /** Only render groups whose key appears in this list. Omit to show all groups. */
  groupKeys?: string[];
  /** Called when user taps a group alert — use to navigate to the correct dashboard+tab. */
  onNavigate?: () => void;
}

export default function DashboardNotifications({ groupKeys, onNavigate }: DashboardNotificationsProps = {}) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const { data } = useQuery<SyncIssuesResponse>({
    queryKey: SYNC_ISSUES_QUERY_KEY,
    queryFn: fetchSyncIssues,
    refetchInterval: 30000,
  });

  const issues = data?.issues ?? [];

  const visibleGroups = groupKeys ? GROUPS.filter(g => groupKeys.includes(g.key)) : GROUPS;

  const groupsWithIssues = visibleGroups.map(group => ({
    group,
    issues: issues.filter(i => group.syncTypes.includes(i.syncType)),
  })).filter(({ issues }) => issues.length > 0);

  if (groupsWithIssues.length === 0) return null;

  const activeGroup = GROUPS.find(g => g.key === openGroup);
  const activeIssues = activeGroup
    ? issues.filter(i => activeGroup.syncTypes.includes(i.syncType))
    : [];

  return (
    <>
      <div className="space-y-1" data-testid="section-sync-issues">
        {groupsWithIssues.map(({ group, issues: groupIssues }) => (
          <button
            key={group.key}
            onClick={() => { onNavigate?.(); setOpenGroup(group.key); }}
            className="w-full flex items-center justify-between gap-3 px-2 py-1.5 rounded border border-orange-500/20 bg-orange-950/30 text-left hover-elevate active-elevate-2 text-orange-200"
            data-testid={`button-group-${group.key}`}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-3 h-3 shrink-0 text-orange-400" />
              <span className="text-xs">{group.label}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-300 border border-orange-600/30">
                {groupIssues.length} {groupIssues.length === 1 ? "issue" : "issues"}
              </span>
              <ChevronRight className="w-3 h-3 text-orange-400/60" />
            </div>
          </button>
        ))}
      </div>

      {activeGroup && (
        <GroupSheet
          group={activeGroup}
          issues={activeIssues}
          open={!!openGroup}
          onClose={() => setOpenGroup(null)}
        />
      )}
    </>
  );
}
