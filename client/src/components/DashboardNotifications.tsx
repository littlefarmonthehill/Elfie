import { useQuery, useMutation } from "@tanstack/react-query";
import { X, AlertTriangle, AlertCircle, Info, XCircle } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";

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

export default function DashboardNotifications() {
  // Fetch open sync issues
  const { data } = useQuery<SyncIssuesResponse>({
    queryKey: ['/api/sync-issues', { status: 'open' }],
    queryFn: async () => {
      const response = await fetch('/api/sync-issues?status=open');
      if (!response.ok) throw new Error('Failed to fetch sync issues');
      return response.json();
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const issues = data?.issues || [];

  // Dismiss notification mutation
  const dismissMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'resolved' | 'ignored' }) => {
      return apiRequest('PATCH', `/api/sync-issues/${id}`, { status, resolvedBy: 'user' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sync-issues'] });
    },
  });

  const handleDismiss = (id: string, status: 'resolved' | 'ignored' = 'resolved') => {
    dismissMutation.mutate({ id, status });
  };

  // Don't show notification section if there are no issues
  if (issues.length === 0) return null;

  // Group issues by severity
  const criticalIssues = issues.filter(i => i.severity === 'critical');
  const highIssues = issues.filter(i => i.severity === 'high');
  const mediumIssues = issues.filter(i => i.severity === 'medium');
  const lowIssues = issues.filter(i => i.severity === 'low');

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical': return <XCircle className="w-4 h-4 md:w-5 md:h-5" />;
      case 'high': return <AlertTriangle className="w-4 h-4 md:w-5 md:h-5" />;
      case 'medium': return <AlertCircle className="w-4 h-4 md:w-5 md:h-5" />;
      default: return <Info className="w-4 h-4 md:w-5 md:h-5" />;
    }
  };

  const getSeverityStyles = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-900/50 border-red-500/50 text-red-200';
      case 'high':
        return 'bg-orange-900/50 border-orange-500/50 text-orange-200';
      case 'medium':
        return 'bg-yellow-900/50 border-yellow-500/50 text-yellow-200';
      default:
        return 'bg-blue-900/50 border-blue-500/50 text-blue-200';
    }
  };

  const renderIssues = (issuesList: SyncIssue[]) => {
    return issuesList.map((issue) => (
      <div
        key={issue.id}
        className={`flex items-start gap-2 md:gap-3 p-2 md:p-3 rounded-lg border ${getSeverityStyles(issue.severity)}`}
        data-testid={`notification-${issue.id}`}
      >
        <div className="flex-shrink-0 mt-0.5">
          {getSeverityIcon(issue.severity)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs md:text-sm font-semibold uppercase">
              {issue.syncType.replace('_', ' ')}
            </span>
            <Badge variant="outline" className="text-sm md:text-base md:text-xs">
              {issue.platform}
            </Badge>
            {issue.itemNo && (
              <span className="text-xs md:text-sm font-mono text-gray-300">
                {issue.itemNo}
              </span>
            )}
          </div>
          <p className="text-xs md:text-sm text-gray-300 leading-relaxed">
            {issue.issueDescription}
          </p>
          <div className="flex items-center gap-2 mt-1.5 text-sm md:text-base md:text-xs text-gray-400">
            <span>{issue.issueType.replace('_', ' ')}</span>
            <span>•</span>
            <span>{new Date(issue.createdAt).toLocaleString()}</span>
          </div>
        </div>
        <button
          onClick={() => handleDismiss(issue.id)}
          className="flex-shrink-0 hover-elevate p-1 rounded"
          data-testid={`button-dismiss-${issue.id}`}
          aria-label="Dismiss notification"
        >
          <X className="w-4 h-4 md:w-5 md:h-5" />
        </button>
      </div>
    ));
  };

  return (
    <div className="space-y-2 md:space-y-3" data-testid="section-notifications">
      {/* Critical Issues */}
      {criticalIssues.length > 0 && (
        <div className="space-y-1.5 md:space-y-2">
          {renderIssues(criticalIssues)}
        </div>
      )}

      {/* High Priority Issues */}
      {highIssues.length > 0 && (
        <div className="space-y-1.5 md:space-y-2">
          {renderIssues(highIssues)}
        </div>
      )}

      {/* Medium Priority Issues */}
      {mediumIssues.length > 0 && (
        <div className="space-y-1.5 md:space-y-2">
          {renderIssues(mediumIssues)}
        </div>
      )}

      {/* Low Priority Issues */}
      {lowIssues.length > 0 && (
        <div className="space-y-1.5 md:space-y-2">
          {renderIssues(lowIssues)}
        </div>
      )}
    </div>
  );
}
