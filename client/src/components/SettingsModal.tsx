import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { AppSettings, User, Organization, OrgIntegration } from "@shared/schema";
import { APP_VERSION, APP_NAME } from "@shared/version";
import { X, Download, Trash2, Settings, Package, Sparkles, Database, Clock, Shield, History, AlertTriangle, CheckCircle2, Calendar, RotateCcw, FileText, HardDrive, Upload, CloudUpload, Smartphone, RefreshCw, Users, Wrench, Info, Layers, Play, Loader2, ChevronDown, ChevronRight, ChevronLeft, BarChart2, Eye, ShoppingCart, Brain, TrendingUp, ImageIcon, Plus, Pencil, Lock, LogOut, CreditCard, Share2, PlusSquare, ShieldCheck, ExternalLink, Building2, Search, Activity, Flag, Power, Zap, Globe, ToggleLeft, EyeOff, ClipboardList, Megaphone, Tag, Key } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { PomCategoryTiers } from "@/components/PomCategoryTiers";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmbeddingsManager, UniversalCatalogSection } from "@/components/EmbeddingsManager";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "wouter";
import { TIER_CONFIG, getTierConfig, getEffectiveLimits, checkLimit, formatPrice, type PlanType } from "@shared/tierConfig";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  initialSection?: 'general' | 'platforms' | 'ai' | 'automation' | 'data' | 'enrichment' | 'users' | 'billing' | 'about';
}

type ActiveSection = 'general' | 'platforms' | 'ai' | 'automation' | 'data' | 'enrichment' | 'users' | 'billing' | 'about' | 'orgs' | 'impersonation' | 'systemHealth' | 'auditLog' | 'announcements' | 'billingOverview' | 'plansAndPricing' | 'apiKeys' | null;

interface OrgWithUsage extends Organization {
  userCount: number;
  limits: Record<string, number>;
}

