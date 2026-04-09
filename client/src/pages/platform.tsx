import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useAdminScaling } from "@/hooks/useAdminScaling";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import SettingsModal from "@/components/SettingsModal";
import elfieRobot from "@assets/PlanetBrick_good_robot_1760672362080.png";
import {
  Rocket, Building2, Headphones, TrendingUp, Cpu, Map,
  Settings, LogOut, ChevronRight, Users, Activity,
  CheckCircle2, AlertCircle, Clock, Search, Shield,
  RefreshCw, Loader2, BarChart3, DollarSign, Package,
  Zap, Star, GitBranch, MessageSquare, Server,
  ArrowRight, Eye, Ban, Trash2, CircleCheck, CircleDot,
  ChevronDown, ChevronUp, Layers, ListChecks,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

type PlatformTab = 'central' | 'customers' | 'support' | 'revenue' | 'systems' | 'roadmap';

interface PlatformTabDef {
  id: PlatformTab;
  label: string;
  color: string;
  activeClass: string;
  inactiveClass: string;
  icon: React.ElementType;
  num: string;
}

const PLATFORM_TABS: PlatformTabDef[] = [
  { id: 'central',   label: 'Command',   num: '01', color: 'lego-red',    activeClass: 'text-lego-red',    inactiveClass: 'text-lego-red/70',    icon: Rocket    },
  { id: 'customers', label: 'Customers', num: '02', color: 'lego-blue',   activeClass: 'text-lego-blue',   inactiveClass: 'text-lego-blue/70',   icon: Building2 },
  { id: 'support',   label: 'Support',   num: '03', color: 'lego-orange', activeClass: 'text-lego-orange', inactiveClass: 'text-lego-orange/70', icon: Headphones },
  { id: 'revenue',   label: 'Revenue',   num: '04', color: 'lego-green',  activeClass: 'text-lego-green',  inactiveClass: 'text-lego-green/70',  icon: TrendingUp },
  { id: 'systems',   label: 'Systems',   num: '05', color: 'lego-yellow', activeClass: 'text-lego-yellow', inactiveClass: 'text-lego-yellow/70', icon: Cpu       },
  { id: 'roadmap',   label: 'Roadmap',   num: '06', color: 'lego-purple', activeClass: 'text-lego-purple', inactiveClass: 'text-lego-purple/70', icon: Map       },
];

const TAB_COLOR_MAP: Record<string, { border: string; bg: string; glow: string; hex: string; rgb: string; text: string; iconBg: string; }> = {
  'lego-red':    { border: 'border-lego-red/30',    bg: 'from-lego-red/8 via-transparent to-lego-red/4',       glow: 'bg-lego-red',    hex: '#E53535', rgb: '229,53,53',   text: 'text-lego-red',    iconBg: 'bg-lego-red/10'    },
  'lego-blue':   { border: 'border-lego-blue/30',   bg: 'from-lego-blue/8 via-transparent to-lego-blue/4',     glow: 'bg-lego-blue',   hex: '#1B7CE5', rgb: '27,124,229',  text: 'text-lego-blue',   iconBg: 'bg-lego-blue/10'   },
  'lego-orange': { border: 'border-lego-orange/30', bg: 'from-lego-orange/8 via-transparent to-lego-orange/4', glow: 'bg-lego-orange', hex: '#E8611C', rgb: '232,97,28',   text: 'text-lego-orange', iconBg: 'bg-lego-orange/10' },
  'lego-green':  { border: 'border-lego-green/30',  bg: 'from-lego-green/8 via-transparent to-lego-green/4',   glow: 'bg-lego-green',  hex: '#00963C', rgb: '0,150,60',    text: 'text-lego-green',  iconBg: 'bg-lego-green/10'  },
  'lego-yellow': { border: 'border-lego-yellow/30', bg: 'from-lego-yellow/8 via-transparent to-lego-yellow/4', glow: 'bg-lego-yellow', hex: '#F5C200', rgb: '245,194,0',   text: 'text-lego-yellow', iconBg: 'bg-lego-yellow/10' },
  'lego-purple': { border: 'border-lego-purple/30', bg: 'from-lego-purple/8 via-transparent to-lego-purple/4', glow: 'bg-lego-purple', hex: '#9B5DE5', rgb: '155,93,229',  text: 'text-lego-purple', iconBg: 'bg-lego-purple/10' },
};

// ─── Shared UI helpers ───────────────────────────────────────────────────────

/** Card section with org-dashboard-style header: icon + uppercase label */
function DashSection({ label, Icon, color, children, action }: {
  label: string; Icon: React.ElementType; color: string; children: React.ReactNode; action?: React.ReactNode;
}) {
  const c = TAB_COLOR_MAP[color] ?? TAB_COLOR_MAP['lego-blue'];
  return (
    <div className="rounded-xl border border-white/8 bg-gray-900/60 overflow-hidden">
      <div className="flex items-center gap-2.5 px-3 py-2.5 border-b border-white/5 bg-gray-950/30">
        <div className={cn("p-1.5 rounded-md shrink-0", c.iconBg)}>
          <Icon className={cn("w-3.5 h-3.5", c.text)} />
        </div>
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/80 flex-1">{label}</span>
        {action}
      </div>
      <div className="p-3">
        {children}
      </div>
    </div>
  );
}

/** Large metric displayed inside a DashSection metric row */
function MetricItem({ label, value, color, sub, onClick }: {
  label: string; value: string | number; color: string; sub?: string; onClick?: () => void;
}) {
  const c = TAB_COLOR_MAP[color] ?? TAB_COLOR_MAP['lego-blue'];
  if (onClick) {
    return (
      <button
        onClick={onClick}
        className="flex flex-col gap-0.5 px-2 py-1.5 rounded-md hover-elevate active-elevate-2 text-left w-full cursor-pointer"
      >
        <div className="flex items-center justify-between gap-1">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{label}</p>
          <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
        </div>
        <p className={cn("text-2xl font-black font-mono leading-none", c.text)}>{value}</p>
        {sub && <p className="text-[9px] text-muted-foreground">{sub}</p>}
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-0.5 px-2 py-1.5">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{label}</p>
      <p className={cn("text-2xl font-black font-mono leading-none", c.text)}>{value}</p>
      {sub && <p className="text-[9px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** Colored tool tile — 2-column grid item */
function ToolTile({ label, sub, Icon, color, onClick }: {
  label: string; sub: string; Icon: React.ElementType; color: string; onClick?: () => void;
}) {
  const c = TAB_COLOR_MAP[color] ?? TAB_COLOR_MAP['lego-blue'];
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-lg p-3 text-left space-y-2 hover-elevate active-elevate-2 w-full border",
        c.iconBg, c.border
      )}
    >
      <div className={cn("p-1.5 rounded-md w-fit", c.iconBg)}>
        <Icon className={cn("w-4 h-4", c.text)} />
      </div>
      <div>
        <p className="text-sm font-semibold text-foreground leading-tight">{label}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{sub}</p>
      </div>
    </button>
  );
}

/** Full-width list row */
function ListRow({ children, onClick, testId }: {
  children: React.ReactNode; onClick?: () => void; testId?: string;
}) {
  if (onClick) {
    return (
      <button
        onClick={onClick}
        data-testid={testId}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-white/5 bg-gray-900/30 hover-elevate active-elevate-2 text-left"
      >
        {children}
      </button>
    );
  }
  return (
    <div data-testid={testId} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-white/5 bg-gray-900/30">
      {children}
    </div>
  );
}

// ─── Tab: Platform Central ───────────────────────────────────────────────────

function CentralTab({ onNavigate }: { onNavigate: (tab: PlatformTab) => void }) {
  const { data: stats } = useQuery<{ totalOrganizations: number; totalUsers: number; activeSubscriptions: number }>({
    queryKey: ['/api/platform-admin/stats'],
  });
  const { data: ticketCount } = useQuery<{ count: number }>({
    queryKey: ['/api/platform-admin/support-queue/count'],
    refetchInterval: 15000,
  });
  const { data: orgs } = useQuery<any[]>({
    queryKey: ['/api/platform-admin/orgs'],
  });
  const recentOrgs = orgs?.slice().sort((a, b) =>
    new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
  ).slice(0, 4) ?? [];

  return (
    <div className="p-3 space-y-3 max-w-4xl mx-auto">
      {/* Metrics */}
      <DashSection label="Platform Metrics" Icon={BarChart3} color="lego-red">
        <div className="grid grid-cols-2 gap-x-1 gap-y-0 divide-x divide-white/5">
          <MetricItem label="Organizations" value={stats?.totalOrganizations ?? '—'} color="lego-blue" />
          <MetricItem label="Active Plans" value={stats?.activeSubscriptions ?? '—'} color="lego-green" sub="paying" />
          <MetricItem label="Total Users" value={stats?.totalUsers ?? '—'} color="lego-yellow" />
          <MetricItem label="Open Tickets" value={ticketCount?.count ?? 0} color={ticketCount?.count ? 'lego-orange' : 'lego-green'} sub={ticketCount?.count ? 'needs attention' : 'all clear'} />
        </div>
      </DashSection>

      {/* Quick actions */}
      <DashSection label="Command Center" Icon={Rocket} color="lego-red">
        <div className="grid grid-cols-2 gap-2">
          <ToolTile label="Support Queue" sub={`${ticketCount?.count ?? 0} tickets waiting`} Icon={Headphones} color="lego-orange" onClick={() => onNavigate('support')} />
          <ToolTile label="Customer Orgs" sub={`${stats?.totalOrganizations ?? 0} organizations`} Icon={Building2} color="lego-blue" onClick={() => onNavigate('customers')} />
          <ToolTile label="Revenue & Plans" sub="Manage plans and pricing" Icon={TrendingUp} color="lego-green" onClick={() => onNavigate('revenue')} />
          <ToolTile label="System Health" sub="Sync jobs and scheduler" Icon={Activity} color="lego-yellow" onClick={() => onNavigate('systems')} />
        </div>
      </DashSection>

      {/* Recent signups */}
      {recentOrgs.length > 0 && (
        <DashSection label="Recent Signups" Icon={Users} color="lego-blue">
          <div className="space-y-1.5">
            {recentOrgs.map((org) => (
              <ListRow key={org.id}>
                <div className="w-7 h-7 rounded-md bg-lego-blue/15 border border-lego-blue/25 flex items-center justify-center shrink-0">
                  <Building2 className="w-3.5 h-3.5 text-lego-blue" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{org.name}</p>
                  <p className="text-[10px] text-muted-foreground">{org.plan ?? 'no plan'} · {org.userCount ?? 0} users</p>
                </div>
                <Badge variant="outline" className="text-[9px] shrink-0 capitalize border-white/15 text-muted-foreground">
                  {org.subscriptionStatus ?? 'inactive'}
                </Badge>
              </ListRow>
            ))}
          </div>
        </DashSection>
      )}
    </div>
  );
}

// ─── Tab: Customers ──────────────────────────────────────────────────────────

function CustomersTab() {
  const { toast } = useToast();
  const [search, setSearch] = useState('');

  const { data: orgs, isLoading } = useQuery<any[]>({
    queryKey: ['/api/platform-admin/orgs'],
  });

  const impersonateMutation = useMutation({
    mutationFn: (orgId: string) => apiRequest('POST', `/api/platform-admin/impersonate/${orgId}`, {}),
    onSuccess: () => { window.location.href = '/'; },
    onError: () => toast({ title: 'Failed to impersonate', variant: 'destructive' }),
  });

  const suspendMutation = useMutation({
    mutationFn: ({ orgId, suspend }: { orgId: string; suspend: boolean }) =>
      apiRequest('PATCH', `/api/platform-admin/orgs/${orgId}/suspend`, { suspend }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/orgs'] }); },
    onError: () => toast({ title: 'Failed to update org status', variant: 'destructive' }),
  });

  const filtered = orgs?.filter(o =>
    o.name?.toLowerCase().includes(search.toLowerCase()) ||
    o.plan?.toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  const planColor = (plan: string) => {
    switch (plan) {
      case 'flagship': return 'text-lego-purple border-lego-purple/30 bg-lego-purple/10';
      case 'core': return 'text-lego-blue border-lego-blue/30 bg-lego-blue/10';
      case 'foundation': return 'text-lego-green border-lego-green/30 bg-lego-green/10';
      case 'beta': return 'text-lego-yellow border-lego-yellow/30 bg-lego-yellow/10';
      default: return 'text-muted-foreground border-white/15 bg-white/5';
    }
  };

  return (
    <div className="p-3 space-y-3 max-w-5xl mx-auto">
      <DashSection label="Organizations" Icon={Building2} color="lego-blue">
        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search organizations or plans…"
            className="pl-9 bg-gray-900/80 border-white/10 text-sm"
            data-testid="input-customer-search"
          />
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-lego-blue" />
          </div>
        ) : (
          <div className="space-y-1.5">
            {filtered.map((org) => (
              <ListRow key={org.id} testId={`card-org-${org.id}`}>
                <div className="w-8 h-8 rounded-md bg-lego-blue/15 border border-lego-blue/25 flex items-center justify-center shrink-0">
                  <Building2 className="w-4 h-4 text-lego-blue" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-foreground truncate">{org.name}</p>
                    <Badge className={cn("text-[9px] border px-1.5 py-0 font-mono uppercase", planColor(org.plan ?? ''))}>
                      {org.plan ?? 'none'}
                    </Badge>
                    {!org.isActive && (
                      <Badge className="text-[9px] border px-1.5 py-0 text-red-400 border-red-500/30 bg-red-950/30">
                        Suspended
                      </Badge>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {org.userCount ?? 0} users · {org.subscriptionStatus ?? 'inactive'}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs h-7 px-2 text-lego-blue"
                    onClick={() => impersonateMutation.mutate(org.id)}
                    disabled={impersonateMutation.isPending}
                    data-testid={`button-impersonate-${org.id}`}
                    title="View as this company"
                  >
                    <Eye className="w-3.5 h-3.5 mr-1" />
                    View
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={cn("text-xs h-7 px-2", org.isActive ? "text-yellow-400" : "text-lego-green")}
                    onClick={() => suspendMutation.mutate({ orgId: org.id, suspend: org.isActive })}
                    disabled={suspendMutation.isPending}
                    data-testid={`button-suspend-${org.id}`}
                    title={org.isActive ? 'Suspend org' : 'Activate org'}
                  >
                    {org.isActive ? <Ban className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  </Button>
                </div>
              </ListRow>
            ))}
            {filtered.length === 0 && (
              <div className="text-center py-10 text-muted-foreground text-sm">
                No organizations match your search.
              </div>
            )}
          </div>
        )}
      </DashSection>
    </div>
  );
}

// ─── Tab: Support ────────────────────────────────────────────────────────────

function SupportTab({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { data: tickets, isLoading } = useQuery<any[]>({
    queryKey: ['/api/platform-admin/support-queue'],
    refetchInterval: 15000,
  });
  const { data: ticketCount } = useQuery<{ count: number }>({
    queryKey: ['/api/platform-admin/support-queue/count'],
    refetchInterval: 15000,
  });

  const active = tickets?.filter(t => t.status !== 'resolved') ?? [];
  const resolved = tickets?.filter(t => t.status === 'resolved') ?? [];

  const statusColor = (status: string) => {
    switch (status) {
      case 'escalated': return 'text-lego-orange border-lego-orange/30 bg-lego-orange/10';
      case 'active': return 'text-lego-yellow border-lego-yellow/30 bg-lego-yellow/10';
      case 'resolved': return 'text-lego-green border-lego-green/30 bg-lego-green/10';
      default: return 'text-muted-foreground border-white/15';
    }
  };

  function relTime(iso: string) {
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 2) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  }

  return (
    <div className="p-3 space-y-3 max-w-4xl mx-auto">
      <DashSection label="Support Metrics" Icon={Headphones} color="lego-orange">
        <div className="grid grid-cols-3 gap-x-1 divide-x divide-white/5">
          <MetricItem label="Open" value={active.filter(t => t.status === 'active').length} color="lego-yellow" />
          <MetricItem label="Escalated" value={active.filter(t => t.status === 'escalated').length} color="lego-orange" />
          <MetricItem label="Resolved" value={resolved.length} color="lego-green" sub="all time" />
        </div>
      </DashSection>

      <DashSection label="Support Tools" Icon={MessageSquare} color="lego-orange">
        <div className="grid grid-cols-1 gap-2">
          <ToolTile
            label="Support Queue"
            sub="Reply to tickets, view full conversation history"
            Icon={MessageSquare}
            color="lego-orange"
            onClick={onOpenSettings}
          />
        </div>
      </DashSection>

      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-5 h-5 animate-spin text-lego-orange" />
        </div>
      ) : active.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8">
          <CheckCircle2 className="w-8 h-8 text-lego-green" />
          <p className="text-sm text-muted-foreground">No open tickets — all clear</p>
        </div>
      ) : (
        <DashSection label="Active Tickets" Icon={AlertCircle} color="lego-orange">
          <div className="space-y-1.5">
            {active.map((ticket) => (
              <ListRow key={ticket.id} onClick={onOpenSettings} testId={`card-ticket-${ticket.id}`}>
                <div className="w-8 h-8 rounded-md bg-lego-orange/10 border border-lego-orange/25 flex items-center justify-center shrink-0">
                  <Headphones className="w-4 h-4 text-lego-orange" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground truncate">
                      {ticket.orgName ?? ticket.userId ?? 'Unknown'}
                    </p>
                    <Badge className={cn("text-[9px] border px-1.5 py-0 capitalize shrink-0", statusColor(ticket.status))}>
                      {ticket.status}
                    </Badge>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {ticket.messageCount ?? 0} messages · {ticket.updatedAt ? relTime(ticket.updatedAt) : '—'}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </ListRow>
            ))}
          </div>
        </DashSection>
      )}
    </div>
  );
}

// ─── Tab: Revenue ────────────────────────────────────────────────────────────

function RevenueTab({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { data: plans, isLoading } = useQuery<any[]>({
    queryKey: ['/api/platform-admin/plans'],
  });
  const { data: orgs } = useQuery<any[]>({
    queryKey: ['/api/platform-admin/orgs'],
  });

  const activeOrgs = orgs?.filter(o => o.subscriptionStatus === 'active') ?? [];
  const trialOrgs = orgs?.filter(o => o.subscriptionStatus === 'trial' || o.plan === 'trial') ?? [];

  // Simple MRR estimate from active orgs and their plans
  const estimatedMRR = plans && orgs ? activeOrgs.reduce((sum, org) => {
    const plan = plans.find((p: any) => p.name?.toLowerCase() === org.plan?.toLowerCase());
    return sum + (plan?.basePrice ?? 0);
  }, 0) : 0;

  const planColor = (status: string) => {
    switch (status) {
      case 'live': return 'text-lego-green border-lego-green/30 bg-lego-green/10';
      case 'in_progress': return 'text-lego-yellow border-lego-yellow/30 bg-lego-yellow/10';
      case 'sunset': return 'text-red-400 border-red-500/30 bg-red-950/20';
      default: return 'text-muted-foreground border-white/15';
    }
  };

  const orgCountForPlan = (planName: string) =>
    orgs?.filter(o => o.plan?.toLowerCase() === planName?.toLowerCase()).length ?? 0;

  return (
    <div className="p-3 space-y-3 max-w-4xl mx-auto">
      <DashSection label="Revenue Metrics" Icon={TrendingUp} color="lego-green">
        <div className="grid grid-cols-2 gap-x-1 divide-x divide-white/5">
          <MetricItem label="Est. MRR" value={`$${estimatedMRR.toFixed(0)}`} color="lego-green" sub="base plan fees" />
          <MetricItem label="Active" value={activeOrgs.length} color="lego-blue" sub="paying orgs" />
          <MetricItem label="Trials" value={trialOrgs.length} color="lego-yellow" />
          <MetricItem label="Live Plans" value={plans?.filter((p: any) => p.status === 'live').length ?? 0} color="lego-purple" />
        </div>
      </DashSection>

      <DashSection label="Tools" Icon={DollarSign} color="lego-green">
        <ToolTile
          label="Plans & Pricing Editor"
          sub="Create plans, set pricing, manage trial periods"
          Icon={TrendingUp}
          color="lego-green"
          onClick={onOpenSettings}
        />
      </DashSection>

      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-5 h-5 animate-spin text-lego-green" />
        </div>
      ) : (
        <DashSection label="Plans" Icon={Layers} color="lego-green">
          <div className="space-y-1.5">
            {plans?.map((plan: any) => (
              <ListRow key={plan.id} testId={`card-plan-${plan.id}`}>
                <div className="w-8 h-8 rounded-md bg-lego-green/10 border border-lego-green/25 flex items-center justify-center shrink-0">
                  <Layers className="w-4 h-4 text-lego-green" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-foreground">{plan.name}</p>
                    <Badge className={cn("text-[9px] border px-1.5 py-0 capitalize", planColor(plan.status ?? 'live'))}>
                      {plan.status ?? 'live'}
                    </Badge>
                  </div>
                  <p className="text-[10px] text-muted-foreground font-mono">
                    ${Number(plan.basePrice ?? 0).toFixed(2)}/mo · {orgCountForPlan(plan.name)} orgs
                    {plan.salesPercentage ? ` · ${plan.salesPercentage}% GMV` : ''}
                  </p>
                </div>
                <Button size="sm" variant="ghost" className="text-xs h-7 px-2 text-lego-green" onClick={onOpenSettings}>
                  Edit
                </Button>
              </ListRow>
            ))}
          </div>
        </DashSection>
      )}
    </div>
  );
}

// ─── Tab: Systems ────────────────────────────────────────────────────────────

function SystemsTab({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { data: syncStatuses } = useQuery<any>({
    queryKey: ['/api/platform-admin/org-sync-status'],
    refetchInterval: 30000,
  });

  const { data: platformInfo } = useQuery<any>({
    queryKey: ['/api/platform-admin/platform-services/platform-info'],
  });

  const jobStatusColor = (status: string) => {
    if (status === 'success') return 'text-lego-green';
    if (status === 'in_progress') return 'text-lego-yellow';
    if (status === 'failed' || status === 'error') return 'text-red-400';
    return 'text-muted-foreground';
  };

  const jobStatusIcon = (status: string) => {
    if (status === 'success') return CheckCircle2;
    if (status === 'in_progress') return RefreshCw;
    if (status === 'failed' || status === 'error') return AlertCircle;
    return Clock;
  };

  function relTime(iso: string | null) {
    if (!iso) return 'never';
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 2) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  }

  const syncSummary = syncStatuses?.summary ?? [];

  return (
    <div className="p-3 space-y-3 max-w-4xl mx-auto">
      <DashSection label="System Metrics" Icon={Cpu} color="lego-yellow">
        <div className="grid grid-cols-2 gap-x-1 divide-x divide-white/5">
          <MetricItem label="Platform" value={platformInfo?.platformName ?? 'E.L.F.I.E.'} color="lego-yellow" sub="online" />
          <MetricItem label="Orgs Synced" value={syncStatuses?.orgCount ?? '—'} color="lego-blue" sub="active sync" />
        </div>
      </DashSection>

      <DashSection label="System Tools" Icon={Activity} color="lego-yellow">
        <div className="grid grid-cols-2 gap-2">
          <ToolTile
            label="Scheduler & Jobs"
            sub="API quota, sync schedules, trigger jobs"
            Icon={Activity}
            color="lego-yellow"
            onClick={onOpenSettings}
          />
          <ToolTile
            label="Data Enrichment"
            sub="Catalog images, embeddings, maintenance"
            Icon={Package}
            color="lego-blue"
            onClick={onOpenSettings}
          />
        </div>
      </DashSection>

      {syncSummary.length > 0 ? (
        <DashSection label="Org Sync Status" Icon={RefreshCw} color="lego-yellow">
          <div className="space-y-1.5">
            {syncSummary.slice(0, 8).map((item: any) => {
              const StatusIcon = jobStatusIcon(item.inventoryStatus ?? '');
              return (
                <ListRow key={item.orgId}>
                  <div className="w-7 h-7 rounded-md bg-lego-yellow/10 border border-lego-yellow/25 flex items-center justify-center shrink-0">
                    <Building2 className="w-3.5 h-3.5 text-lego-yellow" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{item.orgName}</p>
                    <p className="text-[10px] text-muted-foreground">
                      Inventory: {relTime(item.lastInventorySync)} · Orders: {relTime(item.lastOrderSync)}
                    </p>
                  </div>
                  <StatusIcon className={cn("w-4 h-4 shrink-0", jobStatusColor(item.inventoryStatus ?? ''),
                    item.inventoryStatus === 'in_progress' && 'animate-spin'
                  )} />
                </ListRow>
              );
            })}
          </div>
        </DashSection>
      ) : (
        <div className="flex flex-col items-center gap-2 py-8">
          <Server className="w-8 h-8 text-lego-yellow/50" />
          <p className="text-sm text-muted-foreground">Open Scheduler to view detailed system status</p>
          <Button size="sm" variant="ghost" className="text-lego-yellow text-xs" onClick={onOpenSettings}>
            Open Scheduler <ArrowRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Roadmap ────────────────────────────────────────────────────────────

function RoadmapTab({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { data: capabilities } = useQuery<any[]>({
    queryKey: ['/api/platform-admin/product/capabilities'],
  });
  const { data: backlog } = useQuery<any[]>({
    queryKey: ['/api/platform-admin/product/backlog'],
  });
  const { data: okrs } = useQuery<any[]>({
    queryKey: ['/api/platform-admin/product/okrs'],
  });

  const built  = capabilities?.filter(c => c.status === 'built').length ?? 0;
  const now    = capabilities?.filter(c => c.status === 'now').length ?? 0;
  const next   = capabilities?.filter(c => c.status === 'next').length ?? 0;
  const later  = capabilities?.filter(c => c.status === 'later').length ?? 0;
  const total  = (built + now + next + later) || 1;

  const statusDef = [
    { key: 'built', label: 'Built', count: built, color: 'lego-green', Icon: CheckCircle2 },
    { key: 'now',   label: 'Now',   count: now,   color: 'lego-orange', Icon: CircleDot   },
    { key: 'next',  label: 'Next',  count: next,  color: 'lego-blue',  Icon: GitBranch   },
    { key: 'later', label: 'Later', count: later, color: 'lego-purple', Icon: Clock       },
  ];

  return (
    <div className="p-3 space-y-3 max-w-4xl mx-auto">
      <DashSection label="Capabilities" Icon={Star} color="lego-purple">
        <div className="grid grid-cols-2 gap-x-1 divide-x divide-white/5 mb-3">
          {statusDef.map(({ key, label, count, color }) => (
            <MetricItem key={key} label={label} value={count} color={color} sub={`${Math.round((count / total) * 100)}%`} />
          ))}
        </div>
        {/* Progress bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Overall Progress</span>
            <span className="text-xs font-mono text-lego-green">{Math.round((built / total) * 100)}% built</span>
          </div>
          <div className="flex h-2 rounded-full overflow-hidden bg-gray-800">
            <div className="bg-lego-green transition-all duration-500" style={{ width: `${(built / total) * 100}%` }} />
            <div className="bg-lego-orange transition-all duration-500" style={{ width: `${(now / total) * 100}%` }} />
            <div className="bg-lego-blue transition-all duration-500" style={{ width: `${(next / total) * 100}%` }} />
            <div className="bg-lego-purple transition-all duration-500" style={{ width: `${(later / total) * 100}%` }} />
          </div>
          <div className="flex gap-3 flex-wrap">
            {statusDef.map(({ label, color }) => {
              const cc = TAB_COLOR_MAP[color] ?? TAB_COLOR_MAP['lego-blue'];
              return (
                <div key={label} className="flex items-center gap-1">
                  <div className={cn("w-2 h-2 rounded-full", cc.glow)} />
                  <span className="text-[9px] text-muted-foreground">{label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </DashSection>

      <DashSection label="Product Tools" Icon={Map} color="lego-purple">
        <div className="grid grid-cols-2 gap-2">
          <ToolTile
            label="Product Roadmap"
            sub={`${now} in flight · ${next} up next`}
            Icon={Map}
            color="lego-purple"
            onClick={onOpenSettings}
          />
          <ToolTile
            label="Feature Backlog"
            sub={`${backlog?.length ?? 0} items · ${okrs?.length ?? 0} OKRs`}
            Icon={ListChecks}
            color="lego-blue"
            onClick={onOpenSettings}
          />
        </div>
      </DashSection>

      {okrs && okrs.length > 0 && (
        <DashSection label="Active OKRs" Icon={GitBranch} color="lego-purple">
          <div className="space-y-2">
            {okrs.slice(0, 3).map((okr: any) => {
              const progress = okr.progress ?? 0;
              return (
                <div key={okr.id} className="rounded-lg border border-white/5 bg-gray-900/30 p-3">
                  <p className="text-sm font-medium text-foreground mb-2">{okr.objective}</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-lego-purple rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(progress, 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-mono text-lego-purple shrink-0">{progress}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </DashSection>
      )}
    </div>
  );
}

// ─── Platform Nav Rail (desktop/tablet) ──────────────────────────────────────

function PlatformNavRail({
  active, onSelect, compact,
}: {
  active: PlatformTab; onSelect: (t: PlatformTab) => void; compact?: boolean;
}) {
  return (
    <div className="flex flex-col items-center py-2 gap-0.5 h-full overflow-hidden">
      {PLATFORM_TABS.map((tab) => {
        const isActive = active === tab.id;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            data-testid={`rail-tab-platform-${tab.id}`}
            title={tab.label}
            className={cn(
              "relative flex flex-col items-center gap-1 w-full transition-colors duration-200 rounded-md",
              compact ? "py-2 px-1" : "py-2.5 px-1",
              isActive ? tab.activeClass : tab.inactiveClass
            )}
          >
            {isActive && (
              <div className={cn(
                "absolute left-0 top-2 bottom-2 w-[2px] rounded-full",
                tab.color === 'lego-red'    && "bg-lego-red shadow-[0_0_6px_2px] shadow-lego-red/50",
                tab.color === 'lego-blue'   && "bg-lego-blue shadow-[0_0_6px_2px] shadow-lego-blue/50",
                tab.color === 'lego-orange' && "bg-lego-orange shadow-[0_0_6px_2px] shadow-lego-orange/50",
                tab.color === 'lego-green'  && "bg-lego-green shadow-[0_0_6px_2px] shadow-lego-green/50",
                tab.color === 'lego-yellow' && "bg-lego-yellow shadow-[0_0_6px_2px] shadow-lego-yellow/50",
                tab.color === 'lego-purple' && "bg-lego-purple shadow-[0_0_6px_2px] shadow-lego-purple/50",
              )} />
            )}
            <div className="relative">
              {isActive && (
                <div className={cn(
                  "absolute inset-0 rounded-full blur-md scale-[2.5] opacity-30",
                  tab.color === 'lego-red'    && "bg-lego-red",
                  tab.color === 'lego-blue'   && "bg-lego-blue",
                  tab.color === 'lego-orange' && "bg-lego-orange",
                  tab.color === 'lego-green'  && "bg-lego-green",
                  tab.color === 'lego-yellow' && "bg-lego-yellow",
                  tab.color === 'lego-purple' && "bg-lego-purple",
                )} />
              )}
              <Icon className={cn("relative shrink-0", compact ? "w-4 h-4" : "w-5 h-5")} strokeWidth={isActive ? 2.2 : 1.6} />
            </div>
            {!compact && (
              <span className={cn("text-[9px] font-medium leading-tight text-center px-0.5 w-full", isActive && "font-semibold")}>
                {tab.label}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Platform Bottom Nav (mobile) ────────────────────────────────────────────

const SWIPE_THRESHOLD = 30;

function PlatformBottomNav({ active, onSelect, hasOrg, onMyOrg }: { active: PlatformTab; onSelect: (t: PlatformTab) => void; hasOrg?: boolean; onMyOrg?: () => void }) {
  const [isHidden, setIsHidden] = useState(false);
  const touchStartY = useRef<number | null>(null);

  const lockScroll = useCallback(() => {
    document.body.style.overflow = 'hidden';
  }, []);
  const unlockScroll = useCallback(() => {
    document.body.style.overflow = '';
  }, []);
  useEffect(() => () => unlockScroll(), [unlockScroll]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    lockScroll();
  }, [lockScroll]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    unlockScroll();
    if (touchStartY.current === null) return;
    const dist = e.changedTouches[0].clientY - touchStartY.current;
    if (dist > SWIPE_THRESHOLD) setIsHidden(true);
    else if (dist < -SWIPE_THRESHOLD) setIsHidden(false);
    touchStartY.current = null;
  }, [unlockScroll]);

  return (
    <>
      {isHidden && (
        <div
          className="fixed bottom-0 left-0 right-0 z-50 flex flex-col items-center pb-[max(8px,env(safe-area-inset-bottom))] pt-2 cursor-pointer touch-none"
          onClick={() => setIsHidden(false)}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          data-testid="platform-pull-tab"
        >
          <div className="w-10 h-[3px] rounded-full bg-lego-purple/70" />
          <span className="text-[9px] text-lego-purple/50 mt-1 font-medium tracking-wider uppercase">Menu</span>
        </div>
      )}
      <nav
        className={cn(
          "fixed bottom-0 left-0 right-0 z-50 bg-gray-950/95 backdrop-blur-md border-t border-white/8 transition-transform duration-300 ease-in-out touch-none",
          isHidden ? "translate-y-full" : "translate-y-0"
        )}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        data-testid="platform-bottom-nav"
      >
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 rounded-full bg-white/30" />
        </div>
        <div
          className="flex items-end justify-around"
          style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}
        >
          {PLATFORM_TABS.map((tab) => {
            const isActive = active === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => onSelect(tab.id)}
                data-testid={`tab-platform-${tab.id}`}
                className={cn(
                  "relative flex flex-col items-center gap-0.5 pt-2 pb-1 px-2 min-w-0 flex-1 transition-colors duration-200",
                  isActive ? tab.activeClass : tab.inactiveClass
                )}
              >
                <div className="relative">
                  {isActive && (
                    <div className={cn(
                      "absolute inset-0 rounded-full blur-md scale-[2] opacity-40",
                      TAB_COLOR_MAP[tab.color]?.glow,
                    )} />
                  )}
                  <Icon className="relative w-5 h-5 shrink-0" strokeWidth={isActive ? 2.2 : 1.6} />
                </div>
                <span className={cn("text-[10px] font-medium truncate max-w-full", isActive && "font-semibold")}>
                  {tab.label}
                </span>
                {isActive ? (
                  <div className={cn(
                    "w-5 h-[2px] rounded-full mt-0.5",
                    tab.color === 'lego-red'    && "bg-lego-red shadow-[0_0_6px_1px] shadow-lego-red/60",
                    tab.color === 'lego-blue'   && "bg-lego-blue shadow-[0_0_6px_1px] shadow-lego-blue/60",
                    tab.color === 'lego-orange' && "bg-lego-orange shadow-[0_0_6px_1px] shadow-lego-orange/60",
                    tab.color === 'lego-green'  && "bg-lego-green shadow-[0_0_6px_1px] shadow-lego-green/60",
                    tab.color === 'lego-yellow' && "bg-lego-yellow shadow-[0_0_6px_1px] shadow-lego-yellow/60",
                    tab.color === 'lego-purple' && "bg-lego-purple shadow-[0_0_6px_1px] shadow-lego-purple/60",
                  )} />
                ) : (
                  <div className="w-5 h-[2px] mt-0.5" />
                )}
              </button>
            );
          })}

          {/* Org toggle — far right, only when admin also has an org */}
          {hasOrg && onMyOrg && (
            <>
              <div className="w-px self-stretch my-2 bg-white/8 shrink-0" />
              <button
                onClick={onMyOrg}
                data-testid="tab-platform-my-org"
                className="relative flex flex-col items-center gap-0.5 pt-2 pb-1 px-2 min-w-0 flex-1 transition-colors duration-200 text-lego-blue/60 hover:text-lego-blue/90"
              >
                <Building2 className="relative w-5 h-5 shrink-0" strokeWidth={1.6} />
                <span className="text-[10px] font-medium truncate max-w-full">My Org</span>
                <div className="w-5 h-[2px] mt-0.5" />
              </button>
            </>
          )}
        </div>
      </nav>
    </>
  );
}

// ─── Platform Header ─────────────────────────────────────────────────────────

function PlatformHeader({
  activeTab, hasOrg, onSettings, onMyOrg, onLogout,
}: {
  activeTab: PlatformTab; hasOrg: boolean; onSettings: () => void; onMyOrg: () => void; onLogout: () => void;
}) {
  const logoutMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/logout'),
    onSuccess: () => { window.location.href = '/'; },
  });

  const activeTabDef = PLATFORM_TABS.find(t => t.id === activeTab)!;

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 bg-gray-950/80 backdrop-blur-sm shrink-0">
      {/* Logo + Title */}
      <div className="flex items-center gap-2 min-w-0">
        <img src={elfieRobot} alt="E.L.F.I.E." className="h-7 w-7 object-contain shrink-0 opacity-90" />
        <div className="min-w-0 hidden sm:block">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-lego-purple/80 leading-none">Platform Admin</p>
          <p className={cn("text-xs font-semibold", activeTabDef.activeClass)}>{activeTabDef.label}</p>
        </div>
      </div>

      <div className="flex-1" />

      {/* Back to My Org */}
      {hasOrg && (
        <Button
          size="sm"
          variant="ghost"
          className="text-xs h-8 gap-1.5 text-muted-foreground hover:text-foreground shrink-0"
          onClick={onMyOrg}
          data-testid="button-platform-my-org"
        >
          <Building2 className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">My Org</span>
        </Button>
      )}

      {/* Settings */}
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
        onClick={onSettings}
        data-testid="button-platform-settings"
        title="Platform Settings"
      >
        <Settings className="w-4 h-4" />
      </Button>

      {/* Logout */}
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
        onClick={() => logoutMutation.mutate()}
        disabled={logoutMutation.isPending}
        data-testid="button-platform-logout"
        title="Log out"
      >
        <LogOut className="w-4 h-4" />
      </Button>
    </div>
  );
}

// ─── Main Platform Page ──────────────────────────────────────────────────────

export default function PlatformPage() {
  useAdminScaling();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const hasOrg = !!(user as any)?.orgId;

  const [activeTab, setActiveTab] = useState<PlatformTab>('central');
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth >= 1024
  );
  const [navHidden] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<string | null>(null);

  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 1024);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // iOS scroll-freeze recovery
  useEffect(() => {
    const recover = () => {
      const isLocked =
        document.body.hasAttribute('data-scroll-locked') ||
        document.body.style.overflow === 'hidden';
      if (!isLocked) return;
      const hasOpen =
        !!document.querySelector('[data-radix-dialog-content][data-state="open"]') ||
        !!document.querySelector('[data-vaul-drawer][data-state="open"]');
      if (!hasOpen) {
        document.body.removeAttribute('data-scroll-locked');
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.top = '';
      }
    };
    document.addEventListener('touchstart', recover, { passive: true });
    return () => document.removeEventListener('touchstart', recover);
  }, []);

  const openSettings = (section?: string) => {
    setSettingsInitialSection(section ?? null);
    setSettingsOpen(true);
  };

  const handleMyOrg = () => { setLocation('/'); };

  // Tab → settings section mapping for quick-action buttons
  const settingsSectionForTab: Partial<Record<PlatformTab, string>> = {
    support:  'supportQueue',
    revenue:  'plansAndPricing',
    systems:  'platformScheduler',
    roadmap:  'roadmap',
  };

  const activeTabDef = PLATFORM_TABS.find(t => t.id === activeTab)!;
  const colorData = TAB_COLOR_MAP[activeTabDef.color];

  const renderTabContent = () => {
    const settingsSection = settingsSectionForTab[activeTab];
    const handleOpenSettings = () => openSettings(settingsSection);

    switch (activeTab) {
      case 'central':   return <CentralTab onNavigate={setActiveTab} />;
      case 'customers': return <CustomersTab />;
      case 'support':   return <SupportTab onOpenSettings={handleOpenSettings} />;
      case 'revenue':   return <RevenueTab onOpenSettings={handleOpenSettings} />;
      case 'systems':   return <SystemsTab onOpenSettings={handleOpenSettings} />;
      case 'roadmap':   return <RoadmapTab onOpenSettings={handleOpenSettings} />;
    }
  };

  // ── Desktop TV cockpit layout ────────────────────────────────────────────
  const TV_DIALS = PLATFORM_TABS.map(t => ({
    id: t.id, num: t.num, label: t.label.toUpperCase(), hex: TAB_COLOR_MAP[t.color].hex, rgb: TAB_COLOR_MAP[t.color].rgb,
  }));
  const activeDial = TV_DIALS.find(d => d.id === activeTab) ?? TV_DIALS[0];

  return (
    <div
      className="flex flex-col bg-[#04080F] text-foreground"
      style={{ height: '100dvh', paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      {/* Header */}
      <div className="sticky top-0 z-50">
        <PlatformHeader
          activeTab={activeTab}
          hasOrg={hasOrg}
          onSettings={() => openSettings()}
          onMyOrg={handleMyOrg}
          onLogout={() => {}}
        />
      </div>

      {/* Dashboard area */}
      <div className="flex-1 overflow-hidden bg-[#04080F]">

        {/* ── MOBILE (< md) ── */}
        <div className="md:hidden h-full overflow-y-auto">
          <div className={cn(
            "h-full p-2 transition-[padding] duration-300",
            !navHidden && "pb-20"
          )}>
            <div className={cn(
              "h-full rounded-lg border overflow-hidden",
              colorData.border,
              `bg-gradient-to-br ${colorData.bg.replace('via-transparent', 'via-gray-950/80')} to-gray-950/80`
            )}>
              <div className="h-full overflow-y-auto">
                {renderTabContent()}
              </div>
            </div>
          </div>
        </div>

        {/* ── TABLET (md to lg) ── */}
        <div className="hidden md:flex lg:hidden h-full p-2 gap-2">
          <div className="flex h-full w-full rounded-xl border border-white/10 bg-gradient-to-br from-gray-900/50 via-gray-950/90 to-gray-900/50 shadow-[0_0_60px_rgba(0,0,0,0.5)] overflow-hidden relative">
            <div className="absolute top-0 left-0 w-5 h-5 border-t-2 border-l-2 border-white/15 rounded-tl-xl pointer-events-none z-10" />
            <div className="absolute top-0 right-0 w-5 h-5 border-t-2 border-r-2 border-white/15 rounded-tr-xl pointer-events-none z-10" />
            <div className="absolute bottom-0 left-0 w-5 h-5 border-b-2 border-l-2 border-white/15 rounded-bl-xl pointer-events-none z-10" />
            <div className="absolute bottom-0 right-0 w-5 h-5 border-b-2 border-r-2 border-white/15 rounded-br-xl pointer-events-none z-10" />

            {/* Vertical nav rail */}
            <div className="w-[62px] flex-shrink-0 border-r border-white/5 bg-gray-950/60 h-full">
              <PlatformNavRail active={activeTab} onSelect={setActiveTab} />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 h-full relative overflow-hidden">
              <div className={cn("h-full overflow-y-auto bg-gradient-to-br", colorData.bg)}>
                {renderTabContent()}
              </div>
            </div>
          </div>
        </div>

        {/* ── DESKTOP (lg+): TV cockpit ── */}
        <div className="hidden lg:flex h-full p-3">
          <style>{`
            @keyframes pfm-scan { 0%{top:-2px;opacity:0} 4%{opacity:0.55} 96%{opacity:0.25} 100%{top:100%;opacity:0} }
            @keyframes pfm-ledpulse { 0%,100%{text-shadow:0 0 8px #B77FFF} 50%{text-shadow:0 0 18px #B77FFF,0 0 36px rgba(183,127,255,0.4)} }
            @keyframes pfm-bgring { from{transform:translate(-50%,-50%) rotate(0deg)} to{transform:translate(-50%,-50%) rotate(360deg)} }
            @keyframes pfm-chglow { 0%,100%{box-shadow:0 0 10px var(--pfm-ch-hex,#9B5DE5),inset 0 0 6px rgba(0,0,0,0.5)} 50%{box-shadow:0 0 20px var(--pfm-ch-hex,#9B5DE5),inset 0 0 10px rgba(0,0,0,0.3)} }
            @keyframes pfm-idle { 0%,100%{opacity:0.06} 50%{opacity:0.12} }
          `}</style>

          {/* TV body */}
          <div className="flex h-full w-full flex-col relative" style={{
            background: 'linear-gradient(165deg, #1C1C32 0%, #151525 35%, #101020 70%, #0C0C1A 100%)',
            borderRadius: 'clamp(16px, 2.5vw, 28px)',
            border: '2px solid rgba(255,255,255,0.16)',
            boxShadow: '0 0 0 1px rgba(120,80,255,0.30) inset, 0 0 0 2px rgba(80,40,180,0.18) inset, 0 20px 80px rgba(0,0,0,0.9), 0 0 80px rgba(155,93,229,0.10)',
            padding: 'clamp(10px,1.2vw,14px)',
            paddingBottom: 0,
            gap: 'clamp(8px,0.9vw,10px)',
            overflow: 'hidden',
          }}>

            {/* Top highlight */}
            <div style={{ position: 'absolute', top: 0, left: '6%', right: '6%', height: '1px', background: 'linear-gradient(90deg, transparent, rgba(183,127,255,0.3), transparent)', pointerEvents: 'none' }} />

            {/* Corner accents */}
            {([{ top: '11px', left: '16px' }, { top: '11px', right: '16px' }, { bottom: '11px', left: '16px' }, { bottom: '11px', right: '16px' }] as const).map((pos, i) => (
              <div key={i} style={{ position: 'absolute', ...pos, width: '11px', height: '11px', border: '1px solid rgba(183,127,255,0.18)', borderRadius: '3px', pointerEvents: 'none', zIndex: 10 }} />
            ))}

            {/* 2-panel content row: nav rail left + main content */}
            <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 'clamp(8px,0.9vw,12px)' }}>

              {/* LEFT: Nav Rail */}
              <div style={{
                flex: '0 0 clamp(68px,7%,80px)',
                display: 'flex', flexDirection: 'column',
                borderRadius: '10px', overflow: 'hidden',
                border: '1.5px solid rgba(120,80,255,0.28)',
                background: 'rgba(10,12,32,0.92)',
                boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.5), 0 0 18px rgba(100,60,220,0.12)',
              }}>
                {/* Platform badge */}
                <div className="flex flex-col items-center pt-3 pb-2 border-b border-white/5">
                  <Shield className="w-5 h-5 text-lego-purple mb-1" strokeWidth={1.5} />
                  <span className="text-[8px] text-lego-purple/70 font-bold tracking-widest uppercase">Admin</span>
                </div>
                <div className="flex-1 overflow-hidden">
                  <PlatformNavRail active={activeTab} onSelect={setActiveTab} />
                </div>
                {/* My Org shortcut */}
                {hasOrg && (
                  <div className="border-t border-white/5 p-1">
                    <button
                      onClick={handleMyOrg}
                      title="Back to My Org"
                      className="w-full flex flex-col items-center gap-1 py-2 rounded-md text-muted-foreground hover:text-lego-blue transition-colors"
                      data-testid="button-rail-my-org"
                    >
                      <Building2 className="w-4 h-4" strokeWidth={1.6} />
                      <span className="text-[8px] font-medium">My Org</span>
                    </button>
                  </div>
                )}
              </div>

              {/* RIGHT: Main screen */}
              <div style={{
                flex: 1, minWidth: 0,
                display: 'flex', flexDirection: 'column',
                borderRadius: '10px', overflow: 'hidden',
                border: `1.5px solid rgba(${activeDial.rgb},0.28)`,
                background: 'rgba(6,8,20,0.96)',
                boxShadow: `inset 0 2px 10px rgba(0,0,0,0.5), 0 0 18px rgba(${activeDial.rgb},0.10)`,
                position: 'relative',
              }}>
                {/* Scan line */}
                <div style={{
                  position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1,
                  background: `repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(${activeDial.rgb},0.025) 3px,rgba(${activeDial.rgb},0.025) 4px)`,
                }} />
                {/* Screen glow */}
                <div style={{
                  position: 'absolute', top: 0, left: 0, right: 0, height: '30%', pointerEvents: 'none', zIndex: 1,
                  background: `radial-gradient(ellipse at 50% 0%, rgba(${activeDial.rgb},0.08) 0%, transparent 70%)`,
                }} />
                {/* Moving scan bar */}
                <div style={{
                  position: 'absolute', left: 0, right: 0, height: '2px', pointerEvents: 'none', zIndex: 2,
                  background: `linear-gradient(90deg, transparent 0%, rgba(${activeDial.rgb},0.6) 50%, transparent 100%)`,
                  animation: 'pfm-scan 4s linear infinite',
                }} />

                {/* Screen tab bar */}
                <div className="relative z-10 flex items-center gap-0 border-b border-white/5 bg-gray-950/50 px-3 py-1.5 shrink-0">
                  {TV_DIALS.map((dial) => {
                    const isActive = dial.id === activeTab;
                    const tabDef = PLATFORM_TABS.find(t => t.id === dial.id)!;
                    return (
                      <button
                        key={dial.id}
                        onClick={() => setActiveTab(dial.id)}
                        style={isActive ? { '--pfm-ch-hex': dial.hex } as React.CSSProperties : {}}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-1 text-[10px] font-bold tracking-wider rounded-sm transition-all mr-0.5",
                          isActive
                            ? `${tabDef.activeClass} bg-white/5 border border-${tabDef.color}/25`
                            : `${tabDef.inactiveClass} hover:bg-white/5`
                        )}
                        data-testid={`desktop-tab-${dial.id}`}
                      >
                        <span className="text-[9px] font-mono opacity-60">{dial.num}</span>
                        <tabDef.icon className="w-3 h-3" strokeWidth={isActive ? 2.2 : 1.6} />
                        <span>{dial.label}</span>
                      </button>
                    );
                  })}
                  {/* LED indicator */}
                  <div className="ml-auto flex items-center gap-1.5 pr-1">
                    <div
                      className="w-1.5 h-1.5 rounded-full"
                      style={{
                        backgroundColor: activeDial.hex,
                        animation: 'pfm-ledpulse 2.5s ease-in-out infinite',
                        boxShadow: `0 0 6px ${activeDial.hex}`,
                      }}
                    />
                    <span className="text-[9px] font-mono text-muted-foreground/60 tracking-widest">LIVE</span>
                  </div>
                </div>

                {/* Content */}
                <div
                  className={cn("relative z-10 flex-1 min-h-0 overflow-y-auto bg-gradient-to-br", colorData.bg)}
                >
                  {renderTabContent()}
                </div>
              </div>
            </div>

            {/* Bottom chrome bar with channel dials */}
            <div style={{
              height: 'clamp(36px,4vh,48px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'clamp(6px,1.2vw,16px)',
              borderTop: '1px solid rgba(255,255,255,0.06)',
              flexShrink: 0,
            }}>
              {TV_DIALS.map((dial) => {
                const isActive = dial.id === activeTab;
                const tabDef = PLATFORM_TABS.find(t => t.id === dial.id)!;
                return (
                  <button
                    key={dial.id}
                    onClick={() => setActiveTab(dial.id)}
                    style={{ '--pfm-ch-hex': dial.hex } as React.CSSProperties}
                    className={cn(
                      "flex flex-col items-center gap-0.5 group",
                      isActive ? tabDef.activeClass : "text-white/25 hover:text-white/50"
                    )}
                    data-testid={`dial-${dial.id}`}
                  >
                    <div style={{
                      width: 'clamp(22px,2.4vw,30px)', height: 'clamp(22px,2.4vw,30px)',
                      borderRadius: '50%',
                      border: `1px solid ${isActive ? dial.hex : 'rgba(255,255,255,0.12)'}`,
                      background: isActive ? `rgba(${dial.rgb},0.15)` : 'rgba(255,255,255,0.04)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      animation: isActive ? 'pfm-chglow 2.5s ease-in-out infinite' : undefined,
                    }}>
                      <tabDef.icon style={{ width: 'clamp(9px,1vw,13px)', height: 'clamp(9px,1vw,13px)' }} strokeWidth={isActive ? 2.2 : 1.4} />
                    </div>
                    <span style={{ fontSize: 'clamp(7px,0.65vw,9px)', fontWeight: 700, letterSpacing: '0.08em' }}>
                      {dial.num}
                    </span>
                  </button>
                );
              })}

              {/* Settings + My Org dials */}
              <div className="flex items-center gap-2 ml-auto mr-2">
                {hasOrg && (
                  <button
                    onClick={handleMyOrg}
                    className="flex flex-col items-center gap-0.5 text-lego-blue/50 hover:text-lego-blue/80 transition-colors"
                    title="Back to My Org"
                    data-testid="button-bottom-my-org"
                  >
                    <div style={{
                      width: 'clamp(22px,2.4vw,30px)', height: 'clamp(22px,2.4vw,30px)',
                      borderRadius: '50%', border: '1px solid rgba(27,124,229,0.3)',
                      background: 'rgba(27,124,229,0.08)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Building2 style={{ width: 'clamp(9px,1vw,13px)', height: 'clamp(9px,1vw,13px)' }} strokeWidth={1.6} />
                    </div>
                    <span style={{ fontSize: 'clamp(7px,0.65vw,9px)', fontWeight: 700, letterSpacing: '0.08em' }}>ORG</span>
                  </button>
                )}
                <button
                  onClick={() => openSettings()}
                  className="flex flex-col items-center gap-0.5 text-lego-purple/50 hover:text-lego-purple/80 transition-colors"
                  title="Platform Settings"
                  data-testid="button-bottom-settings"
                >
                  <div style={{
                    width: 'clamp(22px,2.4vw,30px)', height: 'clamp(22px,2.4vw,30px)',
                    borderRadius: '50%', border: '1px solid rgba(155,93,229,0.3)',
                    background: 'rgba(155,93,229,0.08)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Settings style={{ width: 'clamp(9px,1vw,13px)', height: 'clamp(9px,1vw,13px)' }} strokeWidth={1.6} />
                  </div>
                  <span style={{ fontSize: 'clamp(7px,0.65vw,9px)', fontWeight: 700, letterSpacing: '0.08em' }}>CFG</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Nav — mobile only */}
      <div className="md:hidden">
        <PlatformBottomNav active={activeTab} onSelect={setActiveTab} hasOrg={hasOrg} onMyOrg={handleMyOrg} />
      </div>

      {/* Settings Modal — reuses existing platform admin sections */}
      <SettingsModal
        open={settingsOpen}
        onClose={() => { setSettingsOpen(false); setSettingsInitialSection(null); }}
        initialSection={(settingsInitialSection as any) || undefined}
        forcePlatformAdmin
      />
    </div>
  );
}
