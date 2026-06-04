import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Bug, Zap, Star, Copy, Check, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useOrgTimezone } from "@/hooks/use-org-timezone";
import { formatDate } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import type { AppFeedback } from "@shared/schema";

type StatusFilter = "all" | "new" | "in_progress" | "on_hold" | "done";

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  new: { label: "New", color: "text-blue-300", bg: "bg-blue-500/10", border: "border-blue-500/30" },
  in_progress: { label: "In Progress", color: "text-yellow-300", bg: "bg-yellow-500/10", border: "border-yellow-500/30" },
  on_hold: { label: "On Hold", color: "text-orange-300", bg: "bg-orange-500/10", border: "border-orange-500/30" },
  done: { label: "Done", color: "text-green-300", bg: "bg-green-500/10", border: "border-green-500/30" },
};

const TYPE_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
  defect: { label: "Defect", icon: Bug, color: "text-red-400" },
  enhancement: { label: "Enhancement", icon: Zap, color: "text-yellow-400" },
  feature: { label: "New Feature", icon: Star, color: "text-purple-400" },
};

function copyFeedbackText(item: AppFeedback, tz: string): string {
  const typeLbl = TYPE_CONFIG[item.type]?.label ?? item.type;
  const statusLbl = STATUS_CONFIG[item.status]?.label ?? item.status;
  const criteria = (item.acceptanceCriteria ?? "")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => `  • ${l.replace(/^[-•*]\s*/, "")}`)
    .join("\n");

  return [
    `[${typeLbl}] ${item.title}`,
    `Status: ${statusLbl}`,
    item.sourcePage ? `Page: ${item.sourcePage}` : null,
    ``,
    `Description:`,
    item.refinedDescription ?? item.rawDescription,
    ``,
    `Acceptance Criteria:`,
    criteria,
    ``,
    `Submitted: ${formatDate(item.createdAt, tz)}`,
  ].filter((l) => l !== null).join("\n");
}

function FeedbackCard({ item }: { item: AppFeedback }) {
  const { toast } = useToast();
  const tz = useOrgTimezone();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const typeInfo = TYPE_CONFIG[item.type] ?? TYPE_CONFIG.enhancement;
  const statusInfo = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.new;
  const Icon = typeInfo.icon;

  const updateMutation = useMutation({
    mutationFn: (status: string) =>
      apiRequest("PATCH", `/api/feedback/${item.id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/feedback"] }),
    onError: () => toast({ title: "Failed to update status", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/feedback/${item.id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/feedback"] }),
    onError: () => toast({ title: "Failed to delete feedback", variant: "destructive" }),
  });

  function handleCopy() {
    navigator.clipboard.writeText(copyFeedbackText(item, tz));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const criteria = (item.acceptanceCriteria ?? "")
    .split("\n")
    .filter((l) => l.trim());

  return (
    <div className="border border-gray-700 rounded-md bg-gray-800/50 p-3 space-y-2" data-testid={`card-feedback-${item.id}`}>
      {/* Header row */}
      <div className="flex items-start gap-2">
        <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${typeInfo.color}`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-100 leading-snug">{item.title}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">
            {typeInfo.label} · {formatDate(item.createdAt, tz)}
            {item.sourcePage && (
              <span className="ml-1.5 text-gray-600">· from <span className="font-mono text-gray-500">{item.sourcePage}</span></span>
            )}
          </p>
        </div>
        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Select
            value={item.status}
            onValueChange={(v) => updateMutation.mutate(v)}
          >
            <SelectTrigger
              className={`h-6 text-[10px] px-2 w-28 ${statusInfo.bg} ${statusInfo.color} border ${statusInfo.border}`}
              data-testid={`select-status-${item.id}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-gray-900 border-gray-700 text-xs">
              {Object.entries(STATUS_CONFIG).map(([val, cfg]) => (
                <SelectItem key={val} value={val} className={`text-[11px] ${cfg.color}`}>
                  {cfg.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-gray-400 hover:text-gray-200"
            onClick={handleCopy}
            title="Copy to clipboard"
            data-testid={`button-copy-${item.id}`}
          >
            {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-gray-600 hover:text-red-400"
            onClick={() => deleteMutation.mutate()}
            title="Delete"
            data-testid={`button-delete-${item.id}`}
          >
            <Trash2 className="w-3 h-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-gray-400"
            onClick={() => setExpanded((v) => !v)}
            data-testid={`button-expand-${item.id}`}
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </Button>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="ml-5 space-y-2 pt-1 border-t border-gray-700/50">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Description</p>
            <p className="text-xs text-gray-300 leading-relaxed">
              {item.refinedDescription ?? item.rawDescription}
            </p>
          </div>
          {criteria.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Acceptance Criteria</p>
              <ul className="space-y-0.5">
                {criteria.map((line, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-gray-300">
                    <span className="text-gray-600 mt-0.5 shrink-0">•</span>
                    {line.replace(/^[-•*]\s*/, "")}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {item.rawDescription !== item.refinedDescription && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Original Request</p>
              <p className="text-xs text-gray-500 italic leading-relaxed">{item.rawDescription}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function FeedbackBacklog() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const { data: items = [], isLoading } = useQuery<AppFeedback[]>({
    queryKey: ["/api/feedback"],
  });

  const filters: { value: StatusFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "new", label: "New" },
    { value: "in_progress", label: "In Progress" },
    { value: "on_hold", label: "On Hold" },
    { value: "done", label: "Done" },
  ];

  const filtered =
    statusFilter === "all" ? items : items.filter((i) => i.status === statusFilter);

  const counts = {
    all: items.length,
    new: items.filter((i) => i.status === "new").length,
    in_progress: items.filter((i) => i.status === "in_progress").length,
    on_hold: items.filter((i) => i.status === "on_hold").length,
    done: items.filter((i) => i.status === "done").length,
  };

  return (
    <div className="space-y-4 min-h-[400px]">
      <div>
        <h3 className="text-sm font-medium text-gray-300 mb-1">App Feedback Backlog</h3>
        <p className="text-xs text-gray-400">
          Feedback submitted through E.L.F.I.E. Copy any item to paste directly into a Replit message.
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-1.5" data-testid="feedback-filters">
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatusFilter(f.value)}
            data-testid={`filter-${f.value}`}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs border transition-colors ${
              statusFilter === f.value
                ? "bg-purple-500/20 border-purple-500/40 text-purple-300"
                : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300"
            }`}
          >
            {f.label}
            {counts[f.value] > 0 && (
              <span className={`rounded-full px-1 text-[9px] font-mono ${
                statusFilter === f.value ? "bg-purple-500/30 text-purple-200" : "bg-gray-700 text-gray-400"
              }`}>
                {counts[f.value]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full bg-gray-800" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center text-gray-500">
          <Star className="w-8 h-8 mb-2 opacity-30" />
          <p className="text-sm">No feedback {statusFilter !== "all" ? `with status "${STATUS_CONFIG[statusFilter]?.label ?? statusFilter}"` : "yet"}</p>
          <p className="text-xs mt-1">Use the E.L.F.I.E. feedback button to submit requests</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((item) => (
            <FeedbackCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