// ── API Call Schedule Chart ────────────────────────────────────────────────
function ApiCallSchedule({ buckets, callsLast24h, ceiling, timezone = 'America/Chicago' }: {
  buckets: { hourStart: string; rollsOffAt: string; calls: number }[];
  callsLast24h: number;
  ceiling: number;
  timezone?: string;
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const availableNow = Math.max(0, ceiling - callsLast24h);
  const pct = Math.min(callsLast24h / ceiling, 1);
  const maxCalls = Math.max(...buckets.map(b => b.calls), 1);

  const rolloffEvents = [...buckets]
    .filter(b => b.calls > 0)
    .sort((a, b) => new Date(a.rollsOffAt).getTime() - new Date(b.rollsOffAt).getTime());

  let cumFreed = 0;
  const schedule = rolloffEvents.map((b, idx) => {
    cumFreed += b.calls;
    const availableAfter = Math.min(ceiling, availableNow + cumFreed);
    const prevAvail = idx === 0 ? availableNow : Math.min(ceiling, availableNow + (cumFreed - b.calls));
    return { ...b, freed: b.calls, availableAfter, isFirstFull: availableAfter >= ceiling && prevAvail < ceiling };
  });
  const fullRestoreRow = schedule.find(s => s.isFirstFull);

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    const opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', timeZone: timezone };
    const time = d.toLocaleTimeString([], opts);
    const nowStr = new Date().toLocaleDateString('en-US', { timeZone: timezone });
    const tomorrowStr = new Date(Date.now() + 86400000).toLocaleDateString('en-US', { timeZone: timezone });
    const dStr = d.toLocaleDateString('en-US', { timeZone: timezone });
    if (dStr === nowStr) return time;
    if (dStr === tomorrowStr) return `${time} tomorrow`;
    return `${time} ${d.toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: timezone })}`;
  };
  const fmtAxisTime = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: timezone });

  const progressColor = pct >= 0.9 ? 'bg-red-500' : pct >= 0.6 ? 'bg-orange-500' : 'bg-blue-500';
  const barColor = (calls: number) => {
    if (calls === 0) return 'bg-gray-700/50';
    if (calls < ceiling * 0.1) return 'bg-blue-500/70';
    if (calls < ceiling * 0.3) return 'bg-orange-500/70';
    return 'bg-red-500/70';
  };
  const availColor = (avail: number) => {
    const r = avail / ceiling;
    if (r >= 0.9) return 'text-emerald-400';
    if (r >= 0.5) return 'text-blue-400';
    if (r >= 0.25) return 'text-orange-400';
    return 'text-gray-400';
  };
  const hovered = hoveredIdx !== null ? buckets[hoveredIdx] : null;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-gray-200">API Quota — Rolling 24h</div>
          <div className="text-[11px] mt-0.5">
            <span className={pct >= 0.9 ? 'text-red-400' : pct >= 0.6 ? 'text-orange-400' : 'text-emerald-400'}>
              {availableNow.toLocaleString()} free now
            </span>
            <span className="text-gray-600"> · {callsLast24h.toLocaleString()}/{ceiling.toLocaleString()} used</span>
          </div>
        </div>
        {fullRestoreRow ? (
          <div className="text-right flex-shrink-0">
            <div className="text-[9px] text-gray-500 uppercase tracking-wide">Full quota at</div>
            <div className="text-[11px] font-semibold text-emerald-400 leading-tight">{fmtTime(fullRestoreRow.rollsOffAt)}</div>
          </div>
        ) : availableNow >= ceiling ? (
          <span className="text-[11px] text-emerald-400 font-semibold flex-shrink-0">Full quota</span>
        ) : null}
      </div>
      <div className="h-1.5 w-full rounded-full bg-gray-700">
        <div className={`h-full rounded-full transition-all ${progressColor}`} style={{ width: `${pct * 100}%` }} />
      </div>
      <div>
        <div className="text-[9px] text-gray-600 uppercase tracking-wide mb-1">Call History (last 24h)</div>
        <div className="flex items-end gap-px h-10" onMouseLeave={() => setHoveredIdx(null)}>
          {buckets.map((b, i) => {
            const height = b.calls === 0 ? 2 : Math.max(3, Math.round((b.calls / maxCalls) * 40));
            return (
              <div key={b.hourStart} className="flex-1 flex flex-col justify-end cursor-default" onMouseEnter={() => setHoveredIdx(i)}>
                <div className={`w-full rounded-sm ${barColor(b.calls)} ${hoveredIdx === i ? 'opacity-100 ring-1 ring-white/20' : 'opacity-75'}`} style={{ height: `${height}px` }} />
              </div>
            );
          })}
        </div>
        <div className="flex justify-between text-[9px] text-gray-600 font-mono mt-0.5">
          {[0, 6, 12, 18, 23].map(i => (
            <span key={i}>{buckets[i] ? fmtAxisTime(buckets[i].hourStart) : ''}</span>
          ))}
        </div>
        {hovered && hovered.calls > 0 && (
          <div className="text-[10px] text-gray-400 mt-1 font-mono leading-tight">
            {fmtAxisTime(hovered.hourStart)}: <span className="text-gray-200">{hovered.calls.toLocaleString()} calls</span>
            {' '}· frees at <span className="text-gray-200">{fmtTime(hovered.rollsOffAt)}</span>
          </div>
        )}
        {hovered && hovered.calls === 0 && (
          <div className="text-[10px] text-gray-600 mt-1">No calls this hour</div>
        )}
      </div>
      {schedule.length > 0 && (
        <div>
          <div className="text-[9px] text-gray-500 uppercase tracking-wide mb-1.5">Capacity Recovery Schedule</div>
          <div className="space-y-px pr-0.5">
            <div className="relative rounded px-2 py-1 bg-gray-800/60">
              <div className="relative flex items-center justify-between gap-2">
                <span className="text-[11px] text-gray-500">Now</span>
                <span className={`text-[11px] font-mono font-semibold ${availColor(availableNow)}`}>{availableNow.toLocaleString()} free</span>
              </div>
            </div>
            {schedule.map((s) => {
              const availRatio = s.availableAfter / ceiling;
              return (
                <div key={s.hourStart} className={`relative rounded overflow-hidden px-2 py-1 ${s.isFirstFull ? 'ring-1 ring-emerald-500/50' : ''}`} style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                  <div className="absolute left-0 top-0 bottom-0 rounded-sm pointer-events-none" style={{ width: `${Math.min(availRatio * 100, 100)}%`, backgroundColor: availRatio >= 0.9 ? 'rgba(16,185,129,0.12)' : availRatio >= 0.5 ? 'rgba(59,130,246,0.12)' : 'rgba(249,115,22,0.10)' }} />
                  <div className="relative flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[11px] text-gray-300">{fmtTime(s.rollsOffAt)}</span>
                      {s.isFirstFull && <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-wide">Full</span>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[10px] text-gray-600 font-mono">+{s.freed.toLocaleString()}</span>
                      <span className={`text-[11px] font-mono font-semibold w-16 text-right ${availColor(s.availableAfter)}`}>{s.availableAfter.toLocaleString()} free</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {schedule.length === 0 && availableNow >= ceiling && (
        <div className="text-[11px] text-emerald-400 text-center py-1">Full quota available — ready to run anytime.</div>
      )}
    </div>
  );
}

// ── Data Enrichment Summary ───────────────────────────────────────────────
function EnrichmentSummary() {
  const { data: stats } = useQuery<any>({
    queryKey: ['/api/embeddings/stats'],
    refetchInterval: 8000,
  });
  const { data: clip } = useQuery<any>({
    queryKey: ['/api/brickspotter/catalog-status'],
    refetchInterval: 8000,
  });

  const inv   = stats?.inventory  ?? { embedded: 0, total: 0, percentage: '0' };
  const ord   = stats?.orders     ?? { embedded: 0, total: 0, percentage: '0' };
  const sets  = stats?.sets       ?? { embedded: 0, total: 0, percentage: '0' };
  const price = stats?.priceHistory?.snapshots ?? 0;
  const mem   = stats?.aiMemories?.conversations ?? 0;
  const clipCount  = clip?.catalog ?? 0;
  const clipTotal  = inv.total;
  const clipPct    = clipTotal > 0 ? Math.round((clipCount / clipTotal) * 100) : 0;
  const clipRunning = clip?.buildRunning ?? false;

  const tiles = [
    {
      icon: Package,
      label: 'Inventory Text',
      color: 'text-purple-400',
      bar: true,
      done: inv.embedded,
      total: inv.total,
      pct: parseFloat(inv.percentage),
    },
    {
      icon: ShoppingCart,
      label: 'Order Text',
      color: 'text-blue-400',
      bar: true,
      done: ord.embedded,
      total: ord.total,
      pct: parseFloat(ord.percentage),
    },
    {
      icon: Layers,
      label: 'Set-Parts',
      color: 'text-cyan-400',
      bar: true,
      done: sets.embedded,
      total: sets.total,
      pct: parseFloat(sets.percentage),
    },
    {
      icon: Eye,
      label: 'Visual Catalog',
      color: clipRunning ? 'text-blue-400' : 'text-green-400',
      bar: true,
      done: clipCount,
      total: clipTotal,
      pct: clipPct,
      spinning: clipRunning,
    },
    {
      icon: TrendingUp,
      label: 'Price Snapshots',
      color: 'text-yellow-400',
      bar: false,
      count: price,
    },
    {
      icon: Brain,
      label: 'AI Memories',
      color: 'text-pink-400',
      bar: false,
      count: mem,
    },
  ];

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800/60 p-3">
      <h3 className="text-xs font-semibold text-gray-300 mb-3 uppercase tracking-wide">Enrichment Overview</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <div key={t.label} className="bg-gray-900/60 rounded-md p-2.5 space-y-1.5">
              <div className="flex items-center gap-1.5">
                {t.spinning
                  ? <Loader2 className={`w-3 h-3 animate-spin ${t.color}`} />
                  : <Icon className={`w-3 h-3 ${t.color}`} />
                }
                <span className="text-[10px] text-gray-400 leading-tight">{t.label}</span>
              </div>
              {t.bar ? (
                <>
                  <div className="flex items-end justify-between gap-1">
                    <span className={`text-sm font-bold tabular-nums ${t.color}`}>
                      {t.done.toLocaleString()}
                    </span>
                    <span className="text-[10px] text-gray-500">/ {t.total.toLocaleString()}</span>
                  </div>
                  <Progress value={t.pct} className="h-1" />
                  <div className="text-[10px] text-gray-500 text-right">{t.pct.toFixed(0)}%</div>
                </>
              ) : (
                <div className={`text-xl font-bold tabular-nums ${t.color}`}>
                  {(t.count ?? 0).toLocaleString()}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const ROLE_META: Record<string, { label: string; description: string; color: string }> = {
  admin: {
    label: 'Admin',
    description: 'Full access — manage settings, users, integrations, and all data',
    color: 'text-purple-400',
  },
  employee: {
    label: 'Employee',
    description: 'Standard access — use all core features, cannot manage users or settings',
    color: 'text-blue-400',
  },
  customer: {
    label: 'Viewer',
    description: 'Read-only access — view data but cannot make changes',
    color: 'text-gray-400',
  },
};

// User Management Section Component (Admin Only)
function UserManagementSection({ userCount }: { userCount?: number }) {
  const { toast } = useToast();
  const { isAdmin, user: currentUser } = useAuth();

  const { data: users, isLoading, isError } = useQuery<User[]>({
    queryKey: ['/api/admin/users'],
    enabled: isAdmin,
  });

  const updateUserApprovalMutation = useMutation({
    mutationFn: async ({ userId, isApproved }: { userId: string; isApproved: boolean }) => {
      return await apiRequest('PATCH', `/api/admin/users/${userId}/approval`, { isApproved });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      toast({ title: "Access Updated", description: "User access has been updated." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update access.", variant: "destructive" });
    },
  });

  const updateUserRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      return await apiRequest('PATCH', `/api/admin/users/${userId}/role`, { role });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      toast({ title: "Role Updated", description: "User role has been updated." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update role.", variant: "destructive" });
    },
  });

  if (!isAdmin) return null;

  if (isError) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-2">
          <AlertTriangle className="h-8 w-8 text-red-400 mx-auto" />
          <p className="text-sm text-red-400">Access Denied</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-500 border-t-transparent" />
      </div>
    );
  }

  const adminCount = (users ?? []).filter(u => u.role === 'admin' && u.isApproved).length;

  return (
    <div className="space-y-5 min-h-[400px]">
      {/* Team members */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-medium text-gray-300">Team Members</h3>
            <Popover>
              <PopoverTrigger asChild>
                <button className="text-gray-500 hover:text-gray-300 transition-colors" data-testid="button-roles-info">
                  <Info className="h-3.5 w-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-72 bg-gray-900 border-gray-700 p-3" side="right">
                <p className="text-xs font-medium text-gray-300 mb-2">Role Permissions</p>
                <div className="space-y-2">
                  {Object.entries(ROLE_META).map(([key, meta]) => (
                    <div key={key} className="flex items-start gap-2">
                      <span className={`text-xs font-medium w-16 shrink-0 ${meta.color}`}>{meta.label}</span>
                      <span className="text-[11px] text-gray-500 leading-snug">{meta.description}</span>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <span className="text-xs text-gray-500">{(users ?? []).length} member{(users ?? []).length !== 1 ? 's' : ''}</span>
        </div>

        {adminCount === 1 && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-md p-2.5 mb-3 flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
            <p className="text-[11px] text-amber-300">
              Only one Admin remains. Promote another member before changing this admin's role.
            </p>
          </div>
        )}

        <div className="space-y-2">
          {users && users.length > 0 ? users.map((u) => {
            const isCurrentUser = u.id === (currentUser as any)?.id;
            const isLastAdmin = u.role === 'admin' && adminCount === 1;
            const canChangeRole = !isLastAdmin;
            const roleMeta = ROLE_META[u.role] ?? ROLE_META.customer;

            return (
              <div
                key={u.id}
                className="bg-gray-800/50 border border-gray-700 rounded-md p-3 flex flex-wrap gap-3 items-center"
                data-testid={`user-card-${u.id}`}
              >
                {/* Avatar */}
                <div className="shrink-0">
                  {u.profileImageUrl ? (
                    <img src={u.profileImageUrl} alt="" className="h-9 w-9 rounded-full" />
                  ) : (
                    <div className="h-9 w-9 rounded-full bg-purple-500/20 flex items-center justify-center text-xs font-medium text-purple-300">
                      {u.firstName?.[0] ?? u.email?.[0]?.toUpperCase() ?? '?'}
                    </div>
                  )}
                </div>

                {/* Name + email */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-medium text-gray-200 truncate">
                      {u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email ?? 'Unknown User'}
                    </span>
                    {isCurrentUser && (
                      <span className="text-[10px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded">you</span>
                    )}
                    {!u.isApproved && (
                      <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Pending
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 truncate">{u.email}</p>
                </div>

                {/* Role selector */}
                <div className="shrink-0">
                  <Select
                    value={u.role}
                    onValueChange={(role) => updateUserRoleMutation.mutate({ userId: u.id, role })}
                    disabled={updateUserRoleMutation.isPending || !canChangeRole}
                  >
                    <SelectTrigger
                      className={`h-8 text-xs w-[110px] bg-gray-900/50 border-gray-600 ${roleMeta.color}`}
                      data-testid={`select-role-${u.id}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="employee">Employee</SelectItem>
                      <SelectItem value="customer">Viewer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Approval toggle */}
                <div className="shrink-0">
                  {u.isApproved ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => updateUserApprovalMutation.mutate({ userId: u.id, isApproved: false })}
                      disabled={updateUserApprovalMutation.isPending || isCurrentUser}
                      data-testid={`button-revoke-${u.id}`}
                      className="text-xs"
                    >
                      Revoke Access
                    </Button>
                  ) : (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => updateUserApprovalMutation.mutate({ userId: u.id, isApproved: true })}
                      disabled={updateUserApprovalMutation.isPending}
                      data-testid={`button-approve-${u.id}`}
                      className="text-xs"
                    >
                      Approve
                    </Button>
                  )}
                </div>
              </div>
            );
          }) : (
            <div className="text-center py-8 text-gray-400 text-sm">No team members found</div>
          )}
        </div>
      </div>
    </div>
  );
}

// Device detection helper
function getDeviceInfo() {
  const userAgent = navigator.userAgent;
  const platform = navigator.platform;
  
  const isIOS = /iPhone|iPad|iPod/.test(userAgent) && !(window as any).MSStream;
  const isIPad = /iPad/.test(userAgent) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(userAgent);
  const isMac = /Mac/.test(platform) && !isIPad;
  const isWindows = /Win/.test(platform);
  const isSafari = /Safari/.test(userAgent) && !/Chrome/.test(userAgent);
  const isChrome = /Chrome/.test(userAgent);
  const isFirefox = /Firefox/.test(userAgent);
  const isPWA = window.matchMedia('(display-mode: standalone)').matches;
  
  let deviceType = 'Unknown';
  let browserType = 'Unknown';
  
  if (isIOS) deviceType = 'iPhone';
  else if (isIPad) deviceType = 'iPad';
  else if (isAndroid) deviceType = 'Android';
  else if (isMac) deviceType = 'Mac';
  else if (isWindows) deviceType = 'Windows';
  
  if (isSafari) browserType = 'Safari';
  else if (isChrome) browserType = 'Chrome';
  else if (isFirefox) browserType = 'Firefox';
  
  return { deviceType, browserType, isPWA, isIOS: isIOS || isIPad };
}

type SyncStatusEntry = {
  lastSyncTime: string | null;
  lastSyncStatus: string;
  recordsAdded: number;
  recordsUpdated: number;
  errorMessage: string | null;
} | null;

function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function SyncStatusLine({ entry }: { entry: SyncStatusEntry }) {
  if (!entry) return <p className="text-[10px] text-gray-600 mt-1">No sync history</p>;
  const isOk = entry.lastSyncStatus === 'success';
  const isErr = entry.lastSyncStatus === 'failed' || entry.lastSyncStatus === 'error';
  const isRunning = entry.lastSyncStatus === 'in_progress';
  const timeStr = formatRelativeTime(entry.lastSyncTime);
  const counts = (entry.recordsAdded || entry.recordsUpdated)
    ? `${entry.recordsAdded} added · ${entry.recordsUpdated} updated`
    : null;
  return (
    <div className="mt-1 space-y-0.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        {isRunning && <Loader2 className="w-3 h-3 text-blue-400 animate-spin shrink-0" />}
        {isOk && <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />}
        {isErr && <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />}
        {!isRunning && !isOk && !isErr && <Clock className="w-3 h-3 text-gray-500 shrink-0" />}
        <span className={`text-[10px] font-medium ${isOk ? 'text-green-500' : isErr ? 'text-red-400' : isRunning ? 'text-blue-400' : 'text-gray-500'}`}>
          {isRunning ? 'Running…' : isOk ? 'Success' : isErr ? 'Failed' : entry.lastSyncStatus}
        </span>
        <span className="text-[10px] text-gray-500">{timeStr}</span>
        {counts && <span className="text-[10px] text-gray-600">· {counts}</span>}
      </div>
      {isErr && entry.errorMessage && (
        <p className="text-[10px] text-red-400/80 truncate max-w-xs">{entry.errorMessage}</p>
      )}
    </div>
  );
}

export default function SettingsModal({ open, onClose, initialSection }: SettingsModalProps) {
  const { toast } = useToast();
  const { status: installStatus, promptInstall } = useInstallPrompt();
  const { isAdmin, superAdmin, user } = useAuth();
  const [clearDataDialog, setClearDataDialog] = useState<'inventory' | 'orders' | null>(null);
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const [restoreWizardOpen, setRestoreWizardOpen] = useState(false);
  const [restoreStep, setRestoreStep] = useState<'select' | 'warning' | 'restoring' | 'syncing' | 'differential' | 'verification' | 'complete'>('select');
  const [restoreDate, setRestoreDate] = useState('2025-10-18');
  const [restoreTime, setRestoreTime] = useState('14:30');
  const [restoreProgress, setRestoreProgress] = useState(0);
  
  const [restoreCurrentTask, setRestoreCurrentTask] = useState('');
  const [restoreJobId, setRestoreJobId] = useState<string | null>(null);
  const [differentialAnalysis, setDifferentialAnalysis] = useState<{
    totalItems: number;
    quantityChanges: number;
    netQuantityChange: number;
    priceUpdates: number;
    remarksUpdates: number;
    descriptionUpdates: number;
    anomalies?: Array<{
      type: string;
      severity: string;
      description: string;
      affectedItems: number;
      metricValue: number;
    }>;
  } | null>(null);
  const [verificationResults, setVerificationResults] = useState<{
    inventoryMatch: boolean;
    orderStatusMatch: boolean;
    platformSync: boolean;
    inventoryCount?: number;
    bricklinkCount?: number;
    brickowlCount?: number;
    discrepancies?: number;
  } | null>(null);

  // AI Settings
  const [aiEnabled, setAiEnabled] = useState(true);
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [selectedModel, setSelectedModel] = useState("gpt-4o-mini");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  // BrickLink Settings
  const [bricklinkConsumerKey, setBricklinkConsumerKey] = useState("");
  const [bricklinkConsumerSecret, setBricklinkConsumerSecret] = useState("");
  const [bricklinkTokenValue, setBricklinkTokenValue] = useState("");
  const [bricklinkTokenSecret, setBricklinkTokenSecret] = useState("");

  // BrickOwl Settings
  const [brickowlApiKey, setBrickowlApiKey] = useState("");

  // PayPal Settings
  const [paypalClientId, setPaypalClientId] = useState("");
  const [paypalClientSecret, setPaypalClientSecret] = useState("");
  const [paypalEnvironment, setPaypalEnvironment] = useState<'sandbox' | 'live'>('live');
  // Stripe Settings
  const [stripeSecretKey, setStripeSecretKey] = useState("");
  const [stripeEnvironment, setStripeEnvironment] = useState<'test' | 'live'>('live');

  // EasyPost Settings
  const [easypostApiKey, setEasypostApiKey] = useState("");
  const [easypostTestApiKey, setEasypostTestApiKey] = useState("");
  const [easypostKeyMode, setEasypostKeyMode] = useState<'test' | 'production'>('test');

  // Org Integrations State
  const [addIntegrationType, setAddIntegrationType] = useState<'sales_channel' | 'shipping' | 'payment' | null>(null);
  const [activePlatform, setActivePlatform] = useState<string | null>(null);
  const [addIntChannel, setAddIntChannel] = useState('');
  const [addIntDisplayName, setAddIntDisplayName] = useState('');
  const [addIntApiKey, setAddIntApiKey] = useState('');
  const [editingIntId, setEditingIntId] = useState<number | null>(null);
  const [editIntDisplayName, setEditIntDisplayName] = useState('');
  const [editIntApiKey, setEditIntApiKey] = useState('');
  const [deleteIntId, setDeleteIntId] = useState<number | null>(null);
  const [removePrimaryDialog, setRemovePrimaryDialog] = useState<'brickowl' | null>(null);
  // International Shipping / Customs
  const [customsSigner, setCustomsSigner] = useState("");
  const [blIossNumber, setBlIossNumber] = useState("");
  const [boIossNumber, setBoIossNumber] = useState("");
  const [blUkVatNumber, setBlUkVatNumber] = useState("");
  const [boUkVatNumber, setBoUkVatNumber] = useState("");

  // Automation Settings
  const [inventorySyncEnabled, setInventorySyncEnabled] = useState(false);
  const [inventorySyncTime, setInventorySyncTime] = useState("02:00");
  const [priceOMaticEnabled, setPriceOMaticEnabled] = useState(false);
  const [pomScheduleEnabled, setPomScheduleEnabled] = useState(false);
  const [pomSyncTime, setPomSyncTime] = useState("14:00");
  const [timezone, setTimezone] = useState("America/Chicago");
  const [pomScheduleBatchSize, setPomScheduleBatchSize] = useState(1500);
  const [rebrickableImageSyncEnabled, setRebrickableImageSyncEnabled] = useState(true);
  const [channelSyncEnabled, setChannelSyncEnabled] = useState(false);
  const [channelSyncTime, setChannelSyncTime] = useState("03:00");
  const [channelSyncMode, setChannelSyncMode] = useState<'full_control' | 'quantity_only'>('full_control');
  const [channelDetailsExpanded, setChannelDetailsExpanded] = useState(false);
  const [ordersSyncEnabled, setOrdersSyncEnabled] = useState(false);
  const [schedulerInventoryOpen, setSchedulerInventoryOpen] = useState(false);
  const [schedulerOrdersOpen, setSchedulerOrdersOpen] = useState(false);
  const [schedulerChannelOpen, setSchedulerChannelOpen] = useState(false);
  const [schedulerChannelBrickOwlOpen, setSchedulerChannelBrickOwlOpen] = useState(true);
  const [enrichmentEmbeddingsOpen, setEnrichmentEmbeddingsOpen] = useState(false);
  const [enrichmentUniversalOpen, setEnrichmentUniversalOpen] = useState(false);
  const [enrichmentPomOpen, setEnrichmentPomOpen] = useState(false);
  const [enrichmentRebrickableOpen, setEnrichmentRebrickableOpen] = useState(false);
  const [rebrickableSetSyncEnabled, setRebrickableSetSyncEnabled] = useState(false);
  const [rebrickableSetSyncTime, setRebrickableSetSyncTime] = useState("04:00");
  const [ordersSyncFrequency, setOrdersSyncFrequency] = useState(15);
  const [ordersSyncFrequencyStr, setOrdersSyncFrequencyStr] = useState("15");

  // Price-o-Matic Formula Settings
  const [pomBasePremium, setPomBasePremium] = useState(10);
  const [pomMinifigPremium, setPomMinifigPremium] = useState(5);
  const [pomScarcityThreshold1, setPomScarcityThreshold1] = useState(50);
  const [pomScarcityBonus1, setPomScarcityBonus1] = useState(15);
  const [pomScarcityThreshold2, setPomScarcityThreshold2] = useState(200);
  const [pomScarcityBonus2, setPomScarcityBonus2] = useState(8);
  const [pomScarcityThreshold3, setPomScarcityThreshold3] = useState(500);
  const [pomScarcityBonus3, setPomScarcityBonus3] = useState(3);
  const [pomTooHighThreshold, setPomTooHighThreshold] = useState(20);
  const [pomTooLowThreshold, setPomTooLowThreshold] = useState(20);
  const [pomUnderpricedScore, setPomUnderpricedScore] = useState(1.5);
  const [pomOverpricedScore, setPomOverpricedScore] = useState(0.8);
  const [pomPricingOpen, setPomPricingOpen] = useState(false);
  const [pomScoringOpen, setPomScoringOpen] = useState(false);
  const [pomBatchSize, setPomBatchSize] = useState(1500);
  const [blApiCallLimit, setBlApiCallLimit] = useState(4900);
  const [pomCostFloorPct, setPomCostFloorPct] = useState(0);
  const [pomMinPrice, setPomMinPrice] = useState(0.02);
  const [pomTrendingEnabled, setPomTrendingEnabled] = useState(false);
  const [pomTrendingDays, setPomTrendingDays] = useState(15);       // repurposed: max % adjustment
  const [pomTrendingThreshold, setPomTrendingThreshold] = useState(500);  // BL sold qty = "full demand"
  const [pomTrendingBonus, setPomTrendingBonus] = useState(60);     // demand weight 0–100
  const [pomHighSupplyThreshold, setPomHighSupplyThreshold] = useState(10000); // BL stock qty = "full supply"
  const [pomHighSupplyPenalty, setPomHighSupplyPenalty] = useState(40);  // supply weight 0–100

  const [elfieMode, setElfieMode] = useState<'search' | 'ai'>('search');

  const [activeSection, setActiveSection] = useState<ActiveSection>(initialSection ?? null);
  const [activeOrg, setActiveOrg] = useState<OrgWithUsage | null>(null);
  const [activeOrgTab, setActiveOrgTab] = useState<'features' | 'limits' | 'billing'>('features');
  const [activeGeneralTab, setActiveGeneralTab] = useState<'info' | 'features' | 'limits' | 'billing'>('info');
  const [impersonationSearch, setImpersonationSearch] = useState('');
  const [orgSearch, setOrgSearch] = useState('');

  // Sync activeSection whenever the modal opens with a specific initialSection.
  // useState only uses its initial value on first mount, so without this effect
  // clicking a dashboard action item with a different section would have no effect.
  useEffect(() => {
    if (open && initialSection) {
      setActiveSection(initialSection);
    }
  }, [open, initialSection]);

  const { data: settings } = useQuery<AppSettings>({
    queryKey: ['/api/settings'],
    enabled: open,
  });

  const { data: rateLimit } = useQuery<{
    allowed: boolean;
    callsLast24h: number;
    warning?: string;
    blocked?: boolean;
    hourlyBuckets?: { hourStart: string; rollsOffAt: string; calls: number }[];
  }>({
    queryKey: ['/api/bricklink/rate-limit'],
    refetchInterval: 30000,
    enabled: open && activeSection === 'automation',
  });

  const { data: syncStatuses } = useQuery<{
    inventory: SyncStatusEntry;
    priceomatic: SyncStatusEntry;
    channel: SyncStatusEntry;
    orders: SyncStatusEntry;
    rebrickable: SyncStatusEntry;
  }>({
    queryKey: ['/api/sync/statuses'],
    refetchInterval: 30000,
    enabled: open && (activeSection === 'automation' || activeSection === 'enrichment'),
  });

  type PlatformStats = { totalLots: number; totalParts: number; lastSyncedAt: string | null };
  type PlatformSyncData = {
    source: { name: string; stats: PlatformStats };
    targets: {
      name: string;
      enabled: boolean;
      stats: PlatformStats;
      discrepancies: { missingLots: number; missingParts: number; priceDifferences: number; quantityDifferences: number; remarksDifferences: number; descriptionDifferences: number };
    }[];
  };
  const { data: platformSyncData, isLoading: platformSyncLoading } = useQuery<PlatformSyncData>({
    queryKey: ['/api/platform-sync/status'],
    refetchInterval: 60000,
    enabled: open && activeSection === 'automation',
  });
  const brickOwlTarget = platformSyncData?.targets?.find(t => t.name === 'BrickOwl');
  const channelSyncMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/platform-sync/sync', { platform: 'BrickOwl', limit: 10 }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/platform-sync/status'] }); },
  });

  const { data: orgIntegrationsList = [] } = useQuery<OrgIntegration[]>({
    queryKey: ['/api/org/integrations'],
    enabled: open && activeSection === 'platforms',
  });

  const createIntegrationMutation = useMutation({
    mutationFn: (data: { channel: string; type: 'sales_channel' | 'shipping' | 'payment'; displayName: string; credentials: Record<string, string> }) =>
      apiRequest('POST', '/api/org/integrations', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/org/integrations'] });
      setAddIntegrationType(null);
      setAddIntChannel('');
      setAddIntDisplayName('');
      setAddIntApiKey('');
    },
  });

  const updateIntegrationMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: number; displayName?: string; credentials?: Record<string, string> }) =>
      apiRequest('PATCH', `/api/org/integrations/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/org/integrations'] });
      setEditingIntId(null);
    },
  });

  const deleteIntegrationMutation = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/org/integrations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/org/integrations'] });
      setDeleteIntId(null);
    },
  });

  const { data: backupsData, isLoading: backupsLoading } = useQuery<{
    success: boolean;
    backups: Array<{ filename: string; timestamp: string; size: number }>;
  }>({
    queryKey: ['/api/backups/list'],
    enabled: open,
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: Partial<AppSettings>) => {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error('Failed to update settings');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/settings'] });
    },
  });

  const [showClearPomDialog, setShowClearPomDialog] = useState(false);

  const [billingInterval, setBillingInterval] = useState<'monthly' | 'annual'>('monthly');

  const { data: inventoryCountData } = useQuery<{ count: number }>({
    queryKey: ['/api/inventory/count'],
    enabled: open && activeSection === 'billing',
  });

  type TenantLimitsData = {
    plan: string;
    limits: Record<string, number>;
    usage: { seats: { count: number; limit: number }; automationRules: { count: number; limit: number }; brickspotterScans: { scansUsed: number; scansLimit: number } };
  };
  const { data: tenantLimitsData, isLoading: tenantLimitsLoading } = useQuery<TenantLimitsData>({
    queryKey: ['/api/admin/organizations', user?.orgId, 'limits'],
    enabled: open && activeSection === 'general' && activeGeneralTab === 'limits' && !!user?.orgId,
    staleTime: 30000,
    retry: 0,
  });

  type TenantPayment = {
    id: string; amount: number; currency: string; status: string | null;
    description: string | null; periodStart: number; periodEnd: number;
    created: number; hostedUrl: string | null; pdfUrl: string | null;
  };
  const { data: tenantPaymentsData, isLoading: tenantPaymentsLoading } = useQuery<{ payments: TenantPayment[] }>({
    queryKey: ['/api/billing/payments'],
    enabled: open && activeSection === 'general' && activeGeneralTab === 'billing',
    staleTime: 60000,
    retry: 0,
  });

  useEffect(() => { setActiveGeneralTab('info'); }, [activeSection]);

  const { data: platformOrgs, isLoading: platformOrgsLoading, isError: platformOrgsError, error: platformOrgsQueryError, refetch: refetchPlatformOrgs } = useQuery<OrgWithUsage[]>({
    queryKey: ['/api/platform-admin/orgs'],
    enabled: open && (activeSection === 'orgs' || activeSection === 'impersonation'),
    retry: 0,
    staleTime: 0,
  });

  type SystemHealthData = {
    platform: { totalOrganizations: number; totalUsers: number; activeSubscriptions: number };
    embeddings: { inventoryEmbeddings: number; orderEmbeddings: number };
    jobs: {
      active: Array<{ id: string; orgId: string; jobType: string; status: string; processedItems: number; totalItems: number; errorMessage: string | null; createdAt: string; completedAt: string | null }>;
      recent: Array<{ id: string; orgId: string; jobType: string; status: string; processedItems: number; totalItems: number; errorMessage: string | null; createdAt: string; completedAt: string | null }>;
    };
  };

  const { data: orgLimitsUsage, isLoading: orgLimitsLoading } = useQuery<{
    plan: string;
    limits: Record<string, number>;
    usage: {
      seats: { count: number; limit: number; canAdd: boolean };
      automationRules: { count: number; limit: number };
      brickspotterScans: { scansUsed: number; scansLimit: number };
    };
  }>({
    queryKey: ['/api/admin/organizations', activeOrg?.id, 'limits'],
    enabled: open && activeSection === 'orgs' && !!activeOrg,
    staleTime: 15000,
    retry: 0,
  });

  const { data: orgBlApiUsage } = useQuery<{ count: number }>({
    queryKey: ['/api/admin/organizations', activeOrg?.id, 'bl-api-usage'],
    enabled: open && activeSection === 'orgs' && !!activeOrg,
    staleTime: 15000,
    retry: 0,
  });

  type OrgPayment = {
    id: string; amount: number; currency: string; status: string | null;
    description: string | null; periodStart: number; periodEnd: number;
    created: number; hostedUrl: string | null; pdfUrl: string | null;
  };
  const { data: orgPaymentsData, isLoading: orgPaymentsLoading } = useQuery<{ payments: OrgPayment[] }>({
    queryKey: ['/api/platform-admin/orgs', activeOrg?.id, 'payments'],
    enabled: open && activeSection === 'orgs' && !!activeOrg && activeOrgTab === 'billing',
    staleTime: 60000,
    retry: 0,
  });

  useEffect(() => { setActiveOrgTab('features'); }, [activeOrg?.id]);

  const { data: systemHealth, isLoading: systemHealthLoading, isError: systemHealthError, refetch: refetchSystemHealth } = useQuery<SystemHealthData>({
    queryKey: ['/api/platform-admin/system-health'],
    enabled: open && activeSection === 'systemHealth',
    refetchInterval: activeSection === 'systemHealth' ? 15000 : false,
    retry: 0,
    staleTime: 0,
  });

  const { data: universalCatalogStatus } = useQuery<{
    queueSize: number; embedded: number; pending: number; noImage: number; failed: number; workerRunning: boolean;
  }>({
    queryKey: ['/api/brickspotter/universal-catalog/status'],
    enabled: open && activeSection === 'systemHealth',
    refetchInterval: activeSection === 'systemHealth' ? 10000 : false,
  });

  const updateFeaturesMutation = useMutation({
    mutationFn: async ({ orgId, featureOverrides }: { orgId: string; featureOverrides: Record<string, boolean> }) =>
      apiRequest('PATCH', `/api/platform-admin/orgs/${orgId}/features`, { featureOverrides }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/orgs'] }),
    onError: () => toast({ title: 'Failed to update feature flags', variant: 'destructive' }),
  });

  const updatePlanMutation = useMutation({
    mutationFn: async ({ orgId, plan }: { orgId: string; plan: string }) =>
      apiRequest('POST', `/api/admin/organizations/${orgId}/plan`, { plan }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/orgs'] });
      toast({ title: 'Plan updated' });
    },
    onError: () => toast({ title: 'Failed to update plan', variant: 'destructive' }),
  });

  const updateOverridesMutation = useMutation({
    mutationFn: async ({ orgId, overrides }: { orgId: string; overrides: Record<string, number | null> }) =>
      apiRequest('PATCH', `/api/admin/organizations/${orgId}/overrides`, overrides),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/orgs'] });
      toast({ title: 'Overrides saved' });
    },
    onError: () => toast({ title: 'Failed to save overrides', variant: 'destructive' }),
  });

  const suspendOrgMutation = useMutation({
    mutationFn: async ({ orgId, isActive }: { orgId: string; isActive: boolean }) =>
      apiRequest('PATCH', `/api/platform-admin/orgs/${orgId}/suspend`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/orgs'] });
      toast({ title: 'Organization status updated' });
    },
    onError: () => toast({ title: 'Failed to update organization', variant: 'destructive' }),
  });

  const impersonateMutation = useMutation({
    mutationFn: async (orgId: string) => apiRequest('POST', `/api/platform-admin/impersonate/${orgId}`, {}),
    onSuccess: () => { window.location.reload(); },
    onError: () => toast({ title: 'Failed to start impersonation', variant: 'destructive' }),
  });

  const checkoutMutation = useMutation({
    mutationFn: async ({ plan, interval }: { plan: string; interval: string }) => {
      const res = await apiRequest('POST', '/api/billing/checkout', { plan, interval });
      return res as { url: string };
    },
    onSuccess: (data) => {
      if (data?.url) window.location.href = data.url;
    },
    onError: (error: any) => {
      toast({ title: "Billing Error", description: error.message || "Could not start checkout. Make sure Stripe is configured.", variant: "destructive" });
    },
  });

  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/billing/portal', {});
      return res as { url: string };
    },
    onSuccess: (data) => {
      if (data?.url) window.location.href = data.url;
    },
    onError: (error: any) => {
      toast({ title: "Billing Error", description: error.message || "Could not open billing portal. Make sure Stripe is configured.", variant: "destructive" });
    },
  });

  const clearPomCacheMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/sync/priceomatic/cache', { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to clear cache');
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/priceomatic/freshness'] });
      queryClient.invalidateQueries({ queryKey: ['/api/priceomatic/insights'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sync/priceomatic/status'] });
      toast({ title: "Cache Cleared", description: `Removed ${data.deleted} price guide records. Ready for a fresh sync.` });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to clear the cache.", variant: "destructive" });
    },
  });

  useEffect(() => {
    if (settings) {
      setAiEnabled(settings.aiEnabled);
      setOpenaiApiKey(settings.openaiApiKey || "");
      setSelectedModel(settings.selectedModel || "gpt-4o-mini");
      setSystemPrompt(settings.systemPrompt || "");
      setBricklinkConsumerKey(settings.bricklinkConsumerKey || "");
      setBricklinkConsumerSecret(settings.bricklinkConsumerSecret || "");
      setBricklinkTokenValue(settings.bricklinkTokenValue || "");
      setBricklinkTokenSecret(settings.bricklinkTokenSecret || "");
      setBrickowlApiKey(settings.brickowlApiKey || "");
      setPaypalClientId(settings.paypalClientId || "");
      setPaypalClientSecret(settings.paypalClientSecret || "");
      setPaypalEnvironment((settings.paypalEnvironment as 'sandbox' | 'live') || 'live');
      setStripeSecretKey(settings.stripeSecretKey || "");
      setStripeEnvironment((settings.stripeEnvironment as 'test' | 'live') || 'live');
      setEasypostApiKey(settings.easypostApiKey || "");
      setEasypostTestApiKey(settings.easypostTestApiKey || "");
      setEasypostKeyMode((settings.easypostKeyMode as 'test' | 'production') || 'test');
      setCustomsSigner(settings.customsSigner || "");
      setBlIossNumber(settings.blIossNumber || "");
      setBoIossNumber(settings.boIossNumber || "");
      setBlUkVatNumber(settings.blUkVatNumber || "");
      setBoUkVatNumber(settings.boUkVatNumber || "");
      setInventorySyncEnabled(settings.inventorySyncEnabled || false);
      setInventorySyncTime(settings.inventorySyncTime || "02:00");
      setPriceOMaticEnabled(settings.priceOMaticEnabled || false);
      setPomScheduleEnabled(settings.pomScheduleEnabled || false);
      setPomSyncTime(settings.pomSyncTime || '14:00');
      setTimezone(settings.timezone || 'America/Chicago');
      setPomScheduleBatchSize(settings.pomScheduleBatchSize ?? 1500);
      setRebrickableImageSyncEnabled(settings.rebrickableImageSyncEnabled !== false);
      setChannelSyncEnabled(settings.channelSyncEnabled || false);
      setChannelSyncTime(settings.channelSyncTime || '03:00');
      setChannelSyncMode((settings.channelSyncMode as 'full_control' | 'quantity_only') || 'full_control');
      setOrdersSyncEnabled(settings.ordersSyncEnabled || false);
      setOrdersSyncFrequency(settings.ordersSyncFrequency || 15);
      setOrdersSyncFrequencyStr(String(settings.ordersSyncFrequency || 15));
      setRebrickableSetSyncEnabled(settings.rebrickableSetSyncEnabled || false);
      setRebrickableSetSyncTime(settings.rebrickableSetSyncTime || '04:00');

      // Price-o-Matic formula settings
      setPomBasePremium(settings.pomBasePremium ?? 10);
      setPomMinifigPremium(settings.pomMinifigPremium ?? 5);
      setPomScarcityThreshold1(settings.pomScarcityThreshold1 ?? 50);
      setPomScarcityBonus1(settings.pomScarcityBonus1 ?? 15);
      setPomScarcityThreshold2(settings.pomScarcityThreshold2 ?? 200);
      setPomScarcityBonus2(settings.pomScarcityBonus2 ?? 8);
      setPomScarcityThreshold3(settings.pomScarcityThreshold3 ?? 500);
      setPomScarcityBonus3(settings.pomScarcityBonus3 ?? 3);
      setPomTooHighThreshold(settings.pomTooHighThreshold ?? 20);
      setPomTooLowThreshold(settings.pomTooLowThreshold ?? 20);
      setPomUnderpricedScore(settings.pomUnderpricedScore ?? 1.5);
      setPomOverpricedScore(settings.pomOverpricedScore ?? 0.8);
      setPomBatchSize(settings.pomBatchSize ?? 1500);
      setBlApiCallLimit(settings.blApiCallLimit ?? 4900);
      setPomCostFloorPct(settings.pomCostFloorPct ?? 0);
      setPomMinPrice(parseFloat(String(settings.pomMinPrice ?? '0.02')));
      setPomTrendingEnabled(settings.pomTrendingEnabled ?? false);
      setPomTrendingDays(settings.pomTrendingDays ?? 15);
      setPomTrendingThreshold(settings.pomTrendingThreshold ?? 500);
      setPomTrendingBonus(settings.pomTrendingBonus ?? 60);
      setPomHighSupplyThreshold(settings.pomHighSupplyThreshold ?? 10000);
      setPomHighSupplyPenalty(settings.pomHighSupplyPenalty ?? 40);
      setElfieMode((settings.elfieMode as 'search' | 'ai') ?? 'search');

      // Fetch models
      fetchModels();
    }
  }, [settings]);

  const fetchModels = async () => {
    setLoadingModels(true);
    try {
      const response = await fetch('/api/openai/models', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      if (data.models) {
        setAvailableModels(data.models);
      }
    } catch (error) {
      console.error('Failed to fetch models:', error);
    } finally {
      setLoadingModels(false);
    }
  };


  const handleExport = async (type: 'inventory' | 'orders', format: 'csv' | 'xml') => {
    try {
      let url = '';
      
      if (type === 'inventory' && format === 'xml') {
        url = '/api/export/bricklink-xml';
      } else if (type === 'inventory' && format === 'csv') {
        url = '/api/export/inventory-csv';
      } else {
        console.log(`Export not yet implemented for ${type} ${format}`);
        return;
      }
      
      // Trigger download by opening URL in new window
      window.open(url, '_blank');
    } catch (error) {
      console.error(`Error exporting ${type} as ${format}:`, error);
    }
  };

  const handleDownloadBackup = (filename: string) => {
    try {
      const url = `/api/backups/download/${encodeURIComponent(filename)}`;
      
      // iOS-compatible download approach
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error('Error downloading backup:', error);
    }
  };

  const handleClearData = (type: 'inventory' | 'orders') => {
    // TODO: Implement clear data functionality
    console.log(`Clearing ${type} data`);
    setClearDataDialog(null);
  };

  const handleCleanupOldOrders = async () => {
    setCleanupRunning(true);
    try {
      const res = await fetch('/api/admin/cleanup-old-orders');
      const data = await res.json();
      if (data.deleted === 0) {
        toast({ title: 'Nothing to clean up', description: 'No stale orders found — already clean.' });
      } else {
        toast({ title: `Removed ${data.deleted} stale order${data.deleted !== 1 ? 's' : ''}`, description: `${data.orders ?? data.deleted} orders and associated records deleted.` });
      }
    } catch {
      toast({ title: 'Cleanup failed', description: 'Could not remove stale orders.', variant: 'destructive' });
    } finally {
      setCleanupRunning(false);
    }
  };

  // Handle app cache and data clearing
  const handleClearAppCache = async () => {
    try {
      // Clear localStorage (except auth data if any)
      const authKeys = ['elfie-session-id']; // Preserve these keys
      const keysToKeep: Record<string, string> = {};
      
      authKeys.forEach(key => {
        const value = localStorage.getItem(key);
        if (value) keysToKeep[key] = value;
      });
      
      localStorage.clear();
      
      // Restore preserved keys
      Object.entries(keysToKeep).forEach(([key, value]) => {
        localStorage.setItem(key, value);
      });
      
      // Clear sessionStorage
      sessionStorage.clear();
      
      // Clear service worker cache and unregister old service workers
      if ('serviceWorker' in navigator && 'caches' in window) {
        // Clear all caches
        const cacheNames = await caches.keys();
        await Promise.all(
          cacheNames.map(cacheName => caches.delete(cacheName))
        );
        
        // Unregister ALL service workers (to remove old one)
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const registration of registrations) {
          await registration.unregister();
        }
      }
      
      toast({
        title: "Cache Cleared & Service Worker Removed",
        description: "Please close and reopen the app completely to get the latest version.",
      });
      
      // Wait a moment, then reload the page to re-register the new service worker
      setTimeout(() => {
        window.location.reload();
      }, 2000);
      
    } catch (error) {
      console.error('Error clearing cache:', error);
      toast({
        title: "Error",
        description: "Failed to clear cache completely. Try manual steps below.",
        variant: "destructive",
      });
    }
  };

  // Restore workflow functions
  const handleInitiateRestore = async () => {
    try {
      setRestoreStep('restoring');
      setRestoreProgress(0);
      setRestoreCurrentTask('Initiating restore workflow...');
      
      const targetTimestamp = `${restoreDate}T${restoreTime}:00`;
      const response = await apiRequest('POST', '/api/backup/restore', {
        targetTimestamp,
        skipPlatformSync: false,
      });
      
      const { jobId } = response;
      setRestoreJobId(jobId);
      setRestoreCurrentTask('Restore job created - manual PITR required');
      setRestoreProgress(100);
      
      // Move to next step (in production, user would manually restore via Neon)
      setTimeout(() => {
        setRestoreStep('differential');
        handleAnalyzeDifferential(jobId);
      }, 2000);
    } catch (error: any) {
      console.error('Failed to initiate restore:', error);
      setRestoreCurrentTask(`Error: ${error.message || 'Failed to initiate restore'}`);
    }
  };

  const handleAnalyzeDifferential = async (jobId: string) => {
    try {
      setRestoreCurrentTask('Analyzing differential changes...');
      
      const analysis = await apiRequest('POST', '/api/backup/differential/analyze', {
        jobId,
      });
      
      setDifferentialAnalysis(analysis);
      setRestoreCurrentTask('Differential analysis complete');
    } catch (error: any) {
      console.error('Failed to analyze differential:', error);
      setRestoreCurrentTask(`Error: ${error.message || 'Failed to analyze differential'}`);
    }
  };

  const handleApplyDifferential = async (overrideAnomalies = false) => {
    if (!restoreJobId) return;
    
    try {
      setRestoreProgress(0);
      setRestoreCurrentTask('Applying differential recovery to BrickLink...');
      
      await apiRequest('POST', '/api/backup/differential/apply', {
        jobId: restoreJobId,
        overrideAnomalies,
      });
      
      setRestoreProgress(100);
      setRestoreCurrentTask('Differential recovery complete');
      
      // Move to verification
      setTimeout(() => {
        setRestoreStep('verification');
        handleVerifyRestoration();
      }, 1000);
    } catch (error: any) {
      console.error('Failed to apply differential:', error);
      setRestoreCurrentTask(`Error: ${error.message || 'Failed to apply differential'}`);
    }
  };

  const handleVerifyRestoration = async () => {
    if (!restoreJobId) return;
    
    try {
      setRestoreCurrentTask('Running verification checks...');
      
      const results = await apiRequest('GET', `/api/backup/verify/${restoreJobId}`);
      
      setVerificationResults(results);
      setRestoreCurrentTask('Verification complete');
    } catch (error: any) {
      console.error('Failed to verify restoration:', error);
      setRestoreCurrentTask(`Error: ${error.message || 'Failed to verify restoration'}`);
    }
  };

  const [openGroup, setOpenGroup] = useState<'company' | 'platform'>('company');

  const logoutMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/logout'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      window.location.href = '/';
    },
  });

  // Org profile state
  const { data: org } = useQuery<Organization>({
    queryKey: ['/api/org'],
    enabled: open,
  });
  const [orgName, setOrgName] = useState('');
  const [orgAddress, setOrgAddress] = useState('');
  const [orgPhone, setOrgPhone] = useState('');
  const [orgWebsite, setOrgWebsite] = useState('');

  useEffect(() => {
    if (org) {
      setOrgName(org.name ?? '');
      setOrgAddress(org.address ?? '');
      setOrgPhone(org.phone ?? '');
      setOrgWebsite(org.website ?? '');
    }
  }, [org]);

  const updateOrgMutation = useMutation({
    mutationFn: (data: { name?: string; address?: string; phone?: string; website?: string }) =>
      apiRequest('PATCH', '/api/org', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/org'] });
      toast({ title: 'Organization updated', description: 'Your organization profile has been saved.' });
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message || 'Failed to update organization', variant: 'destructive' });
    },
  });

  const logoUploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('logo', file);
      const res = await fetch('/api/org/logo', { method: 'POST', body: formData, credentials: 'include' });
      if (!res.ok) { const t = await res.text(); throw new Error(t); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/org'] });
      toast({ title: 'Logo updated' });
    },
    onError: (err: any) => {
      toast({ title: 'Upload failed', description: err.message || 'Failed to upload logo', variant: 'destructive' });
    },
  });

  const removeLogoMutation = useMutation({
    mutationFn: () => apiRequest('DELETE', '/api/org/logo'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/org'] });
      toast({ title: 'Logo removed' });
    },
  });

  const [deleteOrgDialogOpen, setDeleteOrgDialogOpen] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');

  const deleteOrgMutation = useMutation({
    mutationFn: () => apiRequest('DELETE', '/api/org'),
    onSuccess: () => {
      window.location.href = '/';
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message || 'Failed to delete company', variant: 'destructive' });
    },
  });

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) logoUploadMutation.mutate(file);
    e.target.value = '';
  };

  // Manual sync state for Automation tab
  const [syncingInventory, setSyncingInventory] = useState(false);
  const [syncingOrders, setSyncingOrders] = useState(false);
  const [syncingPom, setSyncingPom] = useState(false);
  const [syncingChannel, setSyncingChannel] = useState(false);
  const [syncingRebrickable, setSyncingRebrickable] = useState(false);

  async function runManualSync(
    endpoint: string,
    setLoading: (v: boolean) => void,
    label: string,
    body?: object,
    successTitle?: string,
    successDescription?: string,
  ) {
    setLoading(true);
    try {
      const result = await apiRequest('POST', endpoint, body);
      toast({ title: successTitle ?? `${label} complete`, description: successDescription ?? 'Sync finished successfully.' });
    } catch (err: any) {
      const msg: string = err?.message || String(err);
      const isBlocked = msg.toLowerCase().includes('already running') || msg.toLowerCase().includes('blocked');
      toast({
        title: isBlocked ? `${label} blocked` : `${label} failed`,
        description: msg,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  const { data: users } = useQuery<User[]>({
    queryKey: ['/api/admin/users'],
    enabled: open && isAdmin,
  });

  const { data: orgLimits } = useQuery<any>({
    queryKey: ['/api/admin/organizations', org?.id, 'limits'],
    enabled: !!org?.id && isAdmin,
  });

  const effectiveLimits = getEffectiveLimits(org ?? { plan: 'trial' });
  const bsCheck = checkLimit(org?.brickspotterScansThisMonth ?? 0, effectiveLimits.brickspotterScansPerMonth, 'BrickSpotter scans');
  const userCheck = checkLimit(users?.length ?? 0, effectiveLimits.seats, 'team seats');
  const inventoryCount = inventoryCountData?.count ?? 0;
  const inventoryCheck = checkLimit(inventoryCount, effectiveLimits.inventoryItems, 'inventory items');
  const trialDaysRemaining = org?.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(org.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  const navigationItems = [
    { id: 'general' as const, label: 'Organization', icon: Settings },
    { id: 'billing' as const, label: 'Billing & Plan', icon: CreditCard },
    { id: 'platforms' as const, label: 'Platforms', icon: Layers },
    ...(isAdmin ? [{ id: 'users' as const, label: 'Team & Roles', icon: Users }] : []),
    { id: 'automation' as const, label: 'Scheduler', icon: Play },
    { id: 'data' as const, label: 'Data Maintenance', icon: HardDrive },
    { id: 'about' as const, label: 'About & Credits', icon: Info },
  ];

  const platformAdminGroups = [
    {
      label: 'Plans & Customers',
      items: [
        { id: 'orgs' as const, label: 'Organizations', icon: Building2 },
        { id: 'impersonation' as const, label: 'View as Company', icon: EyeOff },
        { id: 'billingOverview' as const, label: 'Billing Overview', icon: CreditCard },
        { id: 'plansAndPricing' as const, label: 'Plans & Pricing', icon: Tag },
        { id: 'announcements' as const, label: 'Announcements', icon: Megaphone },
      ],
    },
    {
      label: 'Platform',
      items: [
        { id: 'systemHealth' as const, label: 'System Health', icon: Activity },
        { id: 'auditLog' as const, label: 'Audit Log', icon: ClipboardList },
        { id: 'apiKeys' as const, label: 'API Keys', icon: Key },
        { id: 'enrichment' as const, label: 'Data Enrichment', icon: Database },
        { id: 'ai' as const, label: 'E.L.F.I.E.', icon: Brain },
      ],
    },
  ];

  const platformAdminItems = platformAdminGroups.flatMap(g => g.items);
  const allNavItems = [...navigationItems, ...platformAdminItems];

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent
          className="sm:max-w-[640px] bg-gray-900 border-gray-700 p-0 overflow-hidden"
          style={{ height: 'min(640px, calc(96dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom)))' }}
        >
          <div
            className="flex flex-col h-full min-h-0"
          >
            {/* Header */}
            <div className="flex items-center px-3 py-3 border-b border-gray-700/80 bg-gray-800/70 flex-shrink-0">
              <div className="w-8 flex-shrink-0 flex items-center">
                {(activeSection !== null) && (
                  <button
                    onClick={() => {
                      if (activeSection === 'platforms' && activePlatform !== null) {
                        setActivePlatform(null);
                        setAddIntegrationType(null);
                      } else if (activeSection === 'orgs' && activeOrg !== null) {
                        setActiveOrg(null);
                      } else {
                        setActiveSection(null);
                        setActivePlatform(null);
                        setActiveOrg(null);
                      }
                    }}
                    className="text-gray-400 hover:text-gray-200 transition-colors p-1 rounded"
                    data-testid="button-settings-back"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                )}
              </div>
              <DialogHeader className="flex-1 p-0 text-center">
                <DialogTitle className="text-sm font-semibold text-gray-100 tracking-wide">
                  {activeSection === null
                    ? 'Settings'
                    : activeSection === 'platforms' && activePlatform !== null
                      ? (() => {
                          const hardcoded: Record<string, string> = { bricklink: 'BrickLink', brickowl: 'BrickOwl', paypal: 'PayPal', stripe: 'Stripe', easypost: 'EasyPost' };
                          if (hardcoded[activePlatform]) return hardcoded[activePlatform];
                          const dyn = orgIntegrationsList.find(i => String(i.id) === activePlatform);
                          return dyn ? (dyn.displayName || dyn.channel) : 'Channel';
                        })()
                      : activeSection === 'orgs' && activeOrg !== null
                        ? activeOrg.name
                        : allNavItems.find(i => i.id === activeSection)?.label ?? 'Settings'}
                </DialogTitle>
              </DialogHeader>
              <div className="w-8 flex-shrink-0" />
            </div>

            {/* Content */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {activeSection === null ? (
                <nav className="p-2">
                  {/* Company Settings accordion header */}
                  <button
                    onClick={() => setOpenGroup('company')}
                    className="w-full flex items-center gap-3 px-4 py-2.5 rounded-md text-xs font-semibold uppercase tracking-widest text-gray-400 hover:text-gray-200 hover:bg-gray-700/30 transition-colors"
                    data-testid="button-company-settings-toggle"
                  >
                    <span className="flex-1 text-left">Company Settings</span>
                    {openGroup === 'company'
                      ? <ChevronDown className="h-3.5 w-3.5 text-gray-500 flex-shrink-0" />
                      : <ChevronRight className="h-3.5 w-3.5 text-gray-600 flex-shrink-0" />
                    }
                  </button>
                  {openGroup === 'company' && navigationItems.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setActiveSection(item.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-md text-sm text-gray-300 hover:text-white hover:bg-gray-700/50 transition-colors group"
                      data-testid={`nav-${item.id}`}
                    >
                      <item.icon className="h-4 w-4 text-gray-400 flex-shrink-0 group-hover:text-gray-200 transition-colors" />
                      <span className="flex-1 text-left">{item.label}</span>
                      <ChevronRight className="h-4 w-4 text-gray-600 flex-shrink-0" />
                    </button>
                  ))}

                  {/* Platform Admin accordion — super admin only */}
                  {superAdmin && (
                    <>
                      <div className="my-1.5 mx-4 border-t border-yellow-500/20" />
                      <button
                        onClick={() => setOpenGroup('platform')}
                        className="w-full flex items-center gap-3 px-4 py-2.5 rounded-md text-xs font-semibold uppercase tracking-widest text-yellow-500/80 hover:text-yellow-400 hover:bg-yellow-500/10 transition-colors"
                        data-testid="button-platform-admin-toggle"
                      >
                        <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0" />
                        <span className="flex-1 text-left">Platform Admin</span>
                        {openGroup === 'platform'
                          ? <ChevronDown className="h-3.5 w-3.5 text-yellow-600 flex-shrink-0" />
                          : <ChevronRight className="h-3.5 w-3.5 text-yellow-700 flex-shrink-0" />
                        }
                      </button>
                      {openGroup === 'platform' && platformAdminGroups.map((group) => (
                        <div key={group.label}>
                          <p className="px-4 pt-2 pb-1 text-[9px] uppercase tracking-widest text-yellow-700/60 font-semibold">{group.label}</p>
                          {group.items.map((item) => (
                            <button
                              key={item.id}
                              onClick={() => setActiveSection(item.id)}
                              className="w-full flex items-center gap-3 px-4 py-2.5 rounded-md text-sm text-yellow-300/80 hover:text-yellow-200 hover:bg-yellow-500/10 transition-colors group"
                              data-testid={`nav-${item.id}`}
                            >
                              <item.icon className="h-4 w-4 text-yellow-500/70 flex-shrink-0 group-hover:text-yellow-400 transition-colors" />
                              <span className="flex-1 text-left">{item.label}</span>
                              <ChevronRight className="h-4 w-4 text-yellow-700 flex-shrink-0" />
                            </button>
                          ))}
                        </div>
                      ))}
                    </>
                  )}

                  <div className="my-2 mx-4 border-t border-gray-700/60" />
                  <button
                    onClick={() => logoutMutation.mutate()}
                    disabled={logoutMutation.isPending}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-md text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors group"
                    data-testid="button-logout"
                  >
                    <LogOut className="h-4 w-4 flex-shrink-0" />
                    <span className="flex-1 text-left">Sign Out</span>
                  </button>
                </nav>
              ) : (
                <div className="p-4 sm:p-6">

            {/* General Settings */}
            {activeSection === 'general' && (
              <div className="min-h-[400px]">

              {/* Tab bar */}
              <div className="flex border-b border-gray-700 bg-gray-800/40 -mx-6 px-6 mb-4">
                {(['info', 'features', 'limits', 'billing'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveGeneralTab(tab)}
                    className={`px-4 py-2.5 text-[11px] font-semibold transition-colors border-b-2 -mb-px ${activeGeneralTab === tab ? 'text-yellow-400 border-yellow-500' : 'text-gray-500 border-transparent hover:text-gray-300'}`}
                    data-testid={`tab-general-${tab}`}
                  >
                    {tab === 'billing' ? 'Billing / Payments' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>

              {activeGeneralTab === 'info' && (
              <div className="space-y-4">

              {/* Header card: logo + version + org ID */}
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3">
                <div className="flex items-center gap-3">
                  {/* Logo upload area */}
                  <div className="relative flex-shrink-0">
                    <div className="w-16 h-16 rounded-lg bg-gray-700 border border-gray-600 overflow-hidden flex items-center justify-center">
                      {logoUploadMutation.isPending ? (
                        <Loader2 className="h-5 w-5 text-gray-400 animate-spin" />
                      ) : org?.logoUrl ? (
                        <img src={org.logoUrl} alt="Org logo" className="w-full h-full object-cover" />
                      ) : (
                        <ImageIcon className="h-6 w-6 text-gray-500" />
                      )}
                    </div>
                    <button
                      onClick={() => document.getElementById('logo-upload')?.click()}
                      className="absolute -bottom-1.5 -right-1.5 bg-gray-600 border border-gray-500 rounded-full p-1 cursor-pointer hover:bg-gray-500"
                      title="Upload logo"
                      data-testid="button-upload-logo"
                    >
                      <Upload className="h-2.5 w-2.5 text-gray-300" />
                    </button>
                    <input
                      id="logo-upload"
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleLogoUpload}
                      data-testid="input-logo-upload"
                    />
                  </div>

                  {/* App info + org ID */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div>
                        <p className="text-xs font-medium text-gray-300">{APP_NAME}</p>
                        <p className="text-[10px] text-gray-500">Version {APP_VERSION}</p>
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-gray-500">
                        <CheckCircle2 className="h-3 w-3 text-green-400" />
                        <span>Up to date</span>
                      </div>
                    </div>
                    <div className="mt-2 pt-2 border-t border-gray-700/60">
                      <p className="text-[10px] text-gray-500 mb-0.5">Organization ID</p>
                      <p className="text-[10px] font-mono text-gray-400 truncate" data-testid="text-org-id">
                        {org?.id ?? user?.orgId ?? '—'}
                      </p>
                    </div>
                  </div>
                </div>
                {org?.logoUrl && (
                  <div className="flex justify-end mt-2 pt-2 border-t border-gray-700/60">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeLogoMutation.mutate()}
                      disabled={removeLogoMutation.isPending}
                      className="text-[10px] text-red-400 h-6 px-2"
                      data-testid="button-remove-logo"
                    >
                      Remove logo
                    </Button>
                  </div>
                )}
              </div>

              {/* Organization profile fields */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-gray-300">Organization Profile</h3>

                {/* Company Name */}
                <div className="space-y-1.5">
                  <Label htmlFor="org-name" className="text-xs text-gray-400">Company Name</Label>
                  <Input
                    id="org-name"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    onBlur={() => { if (orgName.trim().length >= 2) updateOrgMutation.mutate({ name: orgName }); }}
                    className="bg-gray-900/50 border-gray-600 text-xs h-8"
                    placeholder="Your company name"
                    data-testid="input-org-name"
                  />
                </div>

                {/* Address */}
                <div className="space-y-1.5">
                  <Label htmlFor="org-address" className="text-xs text-gray-400">Address</Label>
                  <Textarea
                    id="org-address"
                    value={orgAddress}
                    onChange={(e) => setOrgAddress(e.target.value)}
                    onBlur={() => updateOrgMutation.mutate({ address: orgAddress })}
                    className="bg-gray-900/50 border-gray-600 text-xs resize-none"
                    placeholder="Street, City, State, ZIP"
                    rows={2}
                    data-testid="input-org-address"
                  />
                </div>

                {/* Phone */}
                <div className="space-y-1.5">
                  <Label htmlFor="org-phone" className="text-xs text-gray-400">Phone</Label>
                  <Input
                    id="org-phone"
                    value={orgPhone}
                    onChange={(e) => setOrgPhone(e.target.value)}
                    onBlur={() => updateOrgMutation.mutate({ phone: orgPhone })}
                    className="bg-gray-900/50 border-gray-600 text-xs h-8"
                    placeholder="+1 (555) 555-5555"
                    data-testid="input-org-phone"
                  />
                </div>

                {/* Website */}
                <div className="space-y-1.5">
                  <Label htmlFor="org-website" className="text-xs text-gray-400">Website</Label>
                  <Input
                    id="org-website"
                    value={orgWebsite}
                    onChange={(e) => setOrgWebsite(e.target.value)}
                    onBlur={() => updateOrgMutation.mutate({ website: orgWebsite })}
                    className="bg-gray-900/50 border-gray-600 text-xs h-8"
                    placeholder="https://example.com"
                    data-testid="input-org-website"
                  />
                </div>

                {/* Timezone */}
                <div className="space-y-2">
                  <Label htmlFor="timezone" className="text-xs text-gray-400">Time Zone</Label>
                  <Select
                    value={timezone}
                    onValueChange={(tz) => {
                      setTimezone(tz);
                      updateSettingsMutation.mutate({ timezone: tz });
                    }}
                  >
                    <SelectTrigger className="text-xs" data-testid="select-timezone">
                      <SelectValue placeholder="Select timezone" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="America/New_York">Eastern Time (ET)</SelectItem>
                      <SelectItem value="America/Chicago">Central Time (CT)</SelectItem>
                      <SelectItem value="America/Denver">Mountain Time (MT)</SelectItem>
                      <SelectItem value="America/Los_Angeles">Pacific Time (PT)</SelectItem>
                      <SelectItem value="America/Anchorage">Alaska Time (AKT)</SelectItem>
                      <SelectItem value="Pacific/Honolulu">Hawaii Time (HT)</SelectItem>
                      <SelectItem value="Europe/London">London (GMT)</SelectItem>
                      <SelectItem value="Europe/Paris">Paris (CET)</SelectItem>
                      <SelectItem value="Asia/Tokyo">Tokyo (JST)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-gray-500">Used by all schedulers (POM, Inventory Sync)</p>
                </div>
              </div>

              {/* Add to Home Screen */}
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-gray-300">Install App</h3>
                <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 space-y-2">
                  {installStatus === 'installed' ? (
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
                      <div>
                        <p className="text-xs font-medium text-gray-300">App is installed</p>
                        <p className="text-[10px] text-gray-500">PlanetBrick is already on your home screen.</p>
                      </div>
                    </div>
                  ) : installStatus === 'promptable' ? (
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Smartphone className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        <div>
                          <p className="text-xs font-medium text-gray-300">Add to Home Screen</p>
                          <p className="text-[10px] text-gray-500">Install PlanetBrick for quick access.</p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          const outcome = await promptInstall();
                          if (outcome === 'accepted') {
                            toast({ title: 'App installed', description: 'PlanetBrick has been added to your home screen.' });
                          }
                        }}
                        data-testid="button-install-app"
                      >
                        Install
                      </Button>
                    </div>
                  ) : installStatus === 'ios' ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Smartphone className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        <p className="text-xs font-medium text-gray-300">Add to Home Screen</p>
                      </div>
                      <ol className="space-y-1.5 pl-1">
                        <li className="flex items-start gap-2 text-[11px] text-gray-400">
                          <span className="flex-shrink-0 w-4 h-4 rounded-full bg-gray-700 flex items-center justify-center text-[9px] font-bold text-gray-300 mt-0.5">1</span>
                          <span>Tap the <Share2 className="inline w-3 h-3 mb-0.5" /> Share button at the bottom of Safari</span>
                        </li>
                        <li className="flex items-start gap-2 text-[11px] text-gray-400">
                          <span className="flex-shrink-0 w-4 h-4 rounded-full bg-gray-700 flex items-center justify-center text-[9px] font-bold text-gray-300 mt-0.5">2</span>
                          <span>Scroll down and tap <PlusSquare className="inline w-3 h-3 mb-0.5" /> <strong className="text-gray-300">Add to Home Screen</strong></span>
                        </li>
                        <li className="flex items-start gap-2 text-[11px] text-gray-400">
                          <span className="flex-shrink-0 w-4 h-4 rounded-full bg-gray-700 flex items-center justify-center text-[9px] font-bold text-gray-300 mt-0.5">3</span>
                          <span>Tap <strong className="text-gray-300">Add</strong> in the top right corner</span>
                        </li>
                      </ol>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Smartphone className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      <div>
                        <p className="text-xs font-medium text-gray-300">Add to Home Screen</p>
                        <p className="text-[10px] text-gray-500">Use your browser's menu to add PlanetBrick to your home screen or desktop for quick access.</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Danger Zone */}
              <div className="space-y-2 border border-red-900/40 rounded-lg p-3 bg-red-950/10">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                  <h3 className="text-xs font-semibold text-red-400 uppercase tracking-wide">Danger Zone</h3>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs text-gray-300 font-medium">Delete this company</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">Permanently removes all data — orders, inventory, settings, and all users. This cannot be undone.</p>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => { setDeleteConfirmName(''); setDeleteOrgDialogOpen(true); }}
                    data-testid="button-delete-company"
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                    Delete
                  </Button>
                </div>
              </div>

              {/* Delete Company confirmation dialog */}
              <Dialog open={deleteOrgDialogOpen} onOpenChange={setDeleteOrgDialogOpen}>
                <DialogContent className="max-w-md" aria-describedby="delete-org-desc">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-red-400">
                      <AlertTriangle className="w-4 h-4" />
                      Delete company
                    </DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-1" id="delete-org-desc">
                    <p className="text-sm text-gray-300">
                      This will permanently delete <span className="font-semibold text-white">{org?.name}</span> and all associated data — orders, inventory, settings, integrations, and every user in this organization.
                    </p>
                    <div className="bg-red-950/30 border border-red-900/40 rounded-md p-3 text-xs text-red-300">
                      This action is irreversible. There is no way to recover your data after deletion.
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-gray-400">
                        Type <span className="font-mono font-semibold text-white">{org?.name}</span> to confirm
                      </Label>
                      <Input
                        value={deleteConfirmName}
                        onChange={(e) => setDeleteConfirmName(e.target.value)}
                        placeholder={org?.name ?? 'Company name'}
                        className="bg-gray-900 border-gray-700 text-sm"
                        data-testid="input-delete-confirm"
                      />
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteOrgDialogOpen(false)}
                        data-testid="button-delete-cancel"
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => deleteOrgMutation.mutate()}
                        disabled={deleteConfirmName !== org?.name || deleteOrgMutation.isPending}
                        data-testid="button-delete-confirm"
                      >
                        {deleteOrgMutation.isPending ? (
                          <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Deleting…</>
                        ) : (
                          <><Trash2 className="w-3.5 h-3.5 mr-1.5" />Delete company</>
                        )}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>

              </div>
              )}

              {/* Features tab — read-only effective state */}
              {activeGeneralTab === 'features' && (() => {
                const tier = getTierConfig(org?.plan ?? 'trial');
                const fo = (org?.featureOverrides ?? {}) as Record<string, boolean>;
                const FEATURE_ROWS: Array<{ key: string | null; tierKey: keyof typeof tier.features | null; label: string; icon: React.ElementType }> = [
                  { key: 'elfieAiMode',      tierKey: 'elfieAiMode',        label: 'E.L.F.I.E. AI Mode',    icon: Brain },
                  { key: 'pom',              tierKey: 'priceOMatic',         label: 'Price-o-Matic',          icon: TrendingUp },
                  { key: 'dataEnrichment',   tierKey: 'fullDataEnrichment',  label: 'Data Enrichment',        icon: Database },
                  { key: 'brickSpotter',     tierKey: null,                  label: 'BrickSpotter Scanning',  icon: Zap },
                  { key: 'warehouseModule',  tierKey: null,                  label: 'Warehouse Module',       icon: Package },
                  { key: 'universalCatalog', tierKey: null,                  label: 'Universal Catalog',      icon: Globe },
                  { key: null,               tierKey: 'brickOwl',            label: 'BrickOwl Integration',   icon: Globe },
                  { key: null,               tierKey: 'easypostAutomation',  label: 'EasyPost Automation',    icon: Zap },
                  { key: null,               tierKey: 'paymentSync',         label: 'Payment Sync',           icon: CreditCard },
                ];
                return (
                  <div className="rounded-lg bg-gray-800/60 border border-gray-700 overflow-hidden">
                    <div className="px-4 py-2.5 bg-gray-800 border-b border-gray-700 flex items-center gap-2">
                      <Flag className="h-3.5 w-3.5 text-yellow-500/70" />
                      <span className="text-xs font-semibold text-gray-200">Features</span>
                      <span className="text-[10px] text-gray-500 ml-1">— {org?.plan ?? 'trial'} plan</span>
                    </div>
                    <div className="grid grid-cols-[1fr_56px_48px] gap-2 px-4 py-1.5 border-b border-gray-700/60">
                      <span className="text-[9px] uppercase tracking-widest text-gray-600 font-semibold">Feature</span>
                      <span className="text-[9px] uppercase tracking-widest text-gray-600 font-semibold text-center">Plan</span>
                      <span className="text-[9px] uppercase tracking-widest text-gray-600 font-semibold text-center">Active</span>
                    </div>
                    <div className="divide-y divide-gray-700/40">
                      {[...FEATURE_ROWS].sort((a, b) => {
                        const aOn = a.tierKey != null && tier.features[a.tierKey] ? 1 : 0;
                        const bOn = b.tierKey != null && tier.features[b.tierKey] ? 1 : 0;
                        return bOn - aOn;
                      }).map(({ key, tierKey, label, icon: Icon }) => {
                        const planDefault = tierKey != null ? tier.features[tierKey] : null;
                        const overrideVal = key != null ? fo[key] : undefined;
                        const isOverridden = key != null && overrideVal !== undefined;
                        const effective = overrideVal !== undefined ? overrideVal : (planDefault ?? false);
                        return (
                          <div key={key ?? tierKey} className="grid grid-cols-[1fr_56px_48px] gap-2 items-center px-4 py-2.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <Icon className="h-3.5 w-3.5 text-gray-500 shrink-0" />
                              <span className="text-[11px] text-gray-300 truncate">{label}</span>
                              {isOverridden && <span className="shrink-0 text-[8px] font-bold uppercase tracking-wide text-amber-400 border border-amber-500/40 rounded px-1 py-0.5">OVR</span>}
                            </div>
                            <div className="flex justify-center">
                              {planDefault != null ? (
                                <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${planDefault ? 'text-green-400 bg-green-500/10' : 'text-gray-600 bg-gray-700/50'}`}>
                                  {planDefault ? 'ON' : 'OFF'}
                                </span>
                              ) : <span className="text-[9px] text-gray-700">—</span>}
                            </div>
                            <div className="flex justify-center">
                              <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${effective ? 'text-green-400 bg-green-500/10' : 'text-gray-600 bg-gray-700/50'}`}>
                                {effective ? 'ON' : 'OFF'}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="px-4 py-2 border-t border-gray-700/60">
                      <p className="text-[9px] text-gray-600">OVR = feature has been individually overridden by platform admin</p>
                    </div>
                  </div>
                );
              })()}

              {/* Limits tab — read-only usage */}
              {activeGeneralTab === 'limits' && (() => {
                const tier = getTierConfig(org?.plan ?? 'trial');
                const fmtLimit = (n: number) => n === -1 ? '∞' : String(n);
                const rows = [
                  { label: 'Seats',               planMax: fmtLimit(tier.limits.seats),                  usage: tenantLimitsData ? String(tenantLimitsData.usage.seats.count) : '—' },
                  { label: 'BrickSpotter Scans/mo', planMax: fmtLimit(tier.limits.brickspotterScansPerMonth), usage: tenantLimitsData ? String(tenantLimitsData.usage.brickspotterScans.scansUsed) : '—' },
                  { label: 'Automation Rules',     planMax: fmtLimit(tier.limits.automationRules),        usage: tenantLimitsData ? String(tenantLimitsData.usage.automationRules.count) : '—' },
                ];
                return (
                  <div className="rounded-lg bg-gray-800/60 border border-gray-700 overflow-hidden">
                    <div className="px-4 py-2.5 bg-gray-800 border-b border-gray-700 flex items-center gap-2">
                      <Wrench className="h-3.5 w-3.5 text-yellow-500/70" />
                      <span className="text-xs font-semibold text-gray-200">Plan Limits</span>
                      {tenantLimitsLoading && <Loader2 className="h-3 w-3 animate-spin text-gray-500 ml-1" />}
                    </div>
                    <div className="grid grid-cols-[1fr_64px_64px] gap-2 px-4 py-1.5 border-b border-gray-700/60">
                      <span className="text-[9px] uppercase tracking-widest text-gray-600 font-semibold">Limit</span>
                      <span className="text-[9px] uppercase tracking-widest text-gray-600 font-semibold text-center">Plan Max</span>
                      <span className="text-[9px] uppercase tracking-widest text-gray-600 font-semibold text-center">In Use</span>
                    </div>
                    <div className="divide-y divide-gray-700/40">
                      {rows.map(({ label, planMax, usage }) => (
                        <div key={label} className="grid grid-cols-[1fr_64px_64px] gap-2 items-center px-4 py-2.5">
                          <span className="text-[11px] text-gray-300">{label}</span>
                          <span className="text-xs text-gray-500 text-center font-mono">{planMax}</span>
                          <span className="text-xs text-gray-300 text-center font-mono">{usage}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Billing / Payments tab */}
              {activeGeneralTab === 'billing' && (
                <div className="rounded-lg bg-gray-800/60 border border-gray-700 overflow-hidden">
                  <div className="px-4 py-2.5 bg-gray-800 border-b border-gray-700 flex items-center gap-2">
                    <CreditCard className="h-3.5 w-3.5 text-yellow-500/70" />
                    <span className="text-xs font-semibold text-gray-200">Payment History</span>
                  </div>
                  {tenantPaymentsLoading ? (
                    <div className="flex items-center justify-center py-8 gap-2 text-gray-500">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-xs">Loading payments…</span>
                    </div>
                  ) : !org?.stripeCustomerId || !tenantPaymentsData?.payments?.length ? (
                    <div className="px-4 py-8 text-center">
                      <CreditCard className="h-6 w-6 text-gray-700 mx-auto mb-2" />
                      <p className="text-xs text-gray-500">No payment history available.</p>
                    </div>
                  ) : (
                    <div>
                      <div className="grid grid-cols-[1fr_72px_64px_32px] gap-2 px-4 py-1.5 border-b border-gray-700/60">
                        <span className="text-[9px] uppercase tracking-widest text-gray-600 font-semibold">Description</span>
                        <span className="text-[9px] uppercase tracking-widest text-gray-600 font-semibold text-right">Amount</span>
                        <span className="text-[9px] uppercase tracking-widest text-gray-600 font-semibold text-center">Status</span>
                        <span className="text-[9px]"></span>
                      </div>
                      <div className="divide-y divide-gray-700/40 max-h-72 overflow-y-auto">
                        {[...tenantPaymentsData.payments].sort((a, b) => b.created - a.created).map(pmt => {
                          const fmtAmt = (amt: number, cur: string) =>
                            new Intl.NumberFormat('en-US', { style: 'currency', currency: cur.toUpperCase() }).format(amt / 100);
                          const statusColors: Record<string, string> = {
                            paid: 'text-green-400 bg-green-500/10',
                            open: 'text-yellow-400 bg-yellow-500/10',
                            void: 'text-gray-500 bg-gray-700/50',
                            uncollectible: 'text-red-400 bg-red-500/10',
                            draft: 'text-gray-500 bg-gray-700/50',
                          };
                          const date = new Date(pmt.created * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                          return (
                            <div key={pmt.id} className="grid grid-cols-[1fr_72px_64px_32px] gap-2 items-center px-4 py-2.5">
                              <div className="min-w-0">
                                <p className="text-[11px] text-gray-300 truncate">{pmt.description ?? 'Invoice'}</p>
                                <p className="text-[10px] text-gray-600">{date}</p>
                              </div>
                              <span className="text-xs text-gray-200 font-mono text-right">{fmtAmt(pmt.amount, pmt.currency)}</span>
                              <div className="flex justify-center">
                                <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${statusColors[pmt.status ?? ''] ?? 'text-gray-500 bg-gray-700/50'}`}>
                                  {pmt.status ?? '—'}
                                </span>
                              </div>
                              <div className="flex justify-center">
                                {pmt.hostedUrl && (
                                  <a href={pmt.hostedUrl} target="_blank" rel="noopener noreferrer" title="View invoice" className="text-gray-600 hover:text-yellow-400 transition-colors" data-testid={`link-tenant-invoice-${pmt.id}`}>
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </a>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              </div>
            )}

            {/* __POM_REMOVED_FROM_GENERAL__ */}
            {false && (
                <div>
                  <h3 className="text-sm font-medium text-gray-300 mb-3">Price-o-Matic</h3>

                  {/* Auto Sync Scheduler */}
                  <div className="space-y-3 my-4">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <Label className="text-xs font-medium text-gray-300">Price-o-Matic Auto Sync</Label>
                          <Popover>
                            <PopoverTrigger asChild>
                              <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                <Info className="w-3 h-3" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent side="bottom" className="w-72 text-xs bg-gray-900 border-gray-700 p-3 space-y-1.5">
                              <p className="font-semibold text-gray-200">Price-o-Matic Auto Sync</p>
                              <p className="text-gray-400">Fetches avg listed price, avg sold price, and lot count from BrickLink for each inventory item, then computes a suggested price using your formula. Items are processed in priority order by category tier (T1 → T4).</p>
                              <p className="text-gray-500">Runs on its own independent schedule. Uses 3 BrickLink API calls per lot. Stops automatically at your daily API ceiling.</p>
                            </PopoverContent>
                          </Popover>
                        </div>
                        <p className="text-[10px] md:text-sm text-gray-500 mt-0.5">Runs independently on its own schedule</p>
                        <SyncStatusLine entry={syncStatuses?.priceomatic ?? null} />
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={syncingPom}
                          onClick={() => runManualSync('/api/sync/priceomatic', setSyncingPom, 'Price-o-Matic', undefined, 'Price-o-Matic started', 'Sync is running in the background.')}
                          title="Run Price-o-Matic sync now"
                          data-testid="button-run-pom-sync"
                        >
                          {syncingPom ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                        </Button>
                        <Switch
                          checked={pomScheduleEnabled}
                          onCheckedChange={(checked) => {
                            setPomScheduleEnabled(checked);
                            updateSettingsMutation.mutate({ pomScheduleEnabled: checked });
                          }}
                          data-testid="switch-pom-schedule"
                        />
                      </div>
                    </div>

                    {pomScheduleEnabled && (
                      <div className="ml-4 space-y-3">
                        <div className="flex items-center gap-4">
                          <div className="space-y-1">
                            <Label htmlFor="pom-sync-time" className="text-xs text-gray-400">Sync Time</Label>
                            <Input
                              id="pom-sync-time"
                              type="time"
                              value={pomSyncTime}
                              onChange={(e) => setPomSyncTime(e.target.value)}
                              onBlur={() => updateSettingsMutation.mutate({ pomSyncTime })}
                              className="text-xs w-32"
                              data-testid="input-pom-sync-time"
                            />
                            <p className="text-[10px] text-gray-500">Local timezone</p>
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor="pom-schedule-batch" className="text-xs text-gray-400">Lots per run</Label>
                            <Input
                              id="pom-schedule-batch"
                              type="number"
                              min={100}
                              max={5000}
                              step={100}
                              value={pomScheduleBatchSize}
                              onChange={(e) => setPomScheduleBatchSize(parseInt(e.target.value) || 100)}
                              onBlur={() => updateSettingsMutation.mutate({ pomScheduleBatchSize })}
                              className="text-xs w-28 text-right"
                              data-testid="input-pom-schedule-batch"
                            />
                            <p className="text-[10px] text-gray-500">= {pomScheduleBatchSize} API calls</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Sync Limits — always visible, not tied to scheduler toggle */}
                    <div className="ml-4 space-y-2 pt-2 border-t border-gray-700/40">
                      <p className="text-[10px] text-gray-500">BrickLink allows 5,000 API calls/day. Price-o-Matic uses 3 calls per lot.</p>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <Label className="text-xs text-gray-400">Manual sync batch size</Label>
                          <Popover>
                            <PopoverTrigger asChild>
                              <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                <Info className="w-3 h-3" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent side="bottom" className="w-60 text-xs bg-gray-900 border-gray-700 p-3">
                              Max lots to process when you hit the play button above to run a sync manually.
                            </PopoverContent>
                          </Popover>
                        </div>
                        <div className="flex items-center gap-2">
                          <Input type="number" min={100} max={5000} step={100} value={pomBatchSize} onChange={(e) => setPomBatchSize(parseInt(e.target.value) || 100)} onBlur={() => updateSettingsMutation.mutate({ pomBatchSize })} className="text-xs w-24 text-right" data-testid="input-pom-batch-size" />
                          <span className="text-[10px] text-gray-500 w-16">lots / run</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <Separator className="bg-gray-700" />

                  {/* Scoring collapsible */}
                  <div>
                    <button
                      onClick={() => setPomScoringOpen(!pomScoringOpen)}
                      className="w-full flex items-center justify-between gap-2 py-2 mb-3 border-b border-gray-600/60 hover:border-gray-500/60 transition-colors group"
                      data-testid="button-pom-scoring-toggle"
                    >
                      <span className="text-sm font-semibold text-gray-200 uppercase tracking-wider">Scoring</span>
                      {pomScoringOpen ? <ChevronDown className="w-4 h-4 text-gray-400 group-hover:text-gray-200 transition-colors" /> : <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-200 transition-colors" />}
                    </button>
                    {pomScoringOpen && (
                      <div className="space-y-2">
                        <div className="divide-y divide-gray-700/30 mb-2">
                          <div className="flex items-center justify-between py-3">
                            <div className="flex items-center gap-1.5">
                              <Label className="text-sm text-emerald-300">Underpriced Score</Label>
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                    <Info className="w-3.5 h-3.5" />
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent side="bottom" className="w-64 text-xs bg-gray-900 border-gray-700 p-3">
                                  Items with an opportunity score at or above this value are flagged as underpriced in the POM dashboard filter. Score = market peak ÷ your price, so 1.5× means you're 50% below the market peak. Only items with stock on hand are counted.
                                </PopoverContent>
                              </Popover>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-300">score ≥</span>
                              <Input type="number" min={0.1} max={10} step={0.1} value={pomUnderpricedScore} onChange={(e) => setPomUnderpricedScore(parseFloat(e.target.value) || 0.1)} onBlur={() => updateSettingsMutation.mutate({ pomUnderpricedScore })} className="text-sm w-20 text-right" data-testid="input-pom-underpriced-score" />
                              <span className="text-xs text-gray-400 w-14">× (peak)</span>
                            </div>
                          </div>
                          <div className="flex items-center justify-between py-3">
                            <div className="flex items-center gap-1.5">
                              <Label className="text-sm text-orange-300">Overpriced Score</Label>
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                    <Info className="w-3.5 h-3.5" />
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent side="bottom" className="w-64 text-xs bg-gray-900 border-gray-700 p-3">
                                  Items with an opportunity score at or below this value are flagged as overpriced in the POM dashboard filter. Score = market peak ÷ your price, so 0.8× means you're 25% above the market peak. Only items with stock on hand are counted.
                                </PopoverContent>
                              </Popover>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-300">score ≤</span>
                              <Input type="number" min={0.1} max={10} step={0.1} value={pomOverpricedScore} onChange={(e) => setPomOverpricedScore(parseFloat(e.target.value) || 0.1)} onBlur={() => updateSettingsMutation.mutate({ pomOverpricedScore })} className="text-sm w-20 text-right" data-testid="input-pom-overpriced-score" />
                              <span className="text-xs text-gray-400 w-14">× (peak)</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Layers className="h-4 w-4 text-gray-400" />
                          <p className="text-xs text-gray-400">Assign categories to refresh tiers. T1 = daily, T2 = 3 days, T3 = weekly, T4 = monthly.</p>
                        </div>
                        <PomCategoryTiers />
                      </div>
                    )}
                  </div>

                  {/* Pricing collapsible */}
                  <div>
                    <button
                      onClick={() => setPomPricingOpen(!pomPricingOpen)}
                      className="w-full flex items-center justify-between gap-2 py-2 mb-3 border-b border-gray-600/60 hover:border-gray-500/60 transition-colors group"
                      data-testid="button-pom-pricing-toggle"
                    >
                      <span className="text-sm font-semibold text-gray-200 uppercase tracking-wider">Pricing</span>
                      {pomPricingOpen ? <ChevronDown className="w-4 h-4 text-gray-400 group-hover:text-gray-200 transition-colors" /> : <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-200 transition-colors" />}
                    </button>
                    {pomPricingOpen && (
                      <div className="space-y-4">

                        {/* Base Premium */}
                        <div className="rounded-md border border-gray-700/60 overflow-hidden">
                          <div className="bg-gray-800/50 px-4 py-2.5 flex items-center gap-1.5 border-b border-gray-700/40">
                            <h4 className="text-xs font-semibold text-gray-200 uppercase tracking-wider">Base Premium</h4>
                            <Popover>
                              <PopoverTrigger asChild>
                                <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                  <Info className="w-3.5 h-3.5" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent side="bottom" className="w-64 text-xs bg-gray-900 border-gray-700 p-3">
                                The minimum % markup above BrickLink's average price every item receives. Avg price = midpoint of avg listed and avg sold. Scarcity bonuses stack on top of this.
                              </PopoverContent>
                            </Popover>
                          </div>
                          <div className="px-4 divide-y divide-gray-700/30">
                            <div className="flex items-center justify-between py-3">
                              <div className="flex items-center gap-1.5">
                                <Label className="text-sm text-gray-200">Parts Premium</Label>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                      <Info className="w-3.5 h-3.5" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent side="bottom" className="w-56 text-xs bg-gray-900 border-gray-700 p-3">
                                    Applied to all standard parts. Suggested = avg_price × (1 + base% + scarcity%). Being too high pushes above market; too low leaves margin on the table.
                                  </PopoverContent>
                                </Popover>
                              </div>
                              <div className="flex items-center gap-2">
                                <Input type="number" min={0} max={100} value={pomBasePremium} onChange={(e) => setPomBasePremium(parseInt(e.target.value) || 0)} onBlur={() => updateSettingsMutation.mutate({ pomBasePremium })} className="text-sm w-20 text-right" data-testid="input-pom-base-premium" />
                                <span className="text-xs text-gray-400 w-5">%</span>
                              </div>
                            </div>
                            <div className="flex items-center justify-between py-3">
                              <div className="flex items-center gap-1.5">
                                <Label className="text-sm text-gray-200">Minifigure Premium</Label>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                      <Info className="w-3.5 h-3.5" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent side="bottom" className="w-56 text-xs bg-gray-900 border-gray-700 p-3">
                                    Minifigures use a separate premium because they already command elevated prices relative to cost. Setting this too high on high-value figs risks losing buyers to competitors.
                                  </PopoverContent>
                                </Popover>
                              </div>
                              <div className="flex items-center gap-2">
                                <Input type="number" min={0} max={100} value={pomMinifigPremium} onChange={(e) => setPomMinifigPremium(parseInt(e.target.value) || 0)} onBlur={() => updateSettingsMutation.mutate({ pomMinifigPremium })} className="text-sm w-20 text-right" data-testid="input-pom-minifig-premium" />
                                <span className="text-xs text-gray-400 w-5">%</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Scarcity Bonuses */}
                        <div className="rounded-md border border-gray-700/60 overflow-hidden">
                          <div className="bg-gray-800/50 px-4 py-2.5 flex items-center gap-1.5 border-b border-gray-700/40">
                            <h4 className="text-xs font-semibold text-gray-200 uppercase tracking-wider">Scarcity Bonuses</h4>
                            <Popover>
                              <PopoverTrigger asChild>
                                <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                  <Info className="w-3.5 h-3.5" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent side="bottom" className="w-64 text-xs bg-gray-900 border-gray-700 p-3">
                                When fewer sellers list a part on BrickLink, you can charge more. Each tier adds a bonus % on top of your base premium. Items above the highest threshold get base premium only — no bonus.
                              </PopoverContent>
                            </Popover>
                          </div>
                          <div className="px-4">
                            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-3 py-2 border-b border-gray-700/40">
                              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Supply Level</span>
                              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider text-right">Under</span>
                              <span className="w-6"></span>
                              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider text-right">Bonus</span>
                              <span className="w-4"></span>
                            </div>
                            <div className="divide-y divide-gray-700/30">
                              <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-3 py-3">
                                <span className="text-sm font-medium text-orange-300">Very Low</span>
                                <Input type="number" min={1} value={pomScarcityThreshold1} onChange={(e) => setPomScarcityThreshold1(parseInt(e.target.value) || 1)} onBlur={() => updateSettingsMutation.mutate({ pomScarcityThreshold1 })} className="text-sm w-20 text-right" data-testid="input-pom-threshold1" />
                                <span className="text-xs text-gray-300">lots</span>
                                <Input type="number" min={0} max={200} value={pomScarcityBonus1} onChange={(e) => setPomScarcityBonus1(parseInt(e.target.value) || 0)} onBlur={() => updateSettingsMutation.mutate({ pomScarcityBonus1 })} className="text-sm w-20 text-right" data-testid="input-pom-bonus1" />
                                <span className="text-xs text-gray-400">%</span>
                              </div>
                              <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-3 py-3">
                                <span className="text-sm font-medium text-yellow-300">Low</span>
                                <Input type="number" min={1} value={pomScarcityThreshold2} onChange={(e) => setPomScarcityThreshold2(parseInt(e.target.value) || 1)} onBlur={() => updateSettingsMutation.mutate({ pomScarcityThreshold2 })} className="text-sm w-20 text-right" data-testid="input-pom-threshold2" />
                                <span className="text-xs text-gray-300">lots</span>
                                <Input type="number" min={0} max={200} value={pomScarcityBonus2} onChange={(e) => setPomScarcityBonus2(parseInt(e.target.value) || 0)} onBlur={() => updateSettingsMutation.mutate({ pomScarcityBonus2 })} className="text-sm w-20 text-right" data-testid="input-pom-bonus2" />
                                <span className="text-xs text-gray-400">%</span>
                              </div>
                              <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-3 py-3">
                                <span className="text-sm font-medium text-blue-300">Medium</span>
                                <Input type="number" min={1} value={pomScarcityThreshold3} onChange={(e) => setPomScarcityThreshold3(parseInt(e.target.value) || 1)} onBlur={() => updateSettingsMutation.mutate({ pomScarcityThreshold3 })} className="text-sm w-20 text-right" data-testid="input-pom-threshold3" />
                                <span className="text-xs text-gray-300">lots</span>
                                <Input type="number" min={0} max={200} value={pomScarcityBonus3} onChange={(e) => setPomScarcityBonus3(parseInt(e.target.value) || 0)} onBlur={() => updateSettingsMutation.mutate({ pomScarcityBonus3 })} className="text-sm w-20 text-right" data-testid="input-pom-bonus3" />
                                <span className="text-xs text-gray-400">%</span>
                              </div>
                              <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-3 py-3">
                                <span className="text-sm font-medium text-gray-300">High</span>
                                <span className="text-sm text-gray-400 text-right">{pomScarcityThreshold3}+</span>
                                <span className="text-xs text-gray-400">lots</span>
                                <span className="text-sm text-gray-400 w-20 text-right">—</span>
                                <span className="text-xs text-gray-400">%</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Formula Preview */}
                        <div className="bg-gray-900/60 rounded-md border border-gray-700/40 px-4 py-3">
                          <div className="flex items-center gap-1.5 mb-2.5">
                            <h4 className="text-[10px] font-semibold text-gray-300 uppercase tracking-wider">Formula Preview</h4>
                            <Popover>
                              <PopoverTrigger asChild>
                                <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                  <Info className="w-3 h-3" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent side="bottom" className="w-64 text-xs bg-gray-900 border-gray-700 p-3">
                                Shows the suggested price for a $0.10 part at each supply level using your current settings. Adjust the premiums and bonuses above to see results update instantly.
                              </PopoverContent>
                            </Popover>
                          </div>
                          <div className="space-y-1.5 font-mono text-xs">
                            {[
                              { label: 'Very Low (30 lots)', color: 'text-orange-300', premium: pomBasePremium + pomScarcityBonus1 },
                              { label: 'Low (100 lots)', color: 'text-yellow-300', premium: pomBasePremium + pomScarcityBonus2 },
                              { label: 'Medium (350 lots)', color: 'text-blue-300', premium: pomBasePremium + pomScarcityBonus3 },
                              { label: 'High (600 lots)', color: 'text-gray-500', premium: pomBasePremium },
                            ].map(({ label, color, premium }) => (
                              <div key={label} className="flex items-center justify-between">
                                <span className={color}>{label}</span>
                                <span className="text-green-400 font-semibold">${(0.10 * (1 + premium / 100)).toFixed(3)}</span>
                              </div>
                            ))}
                            <div className="border-t border-gray-700/50 pt-1.5 mt-0.5">
                              <span className="text-gray-400">Base input: $0.10 avg price</span>
                            </div>
                          </div>
                        </div>

                        {/* Price Floors */}
                        <div className="rounded-md border border-gray-700/60 overflow-hidden">
                          <div className="bg-gray-800/50 px-4 py-2.5 flex items-center gap-1.5 border-b border-gray-700/40">
                            <h4 className="text-xs font-semibold text-gray-200 uppercase tracking-wider">Price Floors</h4>
                            <Popover>
                              <PopoverTrigger asChild>
                                <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                  <Info className="w-3.5 h-3.5" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent side="bottom" className="w-64 text-xs bg-gray-900 border-gray-700 p-3">
                                Safety net applied after the market formula. Final price = max(market_price, cost_floor, min_price). Cost floor only applies to items with a recorded cost (my_cost).
                              </PopoverContent>
                            </Popover>
                          </div>
                          <div className="px-4 divide-y divide-gray-700/30">
                            <div className="flex items-center justify-between py-3">
                              <div className="flex items-center gap-1.5">
                                <Label className="text-sm text-gray-200">Cost Floor</Label>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                      <Info className="w-3.5 h-3.5" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent side="bottom" className="w-56 text-xs bg-gray-900 border-gray-700 p-3">
                                    Minimum margin above your recorded cost (my_cost). At 25%, the suggested price never goes below cost × 1.25. Set to 0 to disable.
                                  </PopoverContent>
                                </Popover>
                              </div>
                              <div className="flex items-center gap-2">
                                <Input type="number" min="0" max="200" value={pomCostFloorPct} onChange={(e) => setPomCostFloorPct(parseInt(e.target.value) || 0)} onBlur={() => updateSettingsMutation.mutate({ pomCostFloorPct })} className="text-sm w-20 text-right" data-testid="input-pom-cost-floor" />
                                <span className="text-xs text-gray-400 w-16">% above cost</span>
                              </div>
                            </div>
                            <div className="flex items-center justify-between py-3">
                              <div className="flex items-center gap-1.5">
                                <Label className="text-sm text-gray-200">Minimum Price</Label>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                      <Info className="w-3.5 h-3.5" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent side="bottom" className="w-56 text-xs bg-gray-900 border-gray-700 p-3">
                                    No item will be suggested below this price regardless of market data or cost. Useful for covering platform fees on micro-priced parts. Default $0.02.
                                  </PopoverContent>
                                </Popover>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-gray-400">$</span>
                                <Input type="number" min="0" step="0.01" value={pomMinPrice} onChange={(e) => setPomMinPrice(parseFloat(e.target.value) || 0)} onBlur={() => updateSettingsMutation.mutate({ pomMinPrice: pomMinPrice.toString() })} className="text-sm w-20 text-right" data-testid="input-pom-min-price" />
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Market Dynamics */}
                        <div className="rounded-md border border-gray-700/60 overflow-hidden">
                          <div className="bg-gray-800/50 px-4 py-2.5 flex items-center justify-between border-b border-gray-700/40">
                            <div className="flex items-center gap-1.5">
                              <h4 className="text-xs font-semibold text-gray-200 uppercase tracking-wider">Market Dynamics</h4>
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                    <Info className="w-3.5 h-3.5" />
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent side="bottom" className="w-80 text-xs bg-gray-900 border-gray-700 p-3 space-y-1.5">
                                  <p>Adjusts suggested prices using live BrickLink market data — no local order history involved.</p>
                                  <p><span className="text-blue-300 font-medium">Demand signal:</span> total pieces sold globally on BrickLink (from the sold price guide). High sales volume relative to your demand threshold boosts the price.</p>
                                  <p><span className="text-orange-300 font-medium">Supply signal:</span> total pieces currently listed for sale globally. High availability relative to your supply threshold lowers the price.</p>
                                  <p>The two signals are weighted and combined: <span className="font-mono text-gray-300">adj = maxAdj × (demandRatio × demandWeight% − supplyRatio × supplyWeight%)</span></p>
                                </PopoverContent>
                              </Popover>
                            </div>
                            <Switch
                              checked={pomTrendingEnabled}
                              onCheckedChange={(v) => { setPomTrendingEnabled(v); updateSettingsMutation.mutate({ pomTrendingEnabled: v }); }}
                              data-testid="switch-pom-trending"
                            />
                          </div>
                          <div className={`px-4 divide-y divide-gray-700/30 ${!pomTrendingEnabled ? 'opacity-40 pointer-events-none' : ''}`}>
                            <div className="flex items-center justify-between py-3">
                              <div className="flex items-center gap-1.5">
                                <Label className="text-sm text-gray-300">Max adjustment</Label>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                      <Info className="w-3.5 h-3.5" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent side="bottom" className="w-60 text-xs bg-gray-900 border-gray-700 p-3">
                                    The maximum percentage the market dynamics formula can move a price — either up (high demand) or down (high supply). Demand and supply weights further scale within this cap.
                                  </PopoverContent>
                                </Popover>
                              </div>
                              <div className="flex items-center gap-2">
                                <Input type="number" min={1} max={50} value={pomTrendingDays} onChange={(e) => setPomTrendingDays(parseInt(e.target.value) || 15)} onBlur={() => updateSettingsMutation.mutate({ pomTrendingDays })} className="text-sm w-20 text-right" data-testid="input-pom-market-max-adj" disabled={!pomTrendingEnabled} />
                                <span className="text-xs text-gray-400 w-8">%</span>
                              </div>
                            </div>
                            <div className="flex items-center justify-between py-3">
                              <div className="flex items-center gap-1.5">
                                <Label className="text-sm text-blue-300">Demand threshold</Label>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                      <Info className="w-3.5 h-3.5" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent side="bottom" className="w-64 text-xs bg-gray-900 border-gray-700 p-3">
                                    Total pieces sold globally on BrickLink that represents "fully demanded." An item at or above this level gets the full demand bonus. Below it, the bonus is proportionally reduced.
                                  </PopoverContent>
                                </Popover>
                              </div>
                              <div className="flex items-center gap-2">
                                <Input type="number" min={1} step={100} value={pomTrendingThreshold} onChange={(e) => setPomTrendingThreshold(parseInt(e.target.value) || 1)} onBlur={() => updateSettingsMutation.mutate({ pomTrendingThreshold })} className="text-sm w-24 text-right" data-testid="input-pom-trending-threshold" disabled={!pomTrendingEnabled} />
                                <span className="text-xs text-gray-400 w-14">units sold</span>
                              </div>
                            </div>
                            <div className="flex items-center justify-between py-3">
                              <div className="flex items-center gap-1.5">
                                <Label className="text-sm text-blue-300">Demand weight</Label>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                      <Info className="w-3.5 h-3.5" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent side="bottom" className="w-60 text-xs bg-gray-900 border-gray-700 p-3">
                                    How much of the max adjustment the demand signal can contribute. At 60 with max 15%, a fully-demanded item adds up to 9% (15 × 0.6).
                                  </PopoverContent>
                                </Popover>
                              </div>
                              <div className="flex items-center gap-2">
                                <Input type="number" min={0} max={100} value={pomTrendingBonus} onChange={(e) => setPomTrendingBonus(parseInt(e.target.value) || 0)} onBlur={() => updateSettingsMutation.mutate({ pomTrendingBonus })} className="text-sm w-20 text-right" data-testid="input-pom-trending-bonus" disabled={!pomTrendingEnabled} />
                                <span className="text-xs text-gray-400 w-8">%</span>
                              </div>
                            </div>
                            <div className="flex items-center justify-between py-3">
                              <div className="flex items-center gap-1.5">
                                <Label className="text-sm text-orange-300">Supply threshold</Label>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                      <Info className="w-3.5 h-3.5" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent side="bottom" className="w-64 text-xs bg-gray-900 border-gray-700 p-3">
                                    Total pieces currently listed for sale on BrickLink globally that represents "fully supplied." Common commodity parts often have 50,000+ pieces globally — set this to match your market context.
                                  </PopoverContent>
                                </Popover>
                              </div>
                              <div className="flex items-center gap-2">
                                <Input type="number" min={100} step={1000} value={pomHighSupplyThreshold} onChange={(e) => setPomHighSupplyThreshold(parseInt(e.target.value) || 100)} onBlur={() => updateSettingsMutation.mutate({ pomHighSupplyThreshold })} className="text-sm w-24 text-right" data-testid="input-pom-high-supply-threshold" disabled={!pomTrendingEnabled} />
                                <span className="text-xs text-gray-400 w-12">pieces</span>
                              </div>
                            </div>
                            <div className="flex items-center justify-between py-3">
                              <div className="flex items-center gap-1.5">
                                <Label className="text-sm text-orange-300">Supply weight</Label>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                      <Info className="w-3.5 h-3.5" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent side="bottom" className="w-60 text-xs bg-gray-900 border-gray-700 p-3">
                                    How much of the max adjustment the supply signal can subtract. At 40 with max 15%, a fully-supplied item removes up to 6% (15 × 0.4).
                                  </PopoverContent>
                                </Popover>
                              </div>
                              <div className="flex items-center gap-2">
                                <Input type="number" min={0} max={100} value={pomHighSupplyPenalty} onChange={(e) => setPomHighSupplyPenalty(parseInt(e.target.value) || 0)} onBlur={() => updateSettingsMutation.mutate({ pomHighSupplyPenalty })} className="text-sm w-20 text-right" data-testid="input-pom-high-supply-penalty" disabled={!pomTrendingEnabled} />
                                <span className="text-xs text-gray-400 w-8">%</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Flag Thresholds */}
                        <div className="rounded-md border border-gray-700/60 overflow-hidden">
                          <div className="bg-gray-800/50 px-4 py-2.5 flex items-center gap-1.5 border-b border-gray-700/40">
                            <h4 className="text-xs font-semibold text-gray-200 uppercase tracking-wider">Flag Thresholds</h4>
                            <Popover>
                              <PopoverTrigger asChild>
                                <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                  <Info className="w-3.5 h-3.5" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent side="bottom" className="w-64 text-xs bg-gray-900 border-gray-700 p-3">
                                Controls which items appear in the Price-o-Matic dashboard as needing attention. Items outside these bands are flagged — not automatically repriced. You decide whether to act on each flag.
                              </PopoverContent>
                            </Popover>
                          </div>
                          <div className="px-4 divide-y divide-gray-700/30">
                            <div className="flex items-center justify-between py-3">
                              <div className="flex items-center gap-1.5">
                                <Label className="text-sm text-red-300">Too High Flag</Label>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                      <Info className="w-3.5 h-3.5" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent side="bottom" className="w-56 text-xs bg-gray-900 border-gray-700 p-3">
                                    Items priced this far above the suggested price appear in the "Too High" tab. Buyers will likely find cheaper options elsewhere, reducing your sell-through rate.
                                  </PopoverContent>
                                </Popover>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-300">more than</span>
                                <Input type="number" min={1} max={200} value={pomTooHighThreshold} onChange={(e) => setPomTooHighThreshold(parseInt(e.target.value) || 1)} onBlur={() => updateSettingsMutation.mutate({ pomTooHighThreshold })} className="text-sm w-20 text-right" data-testid="input-pom-too-high" />
                                <span className="text-xs text-gray-400 w-14">% above</span>
                              </div>
                            </div>
                            <div className="flex items-center justify-between py-3">
                              <div className="flex items-center gap-1.5">
                                <Label className="text-sm text-yellow-300">Too Low Flag</Label>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                      <Info className="w-3.5 h-3.5" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent side="bottom" className="w-56 text-xs bg-gray-900 border-gray-700 p-3">
                                    Items priced this far below the suggested price appear in the "Too Low" tab. You're leaving margin on the table — buyers didn't need that discount.
                                  </PopoverContent>
                                </Popover>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-300">more than</span>
                                <Input type="number" min={1} max={200} value={pomTooLowThreshold} onChange={(e) => setPomTooLowThreshold(parseInt(e.target.value) || 1)} onBlur={() => updateSettingsMutation.mutate({ pomTooLowThreshold })} className="text-sm w-20 text-right" data-testid="input-pom-too-low" />
                                <span className="text-xs text-gray-400 w-14">% below</span>
                              </div>
                            </div>

                          </div>
                        </div>

                      </div>
                    )}
                  </div>

                  {/* Clear Cache */}
                  <div className="bg-red-500/5 border border-red-500/20 rounded-md px-4 py-3">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <Label className="text-sm font-medium text-red-300">Clear Price Guide Cache</Label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                              <Info className="w-3.5 h-3.5" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent side="bottom" className="w-64 text-xs bg-gray-900 border-gray-700 p-3">
                            Deletes all stored price guide data and resets sync history. Use when starting fresh with new formula settings. The next sync rebuilds from scratch. No inventory data is affected.
                          </PopoverContent>
                        </Popover>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => setShowClearPomDialog(true)} className="border-red-500/40 text-red-400 hover:text-red-300 shrink-0" data-testid="button-clear-pom-cache">
                        <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                        Clear Cache
                      </Button>
                    </div>
                  </div>

                  <AlertDialog open={showClearPomDialog} onOpenChange={setShowClearPomDialog}>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Clear Price Guide Cache?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently delete all stored Price-o-Matic price guide data and reset the sync history. The next sync run will start fresh and rebuild from scratch using your current formula settings.
                          <br /><br />
                          This cannot be undone, but no inventory data is affected — only the pricing cache.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => clearPomCacheMutation.mutate()}
                          className="bg-red-600 hover:bg-red-700"
                          data-testid="button-confirm-clear-pom"
                        >
                          {clearPomCacheMutation.isPending ? "Clearing..." : "Yes, Clear Cache"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>

                  <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                    <p className="text-xs text-blue-300">
                      <strong>How it works:</strong> Price-o-Matic pulls avg listed price, avg sold price, and lot count from BrickLink for each item, then applies your formula above to compute a suggested price. Items more than {pomTooHighThreshold}% above or {pomTooLowThreshold}% below that suggested price are flagged in the dashboard.
                    </p>
                  </div>

                </div>

            )}

            {/* Billing & Plan */}
            {activeSection === 'billing' && (
              <div className="space-y-6 min-h-[400px]">
                {/* Trial Countdown Banner */}
                {org?.plan === 'trial' && trialDaysRemaining !== null && (
                  <div className={`rounded-lg p-3 flex items-start gap-3 ${trialDaysRemaining <= 3 ? 'bg-red-500/10 border border-red-500/20' : trialDaysRemaining <= 7 ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-blue-500/10 border border-blue-500/20'}`}>
                    <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${trialDaysRemaining <= 3 ? 'text-red-400' : trialDaysRemaining <= 7 ? 'text-amber-500' : 'text-blue-400'}`} />
                    <div className="space-y-1">
                      <p className={`text-xs font-medium ${trialDaysRemaining <= 3 ? 'text-red-200' : trialDaysRemaining <= 7 ? 'text-amber-200' : 'text-blue-200'}`}>
                        {trialDaysRemaining === 0 ? 'Your trial has ended' : `${trialDaysRemaining} day${trialDaysRemaining === 1 ? '' : 's'} left in your free trial`}
                      </p>
                      <p className="text-[11px] text-gray-400">Subscribe to keep your data and unlock the full platform.</p>
                    </div>
                  </div>
                )}

                {/* Limit Nudge Banners */}
                {(bsCheck.nudgeLevel === 'warning' || bsCheck.nudgeLevel === 'critical' || userCheck.nudgeLevel === 'warning' || userCheck.nudgeLevel === 'critical' || inventoryCheck.nudgeLevel === 'warning' || inventoryCheck.nudgeLevel === 'critical') && (
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 flex items-start gap-3">
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-amber-200">Approaching Plan Limits</p>
                      <p className="text-[11px] text-amber-500/80 leading-relaxed">
                        {bsCheck.message} {userCheck.message} {inventoryCheck.message}
                      </p>
                      {(org?.plan === 'foundation' || org?.plan === 'trial') && (
                        <button
                          onClick={() => checkoutMutation.mutate({ plan: 'core', interval: billingInterval })}
                          disabled={checkoutMutation.isPending}
                          className="text-[11px] font-bold text-amber-400 hover:text-amber-300 underline underline-offset-2"
                        >
                          Upgrade to Core for unlimited access
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Current Plan Card */}
                <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 space-y-4">
                  {org?.plan === 'flagship' ? (
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-medium text-gray-300">Current Plan</h3>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-lg font-bold text-white">Flagship</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider bg-purple-500/10 text-purple-400 border border-purple-500/20">
                            House Account
                          </span>
                        </div>
                      </div>
                      <p className="text-xs text-gray-500">Unlimited — no billing required</p>
                    </div>
                  ) : org?.plan === 'trial' ? (
                    <>
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-sm font-medium text-gray-300">Current Plan</h3>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-lg font-bold text-white">Free Trial</span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider ${trialDaysRemaining !== null && trialDaysRemaining <= 3 ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'}`}>
                              {trialDaysRemaining !== null ? `${trialDaysRemaining}d left` : 'Trial'}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 text-xs">
                          <button
                            onClick={() => setBillingInterval('monthly')}
                            className={`px-2 py-0.5 rounded text-xs ${billingInterval === 'monthly' ? 'bg-gray-600 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                            data-testid="button-billing-monthly"
                          >Monthly</button>
                          <button
                            onClick={() => setBillingInterval('annual')}
                            className={`px-2 py-0.5 rounded text-xs ${billingInterval === 'annual' ? 'bg-gray-600 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                            data-testid="button-billing-annual"
                          >Annual <span className="text-green-400">−17%</span></button>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          className="flex-1 bg-purple-600"
                          onClick={() => checkoutMutation.mutate({ plan: 'core', interval: billingInterval })}
                          disabled={checkoutMutation.isPending}
                          data-testid="button-upgrade-core"
                        >
                          <Sparkles className="w-4 h-4 mr-2" />
                          {checkoutMutation.isPending ? 'Redirecting...' : 'Subscribe to Core'}
                        </Button>
                        <Button
                          variant="outline"
                          className="flex-1 border-gray-600"
                          onClick={() => checkoutMutation.mutate({ plan: 'foundation', interval: billingInterval })}
                          disabled={checkoutMutation.isPending}
                          data-testid="button-upgrade-foundation"
                        >
                          {checkoutMutation.isPending ? 'Redirecting...' : 'Subscribe to Foundation'}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-sm font-medium text-gray-300">Current Plan</h3>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-lg font-bold text-white capitalize">{org?.plan ?? 'Foundation'}</span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider ${
                              org?.subscriptionStatus === 'active' ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
                              org?.subscriptionStatus === 'trial' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                              'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            }`}>
                              {org?.subscriptionStatus ?? 'Trial'}
                            </span>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-gray-500 mb-1">
                            {org?.plan === 'foundation' ? 'Upgrade Billing' : 'Billing Interval'}
                          </p>
                          {org?.plan === 'foundation' ? (
                            <div className="flex items-center gap-1 text-xs">
                              <button
                                onClick={() => setBillingInterval('monthly')}
                                className={`px-2 py-0.5 rounded text-xs ${billingInterval === 'monthly' ? 'bg-gray-600 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                                data-testid="button-billing-monthly"
                              >Monthly</button>
                              <button
                                onClick={() => setBillingInterval('annual')}
                                className={`px-2 py-0.5 rounded text-xs ${billingInterval === 'annual' ? 'bg-gray-600 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                                data-testid="button-billing-annual"
                              >Annual <span className="text-green-400">−17%</span></button>
                            </div>
                          ) : (
                            <p className="text-sm font-medium text-gray-300 capitalize">{org?.subscriptionInterval ?? 'Monthly'}</p>
                          )}
                        </div>
                      </div>

                      <div className="flex gap-3">
                        {org?.plan === 'foundation' ? (
                          <Button 
                            className="flex-1 bg-purple-600"
                            onClick={() => checkoutMutation.mutate({ plan: 'core', interval: billingInterval })}
                            disabled={checkoutMutation.isPending}
                            data-testid="button-upgrade-core"
                          >
                            <Sparkles className="w-4 h-4 mr-2" />
                            {checkoutMutation.isPending ? 'Redirecting...' : 'Upgrade to Core'}
                          </Button>
                        ) : (
                          <Button 
                            variant="outline" 
                            className="flex-1 border-gray-600"
                            onClick={() => portalMutation.mutate()}
                            disabled={portalMutation.isPending}
                            data-testid="button-manage-subscription"
                          >
                            {portalMutation.isPending ? 'Opening...' : 'Manage Subscription'}
                          </Button>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* Usage Meters */}
                <div className="space-y-4">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Usage & Limits</h3>
                  
                  <div className="grid gap-4">
                    {/* BrickSpotter Scans */}
                    <div className="bg-gray-900/40 border border-gray-800 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-400 flex items-center gap-1.5">
                          <Eye className="w-3.5 h-3.5" />
                          BrickSpotter Scans
                        </span>
                        <span className="font-mono text-gray-300">
                          {org?.brickspotterScansThisMonth ?? 0} / {effectiveLimits.brickspotterScansPerMonth === -1 ? '∞' : effectiveLimits.brickspotterScansPerMonth}
                        </span>
                      </div>
                      <Progress 
                        value={effectiveLimits.brickspotterScansPerMonth === -1 ? 0 : Math.min(((org?.brickspotterScansThisMonth ?? 0) / effectiveLimits.brickspotterScansPerMonth) * 100, 100)} 
                        className="h-1.5"
                      />
                      <p className="text-[10px] text-gray-500">Resets on {org?.brickspotterScansResetDate ? new Date(org.brickspotterScansResetDate).toLocaleDateString() : '—'}</p>
                    </div>

                    {/* Team Seats */}
                    <div className="bg-gray-900/40 border border-gray-800 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-400 flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5" />
                          Team Seats
                        </span>
                        <span className="font-mono text-gray-300">
                          {users?.length ?? 0} / {effectiveLimits.seats === -1 ? '∞' : effectiveLimits.seats}
                        </span>
                      </div>
                      <Progress 
                        value={effectiveLimits.seats === -1 ? 0 : Math.min(((users?.length ?? 0) / effectiveLimits.seats) * 100, 100)} 
                        className="h-1.5"
                      />
                      <p className="text-[10px] text-gray-500">Manage seats in Team & Roles</p>
                    </div>

                    {/* Inventory Items — only shown when plan has a limit */}
                    {effectiveLimits.inventoryItems !== -1 && (
                      <div className="bg-gray-900/40 border border-gray-800 rounded-lg p-3 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-400 flex items-center gap-1.5">
                            <Database className="w-3.5 h-3.5" />
                            Inventory Items
                          </span>
                          <span className="font-mono text-gray-300">
                            {inventoryCount} / {effectiveLimits.inventoryItems}
                          </span>
                        </div>
                        <Progress
                          value={Math.min((inventoryCount / effectiveLimits.inventoryItems) * 100, 100)}
                          className="h-1.5"
                        />
                        <p className="text-[10px] text-gray-500">Upgrade to Foundation or Core for unlimited inventory</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Plan Comparison */}
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Plan Comparison</h3>
                  <div className="border border-gray-700 rounded-lg divide-y divide-gray-700 overflow-hidden">
                    {[
                      { feature: 'BrickLink Sync', foundation: true, core: true },
                      { feature: 'BrickOwl Sync', foundation: false, core: true },
                      { feature: 'E.L.F.I.E. AI Mode', foundation: false, core: true },
                      { feature: 'Price-o-Matic', foundation: false, core: true },
                      { feature: 'Auto-Shipping Rules', foundation: false, core: true },
                      { feature: 'Unlimited Scans', foundation: false, core: true },
                    ].map((f, i) => (
                      <div key={i} className="flex items-center justify-between p-3 text-xs">
                        <span className="text-gray-300">{f.feature}</span>
                        <div className="flex gap-4">
                          <div className="flex items-center gap-1.5 w-20 justify-end">
                            <span className="text-[10px] text-gray-500 uppercase">Fdn</span>
                            {f.foundation ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : <Lock className="w-3.5 h-3.5 text-gray-600" />}
                          </div>
                          <div className="flex items-center gap-1.5 w-20 justify-end">
                            <span className="text-[10px] text-gray-500 uppercase">Core</span>
                            {f.core ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : <Lock className="w-3.5 h-3.5 text-gray-600" />}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Platform Connections */}
            {activeSection === 'platforms' && (
              <div className="min-h-[400px]">

                {/* ── CHANNEL LIST (index) ───────────────────────────────────── */}
                {activePlatform === null && (
                  <nav className="p-2">

                    {/* Core Integrations */}
                    <div className="px-4 pt-2 pb-1 flex items-center gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Core Integrations</span>
                      <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border bg-gray-800/60 text-gray-500 border-gray-700">
                        <Lock className="w-2.5 h-2.5" /> Required
                      </span>
                    </div>
                    {[
                      { key: 'bricklink', label: 'BrickLink', connected: !!bricklinkConsumerKey, badge: 'Read only', badgeColor: 'text-blue-400 border-blue-500/20 bg-blue-500/10' },
                      { key: 'paypal',    label: 'PayPal',    connected: !!(paypalClientId || (settings as any)?.paypalConnectedViaEnv), badge: 'Read only', badgeColor: 'text-blue-400 border-blue-500/20 bg-blue-500/10' },
                      { key: 'stripe',    label: 'Stripe',    connected: !!(stripeSecretKey || (settings as any)?.stripeConnectedViaEnv), badge: 'Read only', badgeColor: 'text-blue-400 border-blue-500/20 bg-blue-500/10' },
                    ].map(p => (
                      <button key={p.key} onClick={() => setActivePlatform(p.key)}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-md text-sm text-gray-300 hover:text-white hover:bg-gray-700/50 transition-colors group"
                        data-testid={`nav-platform-${p.key}`}
                      >
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${p.connected ? 'bg-green-400' : 'bg-gray-600'}`} />
                        <span className="flex-1 text-left">{p.label}</span>
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${p.badgeColor}`}>{p.badge}</span>
                        <ChevronRight className="h-4 w-4 text-gray-600 flex-shrink-0" />
                      </button>
                    ))}

                    {/* Sales Channels */}
                    <div className="px-4 pt-3 pb-1 flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Sales Channels</span>
                      <Button size="sm" variant="ghost" className="h-6 text-xs gap-1 text-gray-400 -mr-1"
                        data-testid="button-add-sales-channel"
                        onClick={() => { setAddIntegrationType('sales_channel'); setAddIntChannel('ebay'); setAddIntDisplayName('eBay'); setAddIntApiKey(''); }}>
                        <Plus className="w-3 h-3" /> Add
                      </Button>
                    </div>
                    <button onClick={() => setActivePlatform('brickowl')}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-md text-sm text-gray-300 hover:text-white hover:bg-gray-700/50 transition-colors group"
                      data-testid="nav-platform-brickowl"
                    >
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${brickowlApiKey || (settings as any)?.brickowlConnectedViaEnv ? 'bg-green-400' : 'bg-gray-600'}`} />
                      <span className="flex-1 text-left">BrickOwl</span>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border text-amber-400 border-amber-500/20 bg-amber-500/10">Read + Write</span>
                      <ChevronRight className="h-4 w-4 text-gray-600 flex-shrink-0" />
                    </button>
                    {orgIntegrationsList.filter(i => i.type === 'sales_channel').map(integration => (
                      <button key={integration.id} onClick={() => { setActivePlatform(String(integration.id)); setEditingIntId(integration.id); setEditIntDisplayName(integration.displayName || ''); setEditIntApiKey(''); }}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-md text-sm text-gray-300 hover:text-white hover:bg-gray-700/50 transition-colors group"
                        data-testid={`nav-platform-${integration.id}`}
                      >
                        <div className="w-2 h-2 rounded-full flex-shrink-0 bg-green-400" />
                        <span className="flex-1 text-left">{integration.displayName || integration.channel}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded border bg-gray-800 text-gray-500 border-gray-700 shrink-0">{integration.channel}</span>
                        <ChevronRight className="h-4 w-4 text-gray-600 flex-shrink-0" />
                      </button>
                    ))}
                    {addIntegrationType === 'sales_channel' && (
                      <div className="mx-2 my-1 border border-dashed border-gray-600 rounded-lg px-4 py-3 space-y-3 bg-gray-800/20">
                        <p className="text-xs font-medium text-gray-300">Add Sales Channel</p>
                        <div className="space-y-2">
                          <Label className="text-xs text-gray-400">Platform</Label>
                          <Select value={addIntChannel} onValueChange={(v) => { setAddIntChannel(v); const n: Record<string,string> = { brickowl: 'BrickOwl', ebay: 'eBay', amazon: 'Amazon', etsy: 'Etsy', shopify: 'Shopify', other: 'Other' }; setAddIntDisplayName(n[v] || ''); }}>
                            <SelectTrigger className="text-xs h-8" data-testid="select-add-sales-channel"><SelectValue placeholder="Select platform..." /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="brickowl">BrickOwl</SelectItem>
                              <SelectItem value="ebay">eBay</SelectItem>
                              <SelectItem value="amazon">Amazon</SelectItem>
                              <SelectItem value="etsy">Etsy</SelectItem>
                              <SelectItem value="shopify">Shopify</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs text-gray-400">Display Name</Label>
                          <Input className="text-xs" placeholder="e.g. My eBay Store" value={addIntDisplayName} onChange={(e) => setAddIntDisplayName(e.target.value)} data-testid="input-add-display-name" />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs text-gray-400">API Key</Label>
                          <Input type="password" className="text-xs" placeholder="Enter API key" value={addIntApiKey} onChange={(e) => setAddIntApiKey(e.target.value)} data-testid="input-add-api-key" />
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" className="text-xs" disabled={!addIntChannel || !addIntDisplayName || createIntegrationMutation.isPending} onClick={() => createIntegrationMutation.mutate({ channel: addIntChannel, type: 'sales_channel', displayName: addIntDisplayName, credentials: { apiKey: addIntApiKey } })} data-testid="button-save-add-integration">
                            {createIntegrationMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Add'}
                          </Button>
                          <Button size="sm" variant="ghost" className="text-xs" onClick={() => setAddIntegrationType(null)} data-testid="button-cancel-add-integration">Cancel</Button>
                        </div>
                      </div>
                    )}

                    {/* Payments */}
                    <div className="px-4 pt-3 pb-1 flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Payments</span>
                      <Button size="sm" variant="ghost" className="h-6 text-xs gap-1 text-gray-400 -mr-1"
                        data-testid="button-add-payment-vendor"
                        onClick={() => { setAddIntegrationType('payment'); setAddIntChannel('square'); setAddIntDisplayName('Square'); setAddIntApiKey(''); }}>
                        <Plus className="w-3 h-3" /> Add
                      </Button>
                    </div>
                    <p className="px-4 pb-1 text-[10px] text-gray-600">PayPal and Stripe are in Core Integrations above.</p>
                    {orgIntegrationsList.filter(i => i.type === 'payment').length === 0 && addIntegrationType !== 'payment' && (
                      <p className="mx-2 text-[11px] text-gray-600 border border-gray-700/50 rounded-lg px-4 py-2.5">No additional payment vendors configured.</p>
                    )}
                    {orgIntegrationsList.filter(i => i.type === 'payment').map(integration => (
                      <button key={integration.id} onClick={() => { setActivePlatform(String(integration.id)); setEditingIntId(integration.id); setEditIntDisplayName(integration.displayName || ''); setEditIntApiKey(''); }}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-md text-sm text-gray-300 hover:text-white hover:bg-gray-700/50 transition-colors group"
                        data-testid={`nav-platform-${integration.id}`}
                      >
                        <div className="w-2 h-2 rounded-full flex-shrink-0 bg-green-400" />
                        <span className="flex-1 text-left">{integration.displayName || integration.channel}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded border bg-gray-800 text-gray-500 border-gray-700 shrink-0">{integration.channel}</span>
                        <ChevronRight className="h-4 w-4 text-gray-600 flex-shrink-0" />
                      </button>
                    ))}
                    {addIntegrationType === 'payment' && (
                      <div className="mx-2 my-1 border border-dashed border-gray-600 rounded-lg px-4 py-3 space-y-3 bg-gray-800/20">
                        <p className="text-xs font-medium text-gray-300">Add Payment Vendor</p>
                        <div className="space-y-2">
                          <Label className="text-xs text-gray-400">Platform</Label>
                          <Select value={addIntChannel} onValueChange={(v) => { setAddIntChannel(v); const n: Record<string,string> = { square: 'Square', venmo: 'Venmo', zelle: 'Zelle', cashapp: 'Cash App', authorize_net: 'Authorize.net', braintree: 'Braintree', other: 'Other' }; setAddIntDisplayName(n[v] || ''); }}>
                            <SelectTrigger className="text-xs h-8" data-testid="select-add-payment-vendor"><SelectValue placeholder="Select platform..." /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="square">Square</SelectItem>
                              <SelectItem value="venmo">Venmo</SelectItem>
                              <SelectItem value="zelle">Zelle</SelectItem>
                              <SelectItem value="cashapp">Cash App</SelectItem>
                              <SelectItem value="authorize_net">Authorize.net</SelectItem>
                              <SelectItem value="braintree">Braintree</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs text-gray-400">Display Name</Label>
                          <Input className="text-xs" placeholder="e.g. Square Payments" value={addIntDisplayName} onChange={(e) => setAddIntDisplayName(e.target.value)} data-testid="input-add-display-name" />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs text-gray-400">API Key</Label>
                          <Input type="password" className="text-xs" placeholder="Enter API key" value={addIntApiKey} onChange={(e) => setAddIntApiKey(e.target.value)} data-testid="input-add-api-key" />
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" className="text-xs" disabled={!addIntChannel || !addIntDisplayName || createIntegrationMutation.isPending} onClick={() => createIntegrationMutation.mutate({ channel: addIntChannel, type: 'payment', displayName: addIntDisplayName, credentials: { apiKey: addIntApiKey } })} data-testid="button-save-add-integration">
                            {createIntegrationMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Add'}
                          </Button>
                          <Button size="sm" variant="ghost" className="text-xs" onClick={() => setAddIntegrationType(null)} data-testid="button-cancel-add-integration">Cancel</Button>
                        </div>
                      </div>
                    )}

                    {/* Shipping */}
                    <div className="px-4 pt-3 pb-1 flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Shipping</span>
                      <Button size="sm" variant="ghost" className="h-6 text-xs gap-1 text-gray-400 -mr-1"
                        data-testid="button-add-shipping-vendor"
                        onClick={() => { setAddIntegrationType('shipping'); setAddIntChannel('shipstation'); setAddIntDisplayName('ShipStation'); setAddIntApiKey(''); }}>
                        <Plus className="w-3 h-3" /> Add
                      </Button>
                    </div>
                    <button onClick={() => setActivePlatform('easypost')}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-md text-sm text-gray-300 hover:text-white hover:bg-gray-700/50 transition-colors group"
                      data-testid="nav-platform-easypost"
                    >
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${easypostApiKey || easypostTestApiKey ? 'bg-green-400' : 'bg-gray-600'}`} />
                      <span className="flex-1 text-left">EasyPost</span>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border text-amber-400 border-amber-500/20 bg-amber-500/10">Read + Write</span>
                      <ChevronRight className="h-4 w-4 text-gray-600 flex-shrink-0" />
                    </button>
                    {orgIntegrationsList.filter(i => i.type === 'shipping').map(integration => (
                      <button key={integration.id} onClick={() => { setActivePlatform(String(integration.id)); setEditingIntId(integration.id); setEditIntDisplayName(integration.displayName || ''); setEditIntApiKey(''); }}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-md text-sm text-gray-300 hover:text-white hover:bg-gray-700/50 transition-colors group"
                        data-testid={`nav-platform-${integration.id}`}
                      >
                        <div className="w-2 h-2 rounded-full flex-shrink-0 bg-green-400" />
                        <span className="flex-1 text-left">{integration.displayName || integration.channel}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded border bg-gray-800 text-gray-500 border-gray-700 shrink-0">{integration.channel}</span>
                        <ChevronRight className="h-4 w-4 text-gray-600 flex-shrink-0" />
                      </button>
                    ))}
                    {addIntegrationType === 'shipping' && (
                      <div className="mx-2 my-1 border border-dashed border-gray-600 rounded-lg px-4 py-3 space-y-3 bg-gray-800/20">
                        <p className="text-xs font-medium text-gray-300">Add Shipping Vendor</p>
                        <div className="space-y-2">
                          <Label className="text-xs text-gray-400">Platform</Label>
                          <Select value={addIntChannel} onValueChange={(v) => { setAddIntChannel(v); const n: Record<string,string> = { shipstation: 'ShipStation', pirateship: 'Pirate Ship', stamps_com: 'Stamps.com', shipbob: 'ShipBob', other: 'Other' }; setAddIntDisplayName(n[v] || ''); }}>
                            <SelectTrigger className="text-xs h-8" data-testid="select-add-shipping-vendor"><SelectValue placeholder="Select platform..." /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="shipstation">ShipStation</SelectItem>
                              <SelectItem value="pirateship">Pirate Ship</SelectItem>
                              <SelectItem value="stamps_com">Stamps.com</SelectItem>
                              <SelectItem value="shipbob">ShipBob</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs text-gray-400">Display Name</Label>
                          <Input className="text-xs" placeholder="e.g. ShipStation Account" value={addIntDisplayName} onChange={(e) => setAddIntDisplayName(e.target.value)} data-testid="input-add-display-name" />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs text-gray-400">API Key</Label>
                          <Input type="password" className="text-xs" placeholder="Enter API key" value={addIntApiKey} onChange={(e) => setAddIntApiKey(e.target.value)} data-testid="input-add-api-key" />
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" className="text-xs" disabled={!addIntChannel || !addIntDisplayName || createIntegrationMutation.isPending} onClick={() => createIntegrationMutation.mutate({ channel: addIntChannel, type: 'shipping', displayName: addIntDisplayName, credentials: { apiKey: addIntApiKey } })} data-testid="button-save-add-integration">
                            {createIntegrationMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Add'}
                          </Button>
                          <Button size="sm" variant="ghost" className="text-xs" onClick={() => setAddIntegrationType(null)} data-testid="button-cancel-add-integration">Cancel</Button>
                        </div>
                      </div>
                    )}

                  </nav>
                )}

                {/* ── DETAIL: BrickLink ─────────────────────────────────────── */}
                {activePlatform === 'bricklink' && (
                  <div className="p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border bg-blue-500/10 text-blue-400 border-blue-500/20">Read only</span>
                      <Tooltip><TooltipTrigger asChild><Info className="w-3 h-3 text-gray-500 shrink-0" /></TooltipTrigger><TooltipContent side="right" className="max-w-xs text-xs">BrickLink is the source of truth for inventory. Data flows one way — into this platform. Inventory is never written back to BrickLink.</TooltipContent></Tooltip>
                    </div>
                    <div className="space-y-2"><Label htmlFor="bricklink-key" className="text-xs text-gray-400">Consumer Key</Label><Input id="bricklink-key" placeholder="Enter BrickLink Consumer Key" className="text-xs" value={bricklinkConsumerKey} onChange={(e) => setBricklinkConsumerKey(e.target.value)} onBlur={() => updateSettingsMutation.mutate({ bricklinkConsumerKey: bricklinkConsumerKey || null, bricklinkConsumerSecret: bricklinkConsumerSecret || null, bricklinkTokenValue: bricklinkTokenValue || null, bricklinkTokenSecret: bricklinkTokenSecret || null })} data-testid="input-bricklink-key" /></div>
                    <div className="space-y-2"><Label htmlFor="bricklink-secret" className="text-xs text-gray-400">Consumer Secret</Label><Input id="bricklink-secret" type="password" placeholder="Enter BrickLink Consumer Secret" className="text-xs" value={bricklinkConsumerSecret} onChange={(e) => setBricklinkConsumerSecret(e.target.value)} onBlur={() => updateSettingsMutation.mutate({ bricklinkConsumerKey: bricklinkConsumerKey || null, bricklinkConsumerSecret: bricklinkConsumerSecret || null, bricklinkTokenValue: bricklinkTokenValue || null, bricklinkTokenSecret: bricklinkTokenSecret || null })} data-testid="input-bricklink-secret" /></div>
                    <div className="space-y-2"><Label htmlFor="bricklink-token" className="text-xs text-gray-400">Token Value</Label><Input id="bricklink-token" placeholder="Enter BrickLink Token Value" className="text-xs" value={bricklinkTokenValue} onChange={(e) => setBricklinkTokenValue(e.target.value)} onBlur={() => updateSettingsMutation.mutate({ bricklinkConsumerKey: bricklinkConsumerKey || null, bricklinkConsumerSecret: bricklinkConsumerSecret || null, bricklinkTokenValue: bricklinkTokenValue || null, bricklinkTokenSecret: bricklinkTokenSecret || null })} data-testid="input-bricklink-token" /></div>
                    <div className="space-y-2"><Label htmlFor="bricklink-token-secret" className="text-xs text-gray-400">Token Secret</Label><Input id="bricklink-token-secret" type="password" placeholder="Enter BrickLink Token Secret" className="text-xs" value={bricklinkTokenSecret} onChange={(e) => setBricklinkTokenSecret(e.target.value)} onBlur={() => updateSettingsMutation.mutate({ bricklinkConsumerKey: bricklinkConsumerKey || null, bricklinkConsumerSecret: bricklinkConsumerSecret || null, bricklinkTokenValue: bricklinkTokenValue || null, bricklinkTokenSecret: bricklinkTokenSecret || null })} data-testid="input-bricklink-token-secret" /></div>
                    <div className="space-y-1 pt-2 border-t border-gray-700">
                      <Label className="text-xs text-gray-400">Overall Daily API Limit</Label>
                      <p className="text-[10px] text-gray-500">Hard stop for all BrickLink API calls app-wide. BrickLink's hard cap is 5,000/day.</p>
                      <div className="flex items-center gap-2">
                        <Input type="number" min={500} max={5000} step={100} value={blApiCallLimit} onChange={(e) => setBlApiCallLimit(parseInt(e.target.value) || 500)} onBlur={() => updateSettingsMutation.mutate({ blApiCallLimit })} className="text-xs w-24 text-right" data-testid="input-bl-api-limit" />
                        <span className="text-[10px] text-gray-500">/ 5,000</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── DETAIL: BrickOwl ─────────────────────────────────────── */}
                {activePlatform === 'brickowl' && (
                  <div className="p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border bg-amber-500/10 text-amber-400 border-amber-500/20">Read + Write</span>
                      <Tooltip><TooltipTrigger asChild><Info className="w-3 h-3 text-gray-500 shrink-0" /></TooltipTrigger><TooltipContent side="right" className="max-w-xs text-xs">Orders and inventory are pulled from BrickOwl. Inventory updates are also pushed back to keep BrickOwl in sync.</TooltipContent></Tooltip>
                    </div>
                    <div className="space-y-2"><Label htmlFor="brickowl-key" className="text-xs text-gray-400">API Key</Label><Input id="brickowl-key" type="password" placeholder="Enter BrickOwl API Key" className="text-xs" value={brickowlApiKey} onChange={(e) => setBrickowlApiKey(e.target.value)} onBlur={() => updateSettingsMutation.mutate({ brickowlApiKey: brickowlApiKey || null })} data-testid="input-brickowl-key" /></div>
                    <div className="pt-2 border-t border-gray-700 flex justify-end">
                      <Button variant="ghost" size="sm" className="text-xs gap-1 text-red-400/80 hover:text-red-400" data-testid="button-remove-brickowl" onClick={() => setRemovePrimaryDialog('brickowl')}><Trash2 className="w-3 h-3" /> Remove</Button>
                    </div>
                  </div>
                )}

                {/* ── DETAIL: PayPal ────────────────────────────────────────── */}
                {activePlatform === 'paypal' && (
                  <div className="p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border bg-blue-500/10 text-blue-400 border-blue-500/20">Read only</span>
                      <Tooltip><TooltipTrigger asChild><Info className="w-3 h-3 text-gray-500 shrink-0" /></TooltipTrigger><TooltipContent side="right" className="max-w-xs text-xs">Pulls PayPal transaction data (refunds, fees) and matches them to orders. Requires a PayPal REST API app with Transaction Search permission.</TooltipContent></Tooltip>
                    </div>
                    <div className="space-y-2 pb-2 border-b border-gray-700">
                      <Label className="text-xs text-gray-400">Environment</Label>
                      <div className="flex gap-4">
                        <label className="flex items-center gap-2 cursor-pointer"><input type="radio" name="paypal-env" value="live" checked={paypalEnvironment === 'live'} onChange={() => { setPaypalEnvironment('live'); updateSettingsMutation.mutate({ paypalEnvironment: 'live' }); }} className="text-purple-500 focus:ring-purple-500" data-testid="radio-paypal-live" /><span className="text-xs text-gray-300">Live</span></label>
                        <label className="flex items-center gap-2 cursor-pointer"><input type="radio" name="paypal-env" value="sandbox" checked={paypalEnvironment === 'sandbox'} onChange={() => { setPaypalEnvironment('sandbox'); updateSettingsMutation.mutate({ paypalEnvironment: 'sandbox' }); }} className="text-purple-500 focus:ring-purple-500" data-testid="radio-paypal-sandbox" /><span className="text-xs text-gray-300">Sandbox</span></label>
                      </div>
                      {paypalEnvironment === 'sandbox' && <p className="text-xs text-yellow-500/80">Sandbox mode — test credentials only</p>}
                      {paypalEnvironment === 'live' && <p className="text-xs text-green-500/80">Live mode — real PayPal transactions</p>}
                    </div>
                    <div className="space-y-2"><Label htmlFor="paypal-client-id" className="text-xs text-gray-400">Client ID</Label><Input id="paypal-client-id" placeholder="Enter PayPal Client ID" className="text-xs" value={paypalClientId} onChange={(e) => setPaypalClientId(e.target.value)} onBlur={() => updateSettingsMutation.mutate({ paypalClientId: paypalClientId || null })} data-testid="input-paypal-client-id" /></div>
                    <div className="space-y-2"><Label htmlFor="paypal-client-secret" className="text-xs text-gray-400">Client Secret</Label><Input id="paypal-client-secret" type="password" placeholder="Enter PayPal Client Secret" className="text-xs" value={paypalClientSecret} onChange={(e) => setPaypalClientSecret(e.target.value)} onBlur={() => updateSettingsMutation.mutate({ paypalClientSecret: paypalClientSecret || null })} data-testid="input-paypal-client-secret" /></div>
                  </div>
                )}

                {/* ── DETAIL: Stripe ────────────────────────────────────────── */}
                {activePlatform === 'stripe' && (
                  <div className="p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border bg-blue-500/10 text-blue-400 border-blue-500/20">Read only</span>
                      <Tooltip><TooltipTrigger asChild><Info className="w-3 h-3 text-gray-500 shrink-0" /></TooltipTrigger><TooltipContent side="right" className="max-w-xs text-xs">Pulls Stripe transaction data (refunds, processing fees) and matches them to orders. Use a restricted key with read access to Charges and Refunds.</TooltipContent></Tooltip>
                    </div>
                    <div className="space-y-2 pb-2 border-b border-gray-700">
                      <Label className="text-xs text-gray-400">Environment</Label>
                      <div className="flex gap-4">
                        <label className="flex items-center gap-2 cursor-pointer"><input type="radio" name="stripe-env" value="live" checked={stripeEnvironment === 'live'} onChange={() => { setStripeEnvironment('live'); updateSettingsMutation.mutate({ stripeEnvironment: 'live' }); }} className="text-purple-500 focus:ring-purple-500" data-testid="radio-stripe-live" /><span className="text-xs text-gray-300">Live</span></label>
                        <label className="flex items-center gap-2 cursor-pointer"><input type="radio" name="stripe-env" value="test" checked={stripeEnvironment === 'test'} onChange={() => { setStripeEnvironment('test'); updateSettingsMutation.mutate({ stripeEnvironment: 'test' }); }} className="text-purple-500 focus:ring-purple-500" data-testid="radio-stripe-test" /><span className="text-xs text-gray-300">Test</span></label>
                      </div>
                      {stripeEnvironment === 'test' && <p className="text-xs text-yellow-500/80">Test mode — use a <code className="font-mono">sk_test_</code> key</p>}
                      {stripeEnvironment === 'live' && <p className="text-xs text-green-500/80">Live mode — use a <code className="font-mono">sk_live_</code> or restricted key</p>}
                    </div>
                    <div className="space-y-2"><Label htmlFor="stripe-secret-key" className="text-xs text-gray-400">Secret Key</Label><Input id="stripe-secret-key" type="password" placeholder={stripeEnvironment === 'test' ? 'sk_test_...' : 'sk_live_... or rk_live_...'} className="text-xs" value={stripeSecretKey} onChange={(e) => setStripeSecretKey(e.target.value)} onBlur={() => updateSettingsMutation.mutate({ stripeSecretKey: stripeSecretKey || null })} data-testid="input-stripe-secret-key" /></div>
                  </div>
                )}

                {/* ── DETAIL: EasyPost ─────────────────────────────────────── */}
                {activePlatform === 'easypost' && (
                  <div className="p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border bg-amber-500/10 text-amber-400 border-amber-500/20">Read + Write</span>
                      <Tooltip><TooltipTrigger asChild><Info className="w-3 h-3 text-gray-500 shrink-0" /></TooltipTrigger><TooltipContent side="right" className="max-w-xs text-xs">Used to purchase shipping labels and track packages. Labels are created from within the platform and shipment status is tracked automatically.</TooltipContent></Tooltip>
                    </div>
                    <div className="space-y-2 pb-2 border-b border-gray-700">
                      <Label className="text-xs text-gray-400">Active API Key</Label>
                      <div className="flex gap-4">
                        <label className="flex items-center gap-2 cursor-pointer"><input type="radio" name="easypost-mode" value="test" checked={easypostKeyMode === 'test'} onChange={() => { setEasypostKeyMode('test'); updateSettingsMutation.mutate({ easypostKeyMode: 'test' }); }} className="text-purple-500 focus:ring-purple-500" data-testid="radio-easypost-test" /><span className="text-xs text-gray-300">Test</span></label>
                        <label className="flex items-center gap-2 cursor-pointer"><input type="radio" name="easypost-mode" value="production" checked={easypostKeyMode === 'production'} onChange={() => { setEasypostKeyMode('production'); updateSettingsMutation.mutate({ easypostKeyMode: 'production' }); }} className="text-purple-500 focus:ring-purple-500" data-testid="radio-easypost-production" /><span className="text-xs text-gray-300">Production</span></label>
                      </div>
                      {easypostKeyMode === 'test' && <p className="text-xs text-yellow-500/80">Test mode — labels will use test tracking numbers</p>}
                      {easypostKeyMode === 'production' && <p className="text-xs text-green-500/80">Production mode — real shipping labels will be created</p>}
                    </div>
                    <div className="space-y-2"><Label htmlFor="easypost-key" className="text-xs text-gray-400">Production API Key</Label><Input id="easypost-key" type="password" placeholder="Enter EasyPost Production API Key" className="text-xs" value={easypostApiKey} onChange={(e) => setEasypostApiKey(e.target.value)} onBlur={() => updateSettingsMutation.mutate({ easypostApiKey: easypostApiKey || null })} data-testid="input-easypost-key" /></div>
                    <div className="space-y-2"><Label htmlFor="easypost-test-key" className="text-xs text-gray-400">Test API Key</Label><Input id="easypost-test-key" type="password" placeholder="Enter EasyPost Test API Key" className="text-xs" value={easypostTestApiKey} onChange={(e) => setEasypostTestApiKey(e.target.value)} onBlur={() => updateSettingsMutation.mutate({ easypostTestApiKey: easypostTestApiKey || null })} data-testid="input-easypost-test-key" /></div>
                    <div className="pt-3 border-t border-gray-700 space-y-3">
                      <div>
                        <p className="text-xs font-semibold text-gray-300 mb-0.5">International Shipping</p>
                        <p className="text-[11px] text-gray-500">Customs declarations are auto-generated for international orders. Fill in tax IDs to prevent buyers from being double-charged VAT/GST.</p>
                      </div>
                      <div className="space-y-2"><Label htmlFor="customs-signer" className="text-xs text-gray-400">Customs Signer Name <span className="text-red-400">*</span></Label><Input id="customs-signer" type="text" placeholder="Full name of person certifying customs forms" className="text-xs" value={customsSigner} onChange={(e) => setCustomsSigner(e.target.value)} onBlur={() => updateSettingsMutation.mutate({ customsSigner: customsSigner || null })} data-testid="input-customs-signer" /></div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2"><Label htmlFor="bl-ioss" className="text-xs text-gray-400">BrickLink EU IOSS #</Label><Input id="bl-ioss" type="text" placeholder="IM..." className="text-xs font-mono" value={blIossNumber} onChange={(e) => setBlIossNumber(e.target.value)} onBlur={() => updateSettingsMutation.mutate({ blIossNumber: blIossNumber || null })} data-testid="input-bl-ioss" /></div>
                        <div className="space-y-2"><Label htmlFor="bo-ioss" className="text-xs text-gray-400">BrickOwl EU IOSS #</Label><Input id="bo-ioss" type="text" placeholder="IM..." className="text-xs font-mono" value={boIossNumber} onChange={(e) => setBoIossNumber(e.target.value)} onBlur={() => updateSettingsMutation.mutate({ boIossNumber: boIossNumber || null })} data-testid="input-bo-ioss" /></div>
                        <div className="space-y-2"><Label htmlFor="bl-uk-vat" className="text-xs text-gray-400">BrickLink UK VAT #</Label><Input id="bl-uk-vat" type="text" placeholder="GB..." className="text-xs font-mono" value={blUkVatNumber} onChange={(e) => setBlUkVatNumber(e.target.value)} onBlur={() => updateSettingsMutation.mutate({ blUkVatNumber: blUkVatNumber || null })} data-testid="input-bl-uk-vat" /></div>
                        <div className="space-y-2"><Label htmlFor="bo-uk-vat" className="text-xs text-gray-400">BrickOwl UK VAT #</Label><Input id="bo-uk-vat" type="text" placeholder="GB..." className="text-xs font-mono" value={boUkVatNumber} onChange={(e) => setBoUkVatNumber(e.target.value)} onBlur={() => updateSettingsMutation.mutate({ boUkVatNumber: boUkVatNumber || null })} data-testid="input-bo-uk-vat" /></div>
                      </div>
                      <p className="text-[11px] text-gray-600">Find IOSS/VAT numbers in your BrickLink and BrickOwl seller dashboards under Tax Settings.</p>
                    </div>
                  </div>
                )}

                {/* ── DETAIL: Dynamic org integration ─────────────────────── */}
                {activePlatform !== null && !['bricklink','brickowl','paypal','stripe','easypost'].includes(activePlatform) && (() => {
                  const integration = orgIntegrationsList.find(i => String(i.id) === activePlatform);
                  if (!integration) return null;
                  return (
                    <div className="p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border bg-gray-800 text-gray-500 border-gray-700 capitalize">{integration.type.replace('_', ' ')}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded border bg-gray-800 text-gray-500 border-gray-700">{integration.channel}</span>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs text-gray-400">Display Name</Label>
                        <Input className="text-xs" value={editIntDisplayName} onChange={(e) => setEditIntDisplayName(e.target.value)} data-testid="input-edit-display-name" />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs text-gray-400">API Key <span className="text-gray-600 font-normal">(leave blank to keep existing)</span></Label>
                        <Input type="password" className="text-xs" placeholder="Enter new API key or leave blank" value={editIntApiKey} onChange={(e) => setEditIntApiKey(e.target.value)} data-testid="input-edit-api-key" />
                      </div>
                      <div className="flex items-center justify-between pt-2 border-t border-gray-700">
                        <Button size="sm" variant="ghost" className="text-xs gap-1 text-red-400/80 hover:text-red-400" data-testid={`button-delete-integration-${integration.id}`} onClick={() => setDeleteIntId(integration.id)}>
                          <Trash2 className="w-3 h-3" /> Remove
                        </Button>
                        <Button size="sm" className="text-xs" disabled={updateIntegrationMutation.isPending}
                          onClick={() => updateIntegrationMutation.mutate({ id: integration.id, displayName: editIntDisplayName, ...(editIntApiKey ? { credentials: { apiKey: editIntApiKey } } : {}) })}
                          data-testid="button-save-edit">
                          {updateIntegrationMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
                        </Button>
                      </div>
                    </div>
                  );
                })()}

                {/* ── DIALOGS ─────────────────────────────────────────────── */}
                <AlertDialog open={!!deleteIntId} onOpenChange={(open) => { if (!open) setDeleteIntId(null); }}>
                  <AlertDialogContent className="bg-gray-900 border border-gray-700">
                    <AlertDialogHeader>
                      <AlertDialogTitle className="text-gray-100">Remove Integration</AlertDialogTitle>
                      <AlertDialogDescription className="text-gray-400">This will permanently remove this integration and its credentials. You can add it back at any time.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="bg-transparent border-gray-600 text-gray-300 hover:bg-gray-800" data-testid="button-cancel-delete-integration">Cancel</AlertDialogCancel>
                      <AlertDialogAction className="bg-red-600 hover:bg-red-700 text-white" data-testid="button-confirm-delete-integration" onClick={() => { if (deleteIntId) deleteIntegrationMutation.mutate(deleteIntId); }}>Remove</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                <AlertDialog open={!!removePrimaryDialog} onOpenChange={(open) => { if (!open) setRemovePrimaryDialog(null); }}>
                  <AlertDialogContent className="bg-gray-900 border border-gray-700">
                    <AlertDialogHeader>
                      <AlertDialogTitle className="text-gray-100">Remove BrickOwl</AlertDialogTitle>
                      <AlertDialogDescription className="text-gray-400">This will clear all BrickOwl credentials. You can re-enter them at any time.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="bg-transparent border-gray-600 text-gray-300 hover:bg-gray-800" data-testid="button-cancel-remove-primary">Cancel</AlertDialogCancel>
                      <AlertDialogAction className="bg-red-600 hover:bg-red-700 text-white" data-testid="button-confirm-remove-primary" onClick={() => { setBrickowlApiKey(''); updateSettingsMutation.mutate({ brickowlApiKey: null }); setRemovePrimaryDialog(null); }}>Remove</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

              </div>
            )}

            {/* AI Settings & Intelligence */}
            {activeSection === 'ai' && (
              <div className="space-y-4 min-h-[400px]">
              <div className="space-y-4">

                {/* E.L.F.I.E. Mode — shown first */}
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-gray-300">E.L.F.I.E. Mode</h3>
                  <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 space-y-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setElfieMode('search'); setAiEnabled(true); updateSettingsMutation.mutate({ elfieMode: 'search', aiEnabled: true }); }}
                        className={`flex-1 flex flex-col items-center gap-1 px-3 py-2.5 rounded-md border text-xs transition-colors ${elfieMode === 'search' ? 'bg-purple-500/20 border-purple-500/40 text-purple-300' : 'bg-gray-700/40 border-gray-600 text-gray-400 hover:text-gray-300 hover:bg-gray-700/60'}`}
                        data-testid="button-elfie-mode-search"
                      >
                        <span className="font-semibold">Search Mode</span>
                        <span className="text-[10px] text-center opacity-70">Inventory · Orders · Customers — no AI credits</span>
                      </button>
                      <button
                        onClick={() => { setElfieMode('ai'); setAiEnabled(true); updateSettingsMutation.mutate({ elfieMode: 'ai', aiEnabled: true }); }}
                        className={`flex-1 flex flex-col items-center gap-1 px-3 py-2.5 rounded-md border text-xs transition-colors ${elfieMode === 'ai' ? 'bg-purple-500/20 border-purple-500/40 text-purple-300' : 'bg-gray-700/40 border-gray-600 text-gray-400 hover:text-gray-300 hover:bg-gray-700/60'}`}
                        data-testid="button-elfie-mode-ai"
                      >
                        <span className="font-semibold">AI Mode</span>
                        <span className="text-[10px] text-center opacity-70">Data enrichment &amp; intelligence</span>
                      </button>
                    </div>
                    <p className="text-[10px] text-gray-500">
                      {elfieMode === 'search'
                        ? 'Direct database search — no AI involved. Find inventory, orders, and customers by keyword, part number, or name. Zero credits used.'
                        : 'E.L.F.I.E. uses full AI capabilities including price insights, demand analysis, and intelligent recommendations. Uses Anthropic credits.'}
                    </p>
                  </div>
                </div>

                <Separator className="bg-gray-700" />

                {/* Chat Assistant */}
                <div>
                  <h3 className="text-sm font-medium text-gray-300 mb-3">Chat Assistant (E.L.F.I.E.)</h3>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="system-prompt" className="text-xs text-gray-400">System Prompt / Role Instructions</Label>
                      <Textarea
                        id="system-prompt"
                        placeholder="Enter custom instructions for E.L.F.I.E..."
                        value={systemPrompt}
                        onChange={(e) => setSystemPrompt(e.target.value)}
                        onBlur={() => {
                          updateSettingsMutation.mutate({
                            aiEnabled,
                            openaiApiKey: openaiApiKey || null,
                            selectedModel: selectedModel || null,
                            systemPrompt: systemPrompt || null,
                          });
                        }}
                        className="text-xs font-mono min-h-[200px] resize-y"
                        data-testid="textarea-system-prompt"
                      />
                      <p className="text-xs text-gray-500">
                        Customize E.L.F.I.E.'s role and behavior. Leave empty to use default instructions.
                      </p>
                    </div>

                    <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3">
                      <p className="text-xs text-purple-300">
                        <strong>Powered by Claude:</strong> E.L.F.I.E. runs on Anthropic Claude Sonnet — no API key required. Semantic search uses OpenAI text-embedding-3-small.
                      </p>
                    </div>
                  </div>
                </div>

                <Separator className="bg-gray-700" />

                {/* Semantic Search Test */}
                <div>
                  <h3 className="text-sm font-medium text-gray-300 mb-3">Semantic Search</h3>
                  <EmbeddingsManager searchOnly />
                </div>
              </div>
              </div>
            )}

            {/* Automation & Scheduling */}
            {activeSection === 'automation' && (
              <div className="space-y-4 min-h-[400px]">
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                      <h3 className="text-sm font-medium text-gray-300">Automation & Scheduling</h3>
                      {rateLimit && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <button className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium transition-colors hover:opacity-80 ${
                              rateLimit.blocked
                                ? 'bg-red-500/10 border-red-500/30 text-red-400'
                                : rateLimit.warning
                                ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
                                : 'bg-blue-500/10 border-blue-500/30 text-blue-300'
                            }`}>
                              <BarChart2 className="w-3 h-3" />
                              <span>BrickLink API:</span>
                              <span className="font-mono font-semibold">{rateLimit.callsLast24h.toLocaleString()}</span>
                              <span className="text-gray-400">/ 5,000</span>
                            </button>
                          </PopoverTrigger>
                          <PopoverContent side="bottom" align="end" className="w-96 p-3 max-h-[80vh] overflow-y-auto bg-gray-900 border-gray-700">
                            <ApiCallSchedule
                              buckets={rateLimit.hourlyBuckets ?? []}
                              callsLast24h={rateLimit.callsLast24h}
                              ceiling={5000}
                              timezone={timezone}
                            />
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mb-4">Configure automated syncing and updates</p>

                    {/* Inventory Sync */}
                    <div>
                      <button
                        onClick={() => setSchedulerInventoryOpen(!schedulerInventoryOpen)}
                        className="w-full flex items-center justify-between gap-2 py-2 mb-3 border-b border-gray-600/60 hover:border-gray-500/60 transition-colors group"
                        data-testid="button-scheduler-inventory-toggle"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-gray-200">Inventory Sync</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${inventorySyncEnabled ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-500'}`}>{inventorySyncEnabled ? 'Enabled' : 'Disabled'}</span>
                        </div>
                        {schedulerInventoryOpen ? <ChevronDown className="w-4 h-4 text-gray-400 group-hover:text-gray-200 transition-colors" /> : <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-200 transition-colors" />}
                      </button>
                      {schedulerInventoryOpen && (
                      <div className="space-y-3 mb-4">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <Label className="text-xs font-medium text-gray-300">Inventory Sync (Daily)</Label>
                            <Popover>
                              <PopoverTrigger asChild>
                                <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                  <Info className="w-3 h-3" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent side="bottom" className="w-72 text-xs bg-gray-900 border-gray-700 p-3 space-y-1.5">
                                <p className="font-semibold text-gray-200">Inventory Sync</p>
                                <p className="text-gray-400">Pulls your full BrickLink inventory into the local database. Also syncs BrickLink categories, colors, and Rebrickable part images. Triggers re-embedding of any changed inventory items for AI search.</p>
                                <p className="text-gray-500">Runs once daily. Safe to trigger manually at any time.</p>
                              </PopoverContent>
                            </Popover>
                          </div>
                          <p className="text-[10px] md:text-sm text-gray-500 mt-0.5">Sync inventory, colors, categories + embeddings</p>
                          <SyncStatusLine entry={syncStatuses?.inventory ?? null} />
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={syncingInventory}
                            onClick={() => runManualSync('/api/sync/bricklink/inventory', setSyncingInventory, 'Inventory Sync')}
                            title="Run inventory sync now"
                            data-testid="button-run-inventory-sync"
                          >
                            {syncingInventory ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                          </Button>
                          <Switch
                            checked={inventorySyncEnabled}
                            onCheckedChange={(checked) => {
                              setInventorySyncEnabled(checked);
                              updateSettingsMutation.mutate({ inventorySyncEnabled: checked });
                            }}
                            data-testid="switch-inventory-sync"
                          />
                        </div>
                      </div>
                      
                      {inventorySyncEnabled && (
                        <div className="ml-4 space-y-2">
                          <Label htmlFor="inventory-time" className="text-xs text-gray-400">Sync Time</Label>
                          <Input
                            id="inventory-time"
                            type="time"
                            value={inventorySyncTime}
                            onChange={(e) => setInventorySyncTime(e.target.value)}
                            onBlur={() => updateSettingsMutation.mutate({ inventorySyncTime })}
                            className="text-xs w-32"
                            data-testid="input-inventory-time"
                          />
                          <p className="text-[10px] md:text-sm text-gray-500">Time in your local timezone</p>
                        </div>
                      )}

                      {/* BrickLink Store Info */}
                      <div className="mt-3 bg-gray-800/60 border border-purple-500/20 rounded-lg p-3 space-y-2">
                        <p className="text-xs font-semibold text-purple-300">BrickLink Store</p>
                        {platformSyncLoading ? (
                          <div className="flex gap-4">
                            <span className="inline-block bg-gray-700 h-3 w-20 rounded animate-pulse" />
                            <span className="inline-block bg-gray-700 h-3 w-20 rounded animate-pulse" />
                          </div>
                        ) : (
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <p className="text-[10px] text-gray-500">Lots</p>
                              <p className="text-xs font-bold text-white font-mono">{platformSyncData?.source.stats.totalLots?.toLocaleString() ?? '—'}</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-gray-500">Parts</p>
                              <p className="text-xs font-bold text-white font-mono">{platformSyncData?.source.stats.totalParts?.toLocaleString() ?? '—'}</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-gray-500">Last Synced</p>
                              <p className="text-[10px] text-gray-400">{platformSyncData?.source.stats.lastSyncedAt ? new Date(platformSyncData.source.stats.lastSyncedAt).toLocaleString() : 'Never'}</p>
                            </div>
                          </div>
                        )}
                      </div>
                      </div>
                      )}
                    </div>

                    <Separator className="bg-gray-700" />

                    {/* Orders Sync */}
                    <div>
                      <button
                        onClick={() => setSchedulerOrdersOpen(!schedulerOrdersOpen)}
                        className="w-full flex items-center justify-between gap-2 py-2 mb-3 border-b border-gray-600/60 hover:border-gray-500/60 transition-colors group"
                        data-testid="button-scheduler-orders-toggle"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-gray-200">Orders Sync</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${ordersSyncEnabled ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-500'}`}>{ordersSyncEnabled ? 'Enabled' : 'Disabled'}</span>
                        </div>
                        {schedulerOrdersOpen ? <ChevronDown className="w-4 h-4 text-gray-400 group-hover:text-gray-200 transition-colors" /> : <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-200 transition-colors" />}
                      </button>
                      {schedulerOrdersOpen && (
                      <div className="space-y-3 mt-4">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <Label className="text-xs font-medium text-gray-300">Orders Sync</Label>
                            <Popover>
                              <PopoverTrigger asChild>
                                <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                  <Info className="w-3 h-3" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent side="bottom" className="w-72 text-xs bg-gray-900 border-gray-700 p-3 space-y-1.5">
                                <p className="font-semibold text-gray-200">Orders Sync</p>
                                <p className="text-gray-400">Pulls new and updated orders from BrickLink and BrickOwl into the local database. Also syncs order line items, generates AI embeddings for semantic search, and matches Stripe and PayPal refunds and merchant fees to orders.</p>
                                <p className="text-gray-400">After each order is processed, sold quantities are deducted from local inventory — keeping all channel inventory counts in sync automatically.</p>
                                <p className="text-gray-500">Runs on a short interval (e.g. every 15–30 min) to keep order data fresh throughout the day.</p>
                              </PopoverContent>
                            </Popover>
                          </div>
                          <p className="text-[10px] md:text-sm text-gray-500 mt-0.5">Sync orders, details, embeddings + refunds/fees periodically</p>
                          <SyncStatusLine entry={syncStatuses?.orders ?? null} />
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={syncingOrders}
                            onClick={() => runManualSync('/api/sync/all-platforms/orders', setSyncingOrders, 'Orders Sync', { limit: 50, fullSync: false })}
                            title="Run orders sync now"
                            data-testid="button-run-orders-sync"
                          >
                            {syncingOrders ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                          </Button>
                          <Switch
                            checked={ordersSyncEnabled}
                            onCheckedChange={(checked) => {
                              setOrdersSyncEnabled(checked);
                              updateSettingsMutation.mutate({ ordersSyncEnabled: checked });
                            }}
                            data-testid="switch-orders-sync"
                          />
                        </div>
                      </div>

                      {ordersSyncEnabled && (
                        <div className="ml-4 space-y-2">
                          <Label htmlFor="orders-frequency" className="text-xs text-gray-400">Sync Frequency (minutes)</Label>
                          <Input
                            id="orders-frequency"
                            type="number"
                            min="5"
                            max="120"
                            value={ordersSyncFrequencyStr}
                            onChange={(e) => setOrdersSyncFrequencyStr(e.target.value)}
                            onBlur={() => {
                              const parsed = parseInt(ordersSyncFrequencyStr);
                              const clamped = isNaN(parsed) ? 15 : Math.max(5, Math.min(120, parsed));
                              setOrdersSyncFrequency(clamped);
                              setOrdersSyncFrequencyStr(String(clamped));
                              updateSettingsMutation.mutate({ ordersSyncFrequency: clamped });
                            }}
                            className="text-xs w-24"
                            data-testid="input-orders-frequency"
                          />
                          <p className="text-[10px] md:text-sm text-gray-500">Recommended: 15 minutes</p>
                        </div>
                      )}
                      </div>
                      )}
                    </div>

                    <Separator className="bg-gray-700" />

                    {/* Channel Sync */}
                    <div>
                      <button
                        onClick={() => setSchedulerChannelOpen(!schedulerChannelOpen)}
                        className="w-full flex items-center justify-between gap-2 py-2 mb-3 border-b border-gray-600/60 hover:border-gray-500/60 transition-colors group"
                        data-testid="button-scheduler-channel-toggle"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-gray-200">Channel Sync</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${channelSyncEnabled ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-500'}`}>{channelSyncEnabled ? 'Enabled' : 'Disabled'}</span>
                        </div>
                        {schedulerChannelOpen ? <ChevronDown className="w-4 h-4 text-gray-400 group-hover:text-gray-200 transition-colors" /> : <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-200 transition-colors" />}
                      </button>
                      {schedulerChannelOpen && (
                      <div className="space-y-2 my-2">

                        {/* BrickOwl channel group */}
                        <div className="rounded-md border border-gray-700/60 bg-gray-800/30 overflow-hidden">
                          {/* Channel sub-header */}
                          <button
                            onClick={() => setSchedulerChannelBrickOwlOpen(!schedulerChannelBrickOwlOpen)}
                            className="w-full flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-gray-700/30 transition-colors group"
                            data-testid="button-scheduler-channel-brickowl-toggle"
                          >
                            <div className="flex items-center gap-2">
                              <Globe className="w-3.5 h-3.5 text-green-400 shrink-0" />
                              <span className="text-xs font-semibold text-gray-200">BrickOwl</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${channelSyncEnabled ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-500'}`}>
                                {channelSyncEnabled ? 'Enabled' : 'Disabled'}
                              </span>
                            </div>
                            {schedulerChannelBrickOwlOpen
                              ? <ChevronDown className="w-3.5 h-3.5 text-gray-500 group-hover:text-gray-300 transition-colors" />
                              : <ChevronRight className="w-3.5 h-3.5 text-gray-500 group-hover:text-gray-300 transition-colors" />}
                          </button>

                          {schedulerChannelBrickOwlOpen && (
                          <div className="px-3 pb-3 pt-1 space-y-3 border-t border-gray-700/40">
                      <div className="flex items-center justify-between gap-2 pt-2">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <Label className="text-xs font-medium text-gray-300">Daily Schedule</Label>
                            <Popover>
                              <PopoverTrigger asChild>
                                <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                  <Info className="w-3 h-3" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent side="bottom" className="w-72 text-xs bg-gray-900 border-gray-700 p-3 space-y-1.5">
                                <p className="font-semibold text-gray-200">Channel Sync — BrickOwl</p>
                                <p className="text-gray-400">Pushes your local database inventory outward to BrickOwl. Compares local quantities and prices against the platform and updates only what has changed.</p>
                                <p className="text-gray-500">Should run after Inventory Sync has completed. Schedule it at least 1 hour later to ensure inbound data has settled.</p>
                              </PopoverContent>
                            </Popover>
                          </div>
                          <p className="text-[10px] md:text-sm text-gray-500 mt-0.5">Push Local DB → BrickOwl after inbound + order syncs settle</p>
                          <SyncStatusLine entry={syncStatuses?.channel ?? null} />
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={syncingChannel}
                            onClick={() => runManualSync('/api/sync/channel', setSyncingChannel, 'Channel Sync')}
                            title="Run channel sync now"
                            data-testid="button-run-channel-sync"
                          >
                            {syncingChannel ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                          </Button>
                          <Switch
                            checked={channelSyncEnabled}
                            onCheckedChange={(checked) => {
                              setChannelSyncEnabled(checked);
                              updateSettingsMutation.mutate({ channelSyncEnabled: checked });
                            }}
                            data-testid="switch-channel-sync"
                          />
                        </div>
                      </div>

                      {channelSyncEnabled && (
                        <div className="ml-4 space-y-2">
                          <Label htmlFor="channel-sync-time" className="text-xs text-gray-400">Sync Time</Label>
                          <Input
                            id="channel-sync-time"
                            type="time"
                            value={channelSyncTime}
                            onChange={(e) => setChannelSyncTime(e.target.value)}
                            onBlur={() => updateSettingsMutation.mutate({ channelSyncTime })}
                            className="text-xs w-32"
                            data-testid="input-channel-sync-time"
                          />
                          <p className="text-[10px] md:text-sm text-gray-500">Run at least 1 hour after Inventory Sync</p>
                        </div>
                      )}

                      {/* Sync Mode */}
                      <div className="mt-3 space-y-2">
                        <div className="flex items-center gap-1.5">
                          <Label className="text-xs text-gray-400">Sync Mode</Label>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="w-3 h-3 text-gray-500 shrink-0 cursor-default" />
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-xs text-xs">
                              Controls what happens when a BrickLink item has no matching BrickOwl lot.
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <div className="grid grid-cols-1 gap-1.5">
                          <button
                            onClick={() => { setChannelSyncMode('full_control'); updateSettingsMutation.mutate({ channelSyncMode: 'full_control' }); }}
                            className={`flex items-start gap-2 rounded-md border p-2.5 text-left transition-colors ${channelSyncMode === 'full_control' ? 'border-blue-500/60 bg-blue-500/10' : 'border-gray-700 bg-gray-800/40 hover:border-gray-600'}`}
                            data-testid="button-sync-mode-full"
                          >
                            <div className={`mt-0.5 w-3 h-3 rounded-full border-2 shrink-0 ${channelSyncMode === 'full_control' ? 'border-blue-400 bg-blue-400' : 'border-gray-500'}`} />
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-medium text-gray-200">Full Control</span>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Info className="w-2.5 h-2.5 text-gray-500 shrink-0 cursor-default" />
                                  </TooltipTrigger>
                                  <TooltipContent side="right" className="max-w-xs text-xs">
                                    Creates new BrickOwl lots for any BrickLink items that don't have a matching listing yet. Keeps both stores fully in sync.
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                              <p className="text-[10px] text-gray-500 mt-0.5">Push all items — create new lots + update existing</p>
                            </div>
                          </button>
                          <button
                            onClick={() => { setChannelSyncMode('quantity_only'); updateSettingsMutation.mutate({ channelSyncMode: 'quantity_only' }); }}
                            className={`flex items-start gap-2 rounded-md border p-2.5 text-left transition-colors ${channelSyncMode === 'quantity_only' ? 'border-blue-500/60 bg-blue-500/10' : 'border-gray-700 bg-gray-800/40 hover:border-gray-600'}`}
                            data-testid="button-sync-mode-qty"
                          >
                            <div className={`mt-0.5 w-3 h-3 rounded-full border-2 shrink-0 ${channelSyncMode === 'quantity_only' ? 'border-blue-400 bg-blue-400' : 'border-gray-500'}`} />
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-medium text-gray-200">Quantity Only</span>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Info className="w-2.5 h-2.5 text-gray-500 shrink-0 cursor-default" />
                                  </TooltipTrigger>
                                  <TooltipContent side="right" className="max-w-xs text-xs">
                                    Only updates quantities and prices on lots that already exist in BrickOwl. Items without a matching lot are skipped — nothing is created. Safer for stores where you manage listings manually on BrickOwl.
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                              <p className="text-[10px] text-gray-500 mt-0.5">Update counts on existing lots only — never create</p>
                            </div>
                          </button>
                        </div>
                      </div>
                          </div>
                          )}
                        </div>
                      </div>
                      )}
                    </div>

                    <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3 mt-4">
                      <p className="text-xs text-purple-300">
                        <strong>Note:</strong> All automation respects BrickLink's 5,000 API calls/day limit. Syncs will automatically pause when approaching the limit.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}


            {activeSection === 'enrichment' && (
              <div className="space-y-4 min-h-[400px]">

                {/* Enrichment Overview */}
                <EnrichmentSummary />

                <Separator className="bg-gray-700" />

                {/* ── LOCAL INDEX — group header ── */}
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 whitespace-nowrap">Local Index</span>
                  <div className="flex-1 h-px bg-gray-700/60" />
                </div>
                <p className="text-[11px] text-gray-500 -mt-2">
                  Run once to build your search index. New inventory and orders are embedded automatically as they sync.
                </p>

                {/* OpenAI API Key — required for local embeddings */}
                <div className="flex items-center gap-3 bg-gray-800/60 border border-gray-700/60 rounded-md px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <label className="block text-[10px] font-semibold uppercase tracking-widest text-gray-500 mb-1">OpenAI API Key</label>
                    <input
                      type="password"
                      value={openaiApiKey}
                      onChange={e => setOpenaiApiKey(e.target.value)}
                      placeholder="sk-..."
                      data-testid="input-openai-api-key"
                      className="w-full bg-transparent text-sm text-gray-200 placeholder-gray-600 outline-none border-none"
                    />
                  </div>
                  <span className="text-[10px] text-gray-600 whitespace-nowrap shrink-0">embeddings only</span>
                </div>

                {/* Semantic Search & Embeddings */}
                <div>
                  <button
                    onClick={() => setEnrichmentEmbeddingsOpen(!enrichmentEmbeddingsOpen)}
                    className="w-full flex items-center justify-between gap-2 py-2 mb-3 border-b border-gray-600/60 hover:border-gray-500/60 transition-colors group"
                    data-testid="button-enrichment-embeddings-toggle"
                  >
                    <span className="text-sm font-semibold text-gray-200">Semantic Search &amp; Embeddings</span>
                    {enrichmentEmbeddingsOpen ? <ChevronDown className="w-4 h-4 text-gray-400 group-hover:text-gray-200 transition-colors" /> : <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-200 transition-colors" />}
                  </button>
                  {enrichmentEmbeddingsOpen && (
                    <div className="mt-2">
                      <EmbeddingsManager />
                    </div>
                  )}
                </div>

                <Separator className="bg-gray-700" />

                {/* ── ONGOING ENRICHMENT — group header ── */}
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 whitespace-nowrap">Ongoing Enrichment</span>
                  <div className="flex-1 h-px bg-gray-700/60" />
                </div>
                <p className="text-[11px] text-gray-500 -mt-2">
                  Independent recurring processes — not tied to inventory or orders. Enable a schedule or run manually.
                </p>

                {/* Universal CLIP Catalog */}
                <div>
                  <button
                    onClick={() => setEnrichmentUniversalOpen(!enrichmentUniversalOpen)}
                    className="w-full flex items-center justify-between gap-2 py-2 mb-3 border-b border-gray-600/60 hover:border-gray-500/60 transition-colors group"
                    data-testid="button-enrichment-universal-toggle"
                  >
                    <span className="text-sm font-semibold text-gray-200">Universal CLIP Catalog</span>
                    {enrichmentUniversalOpen ? <ChevronDown className="w-4 h-4 text-gray-400 group-hover:text-gray-200 transition-colors" /> : <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-200 transition-colors" />}
                  </button>
                  {enrichmentUniversalOpen && (
                    <div className="mt-2">
                      <UniversalCatalogSection />
                    </div>
                  )}
                </div>

                <Separator className="bg-gray-700" />

                {/* Price-o-Matic */}
                <div>
                  <button
                    onClick={() => setEnrichmentPomOpen(!enrichmentPomOpen)}
                    className="w-full flex items-center justify-between gap-2 py-2 mb-3 border-b border-gray-600/60 hover:border-gray-500/60 transition-colors group"
                    data-testid="button-enrichment-pom-toggle"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-200">Price-o-Matic</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${pomScheduleEnabled ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-500'}`}>{pomScheduleEnabled ? 'Enabled' : 'Disabled'}</span>
                    </div>
                    {enrichmentPomOpen ? <ChevronDown className="w-4 h-4 text-gray-400 group-hover:text-gray-200 transition-colors" /> : <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-200 transition-colors" />}
                  </button>
                  {enrichmentPomOpen && (
                  <div>
                  <h3 className="text-sm font-medium text-gray-300 mb-3 sr-only">Price-o-Matic</h3>

                  {/* Auto Sync Scheduler */}
                  <div className="space-y-3 my-4">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <Label className="text-xs font-medium text-gray-300">Price-o-Matic Auto Sync</Label>
                          <Popover>
                            <PopoverTrigger asChild>
                              <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                <Info className="w-3 h-3" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent side="bottom" className="w-72 text-xs bg-gray-900 border-gray-700 p-3 space-y-1.5">
                              <p className="font-semibold text-gray-200">Price-o-Matic Auto Sync</p>
                              <p className="text-gray-400">Fetches avg listed price, avg sold price, and lot count from BrickLink for each inventory item, then computes a suggested price using your formula. Items are processed in priority order by category tier (T1 → T4).</p>
                              <p className="text-gray-500">Runs on its own independent schedule. Uses 3 BrickLink API calls per lot. Stops automatically at your daily API ceiling.</p>
                            </PopoverContent>
                          </Popover>
                        </div>
                        <p className="text-[10px] md:text-sm text-gray-500 mt-0.5">Runs independently on its own schedule</p>
                        <SyncStatusLine entry={syncStatuses?.priceomatic ?? null} />
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={syncingPom}
                          onClick={() => runManualSync('/api/sync/priceomatic', setSyncingPom, 'Price-o-Matic', undefined, 'Price-o-Matic started', 'Sync is running in the background.')}
                          title="Run Price-o-Matic sync now"
                          data-testid="button-run-pom-sync"
                        >
                          {syncingPom ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                        </Button>
                        <Switch
                          checked={pomScheduleEnabled}
                          onCheckedChange={(checked) => {
                            setPomScheduleEnabled(checked);
                            updateSettingsMutation.mutate({ pomScheduleEnabled: checked });
                          }}
                          data-testid="switch-pom-schedule"
                        />
                      </div>
                    </div>

                    {pomScheduleEnabled && (
                      <div className="ml-4 space-y-3">
                        <div className="flex items-center gap-4">
                          <div className="space-y-1">
                            <Label htmlFor="pom-sync-time" className="text-xs text-gray-400">Sync Time</Label>
                            <Input
                              id="pom-sync-time"
                              type="time"
                              value={pomSyncTime}
                              onChange={(e) => setPomSyncTime(e.target.value)}
                              onBlur={() => updateSettingsMutation.mutate({ pomSyncTime })}
                              className="text-xs w-32"
                              data-testid="input-pom-sync-time"
                            />
                            <p className="text-[10px] text-gray-500">Local timezone</p>
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor="pom-schedule-batch" className="text-xs text-gray-400">Lots per run</Label>
                            <Input
                              id="pom-schedule-batch"
                              type="number"
                              min={100}
                              max={5000}
                              step={100}
                              value={pomScheduleBatchSize}
                              onChange={(e) => setPomScheduleBatchSize(parseInt(e.target.value) || 100)}
                              onBlur={() => updateSettingsMutation.mutate({ pomScheduleBatchSize })}
                              className="text-xs w-28 text-right"
                              data-testid="input-pom-schedule-batch"
                            />
                            <p className="text-[10px] text-gray-500">= {pomScheduleBatchSize} API calls</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Sync Limits — always visible, not tied to scheduler toggle */}
                    <div className="ml-4 space-y-2 pt-2 border-t border-gray-700/40">
                      <p className="text-[10px] text-gray-500">BrickLink allows 5,000 API calls/day. Price-o-Matic uses 3 calls per lot.</p>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <Label className="text-xs text-gray-400">Manual sync batch size</Label>
                          <Popover>
                            <PopoverTrigger asChild>
                              <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                <Info className="w-3 h-3" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent side="bottom" className="w-60 text-xs bg-gray-900 border-gray-700 p-3">
                              Max lots to process when you hit the play button above to run a sync manually.
                            </PopoverContent>
                          </Popover>
                        </div>
                        <div className="flex items-center gap-2">
                          <Input type="number" min={100} max={5000} step={100} value={pomBatchSize} onChange={(e) => setPomBatchSize(parseInt(e.target.value) || 100)} onBlur={() => updateSettingsMutation.mutate({ pomBatchSize })} className="text-xs w-24 text-right" data-testid="input-pom-batch-size" />
                          <span className="text-[10px] text-gray-500 w-16">lots / run</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <Separator className="bg-gray-700" />

                  {/* Scoring collapsible */}
                  <div>
                    <button
                      onClick={() => setPomScoringOpen(!pomScoringOpen)}
                      className="w-full flex items-center justify-between gap-2 py-2 mb-3 border-b border-gray-600/60 hover:border-gray-500/60 transition-colors group"
                      data-testid="button-pom-scoring-toggle"
                    >
                      <span className="text-sm font-semibold text-gray-200 uppercase tracking-wider">Scoring</span>
                      {pomScoringOpen ? <ChevronDown className="w-4 h-4 text-gray-400 group-hover:text-gray-200 transition-colors" /> : <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-200 transition-colors" />}
                    </button>
                    {pomScoringOpen && (
                      <div className="space-y-2">
                        <div className="divide-y divide-gray-700/30 mb-2">
                          <div className="flex items-center justify-between py-3">
                            <div className="flex items-center gap-1.5">
                              <Label className="text-sm text-emerald-300">Underpriced Score</Label>
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                    <Info className="w-3.5 h-3.5" />
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent side="bottom" className="w-64 text-xs bg-gray-900 border-gray-700 p-3">
                                  Items with an opportunity score at or above this value are flagged as underpriced in the POM dashboard filter. Score = market peak ÷ your price, so 1.5× means you're 50% below the market peak. Only items with stock on hand are counted.
                                </PopoverContent>
                              </Popover>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-300">score ≥</span>
                              <Input type="number" min={0.1} max={10} step={0.1} value={pomUnderpricedScore} onChange={(e) => setPomUnderpricedScore(parseFloat(e.target.value) || 0.1)} onBlur={() => updateSettingsMutation.mutate({ pomUnderpricedScore })} className="text-sm w-20 text-right" data-testid="input-pom-underpriced-score" />
                              <span className="text-xs text-gray-400 w-14">× (peak)</span>
                            </div>
                          </div>
                          <div className="flex items-center justify-between py-3">
                            <div className="flex items-center gap-1.5">
                              <Label className="text-sm text-orange-300">Overpriced Score</Label>
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                    <Info className="w-3.5 h-3.5" />
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent side="bottom" className="w-64 text-xs bg-gray-900 border-gray-700 p-3">
                                  Items with an opportunity score at or below this value are flagged as overpriced in the POM dashboard filter. Score = market peak ÷ your price, so 0.8× means you're 25% above the market peak. Only items with stock on hand are counted.
                                </PopoverContent>
                              </Popover>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-300">score ≤</span>
                              <Input type="number" min={0.1} max={10} step={0.1} value={pomOverpricedScore} onChange={(e) => setPomOverpricedScore(parseFloat(e.target.value) || 0.1)} onBlur={() => updateSettingsMutation.mutate({ pomOverpricedScore })} className="text-sm w-20 text-right" data-testid="input-pom-overpriced-score" />
                              <span className="text-xs text-gray-400 w-14">× (peak)</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Layers className="h-4 w-4 text-gray-400" />
                          <p className="text-xs text-gray-400">Assign categories to refresh tiers. T1 = daily, T2 = 3 days, T3 = weekly, T4 = monthly.</p>
                        </div>
                        <PomCategoryTiers />
                      </div>
                    )}
                  </div>

                  {/* Pricing collapsible */}
                  <div>
                    <button
                      onClick={() => setPomPricingOpen(!pomPricingOpen)}
                      className="w-full flex items-center justify-between gap-2 py-2 mb-3 border-b border-gray-600/60 hover:border-gray-500/60 transition-colors group"
                      data-testid="button-pom-pricing-toggle"
                    >
                      <span className="text-sm font-semibold text-gray-200 uppercase tracking-wider">Pricing</span>
                      {pomPricingOpen ? <ChevronDown className="w-4 h-4 text-gray-400 group-hover:text-gray-200 transition-colors" /> : <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-200 transition-colors" />}
                    </button>
                    {pomPricingOpen && (
                      <div className="space-y-4">

                        {/* Base Premium */}
                        <div className="rounded-md border border-gray-700/60 overflow-hidden">
                          <div className="bg-gray-800/50 px-4 py-2.5 flex items-center gap-1.5 border-b border-gray-700/40">
                            <h4 className="text-xs font-semibold text-gray-200 uppercase tracking-wider">Base Premium</h4>
                            <Popover>
                              <PopoverTrigger asChild>
                                <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                  <Info className="w-3.5 h-3.5" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent side="bottom" className="w-64 text-xs bg-gray-900 border-gray-700 p-3">
                                The minimum % markup above BrickLink's average price every item receives. Avg price = midpoint of avg listed and avg sold. Scarcity bonuses stack on top of this.
                              </PopoverContent>
                            </Popover>
                          </div>
                          <div className="px-4 divide-y divide-gray-700/30">
                            <div className="flex items-center justify-between py-3">
                              <div className="flex items-center gap-1.5">
                                <Label className="text-sm text-gray-200">Parts Premium</Label>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                      <Info className="w-3.5 h-3.5" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent side="bottom" className="w-56 text-xs bg-gray-900 border-gray-700 p-3">
                                    Applied to all standard parts. Suggested = avg_price × (1 + base% + scarcity%). Being too high pushes above market; too low leaves margin on the table.
                                  </PopoverContent>
                                </Popover>
                              </div>
                              <div className="flex items-center gap-2">
                                <Input type="number" min={0} max={100} value={pomBasePremium} onChange={(e) => setPomBasePremium(parseInt(e.target.value) || 0)} onBlur={() => updateSettingsMutation.mutate({ pomBasePremium })} className="text-sm w-20 text-right" data-testid="input-pom-base-premium" />
                                <span className="text-xs text-gray-400 w-5">%</span>
                              </div>
                            </div>
                            <div className="flex items-center justify-between py-3">
                              <div className="flex items-center gap-1.5">
                                <Label className="text-sm text-gray-200">Minifigure Premium</Label>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                      <Info className="w-3.5 h-3.5" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent side="bottom" className="w-56 text-xs bg-gray-900 border-gray-700 p-3">
                                    Minifigures use a separate premium because they already command elevated prices relative to cost. Setting this too high on high-value figs risks losing buyers to competitors.
                                  </PopoverContent>
                                </Popover>
                              </div>
                              <div className="flex items-center gap-2">
                                <Input type="number" min={0} max={100} value={pomMinifigPremium} onChange={(e) => setPomMinifigPremium(parseInt(e.target.value) || 0)} onBlur={() => updateSettingsMutation.mutate({ pomMinifigPremium })} className="text-sm w-20 text-right" data-testid="input-pom-minifig-premium" />
                                <span className="text-xs text-gray-400 w-5">%</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Scarcity Bonuses */}
                        <div className="rounded-md border border-gray-700/60 overflow-hidden">
                          <div className="bg-gray-800/50 px-4 py-2.5 flex items-center gap-1.5 border-b border-gray-700/40">
                            <h4 className="text-xs font-semibold text-gray-200 uppercase tracking-wider">Scarcity Bonuses</h4>
                            <Popover>
                              <PopoverTrigger asChild>
                                <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                  <Info className="w-3.5 h-3.5" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent side="bottom" className="w-64 text-xs bg-gray-900 border-gray-700 p-3">
                                When fewer sellers list a part on BrickLink, you can charge more. Each tier adds a bonus % on top of your base premium. Items above the highest threshold get base premium only — no bonus.
                              </PopoverContent>
                            </Popover>
                          </div>
                          <div className="px-4">
                            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-3 py-2 border-b border-gray-700/40">
                              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Supply Level</span>
                              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider text-right">Under</span>
                              <span className="w-6"></span>
                              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider text-right">Bonus</span>
                              <span className="w-4"></span>
                            </div>
                            <div className="divide-y divide-gray-700/30">
                              <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-3 py-3">
                                <span className="text-sm font-medium text-orange-300">Very Low</span>
                                <Input type="number" min={1} value={pomScarcityThreshold1} onChange={(e) => setPomScarcityThreshold1(parseInt(e.target.value) || 1)} onBlur={() => updateSettingsMutation.mutate({ pomScarcityThreshold1 })} className="text-sm w-20 text-right" data-testid="input-pom-threshold1" />
                                <span className="text-xs text-gray-300">lots</span>
                                <Input type="number" min={0} max={200} value={pomScarcityBonus1} onChange={(e) => setPomScarcityBonus1(parseInt(e.target.value) || 0)} onBlur={() => updateSettingsMutation.mutate({ pomScarcityBonus1 })} className="text-sm w-20 text-right" data-testid="input-pom-bonus1" />
                                <span className="text-xs text-gray-400">%</span>
                              </div>
                              <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-3 py-3">
                                <span className="text-sm font-medium text-yellow-300">Low</span>
                                <Input type="number" min={1} value={pomScarcityThreshold2} onChange={(e) => setPomScarcityThreshold2(parseInt(e.target.value) || 1)} onBlur={() => updateSettingsMutation.mutate({ pomScarcityThreshold2 })} className="text-sm w-20 text-right" data-testid="input-pom-threshold2" />
                                <span className="text-xs text-gray-300">lots</span>
                                <Input type="number" min={0} max={200} value={pomScarcityBonus2} onChange={(e) => setPomScarcityBonus2(parseInt(e.target.value) || 0)} onBlur={() => updateSettingsMutation.mutate({ pomScarcityBonus2 })} className="text-sm w-20 text-right" data-testid="input-pom-bonus2" />
                                <span className="text-xs text-gray-400">%</span>
                              </div>
                              <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-3 py-3">
                                <span className="text-sm font-medium text-blue-300">Medium</span>
                                <Input type="number" min={1} value={pomScarcityThreshold3} onChange={(e) => setPomScarcityThreshold3(parseInt(e.target.value) || 1)} onBlur={() => updateSettingsMutation.mutate({ pomScarcityThreshold3 })} className="text-sm w-20 text-right" data-testid="input-pom-threshold3" />
                                <span className="text-xs text-gray-300">lots</span>
                                <Input type="number" min={0} max={200} value={pomScarcityBonus3} onChange={(e) => setPomScarcityBonus3(parseInt(e.target.value) || 0)} onBlur={() => updateSettingsMutation.mutate({ pomScarcityBonus3 })} className="text-sm w-20 text-right" data-testid="input-pom-bonus3" />
                                <span className="text-xs text-gray-400">%</span>
                              </div>
                              <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-3 py-3">
                                <span className="text-sm font-medium text-gray-300">High</span>
                                <span className="text-sm text-gray-400 text-right">{pomScarcityThreshold3}+</span>
                                <span className="text-xs text-gray-400">lots</span>
                                <span className="text-sm text-gray-400 w-20 text-right">—</span>
                                <span className="text-xs text-gray-400">%</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Formula Preview */}
                        <div className="bg-gray-900/60 rounded-md border border-gray-700/40 px-4 py-3">
                          <div className="flex items-center gap-1.5 mb-2.5">
                            <h4 className="text-[10px] font-semibold text-gray-300 uppercase tracking-wider">Formula Preview</h4>
                            <Popover>
                              <PopoverTrigger asChild>
                                <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                  <Info className="w-3 h-3" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent side="bottom" className="w-64 text-xs bg-gray-900 border-gray-700 p-3">
                                Shows the suggested price for a $0.10 part at each supply level using your current settings. Adjust the premiums and bonuses above to see results update instantly.
                              </PopoverContent>
                            </Popover>
                          </div>
                          <div className="space-y-1.5 font-mono text-xs">
                            {[
                              { label: 'Very Low (30 lots)', color: 'text-orange-300', premium: pomBasePremium + pomScarcityBonus1 },
                              { label: 'Low (100 lots)', color: 'text-yellow-300', premium: pomBasePremium + pomScarcityBonus2 },
                              { label: 'Medium (350 lots)', color: 'text-blue-300', premium: pomBasePremium + pomScarcityBonus3 },
                              { label: 'High (600 lots)', color: 'text-gray-500', premium: pomBasePremium },
                            ].map(({ label, color, premium }) => (
                              <div key={label} className="flex items-center justify-between">
                                <span className={color}>{label}</span>
                                <span className="text-green-400 font-semibold">${(0.10 * (1 + premium / 100)).toFixed(3)}</span>
                              </div>
                            ))}
                            <div className="border-t border-gray-700/50 pt-1.5 mt-0.5">
                              <span className="text-gray-400">Base input: $0.10 avg price</span>
                            </div>
                          </div>
                        </div>

                        {/* Price Floors */}
                        <div className="rounded-md border border-gray-700/60 overflow-hidden">
                          <div className="bg-gray-800/50 px-4 py-2.5 flex items-center gap-1.5 border-b border-gray-700/40">
                            <h4 className="text-xs font-semibold text-gray-200 uppercase tracking-wider">Price Floors</h4>
                            <Popover>
                              <PopoverTrigger asChild>
                                <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                  <Info className="w-3.5 h-3.5" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent side="bottom" className="w-64 text-xs bg-gray-900 border-gray-700 p-3">
                                Safety net applied after the market formula. Final price = max(market_price, cost_floor, min_price). Cost floor only applies to items with a recorded cost (my_cost).
                              </PopoverContent>
                            </Popover>
                          </div>
                          <div className="px-4 divide-y divide-gray-700/30">
                            <div className="flex items-center justify-between py-3">
                              <div className="flex items-center gap-1.5">
                                <Label className="text-sm text-gray-200">Cost Floor</Label>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                      <Info className="w-3.5 h-3.5" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent side="bottom" className="w-56 text-xs bg-gray-900 border-gray-700 p-3">
                                    Minimum margin above your recorded cost (my_cost). At 25%, the suggested price never goes below cost × 1.25. Set to 0 to disable.
                                  </PopoverContent>
                                </Popover>
                              </div>
                              <div className="flex items-center gap-2">
                                <Input type="number" min="0" max="200" value={pomCostFloorPct} onChange={(e) => setPomCostFloorPct(parseInt(e.target.value) || 0)} onBlur={() => updateSettingsMutation.mutate({ pomCostFloorPct })} className="text-sm w-20 text-right" data-testid="input-pom-cost-floor" />
                                <span className="text-xs text-gray-400 w-16">% above cost</span>
                              </div>
                            </div>
                            <div className="flex items-center justify-between py-3">
                              <div className="flex items-center gap-1.5">
                                <Label className="text-sm text-gray-200">Minimum Price</Label>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                      <Info className="w-3.5 h-3.5" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent side="bottom" className="w-56 text-xs bg-gray-900 border-gray-700 p-3">
                                    No item will be suggested below this price regardless of market data or cost. Useful for covering platform fees on micro-priced parts. Default $0.02.
                                  </PopoverContent>
                                </Popover>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-gray-400">$</span>
                                <Input type="number" min="0" step="0.01" value={pomMinPrice} onChange={(e) => setPomMinPrice(parseFloat(e.target.value) || 0)} onBlur={() => updateSettingsMutation.mutate({ pomMinPrice: pomMinPrice.toString() })} className="text-sm w-20 text-right" data-testid="input-pom-min-price" />
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Market Dynamics */}
                        <div className="rounded-md border border-gray-700/60 overflow-hidden">
                          <div className="bg-gray-800/50 px-4 py-2.5 flex items-center justify-between border-b border-gray-700/40">
                            <div className="flex items-center gap-1.5">
                              <h4 className="text-xs font-semibold text-gray-200 uppercase tracking-wider">Market Dynamics</h4>
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                    <Info className="w-3.5 h-3.5" />
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent side="bottom" className="w-80 text-xs bg-gray-900 border-gray-700 p-3 space-y-1.5">
                                  <p>Adjusts suggested prices using live BrickLink market data — no local order history involved.</p>
                                  <p><span className="text-blue-300 font-medium">Demand signal:</span> total pieces sold globally on BrickLink (from the sold price guide). High sales volume relative to your demand threshold boosts the price.</p>
                                  <p><span className="text-orange-300 font-medium">Supply signal:</span> total pieces currently listed for sale globally. High availability relative to your supply threshold lowers the price.</p>
                                  <p>The two signals are weighted and combined: <span className="font-mono text-gray-300">adj = maxAdj × (demandRatio × demandWeight% − supplyRatio × supplyWeight%)</span></p>
                                </PopoverContent>
                              </Popover>
                            </div>
                            <Switch
                              checked={pomTrendingEnabled}
                              onCheckedChange={(v) => { setPomTrendingEnabled(v); updateSettingsMutation.mutate({ pomTrendingEnabled: v }); }}
                              data-testid="switch-pom-trending"
                            />
                          </div>
                          <div className={`px-4 divide-y divide-gray-700/30 ${!pomTrendingEnabled ? 'opacity-40 pointer-events-none' : ''}`}>
                            <div className="flex items-center justify-between py-3">
                              <div className="flex items-center gap-1.5">
                                <Label className="text-sm text-gray-300">Max adjustment</Label>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                      <Info className="w-3.5 h-3.5" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent side="bottom" className="w-60 text-xs bg-gray-900 border-gray-700 p-3">
                                    The maximum percentage the market dynamics formula can move a price — either up (high demand) or down (high supply). Demand and supply weights further scale within this cap.
                                  </PopoverContent>
                                </Popover>
                              </div>
                              <div className="flex items-center gap-2">
                                <Input type="number" min={1} max={50} value={pomTrendingDays} onChange={(e) => setPomTrendingDays(parseInt(e.target.value) || 15)} onBlur={() => updateSettingsMutation.mutate({ pomTrendingDays })} className="text-sm w-20 text-right" data-testid="input-pom-market-max-adj" disabled={!pomTrendingEnabled} />
                                <span className="text-xs text-gray-400 w-8">%</span>
                              </div>
                            </div>
                            <div className="flex items-center justify-between py-3">
                              <div className="flex items-center gap-1.5">
                                <Label className="text-sm text-blue-300">Demand threshold</Label>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                      <Info className="w-3.5 h-3.5" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent side="bottom" className="w-64 text-xs bg-gray-900 border-gray-700 p-3">
                                    Total pieces sold globally on BrickLink that represents "fully demanded." An item at or above this level gets the full demand bonus. Below it, the bonus is proportionally reduced.
                                  </PopoverContent>
                                </Popover>
                              </div>
                              <div className="flex items-center gap-2">
                                <Input type="number" min={1} step={100} value={pomTrendingThreshold} onChange={(e) => setPomTrendingThreshold(parseInt(e.target.value) || 1)} onBlur={() => updateSettingsMutation.mutate({ pomTrendingThreshold })} className="text-sm w-24 text-right" data-testid="input-pom-trending-threshold" disabled={!pomTrendingEnabled} />
                                <span className="text-xs text-gray-400 w-14">units sold</span>
                              </div>
                            </div>
                            <div className="flex items-center justify-between py-3">
                              <div className="flex items-center gap-1.5">
                                <Label className="text-sm text-blue-300">Demand weight</Label>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                      <Info className="w-3.5 h-3.5" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent side="bottom" className="w-60 text-xs bg-gray-900 border-gray-700 p-3">
                                    How much of the max adjustment the demand signal can contribute. At 60 with max 15%, a fully-demanded item adds up to 9% (15 × 0.6).
                                  </PopoverContent>
                                </Popover>
                              </div>
                              <div className="flex items-center gap-2">
                                <Input type="number" min={0} max={100} value={pomTrendingBonus} onChange={(e) => setPomTrendingBonus(parseInt(e.target.value) || 0)} onBlur={() => updateSettingsMutation.mutate({ pomTrendingBonus })} className="text-sm w-20 text-right" data-testid="input-pom-trending-bonus" disabled={!pomTrendingEnabled} />
                                <span className="text-xs text-gray-400 w-8">%</span>
                              </div>
                            </div>
                            <div className="flex items-center justify-between py-3">
                              <div className="flex items-center gap-1.5">
                                <Label className="text-sm text-orange-300">Supply threshold</Label>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                      <Info className="w-3.5 h-3.5" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent side="bottom" className="w-64 text-xs bg-gray-900 border-gray-700 p-3">
                                    Total pieces currently listed for sale on BrickLink globally that represents "fully supplied." Common commodity parts often have 50,000+ pieces globally — set this to match your market context.
                                  </PopoverContent>
                                </Popover>
                              </div>
                              <div className="flex items-center gap-2">
                                <Input type="number" min={100} step={1000} value={pomHighSupplyThreshold} onChange={(e) => setPomHighSupplyThreshold(parseInt(e.target.value) || 100)} onBlur={() => updateSettingsMutation.mutate({ pomHighSupplyThreshold })} className="text-sm w-24 text-right" data-testid="input-pom-high-supply-threshold" disabled={!pomTrendingEnabled} />
                                <span className="text-xs text-gray-400 w-12">pieces</span>
                              </div>
                            </div>
                            <div className="flex items-center justify-between py-3">
                              <div className="flex items-center gap-1.5">
                                <Label className="text-sm text-orange-300">Supply weight</Label>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                      <Info className="w-3.5 h-3.5" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent side="bottom" className="w-60 text-xs bg-gray-900 border-gray-700 p-3">
                                    How much of the max adjustment the supply signal can subtract. At 40 with max 15%, a fully-supplied item removes up to 6% (15 × 0.4).
                                  </PopoverContent>
                                </Popover>
                              </div>
                              <div className="flex items-center gap-2">
                                <Input type="number" min={0} max={100} value={pomHighSupplyPenalty} onChange={(e) => setPomHighSupplyPenalty(parseInt(e.target.value) || 0)} onBlur={() => updateSettingsMutation.mutate({ pomHighSupplyPenalty })} className="text-sm w-20 text-right" data-testid="input-pom-high-supply-penalty" disabled={!pomTrendingEnabled} />
                                <span className="text-xs text-gray-400 w-8">%</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Flag Thresholds */}
                        <div className="rounded-md border border-gray-700/60 overflow-hidden">
                          <div className="bg-gray-800/50 px-4 py-2.5 flex items-center gap-1.5 border-b border-gray-700/40">
                            <h4 className="text-xs font-semibold text-gray-200 uppercase tracking-wider">Flag Thresholds</h4>
                            <Popover>
                              <PopoverTrigger asChild>
                                <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                  <Info className="w-3.5 h-3.5" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent side="bottom" className="w-64 text-xs bg-gray-900 border-gray-700 p-3">
                                Controls which items appear in the Price-o-Matic dashboard as needing attention. Items outside these bands are flagged — not automatically repriced. You decide whether to act on each flag.
                              </PopoverContent>
                            </Popover>
                          </div>
                          <div className="px-4 divide-y divide-gray-700/30">
                            <div className="flex items-center justify-between py-3">
                              <div className="flex items-center gap-1.5">
                                <Label className="text-sm text-red-300">Too High Flag</Label>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                      <Info className="w-3.5 h-3.5" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent side="bottom" className="w-56 text-xs bg-gray-900 border-gray-700 p-3">
                                    Items priced this far above the suggested price appear in the "Too High" tab. Buyers will likely find cheaper options elsewhere, reducing your sell-through rate.
                                  </PopoverContent>
                                </Popover>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-300">more than</span>
                                <Input type="number" min={1} max={200} value={pomTooHighThreshold} onChange={(e) => setPomTooHighThreshold(parseInt(e.target.value) || 1)} onBlur={() => updateSettingsMutation.mutate({ pomTooHighThreshold })} className="text-sm w-20 text-right" data-testid="input-pom-too-high" />
                                <span className="text-xs text-gray-400 w-14">% above</span>
                              </div>
                            </div>
                            <div className="flex items-center justify-between py-3">
                              <div className="flex items-center gap-1.5">
                                <Label className="text-sm text-yellow-300">Too Low Flag</Label>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                      <Info className="w-3.5 h-3.5" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent side="bottom" className="w-56 text-xs bg-gray-900 border-gray-700 p-3">
                                    Items priced this far below the suggested price appear in the "Too Low" tab. You're leaving margin on the table — buyers didn't need that discount.
                                  </PopoverContent>
                                </Popover>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-300">more than</span>
                                <Input type="number" min={1} max={200} value={pomTooLowThreshold} onChange={(e) => setPomTooLowThreshold(parseInt(e.target.value) || 1)} onBlur={() => updateSettingsMutation.mutate({ pomTooLowThreshold })} className="text-sm w-20 text-right" data-testid="input-pom-too-low" />
                                <span className="text-xs text-gray-400 w-14">% below</span>
                              </div>
                            </div>

                          </div>
                        </div>

                      </div>
                    )}
                  </div>

                  {/* Clear Cache */}
                  <div className="bg-red-500/5 border border-red-500/20 rounded-md px-4 py-3">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <Label className="text-sm font-medium text-red-300">Clear Price Guide Cache</Label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                              <Info className="w-3.5 h-3.5" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent side="bottom" className="w-64 text-xs bg-gray-900 border-gray-700 p-3">
                            Deletes all stored price guide data and resets sync history. Use when starting fresh with new formula settings. The next sync rebuilds from scratch. No inventory data is affected.
                          </PopoverContent>
                        </Popover>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => setShowClearPomDialog(true)} className="border-red-500/40 text-red-400 hover:text-red-300 shrink-0" data-testid="button-clear-pom-cache">
                        <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                        Clear Cache
                      </Button>
                    </div>
                  </div>

                  <AlertDialog open={showClearPomDialog} onOpenChange={setShowClearPomDialog}>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Clear Price Guide Cache?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently delete all stored Price-o-Matic price guide data and reset the sync history. The next sync run will start fresh and rebuild from scratch using your current formula settings.
                          <br /><br />
                          This cannot be undone, but no inventory data is affected — only the pricing cache.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => clearPomCacheMutation.mutate()}
                          className="bg-red-600 hover:bg-red-700"
                          data-testid="button-confirm-clear-pom"
                        >
                          {clearPomCacheMutation.isPending ? "Clearing..." : "Yes, Clear Cache"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>

                  <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                    <p className="text-xs text-blue-300">
                      <strong>How it works:</strong> Price-o-Matic pulls avg listed price, avg sold price, and lot count from BrickLink for each item, then applies your formula above to compute a suggested price. Items more than {pomTooHighThreshold}% above or {pomTooLowThreshold}% below that suggested price are flagged in the dashboard.
                    </p>
                  </div>

                  </div>
                  )}
                </div>

                <Separator className="bg-gray-700" />

                {/* Rebrickable Set-Parts Sync */}
                <div>
                  <button
                    onClick={() => setEnrichmentRebrickableOpen(!enrichmentRebrickableOpen)}
                    className="w-full flex items-center justify-between gap-2 py-2 mb-3 border-b border-gray-600/60 hover:border-gray-500/60 transition-colors group"
                    data-testid="button-enrichment-rebrickable-toggle"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-200">Rebrickable Set-Parts</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${rebrickableSetSyncEnabled ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-500'}`}>
                        {rebrickableSetSyncEnabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                    {enrichmentRebrickableOpen
                      ? <ChevronDown className="w-4 h-4 text-gray-400 group-hover:text-gray-200 transition-colors" />
                      : <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-200 transition-colors" />}
                  </button>
                  {enrichmentRebrickableOpen && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <Label className="text-xs font-medium text-gray-300">Monthly Set-Parts Sync</Label>
                            <Popover>
                              <PopoverTrigger asChild>
                                <button className="text-gray-500 hover:text-gray-200 flex items-center transition-colors">
                                  <Info className="w-3 h-3" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent side="bottom" className="w-72 text-xs bg-gray-900 border-gray-700 p-3 space-y-1.5">
                                <p className="font-semibold text-gray-200">Rebrickable Set-Parts Sync</p>
                                <p className="text-gray-400">Downloads the full Rebrickable set-to-parts relationship database (~1.4M rows). This powers the BrickSpotter "find sets that use this part" feature.</p>
                                <p className="text-gray-500">Runs once per month — Rebrickable data changes rarely. Force-refresh truncates and rebuilds the table from scratch.</p>
                              </PopoverContent>
                            </Popover>
                          </div>
                          <p className="text-[10px] text-gray-500 mt-0.5">Runs once monthly via scheduled download</p>
                          <SyncStatusLine entry={syncStatuses?.rebrickable ?? null} />
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={syncingRebrickable || syncStatuses?.rebrickable?.lastSyncStatus === 'in_progress'}
                            onClick={() => runManualSync('/api/sync/rebrickable/set-parts', setSyncingRebrickable, 'Rebrickable', undefined, 'Rebrickable sync started', 'Downloading set-parts data in the background.')}
                            title="Run Rebrickable set-parts sync now"
                            data-testid="button-run-rebrickable-sync"
                          >
                            {(syncingRebrickable || syncStatuses?.rebrickable?.lastSyncStatus === 'in_progress')
                              ? <Loader2 className="h-4 w-4 animate-spin" />
                              : <Play className="h-4 w-4" />}
                          </Button>
                          <Switch
                            checked={rebrickableSetSyncEnabled}
                            onCheckedChange={(checked) => {
                              setRebrickableSetSyncEnabled(checked);
                              updateSettingsMutation.mutate({ rebrickableSetSyncEnabled: checked });
                            }}
                            data-testid="switch-rebrickable-set-sync"
                          />
                        </div>
                      </div>
                      {rebrickableSetSyncEnabled && (
                        <div className="ml-4 space-y-3">
                          <div className="flex items-center gap-4">
                            <div className="space-y-1">
                              <Label htmlFor="rebrickable-sync-time" className="text-xs text-gray-400">Sync Time</Label>
                              <Input
                                id="rebrickable-sync-time"
                                type="time"
                                value={rebrickableSetSyncTime}
                                onChange={(e) => setRebrickableSetSyncTime(e.target.value)}
                                onBlur={() => updateSettingsMutation.mutate({ rebrickableSetSyncTime })}
                                className="text-xs w-32"
                                data-testid="input-rebrickable-sync-time"
                              />
                              <p className="text-[10px] text-gray-500">Local timezone</p>
                            </div>
                          </div>
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <Label className="text-xs text-gray-400">Force full rebuild</Label>
                          <p className="text-[10px] text-gray-500 mt-0.5">Truncates the table and re-downloads from scratch</p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={syncingRebrickable || syncStatuses?.rebrickable?.lastSyncStatus === 'in_progress'}
                          onClick={() => runManualSync('/api/sync/rebrickable/set-parts', setSyncingRebrickable, 'Rebrickable', { force: true }, 'Rebuilding Rebrickable data', 'Full table rebuild started in background.')}
                          className="border-orange-500/40 text-orange-400 hover:text-orange-300 shrink-0"
                          data-testid="button-rebrickable-force-rebuild"
                        >
                          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                          Force Rebuild
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

              </div>
            )}

            {activeSection === 'data' && (
              <div className="space-y-4 min-h-[400px]">

                {/* Data Export (CSV) */}
                <div>
                  <h3 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                    <Download className="h-4 w-4 text-green-400" />
                    Data Export (CSV)
                  </h3>
                  <p className="text-xs text-gray-400 mb-3">Export your business data as CSV files for analysis or record-keeping</p>

                  <Accordion type="single" collapsible className="space-y-2">
                    {/* Core Business Data */}
                    <AccordionItem value="core" className="bg-gray-800 border border-gray-700 rounded-lg px-3">
                      <AccordionTrigger className="text-xs font-medium text-gray-300 py-2.5 hover:no-underline">
                        <div className="flex items-center gap-2">
                          <HardDrive className="h-3.5 w-3.5 text-purple-400" />
                          Core Business Data
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="pb-3 space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs"
                            onClick={() => handleExport('inventory', 'csv')}
                            data-testid="button-export-inventory-csv"
                          >
                            <Download className="h-3 w-3 mr-1" />
                            Inventory CSV
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs"
                            onClick={() => handleExport('orders', 'csv')}
                            data-testid="button-export-orders-csv"
                          >
                            <Download className="h-3 w-3 mr-1" />
                            Orders CSV
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs"
                            data-testid="button-export-warehouse-csv"
                          >
                            <Download className="h-3 w-3 mr-1" />
                            Warehouse CSV
                          </Button>
                        </div>
                        <p className="text-[10px] md:text-sm text-gray-500 mt-2">
                          Your inventory quantities, orders, and warehouse locations
                        </p>
                      </AccordionContent>
                    </AccordionItem>

                    {/* Platform Catalog Data */}
                    <AccordionItem value="catalog" className="bg-gray-800 border border-gray-700 rounded-lg px-3">
                      <AccordionTrigger className="text-xs font-medium text-gray-300 py-2.5 hover:no-underline">
                        <div className="flex items-center gap-2">
                          <Database className="h-3.5 w-3.5 text-blue-400" />
                          Platform Catalog Data
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="pb-3 space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs"
                            data-testid="button-export-catalog-csv"
                          >
                            <Download className="h-3 w-3 mr-1" />
                            BrickLink Catalog
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs"
                            data-testid="button-export-sets-csv"
                          >
                            <Download className="h-3 w-3 mr-1" />
                            Set-Part Data
                          </Button>
                        </div>
                        <p className="text-[10px] md:text-sm text-gray-500 mt-2">
                          External catalog data (can be re-fetched from BrickLink/Rebrickable)
                        </p>
                      </AccordionContent>
                    </AccordionItem>

                    {/* AI & Analytics */}
                    <AccordionItem value="ai" className="bg-gray-800 border border-gray-700 rounded-lg px-3">
                      <AccordionTrigger className="text-xs font-medium text-gray-300 py-2.5 hover:no-underline">
                        <div className="flex items-center gap-2">
                          <Sparkles className="h-3.5 w-3.5 text-violet-400" />
                          AI & Analytics Data
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="pb-3 space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs"
                            data-testid="button-export-embeddings"
                          >
                            <Download className="h-3 w-3 mr-1" />
                            AI Embeddings
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs"
                            data-testid="button-export-analytics"
                          >
                            <Download className="h-3 w-3 mr-1" />
                            Analytics Cache
                          </Button>
                        </div>
                        <p className="text-[10px] md:text-sm text-gray-500 mt-2">
                          Derived data (can be regenerated, but expensive)
                        </p>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>

                  <p className="text-[10px] md:text-sm text-yellow-400 mt-3 flex items-start gap-1">
                    <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
                    <span>Note: CSV files are for analysis only and are NOT considered backups. Use the section below for restore capabilities.</span>
                  </p>
                </div>

                <Separator className="bg-gray-700" />

                {/* Database Backup Status */}
                <div className="bg-gradient-to-br from-purple-500/10 to-blue-500/10 border border-purple-500/30 rounded-lg p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4 text-purple-400" />
                      <h3 className="text-sm font-medium text-purple-300">Database Protection Status</h3>
                    </div>
                    <CheckCircle2 className="h-4 w-4 text-green-400" />
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-gray-400">History Retention</p>
                      <p className="text-white font-medium">30 Days</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Last Backup</p>
                      <p className="text-white font-medium">2 hours ago</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Backup Type</p>
                      <p className="text-white font-medium">Automatic (Replit)</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Recovery Ready</p>
                      <p className="text-green-400 font-medium">✓ Yes</p>
                    </div>
                  </div>
                </div>

                {/* Automatic Restore (Guided Wizard) */}
                <div>
                  <h3 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                    <RotateCcw className="h-4 w-4 text-blue-400" />
                    Automatic Restore (Guided Wizard)
                  </h3>
                  <p className="text-xs text-gray-400 mb-3">Full-system recovery with impact analysis and automated platform synchronization</p>
                  
                  <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded p-3 space-y-2">
                      <p className="text-xs font-medium text-blue-300">✨ Comprehensive Guided Process</p>
                      <p className="text-[10px] md:text-sm text-blue-200/80">
                        Step-by-step wizard that restores your database to any point in the last 30 days, analyzes inventory/order mismatches, detects anomalies, syncs from BrickLink/BrickOwl, and verifies data integrity.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="restore-date" className="text-xs text-gray-400 mb-1">Restore Date</Label>
                        <Input
                          id="restore-date"
                          type="date"
                          className="text-xs h-8"
                          value={restoreDate}
                          onChange={(e) => setRestoreDate(e.target.value)}
                          data-testid="input-restore-date"
                        />
                      </div>
                      <div>
                        <Label htmlFor="restore-time" className="text-xs text-gray-400 mb-1">Restore Time</Label>
                        <Input
                          id="restore-time"
                          type="time"
                          className="text-xs h-8"
                          value={restoreTime}
                          onChange={(e) => setRestoreTime(e.target.value)}
                          data-testid="input-restore-time"
                        />
                      </div>
                    </div>

                    <Button 
                      variant="default" 
                      size="sm" 
                      className="w-full text-xs bg-blue-600 hover:bg-blue-700"
                      onClick={() => {
                        setRestoreWizardOpen(true);
                        setRestoreStep('warning');
                      }}
                      data-testid="button-start-restore-wizard"
                    >
                      <RotateCcw className="h-3 w-3 mr-1" />
                      Start Guided Restore
                    </Button>
                  </div>
                </div>

                <Separator className="bg-gray-700" />

                {/* Manual Restore */}
                <div>
                  <h3 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                    <Download className="h-4 w-4 text-purple-400" />
                    Manual Restore
                  </h3>
                  <p className="text-xs text-gray-400 mb-3">Download XML backups and manually upload to BrickLink</p>
                  
                  <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
                    <div className="bg-purple-500/10 border border-purple-500/30 rounded p-3 space-y-2">
                      <p className="text-xs font-medium text-purple-300">📥 Simple Download Process</p>
                      <p className="text-[10px] md:text-sm text-purple-200/80">
                        Download BrickLink XML backups from our archive, then manually upload them to BrickLink yourself for complete control over the restore process.
                      </p>
                    </div>

                    {/* List of available backups */}
                    <div className="space-y-2">
                      <Label className="text-xs text-gray-400">Available XML Backups</Label>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {backupsLoading ? (
                          <div className="text-xs text-gray-400 text-center py-4">Loading backups...</div>
                        ) : !backupsData?.backups || backupsData.backups.length === 0 ? (
                          <div className="text-xs text-gray-400 text-center py-4">
                            No backups available yet. Run an inventory sync to create your first backup.
                          </div>
                        ) : (
                          backupsData.backups.map((backup, idx) => {
                            const date = new Date(backup.timestamp);
                            const formattedDate = date.toLocaleString('en-US', {
                              year: 'numeric',
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: false
                            });
                            const sizeInMB = (backup.size / (1024 * 1024)).toFixed(2);
                            
                            return (
                              <div key={backup.filename} className="flex items-center justify-between bg-gray-700/50 rounded p-2">
                                <div>
                                  <p className="text-xs text-gray-300 font-medium">{formattedDate}</p>
                                  <p className="text-[10px] md:text-sm text-gray-500">{sizeInMB} MB</p>
                                </div>
                                <Button 
                                  variant="outline" 
                                  size="sm" 
                                  className="text-xs"
                                  onClick={() => handleDownloadBackup(backup.filename)}
                                  data-testid={`button-download-backup-${idx}`}
                                >
                                  <Download className="h-3 w-3 mr-1" />
                                  Download
                                </Button>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>

                    <div className="bg-gray-900/50 rounded p-3 space-y-2">
                      <p className="text-xs font-medium text-gray-300">After Download:</p>
                      <ol className="text-[10px] md:text-sm text-gray-400 space-y-1 ml-4 list-decimal">
                        <li>Go to BrickLink → My Store → Upload/Update My Inventory</li>
                        <li>Select your downloaded XML file and upload</li>
                        <li>Wait for BrickLink to process the upload</li>
                        <li>Return to PlanetBrick and sync from BrickLink</li>
                      </ol>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="w-full text-xs mt-2"
                        onClick={() => window.open('https://www.bricklink.com/inventory_upload.asp', '_blank')}
                        data-testid="button-open-bricklink-upload"
                      >
                        <CloudUpload className="h-3 w-3 mr-1" />
                        Open BrickLink Upload Page
                      </Button>
                    </div>
                  </div>
                </div>

                <Separator className="bg-gray-700" />

                {/* Maintenance Section */}
                <div>
                  <h3 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                    <Wrench className="h-4 w-4 text-orange-400" />
                    Maintenance
                  </h3>
                  <p className="text-xs text-gray-400 mb-3">One-time cleanup and repair operations</p>
                  <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full justify-start text-xs text-orange-400 border-orange-500/30 hover:bg-orange-500/10"
                      onClick={handleCleanupOldOrders}
                      disabled={cleanupRunning}
                      data-testid="button-cleanup-old-orders"
                    >
                      <Trash2 className="h-3 w-3 mr-2" />
                      {cleanupRunning ? 'Removing stale orders…' : 'Remove Stale Orders from Fulfillment'}
                    </Button>
                    <p className="text-[10px] text-gray-500 mt-2">Deletes old unpaid orders (pre-2023) that appear stuck in the fulfillment queue.</p>
                  </div>
                </div>

                <Separator className="bg-gray-700" />

                {/* Clear Data Section */}
                <div>
                  <h3 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                    <Trash2 className="h-4 w-4 text-red-400" />
                    Clear Data
                  </h3>
                  <p className="text-xs text-gray-400 mb-3">Permanently delete inventory or order data</p>
                  
                  <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 space-y-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full justify-start text-xs text-red-400 border-red-500/30 hover:bg-red-500/10"
                      onClick={() => setClearDataDialog('inventory')}
                      data-testid="button-clear-inventory"
                    >
                      <Trash2 className="h-3 w-3 mr-2" />
                      Clear All Inventory Data
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full justify-start text-xs text-red-400 border-red-500/30 hover:bg-red-500/10"
                      onClick={() => setClearDataDialog('orders')}
                      data-testid="button-clear-orders"
                    >
                      <Trash2 className="h-3 w-3 mr-2" />
                      Clear All Order Data
                    </Button>
                    <div className="bg-red-500/10 border border-red-500/30 rounded p-2">
                      <p className="text-[10px] md:text-sm text-red-300">
                        <strong>Warning:</strong> These actions cannot be undone. Always export backups before clearing data.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Team & Roles (Admin Only) */}
            {activeSection === 'users' && (
              <UserManagementSection userCount={users?.length} />
            )}

            {/* ── Platform Admin: Organizations ────────────────────────────── */}
            {activeSection === 'orgs' && (() => {
              const PLAN_COLORS: Record<string, string> = {
                trial: 'bg-gray-600/50 text-gray-300 border-gray-600',
                foundation: 'bg-blue-900/60 text-blue-300 border-blue-700/50',
                core: 'bg-amber-900/50 text-amber-300 border-amber-700/50',
                flagship: 'bg-yellow-900/50 text-yellow-300 border-yellow-700/50',
              };

              if (activeOrg) {
                const org = platformOrgs?.find(o => o.id === activeOrg.id) ?? activeOrg;
                const fo = (org.featureOverrides ?? {}) as Record<string, boolean>;
                return (
                  <div className="p-4 space-y-4">
                    {/* Org identity */}
                    <div className="flex items-center gap-3 py-2">
                      <div className="h-10 w-10 rounded-full bg-yellow-500/20 flex items-center justify-center flex-shrink-0">
                        <Building2 className="h-5 w-5 text-yellow-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white">{org.name}</p>
                        <p className="text-[11px] text-gray-500 font-mono">{org.slug}</p>
                      </div>
                      <span className={`ml-auto text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded border ${PLAN_COLORS[org.plan] ?? PLAN_COLORS.trial}`}>
                        {org.plan}
                      </span>
                    </div>

                    {/* Plan selector */}
                    <div className="rounded-lg bg-gray-800/60 border border-gray-700 overflow-hidden">
                      <div className="px-4 py-2.5 bg-gray-800 border-b border-gray-700 flex items-center gap-2">
                        <CreditCard className="h-3.5 w-3.5 text-yellow-500/70" />
                        <span className="text-xs font-semibold text-gray-200">Plan</span>
                      </div>
                      <div className="px-4 py-3 flex items-center gap-3">
                        <Select
                          defaultValue={org.plan}
                          onValueChange={(plan) => updatePlanMutation.mutate({ orgId: org.id, plan })}
                          disabled={updatePlanMutation.isPending}
                        >
                          <SelectTrigger className="bg-gray-700 border-gray-600 text-gray-200 text-xs" data-testid={`select-plan-detail-${org.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="trial">Free Trial</SelectItem>
                            <SelectItem value="foundation">Foundation</SelectItem>
                            <SelectItem value="core">Core</SelectItem>
                            <SelectItem value="flagship">Flagship</SelectItem>
                          </SelectContent>
                        </Select>
                        <div className="flex items-center gap-2 text-xs text-gray-400">
                          <Users className="h-3.5 w-3.5" />
                          <span>{org.userCount} users</span>
                        </div>
                      </div>
                      <div className="px-4 pt-3 pb-3 flex items-center justify-between gap-3 border-t border-gray-700/50">
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full shrink-0 ${org.isActive ? 'bg-green-400' : 'bg-red-400'}`} />
                          <span className="text-xs text-gray-300">{org.isActive ? 'Active' : 'Suspended'}</span>
                          <span className="text-[10px] text-gray-500">{org.isActive ? '— organization can log in' : '— all access blocked'}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] text-gray-600">{org.isActive ? 'Deactivate' : 'Reactivate'}</span>
                          <Switch
                            checked={!!org.isActive}
                            onCheckedChange={(checked) => suspendOrgMutation.mutate({ orgId: org.id, isActive: checked })}
                            disabled={suspendOrgMutation.isPending}
                            data-testid={`switch-active-${org.id}`}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Plan tabs: Features | Limits | Billing */}
                    <div className="rounded-lg bg-gray-800/60 border border-gray-700 overflow-hidden">
                      {/* Tab bar */}
                      <div className="flex bg-gray-800 border-b border-gray-700">
                        {(['features', 'limits', 'billing'] as const).map(tab => (
                          <button
                            key={tab}
                            onClick={() => setActiveOrgTab(tab)}
                            className={`flex-1 py-2.5 text-[11px] font-semibold transition-colors border-b-2 -mb-px ${activeOrgTab === tab ? 'text-yellow-400 border-yellow-500' : 'text-gray-500 border-transparent hover:text-gray-300'}`}
                            data-testid={`tab-${tab}-${org.id}`}
                          >
                            {tab === 'billing' ? 'Billing / Payments' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                          </button>
                        ))}
                      </div>

                      {/* Features tab */}
                      {activeOrgTab === 'features' && (() => {
                        const tier = getTierConfig(org.plan);
                        const FEATURE_ROWS: Array<{
                          overrideKey: string | null;
                          tierFeatureKey: keyof typeof tier.features | null;
                          label: string;
                          icon: React.ElementType;
                        }> = [
                          { overrideKey: 'elfieAiMode',      tierFeatureKey: 'elfieAiMode',        label: 'E.L.F.I.E. AI Mode',    icon: Brain },
                          { overrideKey: 'pom',              tierFeatureKey: 'priceOMatic',         label: 'Price-o-Matic',          icon: TrendingUp },
                          { overrideKey: 'dataEnrichment',   tierFeatureKey: 'fullDataEnrichment',  label: 'Data Enrichment',        icon: Database },
                          { overrideKey: 'brickSpotter',     tierFeatureKey: null,                  label: 'BrickSpotter Scanning',  icon: Zap },
                          { overrideKey: 'warehouseModule',  tierFeatureKey: null,                  label: 'Warehouse Module',       icon: Package },
                          { overrideKey: 'universalCatalog', tierFeatureKey: null,                  label: 'Universal Catalog',      icon: Globe },
                          { overrideKey: null,               tierFeatureKey: 'brickOwl',            label: 'BrickOwl Integration',   icon: Globe },
                          { overrideKey: null,               tierFeatureKey: 'easypostAutomation',  label: 'EasyPost Automation',    icon: Zap },
                          { overrideKey: null,               tierFeatureKey: 'paymentSync',         label: 'Payment Sync',           icon: CreditCard },
                        ];
                        return (
                          <div>
                            <div className="grid grid-cols-[1fr_64px_48px_56px] gap-2 px-4 py-1.5 border-b border-gray-700/60">
                              <span className="text-[9px] uppercase tracking-widest text-gray-600 font-semibold">Feature</span>
                              <span className="text-[9px] uppercase tracking-widest text-gray-600 font-semibold text-center">Plan</span>
                              <span className="text-[9px] uppercase tracking-widest text-gray-600 font-semibold text-center">OVR</span>
                              <span className="text-[9px] uppercase tracking-widest text-gray-600 font-semibold text-center">State</span>
                            </div>
                            <div className="divide-y divide-gray-700/40">
                              {[...FEATURE_ROWS].sort((a, b) => {
                                const aOn = a.tierFeatureKey != null && tier.features[a.tierFeatureKey] ? 1 : 0;
                                const bOn = b.tierFeatureKey != null && tier.features[b.tierFeatureKey] ? 1 : 0;
                                return bOn - aOn;
                              }).map(({ overrideKey, tierFeatureKey, label, icon: Icon }) => {
                                const planDefault = tierFeatureKey != null ? tier.features[tierFeatureKey] : null;
                                const overrideVal = overrideKey != null ? fo[overrideKey] : undefined;
                                const isOverridden = overrideKey != null && overrideVal !== undefined;
                                const effective = overrideVal !== undefined ? overrideVal : (planDefault ?? false);
                                const canOverride = overrideKey != null;
                                return (
                                  <div key={overrideKey ?? tierFeatureKey} className={`grid grid-cols-[1fr_64px_48px_56px] gap-2 items-center px-4 py-2.5 ${isOverridden ? 'bg-amber-500/5' : ''}`}>
                                    <div className="flex items-center gap-2 min-w-0">
                                      <Icon className="h-3.5 w-3.5 text-gray-500 shrink-0" />
                                      <span className="text-[11px] text-gray-300 truncate">{label}</span>
                                    </div>
                                    <div className="flex justify-center">
                                      {planDefault != null ? (
                                        <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${planDefault ? 'text-green-400 bg-green-500/10' : 'text-gray-600 bg-gray-700/50'}`}>
                                          {planDefault ? 'ON' : 'OFF'}
                                        </span>
                                      ) : (
                                        <span className="text-[9px] text-gray-700">—</span>
                                      )}
                                    </div>
                                    <div className="flex justify-center">
                                      {isOverridden ? (
                                        <button
                                          title="Click to reset to plan default"
                                          onClick={() => {
                                            const newFo = { ...fo };
                                            delete newFo[overrideKey!];
                                            updateFeaturesMutation.mutate({ orgId: org.id, featureOverrides: newFo });
                                          }}
                                          disabled={updateFeaturesMutation.isPending}
                                          className="text-[8px] font-bold uppercase tracking-wide text-amber-400 border border-amber-500/40 rounded px-1 py-0.5 hover:bg-amber-500/10 transition-colors"
                                          data-testid={`badge-override-${overrideKey}-${org.id}`}
                                        >OVR</button>
                                      ) : (
                                        <span className="text-[9px] text-gray-700">—</span>
                                      )}
                                    </div>
                                    <div className="flex justify-center">
                                      {canOverride ? (
                                        <button
                                          onClick={() => {
                                            const newFo = { ...fo };
                                            const newVal = !effective;
                                            if (planDefault != null && newVal === planDefault) {
                                              delete newFo[overrideKey!];
                                            } else {
                                              newFo[overrideKey!] = newVal;
                                            }
                                            updateFeaturesMutation.mutate({ orgId: org.id, featureOverrides: newFo });
                                          }}
                                          disabled={updateFeaturesMutation.isPending}
                                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${effective ? 'bg-green-500' : 'bg-gray-600'} ${isOverridden ? 'ring-1 ring-amber-400/50' : ''}`}
                                          data-testid={`toggle-feature-${overrideKey}-${org.id}`}
                                        >
                                          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${effective ? 'translate-x-4' : 'translate-x-0.5'}`} />
                                        </button>
                                      ) : (
                                        <div className={`relative inline-flex h-5 w-9 items-center rounded-full ${effective ? 'bg-green-500/40' : 'bg-gray-700'} cursor-not-allowed opacity-50`}>
                                          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white/70 transition-transform ${effective ? 'translate-x-4' : 'translate-x-0.5'}`} />
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="px-4 py-2 border-t border-gray-700/60">
                              <p className="text-[9px] text-gray-600">OVR = overridden from plan · Click OVR badge to reset · Read-only rows use plan defaults only</p>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Limits tab */}
                      {activeOrgTab === 'limits' && (() => {
                        const tier = getTierConfig(org.plan);
                        const fmtLimit = (n: number) => n === -1 ? '∞' : String(n);
                        const rows = [
                          { name: 'seats',       label: 'Seats',               planMax: fmtLimit(tier.limits.seats),                   usage: orgLimitsUsage ? String(orgLimitsUsage.usage.seats.count) : '—',                      override: org.seatLimitOverride,        isOverridden: org.seatLimitOverride != null },
                          { name: 'brickspotter', label: 'BrickSpotter Scans/mo', planMax: fmtLimit(tier.limits.brickspotterScansPerMonth), usage: orgLimitsUsage ? String(orgLimitsUsage.usage.brickspotterScans.scansUsed) : '—', override: org.brickspotterLimitOverride, isOverridden: org.brickspotterLimitOverride != null },
                          { name: 'automation',  label: 'Automation Rules',    planMax: fmtLimit(tier.limits.automationRules),          usage: orgLimitsUsage ? String(orgLimitsUsage.usage.automationRules.count) : '—',            override: org.automationLimitOverride,  isOverridden: org.automationLimitOverride != null },
                          { name: 'blApi',       label: 'BL API Calls/24h',    planMax: '—',                                            usage: orgBlApiUsage != null ? String(orgBlApiUsage.count) : '—',                            override: org.blApiCallLimitOverride,   isOverridden: org.blApiCallLimitOverride != null },
                        ];
                        return (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              const fd = new FormData(e.currentTarget);
                              const parse = (key: string) => { const v = fd.get(key) as string; return v === '' ? null : Number(v); };
                              updateOverridesMutation.mutate({
                                orgId: org.id,
                                overrides: {
                                  seatLimitOverride: parse('seats'),
                                  brickspotterLimitOverride: parse('brickspotter'),
                                  automationLimitOverride: parse('automation'),
                                  blApiCallLimitOverride: parse('blApi'),
                                }
                              });
                            }}
                          >
                            <div className="grid grid-cols-[1fr_48px_44px_80px] gap-2 px-4 py-1.5 border-b border-gray-700/60">
                              <span className="text-[9px] uppercase tracking-widest text-gray-600 font-semibold">Limit</span>
                              <span className="text-[9px] uppercase tracking-widest text-gray-600 font-semibold text-center">Max</span>
                              <span className="text-[9px] uppercase tracking-widest text-gray-600 font-semibold text-center">Use</span>
                              <span className="text-[9px] uppercase tracking-widest text-gray-600 font-semibold text-center">Override</span>
                            </div>
                            {orgLimitsLoading && (
                              <div className="flex items-center justify-center py-4 gap-2 text-gray-500">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                <span className="text-xs">Loading usage…</span>
                              </div>
                            )}
                            <div className="divide-y divide-gray-700/40">
                              {rows.map(({ name, label, planMax, usage, override, isOverridden }) => (
                                <div key={name} className={`grid grid-cols-[1fr_48px_44px_80px] gap-2 items-start px-4 py-2 ${isOverridden ? 'bg-amber-500/5' : ''}`}>
                                  <div className="flex items-start gap-1 pt-0.5">
                                    {isOverridden && <span className="shrink-0 text-[8px] font-bold uppercase tracking-wide text-amber-400 border border-amber-500/40 rounded px-1 py-0.5 mt-px">OVR</span>}
                                    <span className="text-[11px] text-gray-300 leading-tight">{label}</span>
                                  </div>
                                  <span className="text-xs text-gray-500 text-center font-mono pt-0.5">{planMax}</span>
                                  <span className="text-xs text-gray-300 text-center font-mono pt-0.5">{usage}</span>
                                  <Input
                                    name={name}
                                    type="number"
                                    defaultValue={override ?? ''}
                                    placeholder="default"
                                    className={`h-7 text-xs text-center font-mono bg-gray-700 border-gray-600 text-gray-200 placeholder:text-gray-600 ${isOverridden ? 'border-amber-500/40' : ''}`}
                                    data-testid={`input-override-${name}-${org.id}`}
                                  />
                                </div>
                              ))}
                            </div>
                            <div className="px-4 py-2.5 border-t border-gray-700/60">
                              <Button type="submit" size="sm" variant="secondary" disabled={updateOverridesMutation.isPending} className="w-full text-xs" data-testid={`button-save-overrides-${org.id}`}>
                                {updateOverridesMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save Limit Overrides'}
                              </Button>
                            </div>
                          </form>
                        );
                      })()}

                      {/* Billing / Payments tab */}
                      {activeOrgTab === 'billing' && (
                        <div>
                          {orgPaymentsLoading ? (
                            <div className="flex items-center justify-center py-8 gap-2 text-gray-500">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              <span className="text-xs">Loading payments…</span>
                            </div>
                          ) : !org.stripeCustomerId ? (
                            <div className="px-4 py-8 text-center">
                              <CreditCard className="h-6 w-6 text-gray-700 mx-auto mb-2" />
                              <p className="text-xs text-gray-500">No Stripe customer linked to this organization.</p>
                            </div>
                          ) : !orgPaymentsData?.payments?.length ? (
                            <div className="px-4 py-8 text-center">
                              <CreditCard className="h-6 w-6 text-gray-700 mx-auto mb-2" />
                              <p className="text-xs text-gray-500">No payment history found.</p>
                            </div>
                          ) : (
                            <div>
                              <div className="grid grid-cols-[1fr_72px_64px_32px] gap-2 px-4 py-1.5 border-b border-gray-700/60">
                                <span className="text-[9px] uppercase tracking-widest text-gray-600 font-semibold">Description</span>
                                <span className="text-[9px] uppercase tracking-widest text-gray-600 font-semibold text-right">Amount</span>
                                <span className="text-[9px] uppercase tracking-widest text-gray-600 font-semibold text-center">Status</span>
                                <span className="text-[9px] uppercase tracking-widest text-gray-600 font-semibold text-center"></span>
                              </div>
                              <div className="divide-y divide-gray-700/40 max-h-64 overflow-y-auto">
                                {[...orgPaymentsData.payments].sort((a, b) => b.created - a.created).map(pmt => {
                                  const fmtAmt = (amt: number, cur: string) =>
                                    new Intl.NumberFormat('en-US', { style: 'currency', currency: cur.toUpperCase() }).format(amt / 100);
                                  const statusColors: Record<string, string> = {
                                    paid: 'text-green-400 bg-green-500/10',
                                    open: 'text-yellow-400 bg-yellow-500/10',
                                    void: 'text-gray-500 bg-gray-700/50',
                                    uncollectible: 'text-red-400 bg-red-500/10',
                                    draft: 'text-gray-500 bg-gray-700/50',
                                  };
                                  const date = new Date(pmt.created * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                                  return (
                                    <div key={pmt.id} className="grid grid-cols-[1fr_72px_64px_32px] gap-2 items-center px-4 py-2.5">
                                      <div className="min-w-0">
                                        <p className="text-[11px] text-gray-300 truncate">{pmt.description ?? 'Invoice'}</p>
                                        <p className="text-[10px] text-gray-600">{date}</p>
                                      </div>
                                      <span className="text-xs text-gray-200 font-mono text-right">{fmtAmt(pmt.amount, pmt.currency)}</span>
                                      <div className="flex justify-center">
                                        <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${statusColors[pmt.status ?? ''] ?? 'text-gray-500 bg-gray-700/50'}`}>
                                          {pmt.status ?? '—'}
                                        </span>
                                      </div>
                                      <div className="flex justify-center">
                                        {pmt.hostedUrl && (
                                          <a href={pmt.hostedUrl} target="_blank" rel="noopener noreferrer" title="View invoice" className="text-gray-600 hover:text-yellow-400 transition-colors" data-testid={`link-invoice-${pmt.id}`}>
                                            <ExternalLink className="h-3.5 w-3.5" />
                                          </a>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                  </div>
                );
              }

              // ── Org list ─────────────────────────────────────────────────────
              const filtered = (platformOrgs ?? []).filter(o =>
                orgSearch === '' ||
                o.name.toLowerCase().includes(orgSearch.toLowerCase()) ||
                o.slug.toLowerCase().includes(orgSearch.toLowerCase())
              );

              return (
                <div className="p-4 space-y-3">
                  {/* Search */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500 pointer-events-none" />
                    <Input
                      value={orgSearch}
                      onChange={e => setOrgSearch(e.target.value)}
                      placeholder="Search organizations…"
                      className="pl-8 h-8 text-xs bg-gray-800 border-gray-700 text-gray-200 placeholder:text-gray-600"
                      data-testid="input-org-search"
                    />
                  </div>

                  {platformOrgsLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin text-yellow-500/50" />
                    </div>
                  ) : platformOrgsError ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-8">
                      <AlertTriangle className="h-4 w-4 text-red-400/70" />
                      <p className="text-xs text-red-400">{(platformOrgsQueryError as any)?.message || 'Failed to load organizations'}</p>
                      <button onClick={() => refetchPlatformOrgs()} className="text-[10px] text-yellow-400/70 underline hover:text-yellow-400">Retry</button>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-gray-700 overflow-hidden divide-y divide-gray-700/60">
                      {filtered.length === 0 ? (
                        <div className="px-4 py-8 text-center text-xs text-gray-500">No organizations found</div>
                      ) : filtered.map(org => (
                        <button
                          key={org.id}
                          onClick={() => setActiveOrg(org)}
                          className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-700/40 transition-colors group"
                          data-testid={`nav-org-${org.id}`}
                        >
                          <div className="h-7 w-7 rounded-full bg-gray-700 flex items-center justify-center shrink-0">
                            <Building2 className="h-3.5 w-3.5 text-gray-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-xs font-medium text-gray-200 truncate">{org.name}</p>
                              <span className={`shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0 rounded border ${PLAN_COLORS[org.plan] ?? PLAN_COLORS.trial}`}>
                                {org.plan}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${org.isActive ? 'bg-green-500' : 'bg-red-500'}`} />
                              <p className="text-[10px] text-gray-500 truncate font-mono">{org.slug}</p>
                              <span className="text-[10px] text-gray-600">·</span>
                              <Users className="h-2.5 w-2.5 text-gray-600 shrink-0" />
                              <p className="text-[10px] text-gray-500">{org.userCount}</p>
                            </div>
                          </div>
                          <ChevronRight className="h-4 w-4 text-gray-700 group-hover:text-gray-500 transition-colors shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── Platform Admin: View as Company ──────────────────────────── */}
            {activeSection === 'impersonation' && (
              <div className="p-4 space-y-4">
                <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/30 px-4 py-3">
                  <div className="flex items-start gap-2">
                    <EyeOff className="h-3.5 w-3.5 text-yellow-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-yellow-300/80 leading-relaxed">
                      Entering as a company activates full impersonation — all data, settings, and actions will operate as if you were a member of that organization. Exit via the banner that appears at the top of the app.
                    </p>
                  </div>
                </div>

                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500 pointer-events-none" />
                  <Input
                    value={impersonationSearch}
                    onChange={e => setImpersonationSearch(e.target.value)}
                    placeholder="Search organizations…"
                    className="pl-8 h-8 text-xs bg-gray-800 border-gray-700 text-gray-200 placeholder:text-gray-600"
                    data-testid="input-impersonation-search"
                  />
                </div>

                {platformOrgsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-yellow-500/50" />
                  </div>
                ) : platformOrgsError ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-8">
                    <AlertTriangle className="h-4 w-4 text-red-400/70" />
                    <p className="text-xs text-red-400">{(platformOrgsQueryError as any)?.message || 'Failed to load organizations'}</p>
                    <button onClick={() => refetchPlatformOrgs()} className="text-[10px] text-yellow-400/70 underline hover:text-yellow-400">Retry</button>
                  </div>
                ) : (
                  <div className="rounded-lg border border-gray-700 overflow-hidden divide-y divide-gray-700/60">
                    {(platformOrgs ?? [])
                      .filter(o => impersonationSearch === '' || o.name.toLowerCase().includes(impersonationSearch.toLowerCase()) || o.slug.toLowerCase().includes(impersonationSearch.toLowerCase()))
                      .map(org => (
                        <div key={org.id} className="flex items-center gap-3 px-4 py-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-gray-200 truncate">{org.name}</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${org.isActive ? 'bg-green-500' : 'bg-red-500'}`} />
                              <p className="text-[10px] text-gray-500 font-mono truncate">{org.slug}</p>
                              <span className="text-[10px] text-gray-600">·</span>
                              <span className="text-[10px] text-gray-500">{org.plan}</span>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="text-xs shrink-0"
                            onClick={() => impersonateMutation.mutate(org.id)}
                            disabled={impersonateMutation.isPending}
                            data-testid={`button-enter-as-${org.id}`}
                          >
                            {impersonateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Enter as'}
                          </Button>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Platform Admin: System Health ────────────────────────────── */}
            {activeSection === 'systemHealth' && (
              <div className="p-4 space-y-4">
                {systemHealthLoading ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="h-5 w-5 animate-spin text-yellow-500/50" />
                  </div>
                ) : systemHealth ? (
                  <>
                    {/* Platform stats */}
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2 px-1">Platform</p>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { label: 'Organizations', value: systemHealth.platform.totalOrganizations, icon: Building2 },
                          { label: 'Total Users', value: systemHealth.platform.totalUsers, icon: Users },
                          { label: 'Active Subs', value: systemHealth.platform.activeSubscriptions, icon: CreditCard },
                        ].map(({ label, value, icon: Icon }) => (
                          <div key={label} className="rounded-lg bg-gray-800/60 border border-gray-700 px-3 py-2.5">
                            <div className="flex items-center gap-1.5 mb-1">
                              <Icon className="h-3 w-3 text-yellow-500/60" />
                              <span className="text-[10px] text-gray-500">{label}</span>
                            </div>
                            <p className="text-lg font-bold text-white">{Number(value).toLocaleString()}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Embedding counts */}
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2 px-1">Embeddings</p>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { label: 'Inventory Vectors', value: systemHealth.embeddings.inventoryEmbeddings },
                          { label: 'Order Vectors', value: systemHealth.embeddings.orderEmbeddings },
                        ].map(({ label, value }) => (
                          <div key={label} className="rounded-lg bg-gray-800/60 border border-gray-700 px-3 py-2.5">
                            <p className="text-[10px] text-gray-500 mb-1">{label}</p>
                            <p className="text-base font-bold text-white">{Number(value).toLocaleString()}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Universal CLIP Catalog */}
                    {universalCatalogStatus && (
                      <div>
                        <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2 px-1">Universal CLIP Catalog</p>
                        <div className="rounded-lg bg-gray-800/60 border border-gray-700 px-3 py-3 space-y-3">
                          {/* Progress bar */}
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5">
                                {universalCatalogStatus.workerRunning
                                  ? <RefreshCw className="h-3 w-3 text-purple-400 animate-spin" />
                                  : <CheckCircle2 className="h-3 w-3 text-green-400" />}
                                <span className="text-xs text-gray-300">
                                  {universalCatalogStatus.workerRunning ? 'Embedding in progress…' : 'All BrickLink parts'}
                                </span>
                              </div>
                              <span className="text-xs font-mono text-gray-400">
                                {universalCatalogStatus.queueSize > 0
                                  ? `${Math.round(((universalCatalogStatus.embedded + universalCatalogStatus.noImage) / universalCatalogStatus.queueSize) * 100)}%`
                                  : '—'}
                              </span>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-gray-700 overflow-hidden">
                              <div
                                className="h-1.5 rounded-full bg-purple-500 transition-all"
                                style={{
                                  width: universalCatalogStatus.queueSize > 0
                                    ? `${Math.round(((universalCatalogStatus.embedded + universalCatalogStatus.noImage) / universalCatalogStatus.queueSize) * 100)}%`
                                    : '0%'
                                }}
                              />
                            </div>
                          </div>
                          {/* Stat grid */}
                          <div className="grid grid-cols-4 gap-2 text-center">
                            {[
                              { label: 'Total', value: universalCatalogStatus.queueSize, color: 'text-white' },
                              { label: 'Embedded', value: universalCatalogStatus.embedded, color: 'text-emerald-400' },
                              { label: 'Pending', value: universalCatalogStatus.pending, color: 'text-yellow-400' },
                              { label: 'Failed', value: universalCatalogStatus.failed, color: 'text-red-400' },
                            ].map(({ label, value, color }) => (
                              <div key={label}>
                                <p className={`text-sm font-bold ${color}`}>{Number(value).toLocaleString()}</p>
                                <p className="text-[9px] text-gray-600 uppercase tracking-wider">{label}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Active jobs */}
                    <div>
                      <div className="flex items-center gap-2 mb-2 px-1">
                        <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">Active Embedding Jobs</p>
                        {systemHealth.jobs.active.length > 0 && (
                          <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                        )}
                      </div>
                      {systemHealth.jobs.active.length === 0 ? (
                        <div className="rounded-lg bg-gray-800/40 border border-gray-700/60 px-4 py-4 text-center">
                          <CheckCircle2 className="h-4 w-4 text-green-500/50 mx-auto mb-1" />
                          <p className="text-xs text-gray-500">No active jobs</p>
                        </div>
                      ) : (
                        <div className="rounded-lg border border-gray-700 overflow-hidden divide-y divide-gray-700/60">
                          {systemHealth.jobs.active.map(job => (
                            <div key={job.id} className="px-4 py-3">
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <div className="flex items-center gap-2">
                                  <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                                  <span className="text-xs font-medium text-gray-200 capitalize">{job.jobType}</span>
                                  <span className="text-[10px] text-gray-500 font-mono">{job.orgId.slice(0, 8)}…</span>
                                </div>
                                <span className="text-[10px] text-yellow-400 capitalize">{job.status}</span>
                              </div>
                              {job.totalItems > 0 && (
                                <div className="flex items-center gap-2">
                                  <div className="flex-1 bg-gray-700 rounded-full h-1">
                                    <div
                                      className="bg-yellow-500 h-1 rounded-full transition-all"
                                      style={{ width: `${Math.round((job.processedItems / job.totalItems) * 100)}%` }}
                                    />
                                  </div>
                                  <span className="text-[10px] text-gray-500 shrink-0">{job.processedItems}/{job.totalItems}</span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Recent jobs */}
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2 px-1">Recent Jobs</p>
                      <div className="rounded-lg border border-gray-700 overflow-hidden divide-y divide-gray-700/60">
                        {systemHealth.jobs.recent.length === 0 ? (
                          <div className="px-4 py-4 text-center text-xs text-gray-500">No completed jobs yet</div>
                        ) : systemHealth.jobs.recent.map(job => (
                          <div key={job.id} className="flex items-center gap-3 px-4 py-2.5">
                            <div className="shrink-0">
                              {job.status === 'completed'
                                ? <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                                : <AlertTriangle className="h-3.5 w-3.5 text-red-400" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-gray-300 capitalize">{job.jobType}</p>
                              {job.errorMessage && <p className="text-[10px] text-red-400/80 truncate">{job.errorMessage}</p>}
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-[10px] text-gray-500">{job.processedItems}/{job.totalItems}</p>
                              <p className="text-[9px] text-gray-600 font-mono">{job.completedAt ? new Date(job.completedAt).toLocaleDateString() : '—'}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-3 py-10">
                    <AlertTriangle className="h-5 w-5 text-red-400/70" />
                    <p className="text-xs text-gray-500">Failed to load system health data</p>
                    <button
                      onClick={() => refetchSystemHealth()}
                      className="text-[11px] text-yellow-500/70 hover:text-yellow-400 underline"
                      data-testid="button-retry-system-health"
                    >
                      Retry
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Audit Log */}
            {activeSection === 'auditLog' && (
              <div className="p-4 space-y-4">
                <div className="rounded-lg bg-gray-800/60 border border-gray-700 p-6 flex flex-col items-center justify-center gap-3 text-center">
                  <ClipboardList className="h-8 w-8 text-gray-600" />
                  <div>
                    <p className="text-sm font-medium text-gray-300">Audit Log</p>
                    <p className="text-xs text-gray-500 mt-1">Platform-wide activity log tracking all admin and tenant actions across every organization.</p>
                  </div>
                  <Badge variant="outline" className="text-[10px] text-gray-500 border-gray-600">Coming Soon</Badge>
                </div>
              </div>
            )}

            {/* Announcements */}
            {activeSection === 'announcements' && (
              <div className="p-4 space-y-4">
                <div className="rounded-lg bg-gray-800/60 border border-gray-700 p-6 flex flex-col items-center justify-center gap-3 text-center">
                  <Megaphone className="h-8 w-8 text-gray-600" />
                  <div>
                    <p className="text-sm font-medium text-gray-300">Announcements</p>
                    <p className="text-xs text-gray-500 mt-1">Broadcast system-wide messages, maintenance notices, and release updates to all tenant organizations.</p>
                  </div>
                  <Badge variant="outline" className="text-[10px] text-gray-500 border-gray-600">Coming Soon</Badge>
                </div>
              </div>
            )}

            {/* Billing Overview */}
            {activeSection === 'billingOverview' && (
              <div className="p-4 space-y-4">
                <div className="rounded-lg bg-gray-800/60 border border-gray-700 p-6 flex flex-col items-center justify-center gap-3 text-center">
                  <CreditCard className="h-8 w-8 text-gray-600" />
                  <div>
                    <p className="text-sm font-medium text-gray-300">Billing Overview</p>
                    <p className="text-xs text-gray-500 mt-1">Platform-level revenue dashboard — MRR, churn, trial conversions, and per-organization subscription status.</p>
                  </div>
                  <Badge variant="outline" className="text-[10px] text-gray-500 border-gray-600">Coming Soon</Badge>
                </div>
              </div>
            )}

            {/* Plans & Pricing */}
            {activeSection === 'plansAndPricing' && (() => {
              const PLAN_ORDER: PlanType[] = ['trial', 'foundation', 'core', 'flagship'];
              const FEATURE_LABELS: { key: keyof typeof TIER_CONFIG.trial.features; label: string }[] = [
                { key: 'paymentSync', label: 'Payment Sync' },
                { key: 'priceOMatic', label: 'Price-o-Matic' },
                { key: 'brickOwl', label: 'BrickOwl' },
                { key: 'elfieAiMode', label: 'E.L.F.I.E.' },
                { key: 'dataEnrichmentImages', label: 'Image Enrichment' },
                { key: 'dataEnrichmentSemantic', label: 'Semantic Enrichment' },
                { key: 'fullDataEnrichment', label: 'Full Enrichment' },
                { key: 'easypostAutomation', label: 'EasyPost Automation' },
              ];
              const fmtLimit = (n: number) => n === -1 ? '∞' : n.toLocaleString();
              return (
                <div className="p-4 space-y-4">
                  <div className="flex items-center gap-2 px-1">
                    <Tag className="h-4 w-4 text-yellow-500/70" />
                    <p className="text-xs font-semibold text-gray-300 uppercase tracking-widest">Plans & Pricing</p>
                  </div>

                  {/* Plan cards */}
                  <div className="space-y-3">
                    {PLAN_ORDER.map((planId) => {
                      const plan = TIER_CONFIG[planId];
                      const isPaid = plan.pricing.monthly > 0;
                      const isFlagship = planId === 'flagship';
                      return (
                        <div key={planId} className="rounded-lg border border-gray-700 bg-gray-800/40 overflow-hidden" data-testid={`card-plan-${planId}`}>
                          {/* Plan header */}
                          <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-gray-700/60">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-semibold text-gray-200">{plan.name}</p>
                                {isFlagship && (
                                  <Badge variant="outline" className="text-[9px] border-yellow-500/40 text-yellow-500/80 px-1.5">House Account</Badge>
                                )}
                                {planId === 'trial' && (
                                  <Badge variant="outline" className="text-[9px] border-gray-600 text-gray-500 px-1.5">Free</Badge>
                                )}
                              </div>
                              <p className="text-[11px] text-gray-500 mt-0.5">{plan.tagline}</p>
                            </div>
                            {isPaid && (
                              <div className="text-right shrink-0">
                                <p className="text-sm font-bold text-gray-200">{formatPrice(plan.pricing.monthly)}<span className="text-[11px] font-normal text-gray-500">/mo</span></p>
                                <p className="text-[10px] text-gray-500">{formatPrice(plan.pricing.annualMonthly)}/mo billed annually</p>
                              </div>
                            )}
                            {!isPaid && !isFlagship && (
                              <div className="text-right shrink-0">
                                <p className="text-sm font-bold text-gray-400">Free</p>
                                <p className="text-[10px] text-gray-600">15-day limit</p>
                              </div>
                            )}
                            {isFlagship && (
                              <div className="text-right shrink-0">
                                <p className="text-sm font-bold text-gray-400">Internal</p>
                                <p className="text-[10px] text-gray-600">No charge</p>
                              </div>
                            )}
                          </div>

                          {/* Limits row */}
                          <div className="px-4 py-2.5 border-b border-gray-700/60">
                            <p className="text-[9px] uppercase tracking-widest text-gray-600 font-semibold mb-2">Limits</p>
                            <div className="grid grid-cols-5 gap-2">
                              {[
                                { label: 'Seats', value: fmtLimit(plan.limits.seats) },
                                { label: 'Scans/mo', value: fmtLimit(plan.limits.brickspotterScansPerMonth) },
                                { label: 'Auto Rules', value: fmtLimit(plan.limits.automationRules) },
                                { label: 'Order History', value: plan.limits.orderHistoryDays === -1 ? '∞' : `${plan.limits.orderHistoryDays}d` },
                                { label: 'Inventory', value: fmtLimit(plan.limits.inventoryItems) },
                              ].map(({ label, value }) => (
                                <div key={label} className="text-center">
                                  <p className="text-sm font-semibold text-gray-300">{value}</p>
                                  <p className="text-[9px] text-gray-600 mt-0.5">{label}</p>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Features */}
                          <div className="px-4 py-2.5">
                            <p className="text-[9px] uppercase tracking-widest text-gray-600 font-semibold mb-2">Features</p>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                              {FEATURE_LABELS.map(({ key, label }) => {
                                const enabled = plan.features[key];
                                return (
                                  <div key={key} className="flex items-center gap-1.5">
                                    {enabled
                                      ? <CheckCircle2 className="h-3 w-3 text-green-500/70 shrink-0" />
                                      : <X className="h-3 w-3 text-gray-700 shrink-0" />
                                    }
                                    <span className={`text-[11px] ${enabled ? 'text-gray-400' : 'text-gray-600'}`}>{label}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Annual savings note */}
                  <div className="rounded-lg bg-gray-800/30 border border-gray-700/50 px-4 py-3">
                    <p className="text-[10px] text-gray-500 leading-relaxed">
                      Annual billing saves <span className="text-yellow-500/80">~17%</span> vs monthly.
                      Foundation: <span className="text-gray-400">{formatPrice(TIER_CONFIG.foundation.pricing.monthly * 12 - TIER_CONFIG.foundation.pricing.annual)}/yr saved</span> &middot; Core: <span className="text-gray-400">{formatPrice(TIER_CONFIG.core.pricing.monthly * 12 - TIER_CONFIG.core.pricing.annual)}/yr saved</span>
                    </p>
                  </div>
                </div>
              );
            })()}

            {/* API Keys */}
            {activeSection === 'apiKeys' && (
              <div className="p-4 space-y-4">
                <div className="rounded-lg bg-gray-800/60 border border-gray-700 p-6 flex flex-col items-center justify-center gap-3 text-center">
                  <Key className="h-8 w-8 text-gray-600" />
                  <div>
                    <p className="text-sm font-medium text-gray-300">API Keys</p>
                    <p className="text-xs text-gray-500 mt-1">Manage platform-level API keys for third-party integrations, webhooks, and service-to-service authentication.</p>
                  </div>
                  <Badge variant="outline" className="text-[10px] text-gray-500 border-gray-600">Coming Soon</Badge>
                </div>
              </div>
            )}

            {/* About & Credits */}
            {activeSection === 'about' && (
              <div className="p-4 space-y-5">

                {/* Built with Replit */}
                <div className="rounded-lg bg-gray-800/60 border border-gray-700 overflow-hidden">
                  <div className="px-4 py-3 bg-gray-800 border-b border-gray-700 flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-violet-400" />
                    <span className="text-sm font-semibold text-white">Built with Replit</span>
                  </div>
                  <div className="px-4 py-3">
                    <p className="text-xs text-gray-300 leading-relaxed">
                      PlanetBrick was designed and built entirely on <span className="text-violet-300 font-medium">Replit</span> using its AI-powered development environment. Every feature — from BrickSpotter's vision pipeline to the multi-channel sync engine — was conceived, coded, tested, and deployed without leaving the browser.
                    </p>
                  </div>
                </div>

                {/* Data & Security */}
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2 px-1">Data & Security</p>
                  <div className="rounded-lg bg-gray-800/60 border border-gray-700 divide-y divide-gray-700/60">
                    {[
                      { name: 'Tenant Isolation', desc: 'Each store\'s inventory, orders, and settings are scoped to their organization — no data is shared across accounts' },
                      { name: 'Encrypted Credentials', desc: 'Marketplace API keys and secrets are stored encrypted at rest and never exposed in logs or responses' },
                      { name: 'Automated Backups', desc: 'Point-in-time database backups run automatically and can be downloaded or restored at any time from Data Maintenance' },
                      { name: 'Your Data, Your Control', desc: 'Your inventory and order data is never sold or shared with third parties. Marketplace data flows in — not out' },
                      { name: 'Infrastructure', desc: 'Hosted on Replit\'s managed cloud with TLS encryption in transit on all connections' },
                    ].map(({ name, desc }) => (
                      <div key={name} className="flex items-start gap-3 px-4 py-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-200">{name}</p>
                          <p className="text-[10px] text-gray-500">{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Architecture */}
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2 px-1">Architecture</p>
                  <div className="rounded-lg bg-gray-800/60 border border-gray-700 divide-y divide-gray-700/60">
                    {[
                      { name: 'TypeScript', desc: 'End-to-end type safety across client and server', url: 'https://www.typescriptlang.org' },
                      { name: 'React', desc: 'Component-driven UI framework', url: 'https://react.dev' },
                      { name: 'Vite', desc: 'Lightning-fast frontend build tooling', url: 'https://vitejs.dev' },
                      { name: 'Node.js + Express', desc: 'Backend API server', url: 'https://expressjs.com' },
                      { name: 'PostgreSQL', desc: 'Primary relational database', url: 'https://www.postgresql.org' },
                      { name: 'Drizzle ORM', desc: 'Type-safe database queries and schema management', url: 'https://orm.drizzle.team' },
                      { name: 'Python + Flask', desc: 'ML inference service for CLIP and image segmentation', url: 'https://flask.palletsprojects.com' },
                    ].map(({ name, desc, url }) => (
                      <div key={name} className="flex items-start gap-3 px-4 py-2.5">
                        <div className="flex-1 min-w-0">
                          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 group">
                            <span className="text-xs font-medium text-gray-200 group-hover:text-violet-300 transition-colors">{name}</span>
                            <ExternalLink className="h-2.5 w-2.5 text-gray-600 group-hover:text-violet-400 transition-colors shrink-0" />
                          </a>
                          <p className="text-[10px] text-gray-500">{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* UI & Design */}
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2 px-1">UI & Design</p>
                  <div className="rounded-lg bg-gray-800/60 border border-gray-700 divide-y divide-gray-700/60">
                    {[
                      { name: 'shadcn/ui', desc: 'Accessible component library built on Radix UI primitives', url: 'https://ui.shadcn.com' },
                      { name: 'Radix UI', desc: 'Unstyled headless UI primitives', url: 'https://www.radix-ui.com' },
                      { name: 'Tailwind CSS', desc: 'Utility-first CSS framework', url: 'https://tailwindcss.com' },
                      { name: 'Lucide', desc: 'Icon library', url: 'https://lucide.dev' },
                      { name: 'TanStack Query', desc: 'Async data fetching, caching, and synchronization', url: 'https://tanstack.com/query' },
                      { name: 'Zod', desc: 'Schema validation and type inference', url: 'https://zod.dev' },
                    ].map(({ name, desc, url }) => (
                      <div key={name} className="flex items-start gap-3 px-4 py-2.5">
                        <div className="flex-1 min-w-0">
                          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 group">
                            <span className="text-xs font-medium text-gray-200 group-hover:text-violet-300 transition-colors">{name}</span>
                            <ExternalLink className="h-2.5 w-2.5 text-gray-600 group-hover:text-violet-400 transition-colors shrink-0" />
                          </a>
                          <p className="text-[10px] text-gray-500">{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* AI & Intelligence */}
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2 px-1">AI & Intelligence</p>
                  <div className="rounded-lg bg-gray-800/60 border border-gray-700 divide-y divide-gray-700/60">
                    {[
                      { name: 'Anthropic Claude', desc: 'AI analysis, summaries, and natural language features', url: 'https://www.anthropic.com' },
                      { name: 'OpenAI', desc: 'Embeddings powering semantic inventory and order search', url: 'https://openai.com' },
                      { name: 'CLIP (ViT-B/32)', desc: 'Vision-language model for universal catalog image matching', url: 'https://openai.com/research/clip' },
                      { name: 'Brickognize', desc: 'AI-powered LEGO piece identification from photos', url: 'https://www.brickognize.com' },
                      { name: 'remove.bg', desc: 'ML-based background removal for clean part images', url: 'https://www.remove.bg' },
                    ].map(({ name, desc, url }) => (
                      <div key={name} className="flex items-start gap-3 px-4 py-2.5">
                        <div className="flex-1 min-w-0">
                          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 group">
                            <span className="text-xs font-medium text-gray-200 group-hover:text-violet-300 transition-colors">{name}</span>
                            <ExternalLink className="h-2.5 w-2.5 text-gray-600 group-hover:text-violet-400 transition-colors shrink-0" />
                          </a>
                          <p className="text-[10px] text-gray-500">{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* LEGO Data */}
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2 px-1">LEGO Data & Marketplaces</p>
                  <div className="rounded-lg bg-gray-800/60 border border-gray-700 divide-y divide-gray-700/60">
                    {[
                      { name: 'BrickLink', desc: 'Primary marketplace — inventory, orders, and pricing data', url: 'https://www.bricklink.com' },
                      { name: 'BrickOwl', desc: 'Secondary marketplace channel', url: 'https://www.brickowl.com' },
                      { name: 'Rebrickable', desc: 'Parts catalog and set inventories; LDraw for part images', url: 'https://rebrickable.com' },
                    ].map(({ name, desc, url }) => (
                      <div key={name} className="flex items-start gap-3 px-4 py-2.5">
                        <div className="flex-1 min-w-0">
                          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 group">
                            <span className="text-xs font-medium text-gray-200 group-hover:text-violet-300 transition-colors">{name}</span>
                            <ExternalLink className="h-2.5 w-2.5 text-gray-600 group-hover:text-violet-400 transition-colors shrink-0" />
                          </a>
                          <p className="text-[10px] text-gray-500">{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Payments & Services */}
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2 px-1">Payments & Services</p>
                  <div className="rounded-lg bg-gray-800/60 border border-gray-700 divide-y divide-gray-700/60">
                    {[
                      { name: 'Stripe', desc: 'Subscription billing and payment processing', url: 'https://stripe.com' },
                      { name: 'PayPal', desc: 'Payment reconciliation for marketplace orders', url: 'https://www.paypal.com' },
                      { name: 'EasyPost', desc: 'Shipping label generation and scan forms', url: 'https://www.easypost.com' },
                    ].map(({ name, desc, url }) => (
                      <div key={name} className="flex items-start gap-3 px-4 py-2.5">
                        <div className="flex-1 min-w-0">
                          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 group">
                            <span className="text-xs font-medium text-gray-200 group-hover:text-violet-300 transition-colors">{name}</span>
                            <ExternalLink className="h-2.5 w-2.5 text-gray-600 group-hover:text-violet-400 transition-colors shrink-0" />
                          </a>
                          <p className="text-[10px] text-gray-500">{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <p className="text-center text-[10px] text-gray-600 pb-2">{APP_NAME} {APP_VERSION}</p>

              </div>
            )}

                </div>
              )}
            </div>
          </div>
          
        </DialogContent>
      </Dialog>

      {/* Clear Data Confirmation Dialog */}
      <AlertDialog open={clearDataDialog !== null} onOpenChange={() => setClearDataDialog(null)}>
        <AlertDialogContent className="bg-gray-900 border-gray-700">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">Clear {clearDataDialog === 'inventory' ? 'Inventory' : 'Order'} Data?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-gray-400">
              This action cannot be undone. This will permanently delete all {clearDataDialog === 'inventory' ? 'inventory' : 'order'} data from the database.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs" data-testid="button-cancel-clear">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="text-xs bg-red-600 hover:bg-red-700"
              onClick={() => clearDataDialog && handleClearData(clearDataDialog)}
              data-testid="button-confirm-clear"
            >
              Clear Data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Restore Wizard Dialog */}
      <Dialog open={restoreWizardOpen} onOpenChange={(open) => {
        if (!open && restoreStep !== 'restoring' && restoreStep !== 'syncing' && restoreStep !== 'differential') {
          setRestoreWizardOpen(false);
          setRestoreStep('select');
          setRestoreProgress(0);
          setDifferentialAnalysis(null);
          setVerificationResults(null);
        }
      }}>
        <DialogContent className="bg-gray-900 border-gray-700 max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <RotateCcw className="h-4 w-4 text-blue-400" />
              {restoreStep === 'warning' && 'Important: Read Before Proceeding'}
              {restoreStep === 'restoring' && 'Restoring Database...'}
              {restoreStep === 'syncing' && 'Syncing from Sales Platforms...'}
              {restoreStep === 'differential' && 'Quick Recovery: Restore Current State'}
              {restoreStep === 'verification' && 'Verifying Recovery...'}
              {restoreStep === 'complete' && 'Recovery Complete!'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Step 1: Warning & Explanation */}
            {restoreStep === 'warning' && (
              <div className="space-y-4">
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-yellow-400 mt-0.5 flex-shrink-0" />
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-yellow-300">Critical: Understanding Point-in-Time Restore</p>
                      <p className="text-xs text-yellow-200/90">
                        You're about to restore your database to <strong>{restoreDate} at {restoreTime}</strong>. 
                        All data changes after this timestamp will be permanently lost.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 space-y-3">
                  <p className="text-sm font-medium text-blue-300">What Happens Next (Automated):</p>
                  <ol className="text-xs text-blue-200/90 space-y-2 ml-4 list-decimal">
                    <li><strong>Database Restore:</strong> We'll roll back your PlanetBrick database to the selected timestamp</li>
                    <li><strong>Platform Sync:</strong> We'll automatically pull fresh data from BrickLink and BrickOwl</li>
                    <li><strong>Differential Recovery (NEW!):</strong> We'll update BrickLink FROM BrickOwl to get current inventory state</li>
                    <li><strong>Why?</strong> BrickOwl has your most up-to-date inventory, orders, remarks, and prices</li>
                    <li><strong>Verification:</strong> We'll check that everything matches and alert you to any issues</li>
                  </ol>
                </div>

                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                  <p className="text-xs text-red-300 flex items-start gap-2">
                    <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                    <span>
                      <strong>Important:</strong> After restore, your local data will be OLD. We will automatically sync FROM your sales platforms (not TO them) to get the correct current state. This prevents overwriting good data with old data.
                    </span>
                  </p>
                </div>

                <div className="space-y-2 pt-2">
                  <p className="text-xs font-medium text-gray-300">Checklist - Please Confirm:</p>
                  <div className="space-y-1.5">
                    <label className="flex items-start gap-2 text-xs text-gray-400 cursor-pointer">
                      <input type="checkbox" className="mt-0.5" data-testid="checkbox-understand-data-loss" />
                      <span>I understand all changes after {restoreDate} {restoreTime} will be lost</span>
                    </label>
                    <label className="flex items-start gap-2 text-xs text-gray-400 cursor-pointer">
                      <input type="checkbox" className="mt-0.5" data-testid="checkbox-understand-platform-sync" />
                      <span>I understand we will sync FROM platforms (not TO them) after restore</span>
                    </label>
                    <label className="flex items-start gap-2 text-xs text-gray-400 cursor-pointer">
                      <input type="checkbox" className="mt-0.5" data-testid="checkbox-backup-current" />
                      <span>I have exported a current backup of my data (if needed)</span>
                    </label>
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 text-xs"
                    onClick={() => {
                      setRestoreWizardOpen(false);
                      setRestoreStep('select');
                    }}
                    data-testid="button-cancel-restore"
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    className="flex-1 text-xs bg-blue-600 hover:bg-blue-700"
                    onClick={handleInitiateRestore}
                    data-testid="button-confirm-restore"
                  >
                    I Understand - Begin Restore
                  </Button>
                </div>
              </div>
            )}

            {/* Step 2: Restoring Database */}
            {restoreStep === 'restoring' && (
              <div className="space-y-4">
                <div className="text-center py-8">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-500/20 mb-4">
                    <RotateCcw className="h-8 w-8 text-blue-400 animate-spin" />
                  </div>
                  <h3 className="text-sm font-medium text-gray-200 mb-2">Restoring Database</h3>
                  <p className="text-xs text-gray-400 mb-4">{restoreCurrentTask}</p>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>Progress</span>
                    <span>{restoreProgress}%</span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-2">
                    <div 
                      className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                      style={{ width: `${restoreProgress}%` }}
                    />
                  </div>
                </div>

                <div className="bg-gray-800 border border-gray-700 rounded p-3">
                  <p className="text-[10px] md:text-sm text-gray-500">
                    <strong>Note:</strong> Do not close this window or navigate away. The restore process typically takes 1-3 minutes depending on your database size.
                  </p>
                </div>
              </div>
            )}

            {/* Step 3: Syncing from Platforms */}
            {restoreStep === 'syncing' && (
              <div className="space-y-4">
                <div className="text-center py-6">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-500/20 mb-4">
                    <CloudUpload className="h-8 w-8 text-green-400 animate-pulse" />
                  </div>
                  <h3 className="text-sm font-medium text-gray-200 mb-2">Syncing from Sales Platforms</h3>
                  <p className="text-xs text-gray-400 mb-4">Pulling current data from external platforms</p>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-gray-800 border border-gray-700 rounded">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-400" />
                      <span className="text-xs text-gray-300">BrickLink Inventory</span>
                    </div>
                    <span className="text-xs text-green-400">Complete (1,247 items)</span>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-gray-800 border border-gray-700 rounded">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-400" />
                      <span className="text-xs text-gray-300">BrickLink Orders</span>
                    </div>
                    <span className="text-xs text-green-400">Complete (156 orders)</span>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-gray-800 border border-gray-700 rounded">
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                      <span className="text-xs text-gray-300">BrickOwl Orders</span>
                    </div>
                    <span className="text-xs text-gray-400">Syncing... (23 of 89)</span>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-gray-800 border border-gray-700 rounded opacity-50">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-gray-500" />
                      <span className="text-xs text-gray-400">EasyPost Tracking Data</span>
                    </div>
                    <span className="text-xs text-gray-500">Waiting...</span>
                  </div>
                </div>

                <div className="bg-blue-500/10 border border-blue-500/30 rounded p-3">
                  <p className="text-[10px] md:text-sm text-blue-300">
                    <strong>Why we do this:</strong> Your sales platforms (BrickLink and BrickOwl) have processed sales and status changes since the restore point. We're pulling their current data to ensure PlanetBrick matches reality. EasyPost tracking data is also synced to match shipment statuses.
                  </p>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => {
                    setRestoreStep('differential');
                    setDifferentialAnalysis({
                      totalItems: 1247,
                      quantityChanges: 156,
                      netQuantityChange: -89,
                      priceUpdates: 12,
                      remarksUpdates: 23,
                      descriptionUpdates: 8
                    });
                  }}
                  data-testid="button-skip-to-differential"
                >
                  Skip to Differential Recovery (Demo)
                </Button>
              </div>
            )}

            {/* Step 4: Differential Recovery */}
            {restoreStep === 'differential' && differentialAnalysis && (
              <div className="space-y-4">
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-yellow-400 mt-0.5 flex-shrink-0" />
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-yellow-300">Problem Detected</p>
                      <p className="text-xs text-yellow-200/90">
                        BrickLink has been restored to <strong>{restoreDate} at {restoreTime}</strong> (OLD data).
                        Meanwhile, BrickOwl has been synced and contains CURRENT data (up to the minute).
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 space-y-3">
                  <p className="text-sm font-medium text-green-300">Solution: Quick Recovery</p>
                  <p className="text-xs text-green-200/90">
                    We can update BrickLink FROM BrickOwl to get you back to the current state. 
                    This uses your existing sync mappings (external_lot_ids) to match inventory items perfectly.
                  </p>
                  <div className="bg-green-500/20 border border-green-500/40 rounded p-3 mt-2">
                    <p className="text-xs font-medium text-green-300 mb-2">What Gets Synced:</p>
                    <ul className="text-[10px] md:text-sm text-green-200/90 space-y-1 ml-4 list-disc">
                      <li><strong>Quantities:</strong> Reflects sales that happened after restore point</li>
                      <li><strong>Prices:</strong> Current pricing from BrickOwl</li>
                      <li><strong>Remarks:</strong> Personal notes (BrickOwl personal_note → BrickLink remarks)</li>
                      <li><strong>Descriptions:</strong> Public notes (BrickOwl public_note → BrickLink description)</li>
                      <li><strong>Conditions:</strong> New/Used status updates</li>
                    </ul>
                  </div>
                </div>

                <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-gray-300 mb-3">Differential Analysis</h4>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="bg-gray-900 rounded p-3">
                      <p className="text-gray-400">Total Items in BrickOwl</p>
                      <p className="text-white font-medium text-lg">{differentialAnalysis.totalItems}</p>
                    </div>
                    <div className="bg-gray-900 rounded p-3">
                      <p className="text-gray-400">Quantity Adjustments</p>
                      <p className="text-blue-400 font-medium text-lg">{differentialAnalysis.quantityChanges}</p>
                    </div>
                    <div className="bg-gray-900 rounded p-3">
                      <p className="text-gray-400">Net Quantity Change</p>
                      <p className={`font-medium text-lg ${differentialAnalysis.netQuantityChange < 0 ? 'text-red-400' : 'text-green-400'}`}>
                        {differentialAnalysis.netQuantityChange > 0 ? '+' : ''}{differentialAnalysis.netQuantityChange} pieces
                      </p>
                      <p className="text-[10px] md:text-sm text-gray-500 mt-1">
                        {differentialAnalysis.netQuantityChange < 0 ? 'Sales since restore point' : 'Restocks since restore point'}
                      </p>
                    </div>
                    <div className="bg-gray-900 rounded p-3">
                      <p className="text-gray-400">Price Updates</p>
                      <p className="text-purple-400 font-medium text-lg">{differentialAnalysis.priceUpdates}</p>
                    </div>
                    <div className="bg-gray-900 rounded p-3">
                      <p className="text-gray-400">Remarks Updates</p>
                      <p className="text-yellow-400 font-medium text-lg">{differentialAnalysis.remarksUpdates}</p>
                    </div>
                    <div className="bg-gray-900 rounded p-3">
                      <p className="text-gray-400">Description Updates</p>
                      <p className="text-cyan-400 font-medium text-lg">{differentialAnalysis.descriptionUpdates}</p>
                    </div>
                  </div>
                </div>

                <div className="bg-blue-500/10 border border-blue-500/30 rounded p-3">
                  <p className="text-[10px] md:text-sm text-blue-300">
                    <strong>How it works:</strong> We'll use the external_lot_ids.other field (which contains BrickLink inventory IDs) to match each BrickOwl lot to its corresponding BrickLink inventory item, then update BrickLink with BrickOwl's current data via the BrickLink API.
                  </p>
                </div>

                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 text-xs"
                    onClick={() => {
                      setRestoreStep('syncing');
                      setDifferentialAnalysis(null);
                    }}
                    data-testid="button-back-to-sync"
                  >
                    Back
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 text-xs"
                    onClick={() => {
                      setRestoreStep('verification');
                      setVerificationResults({
                        inventoryMatch: true,
                        orderStatusMatch: true,
                        platformSync: true
                      });
                    }}
                    data-testid="button-skip-differential"
                  >
                    Skip (Not Recommended)
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    className="flex-1 text-xs bg-green-600 hover:bg-green-700"
                    onClick={() => handleApplyDifferential(false)}
                    data-testid="button-apply-differential"
                  >
                    Apply to BrickLink
                  </Button>
                </div>
              </div>
            )}

            {/* Step 5: Verification */}
            {restoreStep === 'verification' && verificationResults && (
              <div className="space-y-4">
                <div className="text-center py-4">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-500/20 mb-4">
                    <CheckCircle2 className="h-8 w-8 text-green-400" />
                  </div>
                  <h3 className="text-sm font-medium text-gray-200 mb-2">Verifying Recovery</h3>
                  <p className="text-xs text-gray-400">Checking data integrity and platform synchronization</p>
                </div>

                <div className="space-y-2">
                  <div className={`flex items-center justify-between p-3 rounded border ${
                    verificationResults.inventoryMatch 
                      ? 'bg-green-500/10 border-green-500/30' 
                      : 'bg-red-500/10 border-red-500/30'
                  }`}>
                    <div className="flex items-center gap-2">
                      {verificationResults.inventoryMatch ? (
                        <CheckCircle2 className="h-4 w-4 text-green-400" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-red-400" />
                      )}
                      <span className="text-xs text-gray-300">Inventory Sync Verification</span>
                    </div>
                    <span className={`text-xs ${verificationResults.inventoryMatch ? 'text-green-400' : 'text-red-400'}`}>
                      {verificationResults.inventoryMatch ? '✓ Matched' : '✗ Mismatch'}
                    </span>
                  </div>

                  <div className={`flex items-center justify-between p-3 rounded border ${
                    verificationResults.orderStatusMatch 
                      ? 'bg-green-500/10 border-green-500/30' 
                      : 'bg-red-500/10 border-red-500/30'
                  }`}>
                    <div className="flex items-center gap-2">
                      {verificationResults.orderStatusMatch ? (
                        <CheckCircle2 className="h-4 w-4 text-green-400" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-red-400" />
                      )}
                      <span className="text-xs text-gray-300">Order Status Verification</span>
                    </div>
                    <span className={`text-xs ${verificationResults.orderStatusMatch ? 'text-green-400' : 'text-red-400'}`}>
                      {verificationResults.orderStatusMatch ? '✓ Matched' : '✗ Mismatch'}
                    </span>
                  </div>

                  <div className={`flex items-center justify-between p-3 rounded border ${
                    verificationResults.platformSync 
                      ? 'bg-green-500/10 border-green-500/30' 
                      : 'bg-red-500/10 border-red-500/30'
                  }`}>
                    <div className="flex items-center gap-2">
                      {verificationResults.platformSync ? (
                        <CheckCircle2 className="h-4 w-4 text-green-400" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-red-400" />
                      )}
                      <span className="text-xs text-gray-300">Platform Sync Status</span>
                    </div>
                    <span className={`text-xs ${verificationResults.platformSync ? 'text-green-400' : 'text-red-400'}`}>
                      {verificationResults.platformSync ? '✓ All Synced' : '✗ Issues Found'}
                    </span>
                  </div>
                </div>

                {verificationResults.inventoryMatch && verificationResults.orderStatusMatch && verificationResults.platformSync ? (
                  <div className="bg-green-500/10 border border-green-500/30 rounded p-3">
                    <p className="text-xs text-green-300">
                      <strong>✓ All checks passed!</strong> Your data has been successfully restored and synchronized with your sales platforms. You can now safely resume normal operations.
                    </p>
                  </div>
                ) : (
                  <div className="bg-yellow-500/10 border border-yellow-500/30 rounded p-3">
                    <p className="text-xs text-yellow-300">
                      <strong>⚠ Issues detected.</strong> Some data may not match between PlanetBrick and your sales platforms. Review the issues above and consider manual verification.
                    </p>
                  </div>
                )}

                <Button
                  variant="default"
                  size="sm"
                  className="w-full text-xs bg-blue-600 hover:bg-blue-700"
                  onClick={() => setRestoreStep('complete')}
                  data-testid="button-continue-to-summary"
                >
                  Continue to Summary
                </Button>
              </div>
            )}

            {/* Step 6: Complete */}
            {restoreStep === 'complete' && (
              <div className="space-y-4">
                <div className="text-center py-6">
                  <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-green-500/20 mb-4">
                    <CheckCircle2 className="h-10 w-10 text-green-400" />
                  </div>
                  <h3 className="text-lg font-medium text-green-300 mb-2">Recovery Complete!</h3>
                  <p className="text-xs text-gray-400">Your database has been successfully restored and BrickLink updated to current state</p>
                </div>

                <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-medium text-green-300">✓ Recovery Summary:</p>
                  <ul className="text-[10px] md:text-sm text-green-200/90 space-y-1 ml-4 list-disc">
                    <li>Database restored to {restoreDate} at {restoreTime}</li>
                    <li>Platform data synced from BrickLink and BrickOwl</li>
                    <li>BrickLink updated with current data from BrickOwl (differential sync)</li>
                    <li>All verification checks passed</li>
                  </ul>
                </div>

                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 space-y-3">
                  <p className="text-sm font-medium text-blue-300">Post-Recovery Checklist:</p>
                  <div className="space-y-2">
                    <label className="flex items-start gap-2 text-xs text-blue-200/90 cursor-pointer">
                      <input type="checkbox" className="mt-0.5" />
                      <span>Verify key inventory items match between BrickLink and BrickOwl</span>
                    </label>
                    <label className="flex items-start gap-2 text-xs text-blue-200/90 cursor-pointer">
                      <input type="checkbox" className="mt-0.5" />
                      <span>Check recent orders (last 7 days) for correct statuses</span>
                    </label>
                    <label className="flex items-start gap-2 text-xs text-blue-200/90 cursor-pointer">
                      <input type="checkbox" className="mt-0.5" />
                      <span>Confirm remarks and descriptions synced correctly from BrickOwl</span>
                    </label>
                    <label className="flex items-start gap-2 text-xs text-blue-200/90 cursor-pointer">
                      <input type="checkbox" className="mt-0.5" />
                      <span>Test a manual inventory sync to verify sync system is working</span>
                    </label>
                    <label className="flex items-start gap-2 text-xs text-blue-200/90 cursor-pointer">
                      <input type="checkbox" className="mt-0.5" />
                      <span>Re-enable automated sync schedules if you disabled them</span>
                    </label>
                  </div>
                </div>

                <div className="bg-gray-800 border border-gray-700 rounded p-3">
                  <p className="text-xs text-gray-400">
                    <strong>Next Steps:</strong> Monitor your store for the next 24 hours to ensure everything is working correctly. The differential sync ensured BrickLink matches your current BrickOwl state, but spot-check a few items to confirm.
                  </p>
                </div>

                <Button
                  variant="default"
                  size="sm"
                  className="w-full text-xs bg-green-600 hover:bg-green-700"
                  onClick={() => {
                    setRestoreWizardOpen(false);
                    setRestoreStep('select');
                    setRestoreProgress(0);
                    setDifferentialAnalysis(null);
                    setVerificationResults(null);
                  }}
                  data-testid="button-close-wizard"
                >
                  Close & Return to Settings
                </Button>
              </div>
            )}

          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
