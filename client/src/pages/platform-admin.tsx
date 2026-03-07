import { useQuery, useMutation } from "@tanstack/react-query";
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
import { LayoutDashboard, Users, CreditCard, Scan, Settings2, ShieldCheck, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

const overrideSchema = z.object({
  seatLimitOverride: z.coerce.number().nullable(),
  brickspotterLimitOverride: z.coerce.number().nullable(),
  automationLimitOverride: z.coerce.number().nullable(),
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
        <SelectItem value="foundation">Foundation</SelectItem>
        <SelectItem value="core">Core</SelectItem>
      </SelectContent>
    </Select>
  );
}

export default function PlatformAdmin() {
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
              PlanetBrick Platform Admin
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
                    {new Date(org.createdAt).toLocaleDateString()}
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
