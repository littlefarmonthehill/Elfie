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
import { LayoutDashboard, Users, CreditCard, Scan, Settings2, ShieldCheck, ArrowLeft, Trash2, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
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
  const [dryRunResult, setDryRunResult] = useState<{ ordersToDelete: number; orderDetailsToDelete: number; sampleIds: string[] } | null>(null);
  const [done, setDone] = useState(false);

  const dryRun = useMutation({
    mutationFn: () => apiRequest('POST', '/api/platform-admin/cleanup-shipstation-duplicate-orders'),
    onSuccess: (data: any) => setDryRunResult(data),
    onError: () => toast({ title: 'Dry run failed', variant: 'destructive' }),
  });

  const execute = useMutation({
    mutationFn: () => apiRequest('POST', '/api/platform-admin/cleanup-shipstation-duplicate-orders?confirm=true'),
    onSuccess: (data: any) => {
      setDone(true);
      toast({ title: `Deleted ${data.ordersDeleted} duplicate orders` });
    },
    onError: () => toast({ title: 'Cleanup failed', variant: 'destructive' }),
  });

  if (done) {
    return (
      <div className="flex items-center gap-2 text-green-500 text-sm font-medium p-4">
        <CheckCircle2 className="h-5 w-5" />
        Cleanup complete — duplicate orders removed.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <p className="text-sm text-muted-foreground">
            Removes legacy duplicate BL orders (bare numeric IDs like BL.XXXXXX) where a proper <code className="text-xs bg-muted px-1 py-0.5 rounded">bl-XXXXXX</code> record already exists. Run dry run first to preview.
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
              Ready to delete — review before confirming
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-muted-foreground">Orders to delete</span>
                <p className="font-bold text-lg">{dryRunResult.ordersToDelete.toLocaleString()}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Order details to delete</span>
                <p className="font-bold text-lg">{dryRunResult.orderDetailsToDelete.toLocaleString()}</p>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Sample IDs: {dryRunResult.sampleIds.slice(0, 5).join(', ')}
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDryRunResult(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => execute.mutate()}
              disabled={execute.isPending}
              data-testid="button-confirm-cleanup"
            >
              {execute.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Confirm & Delete {dryRunResult.ordersToDelete.toLocaleString()} Orders
            </Button>
          </div>
        </div>
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
