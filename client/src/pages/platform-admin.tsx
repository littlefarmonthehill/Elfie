import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from "@/components/ui/dialog";
import { 
  Form, 
  FormControl, 
  FormField, 
  FormItem, 
  FormLabel 
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Organization } from "@shared/schema";
import { formatDate } from "@/lib/utils";
import { useOrgTimezone } from "@/hooks/use-org-timezone";
import { LayoutDashboard, Users, CreditCard, Scan, Settings2, ShieldCheck, ArrowLeft, Trash2, AlertTriangle, CheckCircle2, Loader2, ClipboardCheck, RefreshCw, CircleSlash } from "lucide-react";
import { Link } from "wouter";

const overrideSchema = z.object({
  seatLimitOverride: z.coerce.number().nullable(),
  brickspotterLimitOverride: z.coerce.number().nullable(),
  automationLimitOverride: z.coerce.number().nullable(),
  blApiCallLimitOverride: z.coerce.number().min(-1).max(5000).nullable(),
});

type OverrideFormValues = z.infer<typeof overrideSchema>;

interface OrgWithUsage extends Organization {
  userCount: number;
}

function EditOverridesDialog({ org }: { org: OrgWithUsage }) {
  const { toast } = useToast();
  const form = useForm<OverrideFormValues>({
    resolver: zodResolver(overrideSchema),
    defaultValues: {
      seatLimitOverride: org.seatLimitOverride,
      brickspotterLimitOverride: org.brickspotterLimitOverride,
      automationLimitOverride: org.automationLimitOverride,
      blApiCallLimitOverride: org.blApiCallLimitOverride,
    },
  });

  const mutation = useMutation({
    mutationFn: async (values: OverrideFormValues) => {
      return await apiRequest("PATCH", `/api/admin/organizations/${org.id}/overrides`, values);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform-admin/orgs"] });
      toast({ title: "Overrides updated successfully" });
    },
  });

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid={`button-edit-overrides-${org.id}`}>
          <Settings2 className="w-4 h-4 mr-1" />
          Overrides
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Overrides for {org.name}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <FormField
              control={form.control}
              name="seatLimitOverride"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Seat Limit Override (null for default)</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} type="number" data-testid="input-seat-override" />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="brickspotterLimitOverride"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>BrickSpotter Limit Override (null for default)</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} type="number" data-testid="input-scan-override" />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="automationLimitOverride"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Automation Limit Override (null for default)</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} type="number" data-testid="input-automation-override" />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="blApiCallLimitOverride"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>BL API Calls / 24h Override (null = platform default, -1 = unlimited, max 5000)</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} type="number" min={-1} max={5000} data-testid="input-bl-api-override" />
                  </FormControl>
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={mutation.isPending} data-testid="button-save-overrides">
              Save Overrides
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function ChangePlanDropdown({ org }: { org: OrgWithUsage }) {
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: async (plan: string) => {
      return await apiRequest("POST", `/api/admin/organizations/${org.id}/plan`, { plan });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform-admin/orgs"] });
      toast({ title: "Plan updated successfully" });
    },
  });

  return (
    <Select
      defaultValue={org.plan}
      onValueChange={(v) => mutation.mutate(v)}
      disabled={mutation.isPending}
    >
      <SelectTrigger className="w-[130px] h-8" data-testid={`select-plan-${org.id}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="flagship">Flagship</SelectItem>
        <SelectItem value="trial">Free Trial</SelectItem>
        <SelectItem value="foundation">Foundation</SelectItem>
        <SelectItem value="core">Core</SelectItem>
      </SelectContent>
    </Select>
  );
}

function DuplicateOrderCleanup() {
  const { toast } = useToast();
  const [dryRunResult, setDryRunResult] = useState<any | null>(null);
  const { data: archiveData } = useQuery<any>({
    queryKey: ['/api/platform-admin/cleanup-shipstation-duplicate-orders/archives'],
  });

  const dryRun = useMutation({
    mutationFn: () => apiRequest('POST', '/api/platform-admin/cleanup-shipstation-duplicate-orders'),
    onSuccess: (data: any) => setDryRunResult(data),
    onError: () => toast({ title: 'Dry run failed', variant: 'destructive' }),
  });

  const archive = useMutation({
    mutationFn: (candidate: any) => apiRequest('POST', '/api/platform-admin/cleanup-shipstation-duplicate-orders/archive', {
      candidateKey: candidate.candidateKey,
      expectedCandidateHash: candidate.candidateHash,
    }),
    onSuccess: (data: any) => {
      setDryRunResult((previous: any) => previous ? {
        ...previous,
        candidates: previous.candidates.map((candidate: any) =>
          candidate.candidateKey === data.candidateKey ? { ...candidate, archived: true } : candidate,
        ),
      } : previous);
      queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/cleanup-shipstation-duplicate-orders/archives'] });
      toast({ title: 'Candidate archived for review', description: 'The original order history was retained.' });
    },
    onError: (error: Error) => toast({ title: 'Archive failed', description: error.message, variant: 'destructive' }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <p className="text-sm text-muted-foreground">
            Reviews legacy <code className="text-xs bg-muted px-1 py-0.5 rounded">BL.XXXXXX</code> records against their canonical <code className="text-xs bg-muted px-1 py-0.5 rounded">bl-XXXXXX</code> order. Archiving records the proof but never removes order history or line items.
          </p>
        </div>
      </div>

      {!dryRunResult ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => dryRun.mutate()}
          disabled={dryRun.isPending}
          data-testid="button-dryrun-cleanup"
        >
          {dryRun.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
          Run Dry Run
        </Button>
      ) : (
        <div className="space-y-3">
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-md p-4 space-y-2">
            <div className="flex items-center gap-2 text-amber-500 font-semibold text-sm">
              <AlertTriangle className="h-4 w-4" />
              Review each candidate before archiving
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-muted-foreground">Ready for archive</span>
                <p className="font-bold text-lg">{dryRunResult.summary.readyForArchive.toLocaleString()}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Blocked as ambiguous</span>
                <p className="font-bold text-lg">{dryRunResult.summary.blocked.toLocaleString()}</p>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">{dryRunResult.message}</div>
          </div>
          <div className="space-y-2">
            {dryRunResult.candidates.map((candidate: any) => (
              <div key={candidate.candidateKey} className="rounded-md border border-border p-3 space-y-2 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{candidate.duplicateOrder.id} → {candidate.canonicalOrder.id}</p>
                    <p className="text-muted-foreground">{candidate.duplicateDetailsCount} line item{candidate.duplicateDetailsCount === 1 ? '' : 's'} retained</p>
                  </div>
                  {candidate.archived ? (
                    <span className="text-green-600 font-medium">Archived</span>
                  ) : candidate.comparison.isSafe ? (
                    <Button size="sm" variant="outline" onClick={() => archive.mutate(candidate)} disabled={archive.isPending} data-testid={`button-archive-cleanup-${candidate.duplicateOrder.id}`}>
                      {archive.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
                      Archive review
                    </Button>
                  ) : (
                    <span className="text-amber-600 font-medium">Blocked</span>
                  )}
                </div>
                <p className="text-muted-foreground">
                  Key: {candidate.duplicateOrder.order_key ?? 'missing'} · Source: {candidate.duplicateOrder.marketplace ?? 'missing'} · Date: {candidate.duplicateOrder.order_date ?? 'missing'} · Total: {candidate.duplicateOrder.order_total ?? 'missing'}
                </p>
                {!candidate.comparison.isSafe && (
                  <p className="text-amber-600">Not archived: {candidate.comparison.reasons.join('; ')}.</p>
                )}
              </div>
            ))}
          </div>
          {archiveData?.archives?.length > 0 && (
            <div className="space-y-2 border-t pt-3">
              <p className="text-sm font-medium">Archived review evidence</p>
              {archiveData.archives.map((archive: any) => (
                <div key={archive.candidateKey} className="rounded-md border border-border p-3 text-xs space-y-1">
                  <p className="font-medium">{archive.duplicateOrderId} → {archive.canonicalOrderId}</p>
                  <p className="text-muted-foreground">
                    Archived {new Date(archive.archivedAt).toLocaleString()} by {archive.archivedBy} · {archive.duplicateDetailsSnapshot.length} line item{archive.duplicateDetailsSnapshot.length === 1 ? '' : 's'} retained
                  </p>
                  <p>Duplicate: key {archive.duplicateSnapshot.order_key ?? 'missing'} · {archive.duplicateSnapshot.marketplace ?? 'missing'} · {archive.duplicateSnapshot.order_date ?? 'missing'} · {archive.duplicateSnapshot.order_total ?? 'missing'}</p>
                  <p>Canonical: key {archive.canonicalSnapshot.order_key ?? 'missing'} · {archive.canonicalSnapshot.marketplace ?? 'missing'} · {archive.canonicalSnapshot.order_date ?? 'missing'} · {archive.canonicalSnapshot.order_total ?? 'missing'}</p>
                  <p className="text-green-700">{archive.safeReason}</p>
                  {archive.reviewReason && <p className="text-muted-foreground">Reviewer note: {archive.reviewReason}</p>}
                </div>
              ))}
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => setDryRunResult(null)}>Close review</Button>
        </div>
      )}
    </div>
  );
}

type HistoricalRecoveryCandidate = {
  candidateKey: string;
  candidateType: "missing_line_item" | "quantity_mismatch" | "ambiguous";
  reason: string | null;
  order: { id: string; orderNumber: string; orderDate: string; marketplace: string | null; orderStatus: string };
  sourceOrder: { orderId: string | null; orderNumber: string | null; orderStatus: string | null; marketplaceName: string | null };
  sourceItem: { lineItemKey: string; sku: string | null; name: string | null; quantity: number | null; unitPrice: number | null; hasStableKey: boolean };
  localItem: { id: string; lineItemKey: string | null; sku: string | null; name: string; quantity: number; unitPrice: string | null } | null;
  sourceSnapshotHash: string;
  orderMappingStatus: "verified" | "order_number_only";
  review: { decision: string; reason: string | null; reviewedBy: string; reviewedAt: string } | null;
};

type HistoricalRecoveryResponse = {
  candidates: HistoricalRecoveryCandidate[];
  summary: { total: number; missingOrders: number; missingItems: number; quantityDifferences: number; ambiguous: number; reviewed: number };
};

function HistoricalOrderRecovery() {
  const { toast } = useToast();
  const [loaded, setLoaded] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const { data, isFetching, error } = useQuery<HistoricalRecoveryResponse>({
    queryKey: ["/api/platform-admin/historical-order-recovery/candidates", refreshNonce],
    queryFn: async () => {
      const response = await fetch(`/api/platform-admin/historical-order-recovery/candidates${refreshNonce ? "?refresh=true" : ""}`, { credentials: "include" });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || "Could not load ShipStation candidates");
      return response.json();
    },
    enabled: loaded,
    staleTime: 0,
  });

  const review = useMutation({
    mutationFn: async ({ candidate, decision, reason }: { candidate: HistoricalRecoveryCandidate; decision: "confirm_add" | "confirm_quantity" | "skip"; reason?: string }) => {
      if (decision !== "skip" && !candidate.sourceOrder.orderId) throw new Error("This ShipStation order has no stable source ID and cannot be repaired.");
      return apiRequest("POST", `/api/platform-admin/historical-order-recovery/${encodeURIComponent(candidate.candidateKey)}/review`, {
        decision,
        sourceOrderId: candidate.sourceOrder.orderId,
        sourceLineItemKey: candidate.sourceItem.lineItemKey,
        expectedSourceSnapshotHash: candidate.sourceSnapshotHash,
        expectedLocalQuantity: candidate.localItem?.quantity ?? null,
        reason: reason ?? null,
      });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform-admin/historical-order-recovery/candidates"] });
      toast({
        title: variables.decision === "skip" ? "Candidate skipped" : "Historical line item restored",
        description: "The decision and its source snapshot were recorded in the audit trail.",
      });
    },
    onError: (err: Error) => toast({ title: err.message || "Recovery review failed", variant: "destructive" }),
  });

  const verifyOrderLink = useMutation({
    mutationFn: async (candidate: HistoricalRecoveryCandidate) => {
      if (!candidate.sourceOrder.orderId) throw new Error("ShipStation did not provide an immutable order ID for this review.");
      return apiRequest("POST", `/api/platform-admin/historical-order-recovery/${encodeURIComponent(candidate.candidateKey)}/verify-order-link`, {
        sourceOrderId: candidate.sourceOrder.orderId,
        sourceSnapshotHash: candidate.sourceSnapshotHash,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform-admin/historical-order-recovery/candidates"] });
      toast({ title: "Order link verified", description: "The immutable ShipStation-to-channel mapping was saved. Reloaded candidates can now be reviewed for line recovery." });
    },
    onError: (err: Error) => toast({ title: err.message || "Order link verification failed", variant: "destructive" }),
  });

  const confirmCandidate = (candidate: HistoricalRecoveryCandidate) => {
    const action = candidate.candidateType === "missing_line_item" ? "restore this missing item" : "update this quantity";
    if (!window.confirm(`Confirm ${action} for order ${candidate.order.orderNumber}? This changes only the historical line item; inventory and order headers are not changed.`)) return;
    review.mutate({ candidate, decision: candidate.candidateType === "missing_line_item" ? "confirm_add" : "confirm_quantity" });
  };

  const skipCandidate = (candidate: HistoricalRecoveryCandidate) => {
    const reason = window.prompt("Why is this candidate being skipped? This note is saved in the audit trail.");
    if (!reason?.trim()) return;
    review.mutate({ candidate, decision: "skip", reason: reason.trim() });
  };

  const confirmOrderLink = (candidate: HistoricalRecoveryCandidate) => {
    if (!window.confirm(`Verify that ShipStation order ${candidate.sourceOrder.orderNumber || candidate.sourceOrder.orderId} is the same channel order as ${candidate.order.orderNumber}? Compare both source records before continuing. This saves only an immutable identity link; it does not change the order or its items.`)) return;
    verifyOrderLink.mutate(candidate);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            Cross-checks historical order rows against ShipStation using exact order and line-item identifiers. Each repair requires an individual confirmation and never adjusts inventory or the order header.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Rows without a stable source identity are shown as ambiguous and can only be skipped with a recorded reason.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setLoaded(true); setRefreshNonce(value => value + 1); }}
          disabled={isFetching}
          data-testid="button-load-historical-order-recovery"
        >
          {isFetching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          {loaded ? "Refresh ShipStation" : "Load Candidates"}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
            <div className="rounded border p-3"><p className="text-muted-foreground text-xs">Missing orders</p><p className="font-semibold">{data.summary.missingOrders}</p></div>
            <div className="rounded border p-3"><p className="text-muted-foreground text-xs">Missing items</p><p className="font-semibold">{data.summary.missingItems}</p></div>
            <div className="rounded border p-3"><p className="text-muted-foreground text-xs">Quantity differences</p><p className="font-semibold">{data.summary.quantityDifferences}</p></div>
            <div className="rounded border p-3"><p className="text-muted-foreground text-xs">Ambiguous</p><p className="font-semibold">{data.summary.ambiguous}</p></div>
            <div className="rounded border p-3"><p className="text-muted-foreground text-xs">Reviewed</p><p className="font-semibold">{data.summary.reviewed}</p></div>
          </div>

          {data.candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground py-3">No unresolved historical line-item gaps were found.</p>
          ) : (
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Difference</TableHead>
                    <TableHead>ShipStation source</TableHead>
                    <TableHead>Local record</TableHead>
                    <TableHead>Review</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.candidates.map(candidate => (
                    <TableRow key={candidate.candidateKey} data-testid={`row-historical-recovery-${candidate.candidateKey}`}>
                      <TableCell>
                        <p className="font-medium">{candidate.order.orderNumber}</p>
                        <p className="text-xs text-muted-foreground">{candidate.order.marketplace || "Unknown channel"} · {formatDate(candidate.order.orderDate)}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant={candidate.candidateType === "ambiguous" ? "secondary" : candidate.candidateType === "missing_line_item" ? "destructive" : "default"}>
                          {candidate.candidateType === "missing_line_item" ? "Missing item" : candidate.candidateType === "quantity_mismatch" ? "Quantity mismatch" : "Ambiguous"}
                        </Badge>
                        {candidate.reason && <p className="mt-1 max-w-xs text-xs text-muted-foreground">{candidate.reason}</p>}
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{candidate.sourceItem.name || "Unnamed item"}</p>
                        <p className="text-xs text-muted-foreground">SKU {candidate.sourceItem.sku || "—"} · Qty {candidate.sourceItem.quantity ?? "—"} · ${candidate.sourceItem.unitPrice ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">Line key {candidate.sourceItem.lineItemKey}</p>
                      </TableCell>
                      <TableCell>
                        {candidate.localItem ? (
                          <>
                            <p className="font-medium">{candidate.localItem.name}</p>
                            <p className="text-xs text-muted-foreground">SKU {candidate.localItem.sku || "—"} · Qty {candidate.localItem.quantity} · ${candidate.localItem.unitPrice ?? "—"}</p>
                          </>
                        ) : <span className="text-sm text-muted-foreground">No local line item</span>}
                      </TableCell>
                      <TableCell>
                        {candidate.review ? (
                          <div className="text-xs">
                            <Badge variant="secondary">{candidate.review.decision.replace("_", " ")}</Badge>
                            <p className="mt-1 text-muted-foreground">{candidate.review.reason || `Reviewed by ${candidate.review.reviewedBy}`}</p>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2 min-w-[130px]">
                            {candidate.candidateType !== "ambiguous" && candidate.sourceOrder.orderId && (
                              <Button size="sm" onClick={() => confirmCandidate(candidate)} disabled={review.isPending} data-testid={`button-confirm-historical-recovery-${candidate.candidateKey}`}>
                                <CheckCircle2 className="h-4 w-4 mr-1" />
                                Confirm
                              </Button>
                            )}
                            {candidate.orderMappingStatus === "order_number_only" && candidate.sourceOrder.orderId && (
                              <Button variant="secondary" size="sm" onClick={() => confirmOrderLink(candidate)} disabled={verifyOrderLink.isPending || review.isPending} data-testid={`button-verify-historical-order-link-${candidate.candidateKey}`}>
                                <CheckCircle2 className="h-4 w-4 mr-1" />
                                Verify order link
                              </Button>
                            )}
                            <Button variant="outline" size="sm" onClick={() => skipCandidate(candidate)} disabled={review.isPending} data-testid={`button-skip-historical-recovery-${candidate.candidateKey}`}>
                              <CircleSlash className="h-4 w-4 mr-1" />
                              Skip
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  );
}


export default function PlatformAdmin() {
  const tz = useOrgTimezone();
  const { data: orgs, isLoading: orgsLoading } = useQuery<OrgWithUsage[]>({
    queryKey: ["/api/platform-admin/orgs"],
  });

  const { data: stats, isLoading: statsLoading } = useQuery<{
    totalOrgs: number;
    activeSubscriptions: number;
    totalUsers: number;
  }>({
    queryKey: ["/api/platform-admin/stats"],
  });

  if (orgsLoading || statsLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="sm" data-testid="link-back-home">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
            </Link>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <ShieldCheck className="w-8 h-8 text-primary" />
              E.L.F.I.E. Platform Admin
            </h1>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-card border rounded-lg p-6 flex items-center gap-4 shadow-sm" data-testid="stat-total-orgs">
            <div className="p-3 bg-primary/10 rounded-full">
              <LayoutDashboard className="w-6 h-6 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Total Organizations</p>
              <h2 className="text-2xl font-bold">{stats?.totalOrgs ?? 0}</h2>
            </div>
          </div>
          <div className="bg-card border rounded-lg p-6 flex items-center gap-4 shadow-sm" data-testid="stat-active-subs">
            <div className="p-3 bg-green-500/10 rounded-full">
              <CreditCard className="w-6 h-6 text-green-500" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Active Subscriptions</p>
              <h2 className="text-2xl font-bold">{stats?.activeSubscriptions ?? 0}</h2>
            </div>
          </div>
          <div className="bg-card border rounded-lg p-6 flex items-center gap-4 shadow-sm" data-testid="stat-total-users">
            <div className="p-3 bg-blue-500/10 rounded-full">
              <Users className="w-6 h-6 text-blue-500" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Total Users</p>
              <h2 className="text-2xl font-bold">{stats?.totalUsers ?? 0}</h2>
            </div>
          </div>
        </div>

        {/* Maintenance Tools */}
        <div className="bg-card border rounded-lg shadow-sm p-6 space-y-2">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-muted-foreground" />
            Maintenance Tools
          </h2>
          <div className="border-t pt-4">
            <p className="text-sm font-medium mb-2">Duplicate Order Cleanup</p>
            <DuplicateOrderCleanup />
          </div>
          <div className="border-t pt-4">
            <p className="text-sm font-medium mb-2 flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
              Historical Line-Item Recovery
            </p>
            <HistoricalOrderRecovery />
          </div>
        </div>

        {/* Orgs Table */}
        <div className="bg-card border rounded-lg shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Users</TableHead>
                <TableHead>BrickSpotter</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Stripe ID</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orgs?.map((org) => (
                <TableRow key={org.id} data-testid={`row-org-${org.id}`}>
                  <TableCell className="font-medium">
                    <div className="flex flex-col">
                      <span data-testid={`text-org-name-${org.id}`}>{org.name}</span>
                      <span className="text-xs text-muted-foreground font-mono">{org.slug}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <ChangePlanDropdown org={org} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2" data-testid={`text-org-users-${org.id}`}>
                      <Users className="w-4 h-4 text-muted-foreground" />
                      {org.userCount}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2" data-testid={`text-org-scans-${org.id}`}>
                      <Scan className="w-4 h-4 text-muted-foreground" />
                      {org.brickspotterScansThisMonth}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge 
                      variant={org.subscriptionStatus === 'active' ? 'default' : 'secondary'}
                      className="capitalize"
                      data-testid={`status-org-${org.id}`}
                    >
                      {org.subscriptionStatus}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs max-w-[120px] truncate" title={org.stripeCustomerId ?? 'N/A'}>
                    {org.stripeCustomerId ?? '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {formatDate(org.createdAt, tz)}
                  </TableCell>
                  <TableCell className="text-right">
                    <EditOverridesDialog org={org} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
