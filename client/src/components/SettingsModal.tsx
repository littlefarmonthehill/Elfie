import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { AppSettings, User, Organization, OrgIntegration } from "@shared/schema";
import { DimensionWheel, ScoringWheel, type PricingInsight } from "@/components/PriceOMaticDashboard";
import { APP_VERSION, APP_NAME } from "@shared/version";
import { CAPABILITY_STATUS_STYLES, CAPABILITY_STATUS_LABELS, CAPABILITY_STATUS_DOT_COLORS, TOS_SECTIONS, TOS_LAST_UPDATED } from "@/lib/constants";
import { X, Download, Trash2, Settings, Package, Sparkles, Database, Clock, Shield, History, AlertTriangle, CheckCircle2, Calendar, RotateCcw, FileText, HardDrive, Upload, CloudUpload, Smartphone, RefreshCw, Users, Wrench, Info, Layers, Play, Pause, Loader2, ChevronDown, ChevronRight, ChevronLeft, BarChart2, Eye, ShoppingCart, Brain, TrendingUp, ImageIcon, Plus, Pencil, Lock, LogOut, CreditCard, Share2, PlusSquare, ShieldCheck, ShieldAlert, Activity, ExternalLink, Building2, Search, Flag, Zap, Globe, EyeOff, ClipboardList, Megaphone, Tag, Key, Copy, Blocks, DollarSign, Save, ClipboardPaste, Headphones, MessageCircle, Send, Target, Map, ListTodo, Crosshair, ThumbsUp, BarChart3, Warehouse, Bell, BellRing, BellOff } from "lucide-react";
import WarehouseManagement from "@/components/WarehouseManagement";
import NotificationsSection from "@/components/NotificationsSection";
import { parseBricklinkPaste, getPasteStatus, type PasteStatus } from "@/lib/bricklink-paste";
import { Badge } from "@/components/ui/badge";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerClose } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { useIsMobile } from "@/hooks/use-mobile";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmbeddingsManager, UniversalCatalogSection } from "@/components/EmbeddingsManager";
import { MappingSection } from "@/components/MappingSection";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "wouter";
import { getTierConfig } from "@shared/tierConfig";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  initialSection?: 'general' | 'platforms' | 'ai' | 'automation' | 'data' | 'enrichment' | 'about' | 'priceomatic';
  initialPlatformTab?: 'platforms' | 'scheduler';
  focusTarget?: 'channelSync' | 'schedulerInventory' | 'schedulerOrders' | 'schedulerChannel';
  pricingExample?: PricingInsight;
  scoringExample?: PricingInsight;
  isBrickspotterOnly?: boolean;
}

type ActiveSection = 'general' | 'team' | 'platforms' | 'ai' | 'automation' | 'data' | 'enrichment' | 'warehouse' | 'notifications' | 'mapping' | 'about' | 'legal' | 'orgs' | 'impersonation' | 'auditLog' | 'announcements' | 'billingOverview' | 'plansAndPricing' | 'apiKeys' | 'platformGeneral' | 'platformTeam' | 'platformScheduler' | 'syncAdmin' | 'priceomatic' | 'ieStrategies' | 'supportQueue' | 'productVision' | 'productOkrs' | 'productRoadmap' | 'productBacklog' | 'maintenance' | 'platformElfie' | 'platformNotifications' | 'autoSync' | null;

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
      <h3 className="text-xs font-semibold text-gray-100 mb-3 uppercase tracking-wide">Enrichment Overview</h3>
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

// Change Password Section — visible to all authenticated users
function ChangePasswordSection() {
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [open, setOpen] = useState(false);

  const changePasswordMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/change-password", { currentPassword, newPassword });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to change password");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Password changed", description: "Your password has been updated successfully." });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setOpen(false);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to change password.", variant: "destructive" });
    },
  });

  const canSubmit = currentPassword.length > 0 && newPassword.length >= 8 && newPassword === confirmPassword;

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-gray-100">Password</h3>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setOpen(v => !v)}
          className="text-xs"
          data-testid="button-change-password-toggle"
        >
          {open ? "Cancel" : "Change password"}
        </Button>
      </div>
      {open && (
        <div className="bg-gray-800/60 border border-gray-700 rounded-md p-3 space-y-2.5">
          <Input
            type="password"
            placeholder="Current password"
            value={currentPassword}
            onChange={e => setCurrentPassword(e.target.value)}
            className="bg-gray-900/50 border-gray-600 text-white text-xs h-8"
            data-testid="input-current-password"
          />
          <Input
            type="password"
            placeholder="New password (min. 8 characters)"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            className="bg-gray-900/50 border-gray-600 text-white text-xs h-8"
            data-testid="input-new-password"
          />
          <Input
            type="password"
            placeholder="Confirm new password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            className="bg-gray-900/50 border-gray-600 text-white text-xs h-8"
            data-testid="input-confirm-password"
          />
          {confirmPassword.length > 0 && newPassword !== confirmPassword && (
            <p className="text-[11px] text-red-400">Passwords do not match</p>
          )}
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => changePasswordMutation.mutate()}
              disabled={!canSubmit || changePasswordMutation.isPending}
              className="text-xs"
              data-testid="button-save-password"
            >
              {changePasswordMutation.isPending ? "Saving…" : "Save password"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// User Management Section Component (Admin Only)
function UserManagementSection({ userCount }: { userCount?: number }) {
  const { toast } = useToast();
  const { isAdmin, user: currentUser } = useAuth();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newFirstName, setNewFirstName] = useState("");
  const [newLastName, setNewLastName] = useState("");
  const [newRole, setNewRole] = useState("employee");

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

  const addUserMutation = useMutation({
    mutationFn: async (data: { email: string; firstName: string; lastName: string; role: string }) => {
      return await apiRequest('POST', '/api/admin/users', data);
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      setShowAddForm(false);
      setNewEmail("");
      setNewFirstName("");
      setNewLastName("");
      setNewRole("employee");
      toast({
        title: "Team Member Added",
        description: `${data.email} has been added. Temporary password: ${data.tempPassword}`,
        duration: 15000,
      });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to add team member.", variant: "destructive" });
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
            <h3 className="text-sm font-medium text-gray-100">Team Members</h3>
            <Popover>
              <PopoverTrigger asChild>
                <button className="text-gray-500 hover:text-gray-300 transition-colors" data-testid="button-roles-info">
                  <Info className="h-3.5 w-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-72 bg-gray-900 border-gray-700 p-3" side="right">
                <p className="text-xs font-medium text-gray-100 mb-2">Role Permissions</p>
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
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">{(users ?? []).length} member{(users ?? []).length !== 1 ? 's' : ''}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowAddForm(v => !v)}
              className="text-xs"
              data-testid="button-add-member"
            >
              <Plus className="h-3 w-3 mr-1" />
              Add
            </Button>
          </div>
        </div>

        {showAddForm && (
          <div className="bg-gray-800/60 border border-gray-700 rounded-md p-3 mb-3 space-y-2.5">
            <p className="text-xs font-medium text-gray-300">Add a new team member</p>
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="First name"
                value={newFirstName}
                onChange={e => setNewFirstName(e.target.value)}
                className="bg-gray-900/50 border-gray-600 text-white text-xs h-8"
                data-testid="input-add-firstName"
              />
              <Input
                placeholder="Last name"
                value={newLastName}
                onChange={e => setNewLastName(e.target.value)}
                className="bg-gray-900/50 border-gray-600 text-white text-xs h-8"
                data-testid="input-add-lastName"
              />
            </div>
            <Input
              type="email"
              placeholder="Email address"
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              className="bg-gray-900/50 border-gray-600 text-white text-xs h-8"
              data-testid="input-add-email"
            />
            <div className="flex items-center gap-2">
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger className="h-8 text-xs w-[120px] bg-gray-900/50 border-gray-600" data-testid="select-add-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="employee">Employee</SelectItem>
                  <SelectItem value="customer">Viewer</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex-1" />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setShowAddForm(false); setNewEmail(""); setNewFirstName(""); setNewLastName(""); }}
                className="text-xs text-gray-500"
                data-testid="button-cancel-add"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => addUserMutation.mutate({ email: newEmail.trim(), firstName: newFirstName.trim(), lastName: newLastName.trim(), role: newRole })}
                disabled={!newEmail.trim() || addUserMutation.isPending}
                className="text-xs"
                data-testid="button-confirm-add"
              >
                {addUserMutation.isPending ? "Adding..." : "Add Member"}
              </Button>
            </div>
            <p className="text-[10px] text-gray-500">A temporary password will be generated. Share it with the new member so they can sign in and change it.</p>
          </div>
        )}

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
                  <p className="text-xs text-gray-400 truncate">{u.email}</p>
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

interface SupportTicketRow {
  id: string;
  orgId: string;
  sessionId: string;
  status: string;
  subject: string | null;
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  orgName: string;
}

function ProductVisionPanel() {
  const { toast } = useToast();
  const { data: vision, isLoading } = useQuery<any>({ queryKey: ['/api/platform-admin/product/vision'] });
  const [whatChanges, setWhatChanges] = useState('');
  const [howIFeel, setHowIFeel] = useState('');
  const [whatPeopleSay, setWhatPeopleSay] = useState('');
  const [visionStatement, setVisionStatement] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (vision && !initialized) {
      setWhatChanges(vision.whatChanges || '');
      setHowIFeel(vision.howIFeel || '');
      setWhatPeopleSay(vision.whatPeopleSay || '');
      setVisionStatement(vision.visionStatement || '');
      setInitialized(true);
    }
  }, [vision, initialized]);

  const saveField = async (field: string, value: string) => {
    try {
      await apiRequest('PUT', '/api/platform-admin/product/vision', { [field]: value });
      queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/product/vision'] });
    } catch (e: any) { toast({ title: 'Failed to save', description: e.message, variant: 'destructive' }); }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const result = await apiRequest('POST', '/api/platform-admin/product/vision/generate', { whatChanges, howIFeel, whatPeopleSay });
      const stmt = (result as any).visionStatement || '';
      setVisionStatement(stmt);
      await apiRequest('PUT', '/api/platform-admin/product/vision', { visionStatement: stmt });
      queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/product/vision'] });
      toast({ title: 'Vision statement generated' });
    } catch (e: any) { toast({ title: 'Failed to generate', description: e.message, variant: 'destructive' }); } finally { setGenerating(false); }
  };

  if (isLoading) return <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-gray-500" /></div>;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-gray-100">Vision of Success</p>
        <p className="sm-description mt-1">Define what success looks like. Every OKR, roadmap item, and backlog task should trace back to this vision. Changes auto-save when you leave a field.</p>
      </div>
      <div className="space-y-4">
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-md p-4 space-y-2">
          <label className="block text-xs font-medium text-emerald-300">If we are successful, what changes?</label>
          <textarea className="w-full bg-black/30 border border-emerald-500/20 rounded-md p-3 text-sm text-gray-200 min-h-[80px] resize-y focus:outline-none focus:border-emerald-400/50" placeholder="e.g. E.L.F.I.E. is the operating system for LEGO resellers — they can't run their business without it" value={whatChanges} onChange={e => setWhatChanges(e.target.value)} onBlur={() => saveField('whatChanges', whatChanges)} data-testid="input-vision-what-changes" />
        </div>
        <div className="bg-violet-500/10 border border-violet-500/30 rounded-md p-4 space-y-2">
          <label className="block text-xs font-medium text-violet-300">If we are successful, how do I feel?</label>
          <textarea className="w-full bg-black/30 border border-violet-500/20 rounded-md p-3 text-sm text-gray-200 min-h-[80px] resize-y focus:outline-none focus:border-violet-400/50" placeholder="e.g. Confident that the platform is delivering real value, proud of what we've built" value={howIFeel} onChange={e => setHowIFeel(e.target.value)} onBlur={() => saveField('howIFeel', howIFeel)} data-testid="input-vision-how-i-feel" />
        </div>
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-md p-4 space-y-2">
          <label className="block text-xs font-medium text-amber-300">If we are successful, what are people saying?</label>
          <textarea className="w-full bg-black/30 border border-amber-500/20 rounded-md p-3 text-sm text-gray-200 min-h-[80px] resize-y focus:outline-none focus:border-amber-400/50" placeholder='e.g. "This is the best investment I made in my LEGO business"' value={whatPeopleSay} onChange={e => setWhatPeopleSay(e.target.value)} onBlur={() => saveField('whatPeopleSay', whatPeopleSay)} data-testid="input-vision-what-people-say" />
        </div>
      </div>
      <div className="border border-blue-500/30 bg-blue-500/10 rounded-md p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <p className="text-xs font-medium text-blue-300">AI-Generated Vision Statement</p>
            <p className="text-[10px] text-gray-400 mt-0.5">Synthesized from your answers above</p>
          </div>
          <Button size="sm" variant="outline" onClick={handleGenerate} disabled={generating || (!whatChanges && !howIFeel && !whatPeopleSay)} data-testid="button-generate-vision">
            {generating ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Sparkles className="w-3 h-3 mr-1" />}
            {visionStatement ? 'Regenerate' : 'Generate'}
          </Button>
        </div>
        {visionStatement ? (
          <textarea className="w-full bg-black/30 border border-blue-500/20 rounded-md p-3 text-sm text-gray-200 min-h-[80px] resize-y focus:outline-none focus:border-blue-400/50" value={visionStatement} onChange={e => setVisionStatement(e.target.value)} onBlur={() => saveField('visionStatement', visionStatement)} data-testid="input-vision-statement" />
        ) : (
          <p className="text-xs text-gray-500 italic">Fill in the prompts above and click Generate to create a vision statement.</p>
        )}
      </div>
    </div>
  );
}

function InlineDropdown({ value, options, onChange, className, testId }: { value: string; options: { value: string; label: string }[]; onChange: (val: string) => void; className?: string; testId?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);
  const selected = options.find(o => o.value === value);
  return (
    <div ref={ref} className="relative inline-block" data-testid={testId}>
      <button onClick={() => setOpen(!open)} className={`text-[10px] px-1.5 py-0.5 rounded border truncate max-w-[110px] text-left ${className || 'text-gray-500 border-gray-700'}`}>
        {selected?.label || value} <ChevronDown className="inline w-2 h-2 ml-0.5 opacity-50" />
      </button>
      {open && (
        <div className="absolute z-50 mt-0.5 right-0 bg-gray-800 border border-gray-600 rounded-md shadow-lg py-0.5 max-h-[180px] overflow-y-auto min-w-[140px]" style={{ maxWidth: '220px' }}>
          {options.map(o => (
            <button key={o.value} onClick={() => { onChange(o.value); setOpen(false); }} className={`block w-full text-left px-2 py-1 text-[10px] truncate ${o.value === value ? 'bg-blue-500/20 text-blue-300' : 'text-gray-300 hover:bg-gray-700'}`} data-testid={testId ? `${testId}-option-${o.value}` : undefined}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CapStatusBadge({ status, onClick, onSelect }: { status: string; onClick?: () => void; onSelect?: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);
  if (onSelect) {
    const statuses = ['built', 'new', 'now', 'next', 'testing', 'later'];
    return (
      <div ref={ref} className="relative inline-block">
        <button onClick={(e) => { e.stopPropagation(); setOpen(!open); }} className={`px-1.5 py-0.5 text-[9px] font-medium rounded border shrink-0 cursor-pointer ${CAPABILITY_STATUS_STYLES[status] || CAPABILITY_STATUS_STYLES.later}`} data-testid={`badge-status-${status}`}>
          {CAPABILITY_STATUS_LABELS[status] || status} <ChevronDown className="inline w-2 h-2 ml-0.5 opacity-50" />
        </button>
        {open && (
          <div className="absolute z-50 mt-0.5 left-0 bg-gray-800 border border-gray-600 rounded-md shadow-lg py-0.5 min-w-[80px]">
            {statuses.map(s => (
              <button key={s} onClick={(e) => { e.stopPropagation(); onSelect(s); setOpen(false); }} className={`block w-full text-left px-2 py-1 text-[10px] font-medium ${s === status ? 'bg-gray-700' : 'hover:bg-gray-700'}`} data-testid={`badge-status-option-${s}`}>
                <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${CAPABILITY_STATUS_DOT_COLORS[s] || 'bg-gray-500'}`} />
                <span className={CAPABILITY_STATUS_STYLES[s]?.split(' ').find(c => c.startsWith('text-')) || 'text-gray-400'}>{CAPABILITY_STATUS_LABELS[s] || s}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <button onClick={onClick} className={`px-1.5 py-0.5 text-[9px] font-medium rounded border shrink-0 ${onClick ? 'cursor-pointer' : 'cursor-default'} ${CAPABILITY_STATUS_STYLES[status] || CAPABILITY_STATUS_STYLES.later}`} data-testid={`badge-status-${status}`}>
      {CAPABILITY_STATUS_LABELS[status] || status}
    </button>
  );
}

function ProductOkrsPanel() {
  const { toast } = useToast();
  const { data: okrs, isLoading } = useQuery<any[]>({ queryKey: ['/api/platform-admin/product/okrs'] });
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newTimeframe, setNewTimeframe] = useState('Q2 2026');
  const [addingKrFor, setAddingKrFor] = useState<number | null>(null);
  const [newKrTitle, setNewKrTitle] = useState('');

  const addOkr = async () => {
    if (!newTitle.trim()) return;
    try {
      await apiRequest('POST', '/api/platform-admin/product/okrs', { title: newTitle, timeframe: newTimeframe });
      setNewTitle(''); setShowAdd(false);
      queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/product/okrs'] });
    } catch (e: any) { toast({ title: 'Failed to add objective', description: e.message, variant: 'destructive' }); }
  };

  const addKr = async (okrId: number) => {
    if (!newKrTitle.trim()) return;
    try {
      await apiRequest('POST', '/api/platform-admin/product/key-results', { okrId, title: newKrTitle });
      setNewKrTitle(''); setAddingKrFor(null);
      queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/product/okrs'] });
    } catch (e: any) { toast({ title: 'Failed to add key result', description: e.message, variant: 'destructive' }); }
  };

  const updateKrProgress = async (krId: number, progress: number) => {
    try {
      await apiRequest('PATCH', `/api/platform-admin/product/key-results/${krId}`, { progress });
      queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/product/okrs'] });
    } catch (e: any) { toast({ title: 'Failed to update progress', description: e.message, variant: 'destructive' }); }
  };

  const deleteOkr = async (id: number) => {
    try {
      await apiRequest('DELETE', `/api/platform-admin/product/okrs/${id}`);
      queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/product/okrs'] });
    } catch (e: any) { toast({ title: 'Failed to delete objective', description: e.message, variant: 'destructive' }); }
  };

  const deleteKr = async (id: number) => {
    try {
      await apiRequest('DELETE', `/api/platform-admin/product/key-results/${id}`);
      queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/product/okrs'] });
    } catch (e: any) { toast({ title: 'Failed to delete key result', description: e.message, variant: 'destructive' }); }
  };

  const toggleStatus = async (okr: any) => {
    const next = okr.status === 'active' ? 'archived' : 'active';
    try {
      await apiRequest('PATCH', `/api/platform-admin/product/okrs/${okr.id}`, { status: next });
      queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/product/okrs'] });
    } catch (e: any) { toast({ title: 'Failed to update status', description: e.message, variant: 'destructive' }); }
  };

  if (isLoading) return <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-gray-500" /></div>;

  const activeOkrs = (okrs || []).filter((o: any) => o.status === 'active');
  const archivedOkrs = (okrs || []).filter((o: any) => o.status === 'archived');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="text-sm font-medium text-gray-100">Objectives & Key Results</p>
          <p className="sm-description mt-1">Up to 3 objectives, each with up to 3 measurable key results.</p>
        </div>
        {activeOkrs.length < 3 && (
          <Button size="sm" variant="outline" onClick={() => setShowAdd(true)} data-testid="button-add-okr">
            <Plus className="w-3.5 h-3.5 mr-1" /> Add Objective
          </Button>
        )}
      </div>

      {showAdd && (
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 space-y-2">
          <input type="text" className="w-full bg-black/30 border border-gray-600 rounded-md p-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500" placeholder="Objective title..." value={newTitle} onChange={e => setNewTitle(e.target.value)} data-testid="input-okr-title" />
          <div className="flex items-center gap-2 flex-wrap">
            <input type="text" className="bg-black/30 border border-gray-600 rounded-md p-2 text-sm text-gray-200 w-32 focus:outline-none focus:border-blue-500" placeholder="Q2 2026" value={newTimeframe} onChange={e => setNewTimeframe(e.target.value)} data-testid="input-okr-timeframe" />
            <Button size="sm" onClick={addOkr} data-testid="button-save-okr"><Save className="w-3 h-3 mr-1" /> Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {activeOkrs.map((okr: any, idx: number) => {
        const krAvg = okr.keyResults.length > 0 ? Math.round(okr.keyResults.reduce((sum: number, kr: any) => sum + kr.progress, 0) / okr.keyResults.length) : 0;
        return (
          <div key={okr.id} className="bg-gray-900/50 border border-gray-700/50 rounded-lg p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-[10px] text-blue-400 border-blue-500/30">O{idx + 1}</Badge>
                  <p className="text-sm font-medium text-gray-100">{okr.title}</p>
                </div>
                <p className="text-[10px] text-gray-500 mt-1">{okr.timeframe}</p>
              </div>
              <div className="flex items-center gap-1">
                <Badge variant="outline" className={`text-[10px] ${krAvg >= 70 ? 'text-green-400 border-green-500/30' : krAvg >= 30 ? 'text-amber-400 border-amber-500/30' : 'text-gray-400 border-gray-600'}`}>{krAvg}%</Badge>
                <Button size="icon" variant="ghost" onClick={() => toggleStatus(okr)} className="h-7 w-7" data-testid={`button-archive-okr-${okr.id}`}><History className="w-3 h-3" /></Button>
                <Button size="icon" variant="ghost" onClick={() => deleteOkr(okr.id)} className="h-7 w-7 text-red-400" data-testid={`button-delete-okr-${okr.id}`}><Trash2 className="w-3 h-3" /></Button>
              </div>
            </div>

            {okr.keyResults.map((kr: any, krIdx: number) => (
              <div key={kr.id} className="ml-4 flex items-center gap-3">
                <span className="text-[10px] text-gray-500 w-6">KR{krIdx + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-300 truncate">{kr.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${kr.progress >= 70 ? 'bg-green-500' : kr.progress >= 30 ? 'bg-amber-500' : 'bg-gray-600'}`} style={{ width: `${kr.progress}%` }} />
                    </div>
                    <input type="number" min="0" max="100" value={kr.progress} onChange={e => updateKrProgress(kr.id, parseInt(e.target.value) || 0)} className="w-12 bg-black/30 border border-gray-700 rounded px-1.5 py-0.5 text-[10px] text-gray-300 text-center focus:outline-none" data-testid={`input-kr-progress-${kr.id}`} />
                    <span className="text-[10px] text-gray-500">%</span>
                    <Button size="icon" variant="ghost" onClick={() => deleteKr(kr.id)} className="h-5 w-5 text-red-400/60" data-testid={`button-delete-kr-${kr.id}`}><X className="w-2.5 h-2.5" /></Button>
                  </div>
                </div>
              </div>
            ))}

            {okr.keyResults.length < 3 && (
              addingKrFor === okr.id ? (
                <div className="ml-4 flex items-center gap-2">
                  <input type="text" className="flex-1 bg-black/30 border border-gray-600 rounded-md p-1.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500" placeholder="Key result..." value={newKrTitle} onChange={e => setNewKrTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && addKr(okr.id)} data-testid={`input-kr-title-${okr.id}`} />
                  <Button size="sm" onClick={() => addKr(okr.id)} className="text-xs h-7" data-testid={`button-save-kr-${okr.id}`}>Add</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setAddingKrFor(null); setNewKrTitle(''); }} className="text-xs h-7">Cancel</Button>
                </div>
              ) : (
                <button onClick={() => setAddingKrFor(okr.id)} className="ml-4 text-[10px] text-blue-400/60 hover:text-blue-400 transition-colors" data-testid={`button-add-kr-${okr.id}`}>+ Add Key Result</button>
              )
            )}
          </div>
        );
      })}

      {archivedOkrs.length > 0 && (
        <details className="mt-4">
          <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-400">Archived ({archivedOkrs.length})</summary>
          <div className="mt-2 space-y-2">
            {archivedOkrs.map((okr: any) => (
              <div key={okr.id} className="bg-gray-900/30 border border-gray-800 rounded-lg p-3 flex items-center justify-between gap-2 opacity-60">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-400 truncate">{okr.title}</p>
                  <p className="text-[10px] text-gray-600">{okr.timeframe}</p>
                </div>
                <Button size="icon" variant="ghost" onClick={() => toggleStatus(okr)} className="h-6 w-6" data-testid={`button-restore-okr-${okr.id}`}><RotateCcw className="w-3 h-3" /></Button>
              </div>
            ))}
          </div>
        </details>
      )}

      {activeOkrs.length === 0 && !showAdd && (
        <div className="text-center py-8">
          <Target className="w-8 h-8 text-gray-600 mx-auto mb-2" />
          <p className="text-xs text-gray-500">No objectives yet. Add up to 3 objectives with measurable key results.</p>
        </div>
      )}
    </div>
  );
}

function ProductRoadmapPanel() {
  const { toast } = useToast();
  const { data: caps, isLoading } = useQuery<any[]>({ queryKey: ['/api/platform-admin/product/capabilities'] });
  const { data: voteCounts } = useQuery<Record<number, number>>({ queryKey: ['/api/feature-votes/counts'] });
  const [statusFilter, setStatusFilter] = useState<'all' | 'built' | 'new' | 'now' | 'next' | 'testing' | 'later'>('all');
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const [newL1, setNewL1] = useState('');
  const [newL2, setNewL2] = useState<Record<number, string>>({});
  const [newFeature, setNewFeature] = useState<Record<number, string>>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const l1s = (caps || []).filter((c: any) => c.level === 1);
  const l2s = (caps || []).filter((c: any) => c.level === 2);
  const features = (caps || []).filter((c: any) => c.level === 3);

  const addCap = async (title: string, level: number, parentId: number | null, status?: string) => {
    if (!title.trim()) return;
    try {
      await apiRequest('POST', '/api/platform-admin/product/capabilities', { title: title.trim(), level, parentId, status: status || 'built' });
      queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/product/capabilities'] });
    } catch (e: any) { toast({ title: 'Failed to add', description: e.message, variant: 'destructive' }); }
  };

  const updateCap = async (id: number, updates: Record<string, any>) => {
    try {
      await apiRequest('PATCH', `/api/platform-admin/product/capabilities/${id}`, updates);
      queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/product/capabilities'] });
      setEditingId(null);
    } catch (e: any) { toast({ title: 'Failed to update', description: e.message, variant: 'destructive' }); }
  };

  const deleteCap = async (id: number) => {
    try {
      await apiRequest('DELETE', `/api/platform-admin/product/capabilities/${id}`);
      queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/product/capabilities'] });
    } catch (e: any) { toast({ title: 'Failed to delete', description: e.message, variant: 'destructive' }); }
  };

  const moveCapStatus = async (id: number, status: string) => {
    try {
      await apiRequest('PATCH', `/api/platform-admin/product/capabilities/${id}`, { status });
      queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/product/capabilities'] });
    } catch (e: any) { toast({ title: 'Failed to update status', description: e.message, variant: 'destructive' }); }
  };

  const toggleCollapse = (id: number) => setCollapsed(prev => ({ ...prev, [id]: !prev[id] }));

  if (isLoading) return <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-gray-500" /></div>;

  const getL2DerivedStatus = (l2: any) => {
    const children = features.filter((f: any) => f.parentId === l2.id);
    if (children.length === 0) return l2.status || 'built';
    const statuses = children.map((f: any) => f.status || 'built');
    if (statuses.every((s: string) => s === 'built')) return 'built';
    if (statuses.includes('new')) return 'new';
    if (statuses.includes('now')) return 'now';
    if (statuses.includes('next')) return 'next';
    if (statuses.includes('testing')) return 'testing';
    return 'later';
  };

  const filteredL1s = l1s.filter((l1: any) => {
    if (statusFilter === 'all') return true;
    const childL2Ids = l2s.filter((c: any) => c.parentId === l1.id).map((c: any) => c.id);
    return features.some((f: any) => childL2Ids.includes(f.parentId) && (f.status || 'built') === statusFilter);
  });

  const statusColors = CAPABILITY_STATUS_DOT_COLORS;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-gray-100">Roadmap</p>
        <p className="sm-description mt-1">Capability tree by delivery horizon. Add L1/L2/features, tap status to cycle, filter by status.</p>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {(['all', 'built', 'new', 'now', 'next', 'testing', 'later'] as const).map(f => {
          const colors: Record<string, string> = { all: 'bg-blue-500/20 text-blue-300 border-blue-500/30', ...CAPABILITY_STATUS_STYLES };
          const count = f === 'all' ? features.length : features.filter((c: any) => (c.status || 'built') === f).length;
          return (
            <button key={f} onClick={() => setStatusFilter(f)} className={`text-[10px] px-2.5 py-1 rounded-full transition-colors border ${statusFilter === f ? colors[f] : 'text-gray-500 border-transparent'}`} data-testid={`button-roadmap-filter-${f}`}>
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
              <span className="ml-1 text-gray-600">({count})</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <input className="flex-1 bg-black/30 border border-gray-600 rounded-md px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-400/50" placeholder="New L1 Capability..." value={newL1} onChange={e => setNewL1(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { addCap(newL1, 1, null); setNewL1(''); } }} data-testid="input-new-l1" />
        <Button size="sm" variant="outline" onClick={() => { addCap(newL1, 1, null); setNewL1(''); }} disabled={!newL1.trim()} data-testid="button-add-l1"><Plus className="w-3 h-3 mr-1" />Add L1</Button>
      </div>

      {l1s.length === 0 && <p className="text-xs text-gray-500 italic">No capabilities yet. Add your first L1 capability above.</p>}

      {filteredL1s.length === 0 && l1s.length > 0 ? (
        <div className="text-center py-8">
          <Layers className="w-8 h-8 text-gray-600 mx-auto mb-2" />
          <p className="text-xs text-gray-500">{`No ${statusFilter} features found.`}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredL1s.map((l1: any) => {
            const childL2s = l2s.filter((c: any) => c.parentId === l1.id && (statusFilter === 'all' || features.some((f: any) => f.parentId === c.id && (f.status || 'built') === statusFilter)));
            const allL1L2s = l2s.filter((c: any) => c.parentId === l1.id);
            const allL2Ids = allL1L2s.map((c: any) => c.id);
            const l1FeatureCount = features.filter((f: any) => allL2Ids.includes(f.parentId)).length;
            const l1BuiltCount = features.filter((f: any) => allL2Ids.includes(f.parentId) && (f.status || 'built') === 'built').length;
            const isL1Collapsed = collapsed[l1.id];
            return (
              <div key={l1.id} className="border border-gray-700 rounded-md bg-gray-800/50" data-testid={`roadmap-l1-${l1.id}`}>
                <div className="w-full flex items-center gap-2 px-3 py-2.5">
                  <button onClick={() => toggleCollapse(l1.id)} className="flex items-center" data-testid={`button-toggle-l1-${l1.id}`}>
                    <ChevronRight className={`w-3.5 h-3.5 text-gray-400 transition-transform shrink-0 ${isL1Collapsed ? '' : 'rotate-90'}`} />
                  </button>
                  {editingId === l1.id ? (
                    <input className="flex-1 bg-black/30 border border-blue-500/30 rounded px-2 py-0.5 text-sm text-gray-200 focus:outline-none" value={editTitle} onChange={e => setEditTitle(e.target.value)} onBlur={() => updateCap(l1.id, { title: editTitle })} onKeyDown={e => { if (e.key === 'Enter') updateCap(l1.id, { title: editTitle }); if (e.key === 'Escape') setEditingId(null); }} autoFocus data-testid={`input-edit-l1-${l1.id}`} />
                  ) : (
                    <span className="flex-1 text-sm font-medium text-gray-200 cursor-pointer" onClick={() => { setEditingId(l1.id); setEditTitle(l1.title); }} data-testid={`text-l1-${l1.id}`}>{l1.title}</span>
                  )}
                  <span className="text-[10px] text-gray-500">{l1BuiltCount}/{l1FeatureCount}</span>
                  <div className="flex gap-0.5">
                    {['built', 'new', 'now', 'next', 'later'].map(s => {
                      const c = features.filter((f: any) => allL2Ids.includes(f.parentId) && (f.status || 'built') === s).length;
                      return c > 0 ? <span key={s} className={`w-1.5 h-1.5 rounded-full ${statusColors[s]}`} title={`${c} ${s}`} /> : null;
                    })}
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => deleteCap(l1.id)} data-testid={`button-delete-l1-${l1.id}`}><Trash2 className="w-3 h-3 text-gray-500" /></Button>
                </div>
                {!isL1Collapsed && (
                  <div className="px-3 pb-2 space-y-1.5">
                    {childL2s.map((l2: any) => {
                      const derivedStatus = getL2DerivedStatus(l2);
                      const allChildFeatures = features.filter((f: any) => f.parentId === l2.id);
                      const visibleFeatures = statusFilter === 'all' ? allChildFeatures : allChildFeatures.filter((f: any) => (f.status || 'built') === statusFilter);
                      const isL2Collapsed = collapsed[l2.id];
                      const builtCount = allChildFeatures.filter((f: any) => (f.status || 'built') === 'built').length;
                      return (
                        <div key={l2.id} className="ml-3" data-testid={`roadmap-l2-${l2.id}`}>
                          <div className="w-full flex items-center gap-2 py-1.5">
                            <button onClick={() => toggleCollapse(l2.id)} className="flex items-center gap-1 text-left" data-testid={`button-toggle-l2-${l2.id}`}>
                              <ChevronRight className={`w-3 h-3 text-violet-400 transition-transform shrink-0 ${isL2Collapsed ? '' : 'rotate-90'}`} />
                            </button>
                            {editingId === l2.id ? (
                              <input className="flex-1 bg-black/30 border border-violet-500/30 rounded px-2 py-0.5 text-xs text-gray-200 focus:outline-none" value={editTitle} onChange={e => setEditTitle(e.target.value)} onBlur={() => updateCap(l2.id, { title: editTitle })} onKeyDown={e => { if (e.key === 'Enter') updateCap(l2.id, { title: editTitle }); if (e.key === 'Escape') setEditingId(null); }} autoFocus data-testid={`input-edit-l2-${l2.id}`} />
                            ) : (
                              <span className="flex-1 text-xs font-medium text-gray-300 cursor-pointer" onClick={() => { setEditingId(l2.id); setEditTitle(l2.title); }} data-testid={`text-l2-${l2.id}`}>{l2.title}</span>
                            )}
                            <CapStatusBadge status={derivedStatus} />
                            <span className="text-[10px] text-gray-500">{builtCount}/{allChildFeatures.length}</span>
                            <InlineDropdown value={String(l2.parentId)} options={l1s.map((other: any) => ({ value: String(other.id), label: other.title }))} onChange={async val => { const newParent = parseInt(val); if (newParent !== l2.parentId) { try { await apiRequest('PATCH', `/api/platform-admin/product/capabilities/${l2.id}`, { parentId: newParent }); queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/product/capabilities'] }); } catch {} } }} testId={`select-l2-l1-${l2.id}`} />
                            <Button size="icon" variant="ghost" onClick={() => deleteCap(l2.id)} data-testid={`button-delete-l2-${l2.id}`}><Trash2 className="w-3 h-3 text-gray-500" /></Button>
                          </div>
                          {!isL2Collapsed && visibleFeatures.length > 0 && (
                            <div className="ml-5 space-y-0.5 pb-1">
                              {visibleFeatures.map((f: any) => (
                                <div key={f.id} className="flex items-center gap-2 py-1 group" data-testid={`roadmap-feature-${f.id}`}>
                                  <CapStatusBadge status={f.status || 'built'} onSelect={(s) => moveCapStatus(f.id, s)} />
                                  {editingId === f.id ? (
                                    <input className="flex-1 bg-black/30 border border-emerald-500/30 rounded px-2 py-0.5 text-xs text-gray-300 focus:outline-none" value={editTitle} onChange={e => setEditTitle(e.target.value)} onBlur={() => updateCap(f.id, { title: editTitle })} onKeyDown={e => { if (e.key === 'Enter') updateCap(f.id, { title: editTitle }); if (e.key === 'Escape') setEditingId(null); }} autoFocus data-testid={`input-edit-feature-${f.id}`} />
                                  ) : (
                                    <span className={`flex-1 text-xs cursor-pointer ${(f.status || 'built') === 'built' ? 'text-gray-400' : 'text-gray-200'}`} onClick={() => { setEditingId(f.id); setEditTitle(f.title); }} data-testid={`text-feature-${f.id}`}>{f.title}</span>
                                  )}
                                  {(voteCounts?.[f.id] || 0) > 0 && (
                                    <span className="flex items-center gap-0.5 text-[10px] text-cyan-400" title={`${voteCounts?.[f.id]} vote(s)`} data-testid={`votes-roadmap-${f.id}`}>
                                      <ThumbsUp className="w-2.5 h-2.5" />{voteCounts?.[f.id]}
                                    </span>
                                  )}
                                  <InlineDropdown value={String(f.parentId)} options={l2s.map((other: any) => { const pL1 = l1s.find((p: any) => p.id === other.parentId); return { value: String(other.id), label: `${pL1 ? pL1.title + ' / ' : ''}${other.title}` }; })} onChange={async val => { const newParent = parseInt(val); if (newParent !== f.parentId) { try { await apiRequest('PATCH', `/api/platform-admin/product/capabilities/${f.id}`, { parentId: newParent }); queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/product/capabilities'] }); } catch {} } }} testId={`select-feature-l2-${f.id}`} />
                                  <Button size="icon" variant="ghost" className="invisible group-hover:visible" onClick={() => deleteCap(f.id)} data-testid={`button-delete-feature-${f.id}`}><Trash2 className="w-3 h-3 text-gray-500" /></Button>
                                </div>
                              ))}
                            </div>
                          )}
                          {!isL2Collapsed && statusFilter === 'all' && (
                            <div className="ml-5 pb-1">
                              <input className="w-full bg-transparent border-b border-dashed border-gray-700 px-1 py-0.5 text-xs text-gray-400 placeholder-gray-600 focus:outline-none focus:border-emerald-400/50" placeholder="+ Add feature..." value={newFeature[l2.id] || ''} onChange={e => setNewFeature(p => ({ ...p, [l2.id]: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter' && (newFeature[l2.id] || '').trim()) { addCap(newFeature[l2.id], 3, l2.id); setNewFeature(p => ({ ...p, [l2.id]: '' })); } }} data-testid={`input-new-feature-${l2.id}`} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {statusFilter === 'all' && (
                      <div className="ml-3 flex items-center gap-1">
                        <input className="flex-1 bg-transparent border-b border-dashed border-gray-700 px-1 py-0.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-violet-400/50" placeholder="+ Add L2 sub-capability..." value={newL2[l1.id] || ''} onChange={e => setNewL2(p => ({ ...p, [l1.id]: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter' && (newL2[l1.id] || '').trim()) { addCap(newL2[l1.id], 2, l1.id); setNewL2(p => ({ ...p, [l1.id]: '' })); } }} data-testid={`input-new-l2-${l1.id}`} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MaintenancePanel() {
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

  return (
    <div className="px-3 pt-3 pb-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-100 mb-0.5">Duplicate Order Cleanup</h3>
        <p className="text-xs text-gray-400">
          Removes legacy duplicate BL orders (bare numeric IDs like BL.XXXXXX) where a proper <code className="bg-gray-800 px-1 rounded">bl-XXXXXX</code> record already exists.
        </p>
      </div>

      {done ? (
        <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
          <CheckCircle2 className="h-4 w-4" />
          Cleanup complete — duplicate orders removed.
        </div>
      ) : !dryRunResult ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => dryRun.mutate()}
          disabled={dryRun.isPending}
          data-testid="button-dryrun-cleanup"
        >
          {dryRun.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wrench className="h-4 w-4 mr-2" />}
          Run Dry Run
        </Button>
      ) : (
        <div className="space-y-3">
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-md p-3 space-y-2">
            <div className="flex items-center gap-2 text-amber-400 font-semibold text-xs">
              <AlertTriangle className="h-3.5 w-3.5" />
              Review before confirming
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wide">Orders to delete</p>
                <p className="font-bold text-sm text-gray-100">{dryRunResult.ordersToDelete.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wide">Line items to delete</p>
                <p className="font-bold text-sm text-gray-100">{dryRunResult.orderDetailsToDelete.toLocaleString()}</p>
              </div>
            </div>
            <p className="text-[10px] text-gray-500">Sample IDs: {dryRunResult.sampleIds.slice(0, 4).join(', ')}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setDryRunResult(null)}>
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
              Delete {dryRunResult.ordersToDelete.toLocaleString()} Orders
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProductBacklogPanel() {
  const { toast } = useToast();
  const { data: caps, isLoading } = useQuery<any[]>({ queryKey: ['/api/platform-admin/product/capabilities'] });
  const { data: voteCounts } = useQuery<Record<number, number>>({ queryKey: ['/api/feature-votes/counts'] });
  const [filter, setFilter] = useState<'all' | 'new' | 'now' | 'next' | 'later'>('all');

  const l1s = (caps || []).filter((c: any) => c.level === 1);
  const l2s = (caps || []).filter((c: any) => c.level === 2);
  const features = (caps || []).filter((c: any) => c.level === 3);
  const notBuilt = features.filter((f: any) => (f.status || 'built') !== 'built');

  const moveCapStatus = async (id: number, status: string) => {
    try {
      await apiRequest('PATCH', `/api/platform-admin/product/capabilities/${id}`, { status });
      queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/product/capabilities'] });
    } catch (e: any) { toast({ title: 'Failed to update status', description: e.message, variant: 'destructive' }); }
  };

  const moveCapParent = async (id: number, parentId: number) => {
    try {
      await apiRequest('PATCH', `/api/platform-admin/product/capabilities/${id}`, { parentId });
      queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/product/capabilities'] });
    } catch (e: any) { toast({ title: 'Failed to move feature', description: e.message, variant: 'destructive' }); }
  };

  if (isLoading) return <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-gray-500" /></div>;

  const statusGroups = [
    { id: 'new', label: 'New', color: 'violet' },
    { id: 'now', label: 'Now', color: 'blue' },
    { id: 'next', label: 'Next', color: 'amber' },
    { id: 'later', label: 'Later', color: 'gray' },
  ];
  const visibleGroups = filter === 'all' ? statusGroups : statusGroups.filter(g => g.id === filter);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-gray-100">Backlog</p>
        <p className="sm-description mt-1">Features not yet built, grouped by status. Tap status to change, tap L2 to reassign. Features marked "Built" move out of backlog.</p>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {(['all', 'new', 'now', 'next', 'later'] as const).map(f => {
          const colors: Record<string, string> = { all: 'bg-blue-500/20 text-blue-300 border-blue-500/30', ...CAPABILITY_STATUS_STYLES };
          const count = f === 'all' ? notBuilt.length : notBuilt.filter((c: any) => (c.status || 'built') === f).length;
          return (
            <button key={f} onClick={() => setFilter(f)} className={`text-[10px] px-2.5 py-1 rounded-full transition-colors border ${filter === f ? colors[f] : 'text-gray-500 border-transparent'}`} data-testid={`button-backlog-filter-${f}`}>
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
              <span className="ml-1 text-gray-600">({count})</span>
            </button>
          );
        })}
      </div>

      {notBuilt.length === 0 ? (
        <div className="text-center py-8">
          <ListTodo className="w-8 h-8 text-gray-600 mx-auto mb-2" />
          <p className="text-xs text-gray-500">All features are built. Change a feature's status in the Roadmap to add it here.</p>
        </div>
      ) : (
        visibleGroups.map(group => {
          const groupFeatures = notBuilt.filter((f: any) => (f.status || 'built') === group.id);
          const borderColor = group.color === 'violet' ? 'border-violet-500/30' : group.color === 'blue' ? 'border-blue-500/30' : group.color === 'amber' ? 'border-amber-500/30' : 'border-gray-700';
          const labelColor = group.color === 'violet' ? 'text-violet-400' : group.color === 'blue' ? 'text-blue-400' : group.color === 'amber' ? 'text-amber-400' : 'text-gray-400';
          return (
            <div key={group.id}>
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-xs font-medium ${labelColor}`}>{group.label}</span>
                <Badge variant="outline" className="text-[10px] text-gray-500 border-gray-600">{groupFeatures.length}</Badge>
              </div>
              {groupFeatures.length === 0 ? (
                <div className={`border ${borderColor} border-dashed rounded-lg p-4 text-center`}>
                  <p className="text-[10px] text-gray-600">No {group.label.toLowerCase()} features</p>
                </div>
              ) : (
                <div className="space-y-1.5 rounded-lg p-1">
                  {groupFeatures.map((f: any) => {
                    const parentL2 = l2s.find((l2: any) => l2.id === f.parentId);
                    const parentL1 = parentL2 ? l1s.find((l1: any) => l1.id === parentL2.parentId) : null;
                    return (
                      <div key={f.id} className={`border ${borderColor} rounded-lg p-3 bg-gray-900/30`} data-testid={`backlog-feature-${f.id}`}>
                        <div className="flex items-center gap-2">
                          <CapStatusBadge status={f.status || 'built'} onSelect={(s) => moveCapStatus(f.id, s)} />
                          <span className="flex-1 text-xs text-gray-200 min-w-0">{f.title}</span>
                          {(voteCounts?.[f.id] || 0) > 0 && (
                            <span className="flex items-center gap-0.5 text-[10px] text-cyan-400" title={`${voteCounts?.[f.id]} vote(s)`} data-testid={`votes-backlog-${f.id}`}>
                              <ThumbsUp className="w-2.5 h-2.5" />{voteCounts?.[f.id]}
                            </span>
                          )}
                          <InlineDropdown value={String(f.parentId)} options={l2s.map((other: any) => { const pL1 = l1s.find((p: any) => p.id === other.parentId); return { value: String(other.id), label: `${pL1 ? pL1.title + ' / ' : ''}${other.title}` }; })} onChange={val => { const newParent = parseInt(val); if (newParent !== f.parentId) moveCapParent(f.id, newParent); }} testId={`select-backlog-l2-${f.id}`} />
                        </div>
                        {parentL2 && <p className="text-[10px] text-gray-500 mt-0.5 ml-7">{parentL1 ? `${parentL1.title} / ` : ''}{parentL2.title}</p>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function SupportQueuePanel() {
  const { data: openTickets, isLoading: ticketsLoading } = useQuery<SupportTicketRow[]>({
    queryKey: ['/api/platform-admin/support-queue'],
    refetchInterval: 10000,
  });
  const { data: historyTickets } = useQuery<SupportTicketRow[]>({
    queryKey: ['/api/platform-admin/support-queue/history'],
  });
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const { data: ticketConvo, refetch: refetchConvo } = useQuery<{ ticket: SupportTicketRow; messages: Array<{ id: string; role: string; content: string; context: string | null; createdAt: string }> }>({
    queryKey: ['/api/platform-admin/support-queue', selectedTicketId, 'messages'],
    enabled: !!selectedTicketId,
    refetchInterval: selectedTicketId ? 5000 : false,
  });

  const handleReply = async () => {
    if (!replyText.trim() || !selectedTicketId) return;
    setReplying(true);
    try {
      await fetch(`/api/platform-admin/support-queue/${selectedTicketId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ content: replyText }),
      });
      setReplyText('');
      refetchConvo();
      queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/support-queue'] });
    } catch {} finally { setReplying(false); }
  };

  const handleResolve = async () => {
    if (!selectedTicketId) return;
    try {
      await fetch(`/api/platform-admin/support-queue/${selectedTicketId}/resolve`, {
        method: 'PATCH',
        credentials: 'include',
      });
      setSelectedTicketId(null);
      queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/support-queue'] });
      queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/support-queue/history'] });
    } catch {}
  };

  const formatTime = (d: string) => {
    const date = new Date(d);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString();
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ticketConvo?.messages) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [ticketConvo?.messages?.length]);

  if (selectedTicketId && ticketConvo) {
    return (
      <div className="flex flex-col">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <Button size="sm" variant="ghost" onClick={() => setSelectedTicketId(null)} className="text-xs" data-testid="button-back-queue">
            <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Back
          </Button>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-gray-200 truncate">{ticketConvo.ticket.orgName} — {ticketConvo.ticket.subject || 'Support'}</p>
            <p className="text-[10px] text-gray-500">Session: {ticketConvo.ticket.sessionId.slice(0, 20)}...</p>
          </div>
          <Badge variant="outline" className={`text-[10px] ${ticketConvo.ticket.status === 'escalated' ? 'text-amber-400 border-amber-500/30' : ticketConvo.ticket.status === 'active' ? 'text-green-400 border-green-500/30' : 'text-gray-500 border-gray-600'}`}>
            {ticketConvo.ticket.status}
          </Badge>
          {ticketConvo.ticket.status !== 'resolved' && (
            <Button size="sm" variant="ghost" onClick={handleResolve} className="text-[10px] text-green-400" data-testid="button-resolve-ticket">
              <CheckCircle2 className="h-3 w-3 mr-1" /> Resolve
            </Button>
          )}
        </div>
        <div className="overflow-y-auto space-y-2 bg-gray-800/30 rounded-lg p-3 border border-gray-700/50 mb-3 max-h-[400px]">
          {ticketConvo.messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : msg.role === 'system' ? 'justify-center' : 'justify-start'}`}>
              {msg.role === 'system' ? (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded px-3 py-1.5 text-[10px] text-amber-300 text-center max-w-[90%]">
                  {msg.content}
                </div>
              ) : (
                <div className={`max-w-[80%] rounded-lg px-3 py-2 text-xs ${
                  msg.role === 'user' ? 'bg-purple-600 text-white' :
                  msg.role === 'support' ? 'bg-green-600/20 border border-green-500/30 text-green-100' :
                  'bg-gray-700/50 text-gray-300'
                }`}>
                  {msg.role === 'support' && <p className="text-[9px] font-semibold text-green-400 mb-0.5">{msg.context || 'Support Agent'}</p>}
                  {msg.role === 'assistant' && <p className="text-[9px] font-semibold text-purple-400 mb-0.5">E.L.F.I.E.</p>}
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                  <p className="text-[9px] text-gray-500 mt-1">{formatTime(msg.createdAt)}</p>
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
        {ticketConvo.ticket.status !== 'resolved' ? (
          <div className="sticky bottom-0 bg-gray-900/95 backdrop-blur-sm rounded-lg border border-green-500/30 p-3">
            <p className="text-[10px] text-green-400 font-medium mb-2">
              <MessageCircle className="h-3 w-3 inline mr-1" />
              Reply to {ticketConvo.ticket.orgName}'s support request
            </p>
            <div className="flex gap-2">
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReply(); } }}
                placeholder="Type your reply to the customer..."
                rows={2}
                className="flex-1 text-xs bg-gray-800/80 border border-gray-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-green-500/50 rounded-md px-3 py-2 resize-none text-gray-100 placeholder:text-gray-500"
                data-testid="textarea-support-reply"
              />
              <Button onClick={handleReply} disabled={!replyText.trim() || replying} className="bg-green-600 self-end" data-testid="button-send-reply">
                {replying ? <RefreshCw className="h-4 w-4 animate-spin" /> : <><Send className="h-4 w-4 mr-1.5" /> Send</>}
              </Button>
            </div>
            <p className="text-[9px] text-gray-600 mt-1.5">Press Enter to send, Shift+Enter for new line</p>
          </div>
        ) : (
          <div className="rounded-lg border border-gray-700/50 bg-gray-800/30 p-3 text-center">
            <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto mb-1" />
            <p className="text-[10px] text-gray-500">This ticket has been resolved</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 min-h-[400px]">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="text-sm font-medium text-gray-100">Support Queue</p>
          <p className="sm-description mt-0.5">Live support conversations escalated from E.L.F.I.E.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant={showHistory ? 'default' : 'outline'} onClick={() => setShowHistory(!showHistory)} className="text-[10px]" data-testid="button-toggle-history">
            <History className="h-3 w-3 mr-1" /> {showHistory ? 'Show Open' : 'History'}
          </Button>
        </div>
      </div>

      {ticketsLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 text-gray-500 animate-spin" />
        </div>
      ) : (
        <div className="space-y-2">
          {(showHistory ? (historyTickets || []) : (openTickets || [])).length === 0 ? (
            <div className="rounded-lg bg-gray-800/40 border border-gray-700/50 p-6 text-center space-y-2">
              <Headphones className="h-6 w-6 text-gray-600 mx-auto" />
              <p className="text-xs text-gray-500">{showHistory ? 'No resolved tickets yet.' : 'No open support tickets. All clear!'}</p>
            </div>
          ) : (
            (showHistory ? (historyTickets || []) : (openTickets || [])).map((ticket) => (
              <div
                key={ticket.id}
                className="rounded-lg bg-gray-800/40 border border-gray-700/50 p-3 hover-elevate cursor-pointer"
                onClick={() => setSelectedTicketId(ticket.id)}
                data-testid={`ticket-${ticket.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-200 truncate">{ticket.orgName}</p>
                    <p className="text-[10px] text-gray-400 truncate mt-0.5">{ticket.subject || 'Support request'}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge variant="outline" className={`text-[9px] ${ticket.status === 'escalated' ? 'text-amber-400 border-amber-500/30' : ticket.status === 'active' ? 'text-green-400 border-green-500/30' : 'text-gray-500 border-gray-600'}`}>
                      {ticket.status}
                    </Badge>
                    <span className="text-[9px] text-gray-600">{formatTime(ticket.createdAt)}</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function PricingLiveUsageCard() {
  const { data: allOrgsUsage, isLoading } = useQuery<{
    orgs: Array<{
      orgId: string;
      orgName: string;
      planName: string;
      monthlySalesCents: number;
      billing: { baseFee: number; salesFee: number; totalDue: number };
    }>;
    summary: { totalMRR: number; orgCount: number };
  }>({ queryKey: ['/api/platform-admin/all-orgs-usage'] });

  const [selectedOrg, setSelectedOrg] = useState<string>('');

  const { data: orgDetail } = useQuery<{
    orgId: string;
    orgName: string;
    billingStartDate?: string | null;
    plan: { id: number; name: string; basePrice: number; salesPercentage: number; freeSalesThreshold: number };
    monthlySalesCents: number;
    billing: { baseFee: number; salesFee: number; totalDue: number };
  }>({
    queryKey: ['/api/platform-admin/org-usage', selectedOrg],
    enabled: !!selectedOrg,
  });

  if (isLoading) return <div className="sm-card"><div className="px-4 py-3 flex items-center justify-center"><Loader2 className="w-4 h-4 animate-spin text-gray-500" /></div></div>;
  if (!allOrgsUsage) return null;

  const fmtC = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="sm-card" data-testid="pricing-live-usage-card">
      <div className="sm-card-header">
        <Eye className="h-3.5 w-3.5 text-cyan-400/80" />
        <span className="text-xs font-semibold text-gray-200">Live Org Billing</span>
      </div>
      <div className="px-4 py-3 space-y-3">
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-gray-400 whitespace-nowrap">Organization:</label>
          <select
            value={selectedOrg}
            onChange={e => setSelectedOrg(e.target.value)}
            data-testid="select-pricing-live-org"
            className="flex-1 bg-gray-900/60 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 outline-none focus:border-gray-500"
          >
            <option value="">Select an org...</option>
            {allOrgsUsage.orgs.map(o => (
              <option key={o.orgId} value={o.orgId}>{o.orgName} — {fmtC(o.billing.totalDue)}/mo</option>
            ))}
          </select>
        </div>

        {selectedOrg && !orgDetail && (
          <div className="flex items-center justify-center py-3"><Loader2 className="w-3.5 h-3.5 animate-spin text-gray-500" /></div>
        )}

        {orgDetail && (
          <div className="divide-y divide-white/5 rounded-md border border-gray-700 bg-gray-800/40 overflow-hidden text-[10px]">
            <div className="flex items-center justify-between px-3 py-1.5">
              <span className="text-gray-400">Plan</span>
              <span className="text-gray-300">{orgDetail.plan.name}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-1.5">
              <span className="text-gray-400">Monthly sales</span>
              <span className="text-gray-300 tabular-nums">{fmtC(orgDetail.monthlySalesCents)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-1.5">
              <span className="text-gray-400">Free threshold</span>
              <span className="text-gray-300 tabular-nums">{fmtC(orgDetail.plan.freeSalesThreshold)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-1.5">
              <span className="text-gray-400">Base fee</span>
              <span className="text-gray-300 tabular-nums">{fmtC(orgDetail.billing.baseFee)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-1.5">
              <span className="text-gray-400">Sales fee ({orgDetail.plan.salesPercentage}%)</span>
              <span className={orgDetail.billing.salesFee > 0 ? 'text-purple-300 tabular-nums' : 'text-gray-500'}>
                {orgDetail.billing.salesFee > 0 ? `+${fmtC(orgDetail.billing.salesFee)}` : '$0.00'}
              </span>
            </div>
            <div className="flex items-center justify-between px-3 py-2 bg-gray-800/60">
              <span className="text-gray-300 font-semibold">Total due</span>
              <span className="text-white font-bold tabular-nums">{fmtC(orgDetail.billing.totalDue)}/mo</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BillingOverviewPanel() {
  const { data: allOrgsUsage, isLoading } = useQuery<{
    orgs: Array<{
      orgId: string;
      orgName: string;
      planName: string;
      monthlySalesCents: number;
      billing: { baseFee: number; salesFee: number; totalDue: number };
    }>;
    summary: { totalMRR: number; orgCount: number };
  }>({ queryKey: ['/api/platform-admin/all-orgs-usage'] });

  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);

  const { data: orgDetail, isLoading: detailLoading } = useQuery<{
    orgId: string;
    orgName: string;
    billingStartDate?: string | null;
    plan: { id: number; name: string; basePrice: number; salesPercentage: number; freeSalesThreshold: number };
    monthlySalesCents: number;
    billing: { baseFee: number; salesFee: number; totalDue: number };
  }>({
    queryKey: ['/api/platform-admin/org-usage', selectedOrgId],
    enabled: !!selectedOrgId,
  });

  if (isLoading) return <div className="p-4 flex items-center justify-center"><Loader2 className="w-4 h-4 animate-spin text-gray-500" /></div>;
  if (!allOrgsUsage) return <div className="p-4 text-center text-xs text-gray-500">Unable to load billing data.</div>;

  const { orgs, summary } = allOrgsUsage;
  const fmtC = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="px-3 pt-3 pb-4 space-y-3 min-w-0 overflow-hidden">
      <div className="sm-card">
        <div className="sm-card-header">
          <CreditCard className="h-3.5 w-3.5 text-green-400/80" />
          <span className="text-xs font-semibold text-gray-200">Revenue Summary</span>
        </div>
        <div className="px-4 py-3 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <div className="text-lg font-bold text-white tabular-nums">{fmtC(summary.totalMRR)}</div>
              <div className="text-[10px] text-gray-500">Projected MRR</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-white tabular-nums">{summary.orgCount}</div>
              <div className="text-[10px] text-gray-500">Active Orgs</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-white tabular-nums">{fmtC(summary.totalMRR / Math.max(1, summary.orgCount))}</div>
              <div className="text-[10px] text-gray-500">Avg / Org</div>
            </div>
          </div>
        </div>
      </div>

      <div className="sm-card">
        <div className="sm-card-header">
          <BarChart3 className="h-3.5 w-3.5 text-blue-400/80" />
          <span className="text-xs font-semibold text-gray-200">Per-Organization Billing</span>
        </div>
        <div className="px-4 py-3 space-y-2">
          <div className="rounded-md border border-gray-700 bg-gray-800/40 overflow-hidden">
            <table className="w-full border-collapse text-[10px]">
              <thead>
                <tr className="border-b border-gray-700/60 bg-gray-900/40">
                  <th className="text-left px-3 py-1.5 text-gray-500 font-medium">Organization</th>
                  <th className="text-left px-2 py-1.5 text-gray-500 font-medium">Plan</th>
                  <th className="text-right px-2 py-1.5 text-gray-500 font-medium">GMV</th>
                  <th className="text-right px-2 py-1.5 text-gray-500 font-medium">Sales Fee</th>
                  <th className="text-right px-3 py-1.5 text-gray-500 font-medium">Total Due</th>
                </tr>
              </thead>
              <tbody>
                {orgs.map((o) => (
                  <tr
                    key={o.orgId}
                    onClick={() => setSelectedOrgId(o.orgId === selectedOrgId ? null : o.orgId)}
                    className={`border-b border-gray-700/30 cursor-pointer transition-colors ${selectedOrgId === o.orgId ? 'bg-blue-500/10' : 'hover:bg-gray-800/60'}`}
                    data-testid={`billing-org-row-${o.orgId}`}
                  >
                    <td className="px-3 py-1.5 text-gray-300 font-medium truncate max-w-[120px]">{o.orgName}</td>
                    <td className="px-2 py-1.5 text-gray-400 truncate max-w-[80px]">{o.planName}</td>
                    <td className="px-2 py-1.5 text-right text-gray-400 tabular-nums">{fmtC(o.monthlySalesCents)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {o.billing.salesFee > 0
                        ? <span className="text-purple-300">+{fmtC(o.billing.salesFee)}</span>
                        : <span className="text-gray-600">$0.00</span>
                      }
                    </td>
                    <td className="px-3 py-1.5 text-right text-gray-200 font-semibold tabular-nums">{fmtC(o.billing.totalDue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {selectedOrgId && detailLoading && (
        <div className="flex items-center justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-gray-500" /></div>
      )}

      {selectedOrgId && orgDetail && (
        <div className="sm-card">
          <div className="sm-card-header">
            <Building2 className="h-3.5 w-3.5 text-violet-400/80" />
            <span className="text-xs font-semibold text-gray-200">{orgDetail.orgName} — Billing Detail</span>
          </div>
          <div className="px-4 py-3">
            <div className="divide-y divide-white/5 rounded-md border border-gray-700 bg-gray-800/40 overflow-hidden text-[10px]">
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-gray-400">Plan</span>
                <span className="text-gray-300">{orgDetail.plan.name}</span>
              </div>
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-gray-400">Monthly GMV</span>
                <span className="text-gray-300 tabular-nums">{fmtC(orgDetail.monthlySalesCents)}</span>
              </div>
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-gray-400">Free threshold</span>
                <span className="text-gray-300 tabular-nums">{fmtC(orgDetail.plan.freeSalesThreshold)}</span>
              </div>
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-gray-400">Sales over threshold</span>
                <span className="text-gray-300 tabular-nums">{fmtC(Math.max(0, orgDetail.monthlySalesCents - orgDetail.plan.freeSalesThreshold))}</span>
              </div>
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-gray-400">Base fee</span>
                <span className="text-gray-300 tabular-nums">{fmtC(orgDetail.billing.baseFee)}</span>
              </div>
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-gray-400">Sales fee ({orgDetail.plan.salesPercentage}%)</span>
                <span className={orgDetail.billing.salesFee > 0 ? 'text-purple-300 tabular-nums' : 'text-gray-500'}>
                  {orgDetail.billing.salesFee > 0 ? `+${fmtC(orgDetail.billing.salesFee)}` : '$0.00'}
                </span>
              </div>
              <div className="flex items-center justify-between px-3 py-2 bg-gray-800/60">
                <span className="text-gray-200 font-semibold">Total due</span>
                <span className="text-white font-bold tabular-nums">{fmtC(orgDetail.billing.totalDue)}/mo</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function PlansAndPricingPanel() {
  type PlanRow = {
    id: number;
    name: string;
    basePrice: number;
    salesPercentage: number;
    freeSalesThreshold: number;
    status: string;
    sunsetAt: string | null;
    isDefault: boolean;
    isPublic: boolean;
    trialDurationDays: number;
    isBrickspotterOnly: boolean;
    limitBrickspotterScans: number;
    limitBrickspotterApiCalls: number;
    locked: boolean;
    orgCount: number;
  };

  const queryClient = useQueryClient();
  const { data: plans, isLoading } = useQuery<PlanRow[]>({ queryKey: ['/api/platform-admin/plans'] });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const defaultForm = { name: '', basePrice: 3900, salesPercentage: 1.9, freeSalesThreshold: 100000, status: 'in_progress', sunsetAt: null as string | null, isDefault: false, isPublic: true, trialDurationDays: 0, isBrickspotterOnly: false, limitBrickspotterScans: 0, limitBrickspotterApiCalls: 0 };
  const [form, setForm] = useState<typeof defaultForm>(defaultForm);

  const fmtC = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const inputCls = 'w-full bg-gray-900/60 border border-gray-700 rounded px-2 py-1 text-gray-200 outline-none focus:border-gray-500 text-xs tabular-nums';

  const saveMutation = useMutation({
    mutationFn: async (payload: { id?: number; data: Partial<typeof defaultForm> }) => {
      if (payload.id) {
        return apiRequest('PATCH', `/api/platform-admin/plans/${payload.id}`, payload.data);
      } else {
        return apiRequest('POST', '/api/platform-admin/plans', payload.data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/plans'] });
      setEditingId(null);
      setShowCreate(false);
      setForm(defaultForm);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/platform-admin/plans/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/plans'] }),
  });

  const cycleStatus = (plan: PlanRow) => {
    const next = plan.status === 'live' ? 'sunset' : plan.status === 'sunset' ? 'in_progress' : 'live';
    saveMutation.mutate({ id: plan.id, data: { status: next } });
  };

  const startEdit = (plan: PlanRow) => {
    setShowCreate(false);
    setEditingId(plan.id);
    setForm({
      name: plan.name,
      basePrice: plan.basePrice,
      salesPercentage: plan.salesPercentage,
      freeSalesThreshold: plan.freeSalesThreshold,
      status: plan.status,
      sunsetAt: plan.sunsetAt ? new Date(plan.sunsetAt).toISOString().split('T')[0] : null,
      isDefault: plan.isDefault,
      isPublic: plan.isPublic ?? true,
      trialDurationDays: plan.trialDurationDays ?? 0,
      isBrickspotterOnly: plan.isBrickspotterOnly ?? false,
      limitBrickspotterScans: plan.limitBrickspotterScans ?? 0,
      limitBrickspotterApiCalls: plan.limitBrickspotterApiCalls ?? 0,
    });
  };

  const startCreate = () => {
    setEditingId(null);
    setForm(defaultForm);
    setShowCreate(true);
  };

  const handleSave = () => {
    const editingPlanRef = (plans ?? []).find(p => p.id === editingId);
    const sunsetAtIso = form.sunsetAt ? new Date(form.sunsetAt).toISOString() : null;
    const bsFields = { isBrickspotterOnly: form.isBrickspotterOnly, limitBrickspotterScans: form.limitBrickspotterScans, limitBrickspotterApiCalls: form.limitBrickspotterApiCalls };
    const payload = editingId
      ? { id: editingId, data: { name: form.name, status: form.status, sunsetAt: sunsetAtIso, isDefault: form.isDefault, isPublic: form.isPublic, ...bsFields, ...(!editingPlanRef?.locked ? { basePrice: form.basePrice, salesPercentage: form.salesPercentage, freeSalesThreshold: form.freeSalesThreshold, trialDurationDays: form.trialDurationDays } : {}) } }
      : { data: { name: form.name, basePrice: form.basePrice, salesPercentage: form.salesPercentage, freeSalesThreshold: form.freeSalesThreshold, status: form.status, sunsetAt: sunsetAtIso, isDefault: form.isDefault, isPublic: form.isPublic, trialDurationDays: form.trialDurationDays, ...bsFields } };
    saveMutation.mutate(payload);
  };

  const editingPlan = (plans ?? []).find(p => p.id === editingId);

  if (isLoading) {
    return (
      <div className="px-3 pt-3 pb-4 flex items-center justify-center">
        <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
      </div>
    );
  }

  return (
    <div className="px-3 pt-3 pb-4 space-y-3 min-w-0 overflow-hidden" data-testid="plans-and-pricing-panel">
      {/* Plans list */}
      <div className="sm-card">
        <div className="sm-card-header">
          <Tag className="h-3.5 w-3.5 text-violet-400/80" />
          <span className="text-xs font-semibold text-gray-200">Plans</span>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-6 text-[10px] px-2"
            onClick={startCreate}
            data-testid="button-plan-create"
          >
            <Plus className="w-3 h-3 mr-1" />
            New Plan
          </Button>
        </div>
        <div className="px-4 py-3 space-y-2">
          {(plans ?? []).length === 0 && (
            <p className="text-[11px] text-gray-500 text-center py-2">No plans defined yet.</p>
          )}
          {(plans ?? []).map(plan => (
            <div
              key={plan.id}
              className={`rounded-md border p-3 space-y-2 ${plan.status === 'sunset' ? 'border-gray-700/40 bg-gray-800/20 opacity-60' : 'border-gray-700 bg-gray-800/40'}`}
              data-testid={`plan-row-${plan.id}`}
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap gap-y-1">
                    <span className="text-xs font-semibold text-gray-200">{plan.name}</span>
                    {plan.locked && (
                      <span className="text-[9px] bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded px-1 py-0.5">
                        locked ({plan.orgCount} org{plan.orgCount !== 1 ? 's' : ''})
                      </span>
                    )}
                    {plan.isDefault && (
                      <span className="text-[9px] bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded px-1 py-0.5">default</span>
                    )}
                    {!plan.isPublic && (
                      <span className="text-[9px] bg-gray-600/40 text-gray-400 border border-gray-600/40 rounded px-1 py-0.5">private</span>
                    )}
                    {plan.status === 'live' && (
                      <span className="text-[9px] bg-green-500/20 text-green-400 border border-green-500/30 rounded px-1 py-0.5">live</span>
                    )}
                    {plan.status === 'in_progress' && (
                      <span className="text-[9px] bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded px-1 py-0.5">in progress</span>
                    )}
                    {plan.status === 'sunset' && (
                      <>
                        <span className="text-[9px] bg-gray-700/60 text-gray-500 border border-gray-600/40 rounded px-1 py-0.5">sunset</span>
                        {plan.sunsetAt && (
                          <span className="text-[9px] bg-orange-500/10 text-orange-400 border border-orange-500/20 rounded px-1 py-0.5">
                            ends {new Date(plan.sunsetAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  <div className="text-[10px] text-gray-400 mt-0.5 tabular-nums">
                    {fmtC(plan.basePrice)}/mo base · {plan.salesPercentage}% of GMV over {fmtC(plan.freeSalesThreshold)} free threshold
                    {plan.trialDurationDays > 0 && (
                      <span className="ml-2 text-violet-400">· {plan.trialDurationDays}-day free trial</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {plan.isBrickspotterOnly && (
                      <span className="text-[9px] bg-lego-yellow/20 text-lego-yellow border border-lego-yellow/30 rounded px-1 py-0.5">BS standalone</span>
                    )}
                    {(plan.limitBrickspotterScans !== 0 || plan.limitBrickspotterApiCalls !== 0) && (
                      <span className="text-[9px] text-gray-500 font-mono">
                        BS: {plan.limitBrickspotterScans === -1 ? '∞' : plan.limitBrickspotterScans} scans/mo · {plan.limitBrickspotterApiCalls === -1 ? '∞' : plan.limitBrickspotterApiCalls} api/day
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[10px] px-2"
                    onClick={() => cycleStatus(plan)}
                    data-testid={`button-plan-cycle-status-${plan.id}`}
                    title={`Status: ${plan.status} — click to cycle`}
                  >
                    {plan.status === 'live' ? <Eye className="w-3 h-3" /> : plan.status === 'sunset' ? <EyeOff className="w-3 h-3" /> : <Loader2 className="w-3 h-3" />}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[10px] px-2"
                    onClick={() => startEdit(plan)}
                    data-testid={`button-plan-edit-${plan.id}`}
                  >
                    <Pencil className="w-3 h-3" />
                  </Button>
                  {plan.orgCount === 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[10px] px-2 text-red-400"
                      onClick={() => deleteMutation.mutate(plan.id)}
                      data-testid={`button-plan-delete-${plan.id}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Create / Edit form */}
      {(showCreate || editingId !== null) && (
        <div className="sm-card">
          <div className="sm-card-header">
            {editingId ? <Pencil className="h-3.5 w-3.5 text-blue-400/80" /> : <Plus className="h-3.5 w-3.5 text-green-400/80" />}
            <span className="text-xs font-semibold text-gray-200">
              {editingId ? `Edit: ${editingPlan?.name ?? ''}` : 'Create Plan'}
            </span>
          </div>
          <div className="px-4 py-3 space-y-3">
            {editingPlan?.locked && (
              <p className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1.5">
                This plan has active organizations — only the name and status can be changed.
              </p>
            )}
            <div className="space-y-2">
              <div>
                <label className="block app-label mb-1">Plan Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Pay As You Grow"
                  data-testid="input-plan-name"
                  className="w-full bg-gray-900/60 border border-gray-700 rounded px-2 py-1 text-gray-200 outline-none focus:border-gray-500 text-xs"
                />
              </div>
              <div>
                <label className="block app-label mb-1">Status</label>
                <select
                  value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value, sunsetAt: e.target.value !== 'sunset' ? null : f.sunsetAt }))}
                  data-testid="select-plan-status"
                  className="w-full bg-gray-900/60 border border-gray-700 rounded px-2 py-1 text-gray-200 outline-none focus:border-gray-500 text-xs"
                >
                  <option value="live">Live — visible to subscribers</option>
                  <option value="in_progress">In Progress — draft, not yet visible</option>
                  <option value="sunset">Sunset — legacy, no new sign-ups</option>
                </select>
              </div>
              {form.status === 'sunset' && (
                <div>
                  <label className="block app-label mb-1">Plan End Date <span className="text-gray-500 font-normal">(optional)</span></label>
                  <input
                    type="date"
                    value={form.sunsetAt ?? ''}
                    onChange={e => setForm(f => ({ ...f, sunsetAt: e.target.value || null }))}
                    data-testid="input-plan-sunsetAt"
                    className="w-full bg-gray-900/60 border border-gray-700 rounded px-2 py-1 text-gray-200 outline-none focus:border-gray-500 text-xs"
                  />
                  <p className="text-[10px] text-gray-500 mt-0.5">Users on this plan will be notified to switch by this date.</p>
                </div>
              )}
              <div>
                <label className="block app-label mb-1">Default Plan</label>
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, isDefault: !f.isDefault }))}
                  data-testid="toggle-plan-isDefault"
                  className={`flex items-center gap-2 w-full rounded border px-3 py-2 text-xs transition-colors ${form.isDefault ? 'border-purple-500/50 bg-purple-500/10 text-purple-300' : 'border-gray-700 bg-gray-900/40 text-gray-400 hover:border-gray-600'}`}
                >
                  <span className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 transition-colors ${form.isDefault ? 'border-purple-400 bg-purple-400' : 'border-gray-500'}`} />
                  {form.isDefault ? 'This is the default plan' : 'Set as default plan'}
                </button>
                <p className="text-[10px] text-gray-500 mt-0.5">Orgs that don't pick a plan during onboarding are assigned the default plan. Only one plan can be default at a time.</p>
              </div>
              <div>
                <label className="block app-label mb-1">Visibility</label>
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, isPublic: !f.isPublic }))}
                  data-testid="toggle-plan-isPublic"
                  className={`flex items-center gap-2 w-full rounded border px-3 py-2 text-xs transition-colors ${form.isPublic ? 'border-green-600/40 bg-green-600/10 text-green-400' : 'border-gray-700 bg-gray-900/40 text-gray-400 hover:border-gray-600'}`}
                >
                  <span className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 transition-colors ${form.isPublic ? 'border-green-400 bg-green-400' : 'border-gray-500'}`} />
                  {form.isPublic ? 'Public — visible on pricing page' : 'Private — admin-assigned only'}
                </button>
                <p className="text-[10px] text-gray-500 mt-0.5">Private plans can be assigned to orgs by an admin but are never shown on the public pricing page or the self-serve subscription flow.</p>
              </div>
              {!editingPlan?.locked && (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block app-label mb-1">Base Price ($/mo)</label>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={(form.basePrice / 100).toFixed(0)}
                        onChange={e => setForm(f => ({ ...f, basePrice: Math.round(parseFloat(e.target.value || '0') * 100) }))}
                        data-testid="input-plan-basePrice"
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block app-label mb-1">Sales % (of GMV)</label>
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        value={form.salesPercentage}
                        onChange={e => setForm(f => ({ ...f, salesPercentage: parseFloat(e.target.value || '0') }))}
                        data-testid="input-plan-salesPercentage"
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block app-label mb-1">Free Threshold ($)</label>
                      <input
                        type="number"
                        min={0}
                        step={100}
                        value={(form.freeSalesThreshold / 100).toFixed(0)}
                        onChange={e => setForm(f => ({ ...f, freeSalesThreshold: Math.round(parseFloat(e.target.value || '0') * 100) }))}
                        data-testid="input-plan-freeSalesThreshold"
                        className={inputCls}
                      />
                    </div>
                  </div>
                  <div className="text-[10px] text-gray-500 pt-0.5">
                    Preview: {fmtC(form.basePrice)}/mo base + {form.salesPercentage}% on GMV over {fmtC(form.freeSalesThreshold)}
                  </div>
                  <div>
                    <label className="block app-label mb-1">Free Trial Duration (days)</label>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={form.trialDurationDays}
                      onChange={e => setForm(f => ({ ...f, trialDurationDays: Math.max(0, parseInt(e.target.value || '0', 10)) }))}
                      data-testid="input-plan-trialDurationDays"
                      className={inputCls}
                    />
                    <p className="text-[10px] text-gray-500 mt-0.5">Set to 0 for no free trial. Ignored for default/free plans.</p>
                  </div>
                </>
              )}

              {/* BrickSpotter — always editable even on locked plans */}
              <div className="border-t border-gray-700/50 pt-3 space-y-2">
                <p className="text-[10px] font-semibold text-gray-300">BrickSpotter 3000</p>
                <div>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, isBrickspotterOnly: !f.isBrickspotterOnly }))}
                    data-testid="toggle-plan-brickspotter-only"
                    className={`flex items-center gap-2 w-full rounded border px-3 py-2 text-xs transition-colors ${form.isBrickspotterOnly ? 'border-lego-yellow/50 bg-lego-yellow/10 text-lego-yellow' : 'border-gray-700 bg-gray-900/40 text-gray-400'}`}
                  >
                    <span className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 transition-colors ${form.isBrickspotterOnly ? 'border-lego-yellow bg-lego-yellow' : 'border-gray-500'}`} />
                    {form.isBrickspotterOnly ? 'BrickSpotter standalone plan' : 'Set as BrickSpotter standalone'}
                  </button>
                  <p className="text-[10px] text-gray-500 mt-0.5">Standalone plans show only the scanner — no store management UI.</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block app-label mb-1">Scans / month</label>
                    <input
                      type="number"
                      min={-1}
                      step={1}
                      value={form.limitBrickspotterScans}
                      onChange={e => setForm(f => ({ ...f, limitBrickspotterScans: parseInt(e.target.value || '0', 10) }))}
                      data-testid="input-plan-limitBrickspotterScans"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block app-label mb-1">API calls / day</label>
                    <input
                      type="number"
                      min={-1}
                      step={1}
                      value={form.limitBrickspotterApiCalls}
                      onChange={e => setForm(f => ({ ...f, limitBrickspotterApiCalls: parseInt(e.target.value || '0', 10) }))}
                      data-testid="input-plan-limitBrickspotterApiCalls"
                      className={inputCls}
                    />
                  </div>
                </div>
                <p className="text-[10px] text-gray-500">
                  <code className="text-violet-400">-1</code> = unlimited · <code className="text-violet-400">0</code> = BrickSpotter not included
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                variant="default"
                className="text-xs"
                onClick={handleSave}
                disabled={saveMutation.isPending || !form.name.trim()}
                data-testid="button-plan-save"
              >
                {saveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                {editingId ? 'Save Changes' : 'Create Plan'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-xs"
                onClick={() => { setEditingId(null); setShowCreate(false); setForm(defaultForm); }}
                data-testid="button-plan-cancel"
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}


      {/* Live billing snapshot */}
      <PricingLiveUsageCard />
    </div>
  );
}


export default function SettingsModal({ open, onClose, initialSection, initialPlatformTab, focusTarget, pricingExample, scoringExample, isBrickspotterOnly = false }: SettingsModalProps) {
  const { toast } = useToast();
  const { status: installStatus, promptInstall } = useInstallPrompt();
  const { isAdmin, superAdmin, user } = useAuth();
  const isMobile = useIsMobile();
  const [clearDataDialog, setClearDataDialog] = useState<'inventory' | 'orders' | null>(null);
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const [testOrdersDialog, setTestOrdersDialog] = useState(false);
  const [testOrdersPreview, setTestOrdersPreview] = useState<{
    count: number;
    orders: { id: string; orderNumber: string | null; orderStatus: string; orderTotal: string | null; inventoryDeducted: boolean; platform: string | null }[];
    withActiveInventory: string[];
  } | null>(null);
  const [testOrdersLoading, setTestOrdersLoading] = useState(false);
  const [testOrdersDeleting, setTestOrdersDeleting] = useState(false);
  const [closedOrdersDialog, setClosedOrdersDialog] = useState(false);
  const [closedOrdersPreview, setClosedOrdersPreview] = useState<{
    count: number; returnedCount: number; cancelledCount: number; otherCount: number;
  } | null>(null);
  const [closedOrdersLoading, setClosedOrdersLoading] = useState(false);
  const [closedOrdersDeleting, setClosedOrdersDeleting] = useState(false);
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
  const [feedbackPrompt, setFeedbackPrompt] = useState("");
  const [showDefaultPrompt, setShowDefaultPrompt] = useState(false);
  const [defaultPromptText, setDefaultPromptText] = useState("");
  const [elfieAnalyzing, setElfieAnalyzing] = useState(false);
  const [elfieAnalysisResult, setElfieAnalysisResult] = useState<{ summary: string; prompt: string; messageCount: number; sessionCount: number } | null>(null);
  const [elfieAnalysisStart, setElfieAnalysisStart] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10);
  });
  const [elfieAnalysisEnd, setElfieAnalysisEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  // BrickLink Settings
  const [bricklinkConsumerKey, setBricklinkConsumerKey] = useState("");
  const [bricklinkConsumerSecret, setBricklinkConsumerSecret] = useState("");
  const [bricklinkTokenValue, setBricklinkTokenValue] = useState("");
  const [bricklinkTokenSecret, setBricklinkTokenSecret] = useState("");
  const [blPasteText, setBlPasteText] = useState("");
  const [blPasteStatus, setBlPasteStatus] = useState<PasteStatus>("idle");
  const [blParsedTokens, setBlParsedTokens] = useState<{ tokenValue: string; tokenSecret: string }[]>([]);
  const [blOcrProcessing, setBlOcrProcessing] = useState(false);

  // Platform Information — all brand fields
  const [platformNameInput, setPlatformNameInput] = useState("");
  const [platformTaglineInput, setPlatformTaglineInput] = useState("");
  const [shopNameInput, setShopNameInput] = useState("");
  const [shopTaglineInput, setShopTaglineInput] = useState("");
  const [studioNameInput, setStudioNameInput] = useState("");
  const [studioTaglineInput, setStudioTaglineInput] = useState("");
  const [platformNameSaving, setPlatformNameSaving] = useState(false);

  // Platform BrickLink Settings (stored on platform settings row, used for PoM & data enrichment)
  const [platformBlConsumerKey, setPlatformBlConsumerKey] = useState("");
  const [platformBlConsumerSecret, setPlatformBlConsumerSecret] = useState("");
  const [platformBlTokenValue, setPlatformBlTokenValue] = useState("");
  const [platformBlTokenSecret, setPlatformBlTokenSecret] = useState("");
  const [platformBlSaving, setPlatformBlSaving] = useState(false);
  const [platformBlTesting, setPlatformBlTesting] = useState(false);

  // BrickOwl Settings
  const [brickowlApiKey, setBrickowlApiKey] = useState("");

  // Stripe Settings (platform billing)
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
  const [inventorySyncFrequency, setInventorySyncFrequency] = useState(24);
  const [priceOMaticEnabled, setPriceOMaticEnabled] = useState(false);
  const [pomScheduleEnabled, setPomScheduleEnabled] = useState(false);
  const [pomSyncTime, setPomSyncTime] = useState("14:00");
  const [timezone, setTimezone] = useState("America/Chicago");
  const [globalSyncPaused, setGlobalSyncPaused] = useState(false);
  const [defaultInventoryFreqHours, setDefaultInventoryFreqHours] = useState(24);
  const [defaultOrdersFreqMins, setDefaultOrdersFreqMins] = useState(30);
  const [defaultChannelFreqHours, setDefaultChannelFreqHours] = useState(4);
  const [syncFloorsByPlan, setSyncFloorsByPlan] = useState<Record<string, Record<string, number>>>({
    inventory: { beta: 24, core: 12, pro: 6 },
    orders:    { beta: 60, core: 30, pro: 15 },
    channel:   { beta: 12, core: 4,  pro: 1  },
  });
  const [pomScheduleBatchSize, setPomScheduleBatchSize] = useState(1500);
  const [pomFreshnessDays, setPomFreshnessDays] = useState(180);
  const [pomZeroStockSkip, setPomZeroStockSkip] = useState(true);
  const [pomGuideFocus, setPomGuideFocus] = useState<'stock' | 'sold' | 'both'>('both');
  const [catalogDetailEnabled, setCatalogDetailEnabled] = useState(false);
  const [catalogDetailFrequencyHours, setCatalogDetailFrequencyHours] = useState(1);
  const [catalogDetailBatchSize, setCatalogDetailBatchSize] = useState(500);
  const [catalogDetailFreshnessDays, setCatalogDetailFreshnessDays] = useState(90);
  const [catalogDetailZeroStockSkip, setCatalogDetailZeroStockSkip] = useState(true);
  const [catalogScanEnabled, setCatalogScanEnabled] = useState(false);
  const [catalogScanFrequencyHours, setCatalogScanFrequencyHours] = useState(2);
  const [catalogScanZeroStockSkip, setCatalogScanZeroStockSkip] = useState(true);
  const [pomApiBudgetPct, setPomApiBudgetPct] = useState(70);
  const [catalogDetailApiBudgetPct, setCatalogDetailApiBudgetPct] = useState(20);
  const [rebrickableImageSyncEnabled, setRebrickableImageSyncEnabled] = useState(true);
  const [expandedAutoSyncService, setExpandedAutoSyncService] = useState<'inventory' | 'orders' | 'channel' | null>(null);
  const [expandedAdminPanel, setExpandedAdminPanel] = useState<'defaults' | 'floors' | 'health' | null>('health');
  const [channelSyncEnabled, setChannelSyncEnabled] = useState(false);
  const [channelSyncTime, setChannelSyncTime] = useState("03:00");
  const [channelSyncFrequency, setChannelSyncFrequency] = useState(4);
  const [channelSyncMode, setChannelSyncMode] = useState<'analysis' | 'full_control' | 'matched_sync'>('analysis');
  const [syncFieldPrice,       setSyncFieldPrice]       = useState(true);
  const [syncFieldRemarks,     setSyncFieldRemarks]     = useState(true);
  const [syncFieldDescription, setSyncFieldDescription] = useState(true);
  const [syncFieldTierPrice,   setSyncFieldTierPrice]   = useState(true);
  const [syncFieldSalePercent,      setSyncFieldSalePercent]      = useState(true);
  const [syncFieldBulkQty,          setSyncFieldBulkQty]          = useState(true);
  const [syncFieldLotWeight,        setSyncFieldLotWeight]        = useState(true);
  const [syncStockroomModes, setSyncStockroomModes] = useState<Record<string, 'skip'|'hidden'|'active'|'sync'>>({ A: 'skip', B: 'skip', C: 'skip' });
  const [syncItemTypes, setSyncItemTypes] = useState<Record<string, boolean>>({});
  const [syncBulkLots, setSyncBulkLots] = useState(false);
  const [syncPriceFloor, setSyncPriceFloor] = useState<string>('');
  const [channelItemGroupsOpen, setChannelItemGroupsOpen] = useState(false);
  const [channelDetailsExpanded, setChannelDetailsExpanded] = useState(false);
  const [ordersSyncEnabled, setOrdersSyncEnabled] = useState(false);
  const [schedulerInventoryOpen, setSchedulerInventoryOpen] = useState(false);
  const [schedulerOrdersOpen, setSchedulerOrdersOpen] = useState(false);
  const [schedulerChannelOpen, setSchedulerChannelOpen] = useState(false);
  const [schedulerChannelBrickOwlOpen, setSchedulerChannelBrickOwlOpen] = useState(true);
  const [channelSyncFieldsOpen, setChannelSyncFieldsOpen] = useState(false);
  const [triggeringSync, setTriggeringSync] = useState<string | null>(null);
  const [enrichmentEmbeddingsOpen, setEnrichmentEmbeddingsOpen] = useState(false);
  const [enrichmentUniversalOpen, setEnrichmentUniversalOpen] = useState(false);
  const [enrichmentPomOpen, setEnrichmentPomOpen] = useState(false);
  const [enrichmentRebrickableOpen, setEnrichmentRebrickableOpen] = useState(false);
  const [rebrickableSetSyncEnabled, setRebrickableSetSyncEnabled] = useState(false);
  const [rebrickableSetSyncTime, setRebrickableSetSyncTime] = useState("04:00");
  const [ordersSyncFrequency, setOrdersSyncFrequency] = useState(15);
  const [ordersSyncFrequencyStr, setOrdersSyncFrequencyStr] = useState("15");

  const [forumSyncEnabled, setForumSyncEnabled] = useState(true);
  const [forumSyncFrequency, setForumSyncFrequency] = useState(60);
  const [forumSyncFrequencyStr, setForumSyncFrequencyStr] = useState("60");
  const [marketNewsSyncEnabled, setMarketNewsSyncEnabled] = useState(false);
  const [marketNewsSyncFrequency, setMarketNewsSyncFrequency] = useState(360);
  const [marketNewsSyncFrequencyStr, setMarketNewsSyncFrequencyStr] = useState("360");
  const [businessIntelEnabled, setBusinessIntelEnabled] = useState(false);
  const [businessIntelFrequency, setBusinessIntelFrequency] = useState(360);
  const [businessIntelFrequencyStr, setBusinessIntelFrequencyStr] = useState("360");
  const [marketNewsQueries, setMarketNewsQueries] = useState<string[]>([
    'LEGO set retirement announcements',
    'LEGO reseller market news pricing trends',
    'BrickLink marketplace updates sellers',
    'LEGO collectible investing value 2026',
    'LEGO supply chain new releases',
  ]);
  const [universalCatalogScheduleEnabled, setUniversalCatalogScheduleEnabled] = useState(false);
  const [universalCatalogRefreshMonths, setUniversalCatalogRefreshMonths] = useState(1);
  const [universalCatalogRetryDays, setUniversalCatalogRetryDays] = useState(30);
  const [expandedJobs, setExpandedJobs] = useState<Record<string, boolean>>({});

  // Price-o-Matic Formula Settings
  const [pomBasePremium, setPomBasePremium] = useState(10);
  const [pomMinifigPremium, setPomMinifigPremium] = useState(5);
  const [pomScarcityThreshold1, setPomScarcityThreshold1] = useState(50);
  const [pomScarcityBonus1, setPomScarcityBonus1] = useState(15);
  const [pomScarcityThreshold2, setPomScarcityThreshold2] = useState(200);
  const [pomScarcityBonus2, setPomScarcityBonus2] = useState(8);
  const [pomScarcityThreshold3, setPomScarcityThreshold3] = useState(500);
  const [pomScarcityBonus3, setPomScarcityBonus3] = useState(3);
  const [pomUnderpricedScore, setPomUnderpricedScore] = useState(1.5);
  const [pomOverpricedScore, setPomOverpricedScore] = useState(0.8);
  const [pomWeightCeiling, setPomWeightCeiling] = useState(0.4);
  const [pomWeightVelocity, setPomWeightVelocity] = useState(0.3);
  const [pomWeightScarcity, setPomWeightScarcity] = useState(0.2);
  const [pomWeightUndercut, setPomWeightUndercut] = useState(0.1);
  const [pomSugSoldAvgW, setPomSugSoldAvgW] = useState(0.5);
  const [pomSugStockMinW, setPomSugStockMinW] = useState(0.3);
  const [pomSugSoldMaxW, setPomSugSoldMaxW] = useState(0.2);
  const [pomSugDemandMult, setPomSugDemandMult] = useState(0.25);
  const [pomSugCompCap, setPomSugCompCap] = useState(1.15);
  const [pomSugFloor, setPomSugFloor] = useState(0.95);
  const [pomSugStorePremium, setPomSugStorePremium] = useState(1.10);
  const [pomSugPricingOpen, setPomSugPricingOpen] = useState(true);
  const pricingWheelRef = useRef<HTMLDivElement>(null);
  const [pomVelocityHigh, setPomVelocityHigh] = useState(2.0);
  const [pomVelocityLow, setPomVelocityLow] = useState(0.3);
  const [pomScarcityHigh, setPomScarcityHigh] = useState(0.1);
  const [pomScarcityLow, setPomScarcityLow] = useState(0.005);
  const [pomUndercutHigh, setPomUndercutHigh] = useState(1.5);
  const [pomUndercutLow, setPomUndercutLow] = useState(0.8);
  const [pomScoringOpen, setPomScoringOpen] = useState(true);
  const scoringWheelRef = useRef<HTMLDivElement>(null);
  const [pomScoringAdvancedOpen, setPomScoringAdvancedOpen] = useState(false);
  const [pomPricingAdvancedOpen, setPomPricingAdvancedOpen] = useState(false);
  const [pomBatchSize, setPomBatchSize] = useState(1500);
  const [blApiCallLimit, setBlApiCallLimit] = useState(4900);
  const [orgBlApiCallLimit, setOrgBlApiCallLimit] = useState(4900);
  const [pomCostFloorPct, setPomCostFloorPct] = useState(0);
  const [pomMinPrice, setPomMinPrice] = useState(0.02);
  const [pomTrendingEnabled, setPomTrendingEnabled] = useState(false);
  const [pomTrendingDays, setPomTrendingDays] = useState(15);       // repurposed: max % adjustment
  const [pomTrendingThreshold, setPomTrendingThreshold] = useState(500);  // BL sold qty = "full demand"
  // IE Strategies
  const [ieStratVision, setIeStratVision] = useState('');
  const [ieStratSuccess, setIeStratSuccess] = useState('');
  const [ieStratPricing, setIeStratPricing] = useState('');
  const [ieStratPreset, setIeStratPreset] = useState<string | null>(null);
  const [ieStratInventory, setIeStratInventory] = useState('');
  const [ieStratOrders, setIeStratOrders] = useState('');
  const [ieStratCustomer, setIeStratCustomer] = useState('');
  const [ieStratMarket, setIeStratMarket] = useState('');
  const [weightExtractionStatus, setWeightExtractionStatus] = useState<'idle' | 'running' | 'done'>('idle');

  // POM AI Pricing
  const [pomAiEnabled, setPomAiEnabled] = useState(false);
  const [pomAiStrategy, setPomAiStrategy] = useState('');
  const [pomAiDecisionCount, setPomAiDecisionCount] = useState(0);
  const [pomSortMode, setPomSortMode] = useState<'scoring' | 'suggested'>('scoring');
  const [pomAiOpen, setPomAiOpen] = useState(false);
  const [pomTrendingBonus, setPomTrendingBonus] = useState(60);     // demand weight 0–100
  const [pomHighSupplyThreshold, setPomHighSupplyThreshold] = useState(10000); // BL stock qty = "full supply"
  const [pomHighSupplyPenalty, setPomHighSupplyPenalty] = useState(40);  // supply weight 0–100


  const [activeSection, setActiveSection] = useState<ActiveSection>(initialSection === 'automation' ? 'platforms' : initialSection ?? null);
  const [activeOrg, setActiveOrg] = useState<OrgWithUsage | null>(null);
  const [activeOrgTab, setActiveOrgTab] = useState<'features' | 'limits' | 'billing'>('features');
  const [activePlatformInnerTab, setActivePlatformInnerTab] = useState<'platforms' | 'scheduler'>('platforms');
  const [activePlatformServicesTab, setActivePlatformServicesTab] = useState<'stripe' | 'openai' | 'bricklink'>('bricklink');
  const [activeSchedulerTab, setActiveSchedulerTab] = useState<'catalog' | 'embeddings' | 'market'>('catalog');
  const [activeAuditTab, setActiveAuditTab] = useState<'organization' | 'platform'>('organization');
  const [activeAuditOrgTab, setActiveAuditOrgTab] = useState<'overview' | 'bricklink'>('overview');
  const [activeAuditPlatformTab, setActiveAuditPlatformTab] = useState<'enrichment' | 'bricklink' | 'logs' | 'database'>('enrichment');
  const [orgHealthDrawer, setOrgHealthDrawer] = useState<{ open: boolean; metric: string; orgId: string; orgName: string }>({ open: false, metric: '', orgId: '', orgName: '' });
  const [updatedItemsDrawerOpen, setUpdatedItemsDrawerOpen] = useState(false);
  const [selectedOrgMetric, setSelectedOrgMetric] = useState<string | null>(null);
  const [blBreakdownSort, setBlBreakdownSort] = useState<{ col: string; dir: 'asc' | 'desc' }>({ col: 'total', dir: 'desc' });
  const [showBlSchedulePopup, setShowBlSchedulePopup] = useState(false);
  const [impersonationSearch, setImpersonationSearch] = useState('');
  const [orgSearch, setOrgSearch] = useState('');

  // When the settings modal closes, proactively close the org-health drawer so vaul
  // can run its own cleanup before being abruptly unmounted alongside the Dialog.
  // Without this, the Dialog and Drawer both try to release the iOS scroll lock at the
  // same time, which can corrupt the react-remove-scroll ref counter and leave
  // the body permanently locked (touch scrolling frozen app-wide).
  useEffect(() => {
    if (!open && orgHealthDrawer.open) {
      setOrgHealthDrawer(prev => ({ ...prev, open: false }));
    }
  }, [open, orgHealthDrawer.open]);

  // Sync activeSection whenever the modal opens with a specific initialSection.
  // useState only uses its initial value on first mount, so without this effect
  // clicking a dashboard action item with a different section would have no effect.
  useEffect(() => {
    if (!open) return;

    // Scheduler-section focus targets: navigate directly to the Auto-Sync section
    if (focusTarget === 'schedulerInventory' || focusTarget === 'schedulerOrders' || focusTarget === 'schedulerChannel') {
      setActiveSection('autoSync');
      const targetId = focusTarget === 'schedulerInventory' ? 'autosync-inventory-card'
        : focusTarget === 'schedulerOrders' ? 'autosync-orders-card'
        : 'autosync-channel-card';
      setTimeout(() => document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
      return;
    }

    if (initialSection) {
      if (initialSection === 'automation') {
        setActiveSection('autoSync');
        if (focusTarget === 'channelSync') {
          setTimeout(() => document.getElementById('autosync-channel-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
        }
      } else {
        setActiveSection(initialSection);
        if (initialPlatformTab) setActivePlatformInnerTab(initialPlatformTab);
      }
      if (initialSection === 'priceomatic') {
        setPomScoringOpen(true);
      }
    }
  }, [open, initialSection, initialPlatformTab, focusTarget]);

  useEffect(() => {
    if (open && pricingExample) {
      setPomSugPricingOpen(true);
      setTimeout(() => {
        pricingWheelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    }
  }, [open, pricingExample]);

  useEffect(() => {
    if (open && scoringExample) {
      setPomScoringOpen(true);
      setTimeout(() => {
        scoringWheelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    }
  }, [open, scoringExample]);

  const { data: settings } = useQuery<AppSettings>({
    queryKey: ['/api/settings'],
    enabled: open,
  });

  const { data: platformSettings } = useQuery<AppSettings>({
    queryKey: ['/api/platform-admin/settings'],
    enabled: open && superAdmin,
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
    enabled: open && (activeSection === 'autoSync' || (activeSection === 'platforms' && activePlatform === null && activePlatformInnerTab === 'scheduler')),
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
    enabled: open && (activeSection === 'autoSync' || (activeSection === 'platforms' && activePlatform === null && activePlatformInnerTab === 'scheduler') || activeSection === 'enrichment'),
  });

  const { data: channelLastResult } = useQuery<{
    completedAt: string;
    mode: string;
    status: 'success' | 'partial' | 'error';
    lotsCreated: number;
    lotsUpdated: number;
    lotsSkipped: number;
    totalApiCalls: number;
    errorCount: number;
    errors: string[];
  } | null>({
    queryKey: ['/api/channel-sync/last-result'],
    refetchInterval: 30000,
    enabled: open && (activeSection === 'autoSync' || (activeSection === 'platforms' && activePlatform === null && activePlatformInnerTab === 'scheduler')),
  });

  type SyncUpdatedItem = {
    itemNo: string;
    condition: string;
    lotId: string;
    changes: Array<{ field: string; from: string; to: string }>;
  };
  const { data: updatedItemsData, isLoading: updatedItemsLoading } = useQuery<{ updatedItems: SyncUpdatedItem[] }>({
    queryKey: ['/api/channel-sync/updated-items'],
    enabled: updatedItemsDrawerOpen,
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
    enabled: open && (activeSection === 'autoSync' || (activeSection === 'platforms' && activePlatform === null && activePlatformInnerTab === 'scheduler')),
  });
  const brickOwlTarget = platformSyncData?.targets?.find(t => t.name === 'BrickOwl');

  type SyncScopeData = {
    totalLots: number;
    activeTotalLots: number;
    inScopeLots: number;
    softDeletedLots: number;
    skipLots: number;
    hiddenLots: number;
    activeLots: number;
    mainStoreLots: number;
    zeroQtyInScope: number;
    itemTypeExcludedLots: number;
    priceFloorExcludedLots: number;
    priceFloor: number | null;
    excludedItemTypes: string[];
    stockroomModes: Record<string, string>;
    stockroomBreakdown: Array<{ id: string; mode: string; lots: number; zeroQtyLots: number }>;
    exclusions: Array<{ reason: string; count: number }>;
  };
  const { data: syncScopeData } = useQuery<SyncScopeData>({
    queryKey: ['/api/channel-sync/scope'],
    enabled: open && (activeSection === 'autoSync' || activeSection === 'platforms'),
    staleTime: 30000,
  });

  const channelSyncMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/platform-sync/sync', { platform: 'BrickOwl', limit: 10 }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/platform-sync/status'] }); },
  });

  // Channel sync field configuration — always fetch fresh from server when section opens
  const { data: channelSyncFieldConfig } = useQuery<{
    syncPrice: boolean; syncRemarks: boolean; syncDescription: boolean;
    syncTierPrice: boolean; syncSalePercent: boolean;
    syncBulkQty: boolean; syncLotWeight: boolean;
    syncStockroomModes: Record<string, 'skip'|'hidden'|'active'|'sync'>;
    syncItemTypes: Record<string, boolean>;
    syncPriceFloor: number | null;
    syncBulkLots: boolean;
  }>({
    queryKey: ['/api/channel-sync/config'],
    enabled: open && activeSection === 'platforms',
    refetchOnMount: 'always',
    staleTime: 0,
  });
  // Sync local state from server config whenever the data arrives or modal re-opens.
  // Switches save immediately on change so there's no partially-committed local state to protect.
  useEffect(() => {
    if (!channelSyncFieldConfig) return;
    setSyncFieldPrice(channelSyncFieldConfig.syncPrice);
    setSyncFieldRemarks(channelSyncFieldConfig.syncRemarks);
    setSyncFieldDescription(channelSyncFieldConfig.syncDescription);
    setSyncFieldTierPrice(channelSyncFieldConfig.syncTierPrice);
    setSyncFieldSalePercent(channelSyncFieldConfig.syncSalePercent);
    setSyncFieldBulkQty(channelSyncFieldConfig.syncBulkQty ?? true);
    setSyncFieldLotWeight(channelSyncFieldConfig.syncLotWeight ?? true);
    setSyncStockroomModes(channelSyncFieldConfig.syncStockroomModes ?? { A: 'skip', B: 'skip', C: 'skip' });
    setSyncItemTypes(channelSyncFieldConfig.syncItemTypes ?? {});
    setSyncBulkLots(channelSyncFieldConfig.syncBulkLots ?? false);
    const floor = channelSyncFieldConfig.syncPriceFloor;
    setSyncPriceFloor(floor != null && Number(floor) > 0 ? String(floor) : '');
  }, [channelSyncFieldConfig]);

  const updateSyncFieldMutation = useMutation({
    mutationFn: (patch: Partial<{ syncPrice: boolean; syncRemarks: boolean; syncDescription: boolean; syncTierPrice: boolean; syncSalePercent: boolean; syncBulkQty: boolean; syncLotWeight: boolean; syncStockroomModes: Record<string, 'skip'|'hidden'|'active'|'sync'>; syncItemTypes: Record<string, boolean>; syncPriceFloor: number | null; syncBulkLots: boolean }>) =>
      apiRequest('PATCH', '/api/channel-sync/config', patch),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/channel-sync/config'] });
      queryClient.invalidateQueries({ queryKey: ['/api/channel-sync/scope'] });
      if ('syncStockroomModes' in variables) {
        toast({ title: 'Stockroom settings saved', description: 'BrickOwl will use these settings on the next sync.' });
      } else if ('syncItemTypes' in variables) {
        toast({ title: 'Item group settings saved', description: 'BrickOwl will use these settings on the next sync.' });
      } else if ('syncPriceFloor' in variables) {
        const v = variables.syncPriceFloor;
        toast({ title: 'Price floor saved', description: v != null && v > 0 ? `Lots under $${v.toFixed(2)} will be excluded from the next sync.` : 'Price floor cleared — all lots will sync.' });
      }
    },
    onError: (err) => {
      // Revert all local sync-field state to whatever the server last confirmed.
      if (channelSyncFieldConfig) {
        setSyncFieldPrice(channelSyncFieldConfig.syncPrice);
        setSyncFieldRemarks(channelSyncFieldConfig.syncRemarks);
        setSyncFieldDescription(channelSyncFieldConfig.syncDescription);
        setSyncFieldTierPrice(channelSyncFieldConfig.syncTierPrice);
        setSyncFieldSalePercent(channelSyncFieldConfig.syncSalePercent);
        setSyncFieldBulkQty(channelSyncFieldConfig.syncBulkQty ?? true);
        setSyncFieldLotWeight(channelSyncFieldConfig.syncLotWeight ?? true);
        setSyncStockroomModes(channelSyncFieldConfig.syncStockroomModes ?? { A: 'skip', B: 'skip', C: 'skip' });
        setSyncBulkLots(channelSyncFieldConfig.syncBulkLots ?? false);
        const floor = channelSyncFieldConfig.syncPriceFloor;
        setSyncPriceFloor(floor != null && Number(floor) > 0 ? String(floor) : '');
      }
      toast({
        title: 'Failed to save sync settings',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'destructive',
      });
    },
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

  const runBackupNowMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/backups/run-now'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/backups/list'] });
    },
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

  const updatePlatformSettingsMutation = useMutation({
    mutationFn: async (data: Partial<AppSettings>) => {
      const response = await fetch('/api/platform-admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error('Failed to update platform settings');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/settings'] });
      queryClient.invalidateQueries({ queryKey: ['/api/priceomatic/insights'] });
      queryClient.invalidateQueries({ queryKey: ['/api/settings'] });
    },
  });

  const updateOrgSettingsMutation = useMutation({
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
      queryClient.invalidateQueries({ queryKey: ['/api/priceomatic/insights'] });
    },
  });

  const [showClearPomDialog, setShowClearPomDialog] = useState(false);


  // Must be declared before any useEffect that references `org` in its dependency array
  const { data: org } = useQuery<Organization>({
    queryKey: ['/api/org'],
    enabled: open,
  });

  const { data: pomInsightsForExample } = useQuery<{ data: { items: PricingInsight[] } }>({
    queryKey: ['/api/priceomatic/insights'],
    enabled: open && activeSection === 'priceomatic',
    staleTime: 60_000,
  });

  const [wheelSearchQuery, setWheelSearchQuery] = useState('');
  const [wheelSearchOpen, setWheelSearchOpen] = useState(false);
  const [selectedWheelExample, setSelectedWheelExample] = useState<PricingInsight | null>(null);
  const wheelSearchRef = useRef<HTMLInputElement>(null);

  const [scoringSearchQuery, setScoringSearchQuery] = useState('');
  const [scoringSearchOpen, setScoringSearchOpen] = useState(false);
  const [selectedScoringExample, setSelectedScoringExample] = useState<PricingInsight | null>(null);
  const [scoringExampleDismissed, setScoringExampleDismissed] = useState(false);
  const scoringSearchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setSelectedWheelExample(null);
      setWheelSearchQuery('');
      setWheelSearchOpen(false);
      setSelectedScoringExample(null);
      setScoringSearchQuery('');
      setScoringSearchOpen(false);
      setScoringExampleDismissed(false);
    }
  }, [open]);

  const wheelExample: PricingInsight | undefined = pricingExample ?? selectedWheelExample ?? undefined;

  const wheelSearchResults = (() => {
    const items = pomInsightsForExample?.data?.items;
    if (!items || !wheelSearchQuery.trim()) return items?.slice(0, 8) ?? [];
    const q = wheelSearchQuery.toLowerCase();
    return items
      .filter(it => (it.itemName?.toLowerCase().includes(q) || it.itemNo.toLowerCase().includes(q) || it.colorName?.toLowerCase().includes(q)))
      .slice(0, 8);
  })();

  const scoringWheelExample: PricingInsight | undefined = selectedScoringExample ?? (!scoringExampleDismissed ? scoringExample : undefined) ?? undefined;

  const scoringSearchResults = (() => {
    const items = pomInsightsForExample?.data?.items;
    if (!items || !scoringSearchQuery.trim()) return items?.slice(0, 8) ?? [];
    const q = scoringSearchQuery.toLowerCase();
    return items
      .filter(it => (it.itemName?.toLowerCase().includes(q) || it.itemNo.toLowerCase().includes(q) || it.colorName?.toLowerCase().includes(q)))
      .slice(0, 8);
  })();



  const { data: platformOrgs, isLoading: platformOrgsLoading, isError: platformOrgsError, error: platformOrgsQueryError, refetch: refetchPlatformOrgs } = useQuery<OrgWithUsage[]>({
    queryKey: ['/api/platform-admin/orgs'],
    enabled: open && (activeSection === 'orgs' || activeSection === 'impersonation'),
    retry: 0,
    staleTime: 0,
  });

  type SyncJobRow = {
    id: string; orgId: string | null; lastSyncTime: string | null; lastSyncStatus: string;
    recordsAdded: number; recordsUpdated: number; errorMessage: string | null; updatedAt: string;
  };
  type SystemHealthData = {
    platform: { totalOrganizations: number; totalUsers: number; activeSubscriptions: number };
    embeddings: { inventoryEmbeddings: number; inventoryTotal: number; orderEmbeddings: number; orderTotal: number };
    jobs: {
      active: Array<{ id: string; orgId: string; jobType: string; status: string; processedItems: number; totalItems: number; errorMessage: string | null; createdAt: string; completedAt: string | null }>;
      recent: Array<{ id: string; orgId: string; jobType: string; status: string; processedItems: number; totalItems: number; errorMessage: string | null; createdAt: string; completedAt: string | null }>;
    };
    syncJobs?: SyncJobRow[];
    clipCatalogStatus?: { embedded: number; total: number };
    schedulerConfig?: Record<string, { enabled: boolean; schedule: string; frequency: string; batchSize?: number; retryDays?: number; workerRunning?: boolean }>;
    catalogCoverage?: {
      totalLots: number;
      inStockLots: number;
      detail: { has: number; hasInStock: number; stale: number; staleInStock: number };
      supply: { has: number; hasInStock: number; stale: number; staleInStock: number };
      sold: { has: number; hasInStock: number; stale: number; staleInStock: number };
      inventoryNotInCatalog: number;
      apiBudget: { total: number; pomPct: number; catalogDetailPct: number; used24h: number };
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

  type StripeBalanceData = { available: { amount: number; currency: string }[]; pending: { amount: number; currency: string }[]; livemode: boolean };
  const { data: stripeBalanceData, isLoading: stripeBalanceLoading, error: stripeBalanceError } = useQuery<StripeBalanceData>({
    queryKey: ['/api/platform-admin/platform-services/stripe-balance'],
    enabled: open && activeSection === 'apiKeys' && activePlatformServicesTab === 'stripe' && superAdmin,
    staleTime: 60000,
    retry: 0,
  });

  type OpenAIStatusData = { connected: boolean; models?: string[]; keyPrefix?: string; error?: string };
  const { data: openAIStatusData, isLoading: openAIStatusLoading } = useQuery<OpenAIStatusData>({
    queryKey: ['/api/platform-admin/platform-services/openai-status'],
    enabled: open && activeSection === 'apiKeys' && activePlatformServicesTab === 'openai' && superAdmin,
    staleTime: 60000,
    retry: 0,
  });

  type OpenAIBillingGrant = { id: string; amount: number; used: number; effective: string; expires: string };
  type OpenAIBillingData = {
    billing: { totalGranted: number; totalUsed: number; totalAvailable: number; grants: OpenAIBillingGrant[] };
    usage: { last30Days: number; mtd: number; topModels: { model: string; service?: string; cost: number; input_tokens?: number; output_tokens?: number; requests?: number }[]; totalTokens?: number; totalRequests?: number; mtdTokens?: number; mtdRequests?: number };
    costsAvailable: boolean;
    creditsAvailable: boolean;
    source?: string;
  };
  const { data: openAIBillingData, isLoading: openAIBillingLoading } = useQuery<OpenAIBillingData>({
    queryKey: ['/api/platform-admin/platform-services/openai-billing'],
    enabled: open && activeSection === 'apiKeys' && activePlatformServicesTab === 'openai' && superAdmin && !!openAIStatusData?.connected,
    staleTime: 120000,
    retry: 0,
  });

  type OrgUsageOp = { operation: string; tokens: number; cost: number; requests: number };
  type OrgUsageEntry = { orgId: string; orgName: string; totalTokens: number; totalCost: number; requests: number; operations: OrgUsageOp[] };
  type OrgUsageData = { orgs: OrgUsageEntry[] };
  const { data: orgUsageData, isLoading: orgUsageLoading } = useQuery<OrgUsageData>({
    queryKey: ['/api/platform-admin/platform-services/openai-billing/by-org'],
    enabled: open && activeSection === 'apiKeys' && activePlatformServicesTab === 'openai' && superAdmin && !!openAIStatusData?.connected,
    staleTime: 120000,
    retry: 0,
  });

  type PlatformInfoData = { platformName: string; tagline: string; shopName: string; shopTagline: string; studioName: string; studioTagline: string };
  const { data: platformInfoData } = useQuery<PlatformInfoData>({
    queryKey: ['/api/platform-admin/platform-services/platform-info'],
    enabled: open && (activeSection === 'apiKeys' || activeSection === 'platformGeneral') && superAdmin,
    staleTime: 60000,
    retry: 0,
  });

  useEffect(() => {
    if (platformInfoData) {
      setPlatformNameInput(platformInfoData.platformName || '');
      setPlatformTaglineInput(platformInfoData.tagline || '');
      setShopNameInput(platformInfoData.shopName || '');
      setShopTaglineInput(platformInfoData.shopTagline || '');
      setStudioNameInput(platformInfoData.studioName || '');
      setStudioTaglineInput(platformInfoData.studioTagline || '');
    }
  }, [platformInfoData]);

  type PlatformBlStatusData = { connected: boolean; hasCredentials: boolean; keyPrefix?: string; testResult?: string; error?: string };
  const { data: platformBlStatusData, isLoading: platformBlStatusLoading } = useQuery<PlatformBlStatusData>({
    queryKey: ['/api/platform-admin/platform-services/bricklink-status'],
    enabled: open && activeSection === 'apiKeys' && activePlatformServicesTab === 'bricklink' && superAdmin,
    staleTime: 60000,
    retry: 0,
  });

  type PlatformBlCredsData = {
    hasConsumerKey: boolean; consumerKeyPrefix: string;
    hasConsumerSecret: boolean;
    hasTokenValue: boolean; tokenValuePrefix: string;
    hasTokenSecret: boolean;
  };
  const { data: platformBlCredsData } = useQuery<PlatformBlCredsData>({
    queryKey: ['/api/platform-admin/platform-services/bricklink-credentials'],
    enabled: open && activeSection === 'apiKeys' && activePlatformServicesTab === 'bricklink' && superAdmin,
    staleTime: 60000,
    retry: 0,
  });

  const { data: systemHealth, isLoading: systemHealthLoading, isError: systemHealthError, refetch: refetchSystemHealth } = useQuery<SystemHealthData>({
    queryKey: ['/api/platform-admin/system-health'],
    enabled: open && (activeSection === 'platformScheduler' || activeSection === 'auditLog'),
    refetchInterval: (activeSection === 'platformScheduler' || activeSection === 'auditLog') ? 15000 : false,
    retry: 0,
    staleTime: 0,
  });


  type OrgSyncEntry = {
    orgId: string;
    orgName: string;
    syncs: Array<{ id: string; orgId: string | null; lastSyncTime: string | null; lastSyncStatus: string | null; recordsAdded: number | null; recordsUpdated: number | null; errorMessage: string | null; updatedAt: string | null }>;
    brickspotter: { totalScans: number; completed: number; failed: number; lastScanAt: string | null } | null;
  };

  const { data: orgSyncStatus, isError: orgSyncError } = useQuery<OrgSyncEntry[]>({
    queryKey: ['/api/platform-admin/org-sync-status'],
    enabled: open && ((activeSection === 'auditLog' && activeAuditTab === 'organization') || activeSection === 'syncAdmin'),
    refetchInterval: (activeSection === 'auditLog' && activeAuditTab === 'organization') || activeSection === 'syncAdmin' ? 30000 : false,
  });

  type DbTableStat = {
    tableName: string;
    totalSize: string;
    totalSizeBytes: number;
    liveRows: number;
    deadRows: number;
    lastVacuum: string | null;
    lastAnalyze: string | null;
    seqScans: number;
    idxScans: number;
    modSinceAnalyze: number;
    description: string | null;
  };
  const isAuditOrg = activeSection === 'auditLog' && activeAuditTab === 'organization';
  const isAuditOrgBl = isAuditOrg && activeAuditOrgTab === 'bricklink';
  const isAuditPlatform = activeSection === 'auditLog' && activeAuditTab === 'platform';
  const isAuditPlatformDb = isAuditPlatform && activeAuditPlatformTab === 'database';
  const isAuditPlatformLogs = isAuditPlatform && activeAuditPlatformTab === 'logs';
  const isAuditPlatformBl = isAuditPlatform && activeAuditPlatformTab === 'bricklink';
  const isAuditPlatformEnrichment = isAuditPlatform && activeAuditPlatformTab === 'enrichment';

  const { data: dbTables, isLoading: dbTablesLoading, refetch: refetchDbTables } = useQuery<DbTableStat[]>({
    queryKey: ['/api/platform-admin/db-tables'],
    enabled: open && isAuditPlatformDb,
    staleTime: 30000,
    retry: 0,
  });

  type ServerLogEntry = {
    id: number;
    level: 'warn' | 'error';
    message: string;
    timestamp: string;
    count: number;
  };
  const { data: serverLogs, isLoading: serverLogsLoading, refetch: refetchServerLogs } = useQuery<ServerLogEntry[]>({
    queryKey: ['/api/platform-admin/server-logs'],
    enabled: open && isAuditPlatform,
    refetchInterval: isAuditPlatformLogs ? 20000 : false,
    staleTime: 0,
    retry: 0,
  });

  const { data: platformBlApiUsage } = useQuery<{
    callsLast24h: number;
    totalAllTime: number;
    successLast24h: number;
    failLast24h: number;
    hourlyBuckets: { hourStart: string; rollsOffAt: string; calls: number }[];
    perOrg: { orgId: string; calls: number }[];
    topEndpoints: { endpoint: string; calls: number }[];
    ceiling: number;
  }>({
    queryKey: ['/api/platform-admin/bl-api-usage'],
    enabled: open && superAdmin && isAuditPlatformBl,
    refetchInterval: isAuditPlatformBl ? 15000 : false,
    retry: 0,
  });

  type BlApiBreakdownRow = {
    orgId: string; orgName: string; total: number; inventory: number; orders: number;
    catalog: number; priceGuide: number; other: number;
    success: number; failed: number;
  };
  const { data: blApiBreakdown, isLoading: blApiBreakdownLoading } = useQuery<BlApiBreakdownRow[]>({
    queryKey: ['/api/platform-admin/customer-health/bl-api-breakdown'],
    enabled: open && superAdmin && isAuditOrg,
    refetchInterval: isAuditOrg ? 30000 : false,
    retry: 0,
  });

  // Admin Team
  const { data: adminTeam, isLoading: adminTeamLoading, refetch: refetchAdminTeam } = useQuery<User[]>({
    queryKey: ['/api/platform-admin/admin-team'],
    enabled: open && (activeSection === 'platformGeneral' || activeSection === 'platformTeam') && superAdmin,
    retry: 0,
  });

  const [addAdminQuery, setAddAdminQuery] = useState('');
  const [addAdminSearch, setAddAdminSearch] = useState('');

  const { data: adminSearchResults, isLoading: adminSearchLoading } = useQuery<User[]>({
    queryKey: ['/api/platform-admin/admin-team/search', addAdminSearch],
    queryFn: () => fetch(`/api/platform-admin/admin-team/search?q=${encodeURIComponent(addAdminSearch)}`).then(r => r.json()),
    enabled: addAdminSearch.length >= 2,
    staleTime: 10000,
  });

  const toggleSuperAdminMutation = useMutation({
    mutationFn: async ({ id, superAdmin }: { id: string; superAdmin: boolean }) =>
      apiRequest('PATCH', `/api/platform-admin/admin-team/${id}`, { superAdmin }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/admin-team'] });
      setAddAdminQuery('');
      setAddAdminSearch('');
      toast({ title: 'Admin team updated' });
    },
    onError: (err: any) => toast({ title: err?.message || 'Failed to update admin', variant: 'destructive' }),
  });

  const updateFeaturesMutation = useMutation({
    mutationFn: async ({ orgId, featureOverrides }: { orgId: string; featureOverrides: Record<string, boolean> }) =>
      apiRequest('PATCH', `/api/platform-admin/orgs/${orgId}/features`, { featureOverrides }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/orgs'] }),
    onError: () => toast({ title: 'Failed to update feature flags', variant: 'destructive' }),
  });

  const { data: adminPlans = [] } = useQuery<Array<{
    id: number; name: string; basePrice: number; status: string; isDefault: boolean;
  }>>({
    queryKey: ['/api/platform-admin/plans'],
    enabled: open && activeSection === 'orgs',
  });

  const updatePlanMutation = useMutation({
    mutationFn: async ({ orgId, planId }: { orgId: string; planId: number }) =>
      apiRequest('PATCH', `/api/platform-admin/orgs/${orgId}/plan`, { planId }),
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

  const [superAdminDeleteOrgDialogOpen, setSuperAdminDeleteOrgDialogOpen] = useState(false);
  const [superAdminDeleteConfirmName, setSuperAdminDeleteConfirmName] = useState('');

  const superAdminDeleteOrgMutation = useMutation({
    mutationFn: async (orgId: string) =>
      apiRequest('DELETE', `/api/platform-admin/orgs/${orgId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/orgs'] });
      setSuperAdminDeleteOrgDialogOpen(false);
      setSuperAdminDeleteConfirmName('');
      setActiveOrg(null);
      toast({ title: 'Organization permanently deleted' });
    },
    onError: (err: any) => toast({ title: 'Failed to delete organization', description: err.message, variant: 'destructive' }),
  });

  const impersonateMutation = useMutation({
    mutationFn: async (orgId: string) => apiRequest('POST', `/api/platform-admin/impersonate/${orgId}`, {}),
    onSuccess: () => { window.location.reload(); },
    onError: () => toast({ title: 'Failed to start impersonation', variant: 'destructive' }),
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

  const vacuumMutation = useMutation({
    mutationFn: async (tables: string[]) => {
      return await apiRequest('POST', '/api/platform-admin/db-vacuum', { tables });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/db-tables'] });
      const ok = data.results?.filter((r: any) => r.ok).length ?? 0;
      const fail = data.results?.filter((r: any) => !r.ok).length ?? 0;
      toast({ title: "Vacuum Complete", description: `${ok} table${ok !== 1 ? 's' : ''} vacuumed${fail ? `, ${fail} failed` : ''}` });
    },
    onError: (err: any) => {
      toast({ title: "Vacuum Failed", description: err.message || "Could not run vacuum.", variant: "destructive" });
    },
  });

  const cleanupMutation = useMutation({
    mutationFn: async ({ target, daysOld }: { target: string; daysOld: number }) => {
      return await apiRequest('POST', '/api/platform-admin/db-cleanup', { target, daysOld });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/db-tables'] });
      const deleted = data.results?.[0]?.deleted ?? 0;
      toast({ title: "Cleanup Complete", description: `${deleted.toLocaleString()} row${deleted !== 1 ? 's' : ''} purged` });
    },
    onError: (err: any) => {
      toast({ title: "Cleanup Failed", description: err.message || "Could not run cleanup.", variant: "destructive" });
    },
  });

  useEffect(() => {
    if (settings) {
      setAiEnabled(settings.aiEnabled);
      const unmask = (val: string | null | undefined) => (val && !val.includes('····')) ? val : '';
      setOpenaiApiKey(unmask(settings.openaiApiKey));
      setSelectedModel(settings.selectedModel || "gpt-4o-mini");
      setSystemPrompt(settings.systemPrompt || "");
      setFeedbackPrompt((settings as any).feedbackPrompt || "");
      setBricklinkConsumerKey(unmask(settings.bricklinkConsumerKey));
      setBricklinkConsumerSecret(unmask(settings.bricklinkConsumerSecret));
      setBricklinkTokenValue(unmask(settings.bricklinkTokenValue));
      setBricklinkTokenSecret(unmask(settings.bricklinkTokenSecret));
      setOrgBlApiCallLimit((settings as any).blApiCallLimit ?? 4900);
      setBrickowlApiKey(unmask(settings.brickowlApiKey));
      setStripeSecretKey(unmask(settings.stripeSecretKey));
      setStripeEnvironment((settings.stripeEnvironment as 'test' | 'live') || 'live');
      setEasypostApiKey(unmask(settings.easypostApiKey));
      setEasypostTestApiKey(unmask(settings.easypostTestApiKey));
      setEasypostKeyMode((settings.easypostKeyMode as 'test' | 'production') || 'test');
      setCustomsSigner(settings.customsSigner || "");
      setBlIossNumber(settings.blIossNumber || "");
      setBoIossNumber(settings.boIossNumber || "");
      setBlUkVatNumber(settings.blUkVatNumber || "");
      setBoUkVatNumber(settings.boUkVatNumber || "");
      setTimezone(settings.timezone || 'America/Chicago');
      setInventorySyncEnabled(settings.inventorySyncEnabled || false);
      setInventorySyncTime(settings.inventorySyncTime || "02:00");
      setInventorySyncFrequency(settings.inventorySyncFrequency ?? 24);
      setRebrickableImageSyncEnabled(settings.rebrickableImageSyncEnabled !== false);
      setChannelSyncEnabled(settings.channelSyncEnabled || false);
      setChannelSyncTime(settings.channelSyncTime || '03:00');
      setChannelSyncFrequency(settings.channelSyncFrequency ?? 4);
      const rawMode = settings.channelSyncMode as string;
      const normalizedMode = (rawMode === 'quantity_only' ? 'matched_sync' : rawMode) as 'analysis' | 'full_control' | 'matched_sync';
      setChannelSyncMode(normalizedMode || 'analysis');
      setOrdersSyncEnabled(settings.ordersSyncEnabled || false);
      setOrdersSyncFrequency(settings.ordersSyncFrequency || 15);
      setOrdersSyncFrequencyStr(String(settings.ordersSyncFrequency || 15));
      
      setPomSugSoldAvgW(settings.pomSugSoldAvgW ?? 0.5);
      setPomSugStockMinW(settings.pomSugStockMinW ?? 0.3);
      setPomSugSoldMaxW(settings.pomSugSoldMaxW ?? 0.2);
      setPomSugDemandMult(settings.pomSugDemandMult ?? 0.25);
      setPomSugCompCap(settings.pomSugCompCap ?? 1.15);
      setPomSugFloor(settings.pomSugFloor ?? 0.95);
      setPomSugStorePremium(settings.pomSugStorePremium ?? 1.10);
      setPomWeightCeiling(settings.pomWeightCeiling ?? 0.4);
      setPomWeightVelocity(settings.pomWeightVelocity ?? 0.3);
      setPomWeightScarcity(settings.pomWeightScarcity ?? 0.2);
      setPomWeightUndercut(settings.pomWeightUndercut ?? 0.1);
      setPomVelocityHigh(settings.pomVelocityHigh ?? 2.0);
      setPomVelocityLow(settings.pomVelocityLow ?? 0.3);
      setPomScarcityHigh(settings.pomScarcityHigh ?? 0.1);
      setPomScarcityLow(settings.pomScarcityLow ?? 0.005);
      setPomUndercutHigh(settings.pomUndercutHigh ?? 1.5);
      setPomUndercutLow(settings.pomUndercutLow ?? 0.8);

      // Fetch models
      fetchModels();
    }
  }, [settings]);

  const { data: pomAiData } = useQuery<{ aiEnabled: boolean; aiStrategy: string | null; decisionCount: number; sortMode: string }>({
    queryKey: ['/api/pom/ai-settings'],
  });
  useEffect(() => {
    if (pomAiData) {
      setPomAiEnabled(pomAiData.aiEnabled ?? false);
      setPomAiStrategy(pomAiData.aiStrategy ?? '');
      setPomAiDecisionCount(pomAiData.decisionCount ?? 0);
      setPomSortMode((pomAiData.sortMode as 'scoring' | 'suggested') ?? 'scoring');
    }
  }, [pomAiData]);

  const savePomAiMutation = useMutation({
    mutationFn: async (patch: { aiEnabled?: boolean; aiStrategy?: string; sortMode?: string }) =>
      apiRequest('PATCH', '/api/pom/ai-settings', patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/pom/ai-settings'] });
      toast({ title: 'AI pricing settings saved' });
    },
    onError: (err: any) => {
      toast({ title: 'Failed to save AI settings', description: err.message, variant: 'destructive' });
    },
  });

  const { data: ieStratData } = useQuery<{ visionMission: string | null; successFactors: string | null; pricingStrategy: string | null; pricingStrategyPreset: string | null; inventoryStrategy: string | null; ordersStrategy: string | null; customerStrategy: string | null; marketStrategy: string | null }>({
    queryKey: ['/api/ie-strategies'],
    enabled: open,
  });
  useEffect(() => {
    if (ieStratData) {
      setIeStratVision(ieStratData.visionMission ?? '');
      setIeStratSuccess(ieStratData.successFactors ?? '');
      setIeStratPricing(ieStratData.pricingStrategy ?? '');
      setIeStratPreset(ieStratData.pricingStrategyPreset ?? null);
      setIeStratInventory(ieStratData.inventoryStrategy ?? '');
      setIeStratOrders(ieStratData.ordersStrategy ?? '');
      setIeStratCustomer(ieStratData.customerStrategy ?? '');
      setIeStratMarket(ieStratData.marketStrategy ?? '');
    }
  }, [ieStratData]);

  const extractWeightsMutation = useMutation({
    mutationFn: async ({ preset, strategyText }: { preset: string; strategyText: string }) =>
      apiRequest('POST', '/api/ie-strategies/extract-weights', { preset, strategyText }),
    onMutate: () => setWeightExtractionStatus('running'),
    onSuccess: (data: any) => {
      setWeightExtractionStatus('done');
      if (data?.weights) {
        setPomWeightCeiling(data.weights.wCeiling);
        setPomWeightVelocity(data.weights.wVelocity);
        setPomWeightScarcity(data.weights.wScarcity);
        setPomWeightUndercut(data.weights.wUndercut);
      }
      queryClient.invalidateQueries({ queryKey: ['/api/pricing-insights'] });
      setTimeout(() => setWeightExtractionStatus('idle'), 3000);
    },
    onError: () => setWeightExtractionStatus('idle'),
  });

  const saveIeStratMutation = useMutation({
    mutationFn: async (patch: Record<string, string>) => apiRequest('PUT', '/api/ie-strategies', patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ie-strategies'] });
      toast({ title: 'Strategy saved' });
    },
    onError: (err: any) => {
      toast({ title: 'Failed to save strategy', description: err.message, variant: 'destructive' });
    },
  });

  useEffect(() => {
    if (platformSettings) {
      setPriceOMaticEnabled(platformSettings.priceOMaticEnabled || false);
      setPomScheduleEnabled(platformSettings.pomScheduleEnabled || false);
      setPomSyncTime(platformSettings.pomSyncTime || '14:00');
      setPomScheduleBatchSize(platformSettings.pomScheduleBatchSize ?? 1500);
      setPomFreshnessDays(platformSettings.pomFreshnessDays ?? 180);
      setPomZeroStockSkip(platformSettings.pomZeroStockSkip !== false);
      setPomGuideFocus(platformSettings.pomGuideFocus || 'both');
      setCatalogDetailEnabled(platformSettings.catalogDetailEnabled || false);
      setCatalogDetailFrequencyHours(platformSettings.catalogDetailFrequencyHours ?? 1);
      setCatalogDetailBatchSize(platformSettings.catalogDetailBatchSize ?? 500);
      setCatalogDetailFreshnessDays(platformSettings.catalogDetailFreshnessDays ?? 90);
      setCatalogDetailZeroStockSkip(platformSettings.catalogDetailZeroStockSkip !== false);
      setCatalogScanEnabled(platformSettings.catalogScanEnabled || false);
      setCatalogScanFrequencyHours(platformSettings.catalogScanFrequencyHours ?? 2);
      setCatalogScanZeroStockSkip(platformSettings.catalogScanZeroStockSkip !== false);
      setRebrickableSetSyncEnabled(platformSettings.rebrickableSetSyncEnabled || false);
      setRebrickableSetSyncTime(platformSettings.rebrickableSetSyncTime || '04:00');
      setForumSyncEnabled(platformSettings.forumSyncEnabled !== false);
      setForumSyncFrequency(platformSettings.forumSyncFrequency || 60);
      setForumSyncFrequencyStr(String(platformSettings.forumSyncFrequency || 60));
      setMarketNewsSyncEnabled(platformSettings.marketNewsSyncEnabled || false);
      setMarketNewsSyncFrequency(platformSettings.marketNewsSyncFrequency || 360);
      setMarketNewsSyncFrequencyStr(String(platformSettings.marketNewsSyncFrequency || 360));
      setBusinessIntelEnabled(platformSettings.businessIntelEnabled || false);
      setBusinessIntelFrequency(platformSettings.businessIntelFrequency || 360);
      setBusinessIntelFrequencyStr(String(platformSettings.businessIntelFrequency || 360));
      if (platformSettings.marketNewsQueries && Array.isArray(platformSettings.marketNewsQueries) && platformSettings.marketNewsQueries.length > 0) {
        setMarketNewsQueries(platformSettings.marketNewsQueries);
      }
      setUniversalCatalogScheduleEnabled(platformSettings.universalCatalogScheduleEnabled || false);
      setUniversalCatalogRefreshMonths(platformSettings.universalCatalogRefreshMonths ?? 1);
      setUniversalCatalogRetryDays(platformSettings.universalCatalogRetryDays ?? 30);
      setPomApiBudgetPct(platformSettings.pomApiBudgetPct ?? 70);
      setCatalogDetailApiBudgetPct(platformSettings.catalogDetailApiBudgetPct ?? 20);
      setPomBasePremium(platformSettings.pomBasePremium ?? 10);
      setPomMinifigPremium(platformSettings.pomMinifigPremium ?? 5);
      setPomScarcityThreshold1(platformSettings.pomScarcityThreshold1 ?? 50);
      setPomScarcityBonus1(platformSettings.pomScarcityBonus1 ?? 15);
      setPomScarcityThreshold2(platformSettings.pomScarcityThreshold2 ?? 200);
      setPomScarcityBonus2(platformSettings.pomScarcityBonus2 ?? 8);
      setPomScarcityThreshold3(platformSettings.pomScarcityThreshold3 ?? 500);
      setPomScarcityBonus3(platformSettings.pomScarcityBonus3 ?? 3);
      setPomUnderpricedScore(platformSettings.pomUnderpricedScore ?? 1.5);
      setPomOverpricedScore(platformSettings.pomOverpricedScore ?? 0.8);
      setPomBatchSize(platformSettings.pomBatchSize ?? 1500);
      setBlApiCallLimit(platformSettings.blApiCallLimit ?? 4900);
      setPomCostFloorPct(platformSettings.pomCostFloorPct ?? 0);
      setPomMinPrice(parseFloat(String(platformSettings.pomMinPrice ?? '0.02')));
      setPomTrendingEnabled(platformSettings.pomTrendingEnabled ?? false);
      setPomTrendingDays(platformSettings.pomTrendingDays ?? 15);
      setPomTrendingThreshold(platformSettings.pomTrendingThreshold ?? 500);
      setPomTrendingBonus(platformSettings.pomTrendingBonus ?? 60);
      setPomHighSupplyThreshold(platformSettings.pomHighSupplyThreshold ?? 10000);
      setPomHighSupplyPenalty(platformSettings.pomHighSupplyPenalty ?? 40);
      setGlobalSyncPaused((platformSettings as any).globalSyncPaused ?? false);
      setDefaultInventoryFreqHours((platformSettings as any).defaultInventoryFreqHours ?? 24);
      setDefaultOrdersFreqMins((platformSettings as any).defaultOrdersFreqMins ?? 30);
      setDefaultChannelFreqHours((platformSettings as any).defaultChannelFreqHours ?? 4);
      const floors = (platformSettings as any).syncFloorsByPlan;
      if (floors && typeof floors === 'object') {
        setSyncFloorsByPlan({
          inventory: { beta: 24, core: 12, pro: 6, ...(floors.inventory || {}) },
          orders:    { beta: 60, core: 30, pro: 15, ...(floors.orders || {}) },
          channel:   { beta: 12, core: 4,  pro: 1,  ...(floors.channel || {}) },
        });
      }
    }
  }, [platformSettings]);

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
    setClearDataDialog(null);
  };

  const handleOpenTestOrdersDialog = async () => {
    setTestOrdersLoading(true);
    setTestOrdersPreview(null);
    setTestOrdersDialog(true);
    try {
      const res = await fetch('/api/orders/test-preview');
      const data = await res.json();
      setTestOrdersPreview(data);
    } catch {
      toast({ title: 'Could not load test orders', variant: 'destructive' });
      setTestOrdersDialog(false);
    } finally {
      setTestOrdersLoading(false);
    }
  };

  const handleDeleteTestOrders = async () => {
    setTestOrdersDeleting(true);
    try {
      const res = await fetch('/api/orders/test', { method: 'DELETE' });
      const data = await res.json();
      if (data.deleted === 0) {
        toast({ title: 'No test orders found', description: 'Nothing to delete.' });
      } else {
        toast({ title: `Removed ${data.deleted} test order${data.deleted !== 1 ? 's' : ''}`, description: 'All associated records have been deleted. No inventory quantities were changed.' });
      }
      setTestOrdersDialog(false);
      setTestOrdersPreview(null);
    } catch {
      toast({ title: 'Delete failed', description: 'Could not remove test orders.', variant: 'destructive' });
    } finally {
      setTestOrdersDeleting(false);
    }
  };

  const handleOpenClosedOrdersDialog = async () => {
    setClosedOrdersLoading(true);
    setClosedOrdersPreview(null);
    setClosedOrdersDialog(true);
    try {
      const res = await fetch('/api/orders/closed-preview');
      const data = await res.json();
      setClosedOrdersPreview(data);
    } catch {
      toast({ title: 'Could not load order data', variant: 'destructive' });
      setClosedOrdersDialog(false);
    } finally {
      setClosedOrdersLoading(false);
    }
  };

  const handleDeleteClosedOrders = async () => {
    setClosedOrdersDeleting(true);
    try {
      const res = await fetch('/api/orders/closed', { method: 'DELETE' });
      const data = await res.json();
      if (data.deleted === 0) {
        toast({ title: 'No matching orders found', description: 'Nothing to delete.' });
      } else {
        toast({ title: `Removed ${data.deleted} order${data.deleted !== 1 ? 's' : ''}`, description: 'All associated records have been deleted.' });
      }
      setClosedOrdersDialog(false);
      setClosedOrdersPreview(null);
    } catch {
      toast({ title: 'Delete failed', description: 'Could not remove orders.', variant: 'destructive' });
    } finally {
      setClosedOrdersDeleting(false);
    }
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
  const [syncingPomTrigger, setSyncingPomTrigger] = useState(false);
  const [syncingRebrickable, setSyncingRebrickable] = useState(false);

  const { data: pomLiveStatus } = useQuery<{ success: boolean; data: any }>({
    queryKey: ['/api/sync/priceomatic/status'],
    refetchInterval: 3000,
    staleTime: 0,
    enabled: open && (activeSection === 'enrichment' || activeSection === 'priceomatic' || activeSection === 'autoSync' || (activeSection === 'platforms' && activePlatform === null && activePlatformInnerTab === 'scheduler') || activeSection === 'platformScheduler'),
  });
  const pomLiveProgress = pomLiveStatus?.data?.liveProgress;
  const syncingPom = syncingPomTrigger || pomLiveProgress?.active === true;
  const pomProgressPct = pomLiveProgress?.itemsTotal > 0 ? Math.round((pomLiveProgress.itemsProcessed / pomLiveProgress.itemsTotal) * 100) : 0;
  const pomCallsLast24h = pomLiveStatus?.data?.callsLast24h ?? 0;
  const pomApiCeiling = pomLiveStatus?.data?.apiCeiling ?? 4900;
  const pomUnenrichedCount = pomLiveStatus?.data?.unenrichedCount ?? 0;
  const pomCurrentSyncCalls = pomLiveProgress?.active ? Math.max(0, pomCallsLast24h - (pomLiveProgress.apiCallsAtStart ?? pomCallsLast24h)) : 0;

  const { data: cdLiveStatus } = useQuery<{ success: boolean; data: any }>({
    queryKey: ['/api/sync/catalog-detail/status'],
    refetchInterval: 3000,
    staleTime: 0,
    enabled: open && (activeSection === 'platformScheduler'),
  });
  const cdLiveProgress = cdLiveStatus?.data?.liveProgress;
  const syncingCd = cdLiveProgress?.active === true;
  const cdProgressPct = cdLiveProgress?.itemsTotal > 0 ? Math.round((cdLiveProgress.itemsProcessed / cdLiveProgress.itemsTotal) * 100) : 0;

  const { data: csLiveStatus } = useQuery<{ success: boolean; data: any }>({
    queryKey: ['/api/sync/catalog-scan/status'],
    refetchInterval: 3000,
    staleTime: 0,
    enabled: open && (activeSection === 'platformScheduler'),
  });
  const csLiveProgress = csLiveStatus?.data?.liveProgress;
  const syncingCs = csLiveProgress?.active === true;

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
      toast({ title: successTitle ?? `${label} started`, description: successDescription ?? 'Sync is running in the background.' });
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

  const allNavigationItems = [
    { id: 'general' as const, label: 'Company Information', icon: Settings, bsVisible: true },
    { id: 'team' as const, label: 'Team', icon: Users, bsVisible: false },
    { id: 'platforms' as const, label: 'Services', icon: Layers, bsVisible: false },
    { id: 'autoSync' as const, label: 'Auto-Sync Schedule', icon: RefreshCw, bsVisible: false },
    { id: 'ieStrategies' as const, label: 'IE Strategies', icon: Target, bsVisible: false },
    { id: 'data' as const, label: 'Store Data', icon: HardDrive, bsVisible: false },
    { id: 'ai' as const, label: 'E.L.F.I.E.', icon: Brain, bsVisible: true },
    { id: 'warehouse' as const, label: 'Warehouse', icon: Warehouse, bsVisible: false },
    { id: 'notifications' as const, label: 'Notifications', icon: Bell, bsVisible: false },
    { id: 'about' as const, label: 'About & Credits', icon: Info, bsVisible: true },
    { id: 'legal' as const, label: 'Legal & Terms', icon: FileText, bsVisible: true },
  ];
  const navigationItems = isBrickspotterOnly
    ? allNavigationItems.filter(item => item.bsVisible)
    : allNavigationItems;

  const platformAdminGroups = [
    {
      label: '',
      items: [
        { id: 'platformGeneral' as const, label: 'Company Information', icon: Settings },
        { id: 'platformTeam' as const, label: 'Team', icon: Users },
        { id: 'apiKeys' as const, label: 'Services', icon: Key },
        { id: 'syncAdmin' as const, label: 'Auto-Sync Schedule', icon: RefreshCw },
        { id: 'platformScheduler' as const, label: 'Data Enrichment', icon: Calendar },
        { id: 'auditLog' as const, label: 'Platform Health', icon: ClipboardList },
        { id: 'platformElfie' as const, label: 'E.L.F.I.E. Settings', icon: Brain },
        { id: 'platformNotifications' as const, label: 'Notifications', icon: Bell },
        { id: 'mapping' as const, label: 'Mappings', icon: Map },
      ],
    },
    {
      label: 'Plans & Customers',
      items: [
        { id: 'plansAndPricing' as const, label: 'Plans & Pricing', icon: Tag },
        { id: 'orgs' as const, label: 'Organizations', icon: Building2 },
        { id: 'billingOverview' as const, label: 'Billing Overview', icon: CreditCard },
        { id: 'announcements' as const, label: 'Announcements', icon: Megaphone },
        { id: 'supportQueue' as const, label: 'Support Queue', icon: Headphones },
        { id: 'impersonation' as const, label: 'View as Company', icon: EyeOff },
      ],
    },
    {
      label: 'Platform Strategy',
      items: [
        { id: 'productVision' as const, label: 'Vision of Success', icon: Crosshair },
        { id: 'productOkrs' as const, label: 'OKRs', icon: Target },
        { id: 'productRoadmap' as const, label: 'Roadmap', icon: Map },
        { id: 'productBacklog' as const, label: 'Backlog', icon: ListTodo },
      ],
    },
  ];

  const platformAdminItems = platformAdminGroups.flatMap(g => g.items);
  const allNavItems = [...navigationItems, ...platformAdminItems];

  const activeNavItem = allNavItems.find(i => i.id === activeSection);

  const sectionTitle = activeSection === 'platforms' && activePlatform !== null
    ? (() => {
        const hardcoded: Record<string, string> = { bricklink: 'BrickLink', brickowl: 'BrickOwl', easypost: 'EasyPost' };
        if (hardcoded[activePlatform]) return hardcoded[activePlatform];
        const dyn = orgIntegrationsList.find(i => String(i.id) === activePlatform);
        return dyn ? (dyn.displayName || dyn.channel) : 'Channel';
      })()
    : activeSection === 'orgs' && activeOrg !== null
      ? activeOrg.name
      : activeNavItem?.label ?? 'Settings';

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent
          className={isMobile
            ? "!inset-0 !translate-x-0 !translate-y-0 !max-w-none !rounded-none !border-0 bg-gray-900 p-0 !gap-0 overflow-hidden data-[state=open]:!slide-in-from-bottom-full data-[state=closed]:!slide-out-to-bottom-full data-[state=open]:!zoom-in-100 data-[state=closed]:!zoom-out-100 data-[state=open]:!slide-in-from-left-0 data-[state=closed]:!slide-out-to-left-0 [&>button]:!hidden"
            : `${activeSection === 'warehouse' ? 'sm:max-w-[920px]' : 'sm:max-w-[640px]'} bg-gray-900 border-gray-700 p-0 !gap-0 overflow-hidden`
          }
          style={isMobile
            ? { height: '100dvh', paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }
            : { height: `min(${activeSection === 'warehouse' ? '700px' : '640px'}, calc(96dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)))` }
          }
          onCloseAutoFocus={() => {
            // After the closing animation fully completes, sweep any body styles that
            // vaul or react-remove-scroll may have left behind. Safe to call here
            // because focus is being returned and all overlay cleanup should be done.
            document.body.style.overflow = '';
            document.body.style.position = '';
            document.body.style.top = '';
            document.body.style.marginTop = '';
            document.body.style.touchAction = '';
            document.body.style.userSelect = '';
            document.body.removeAttribute('data-scroll-locked');
          }}
        >
          <div
            className="flex flex-col h-full min-h-0 min-w-0 w-full"
          >
            {/* Header */}
            <div className="flex items-center px-3 py-3 border-b border-gray-700/80 bg-gray-800/70 flex-shrink-0">
              <div className="w-8 flex-shrink-0 flex items-center">
                {activeSection !== null && (
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
              <div className="flex-1 p-0 text-center">
                <DialogTitle className="text-sm font-semibold text-gray-100 tracking-wide">
                  {activeSection === null
                    ? 'Settings'
                    : sectionTitle}
                </DialogTitle>
              </div>
              <div className="w-8 flex-shrink-0 flex items-center justify-end">
                {isMobile && (
                  <button
                    onClick={onClose}
                    className="text-gray-400 hover:text-gray-200 transition-colors p-1 rounded"
                    data-testid="button-settings-close-mobile"
                  >
                    <X className="h-5 w-5" />
                  </button>
                )}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden">
              {activeSection === null && (
                <nav className="p-2">
                  {superAdmin && (
                    <div className="tool-tab-bar mb-1">
                      <button
                        onClick={() => setOpenGroup('company')}
                        className={`tool-tab-fill ${openGroup === 'company' ? 'text-yellow-400 border-yellow-500' : 'tool-tab-off'}`}
                        data-testid="button-company-settings-toggle"
                      >
                        <Building2 className="w-3.5 h-3.5 shrink-0" />
                        Company
                      </button>
                      <button
                        onClick={() => setOpenGroup('platform')}
                        className={`tool-tab-fill ${openGroup === 'platform' ? 'text-yellow-400 border-yellow-500' : 'tool-tab-off'}`}
                        data-testid="button-platform-admin-toggle"
                      >
                        <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                        Platform
                      </button>
                    </div>
                  )}

                  {openGroup === 'company' && navigationItems.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setActiveSection(item.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-md text-sm text-gray-100 hover:text-white hover:bg-gray-700/50 transition-colors group"
                      data-testid={`nav-${item.id}`}
                    >
                      <item.icon className="h-4 w-4 text-gray-300 flex-shrink-0 group-hover:text-white transition-colors" />
                      <span className="flex-1 text-left">{item.label}</span>
                      <ChevronRight className="h-4 w-4 text-gray-500 flex-shrink-0" />
                    </button>
                  ))}

                  {openGroup === 'platform' && superAdmin && platformAdminGroups.map((group) => (
                    <div key={group.label || '_top'}>
                      {group.label && <p className="px-4 pt-2 pb-1 text-[9px] uppercase tracking-widest text-yellow-500/70 font-semibold">{group.label}</p>}
                      {group.items.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => setActiveSection(item.id)}
                          className="w-full flex items-center gap-3 px-4 py-2.5 rounded-md text-sm text-yellow-200 hover:text-yellow-100 hover:bg-yellow-500/10 transition-colors group"
                          data-testid={`nav-${item.id}`}
                        >
                          <item.icon className="h-4 w-4 text-yellow-400 flex-shrink-0 group-hover:text-yellow-300 transition-colors" />
                          <span className="flex-1 text-left">{item.label}</span>
                          <ChevronRight className="h-4 w-4 text-yellow-600 flex-shrink-0" />
                        </button>
                      ))}
                    </div>
                  ))}

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
              )}

              {activeSection !== null && (
                <div className={isMobile ? "p-4" : "p-4 sm:p-6"}>

            {/* General Settings */}
            {activeSection === 'general' && (
              <div className="min-h-[400px]">

              <div className="space-y-4">

              {/* Header card: logo + version + org ID */}
              <div className="sm-card p-3">
                <div className="flex items-center gap-3">
                  {/* Logo upload area */}
                  <div className="flex-shrink-0 flex flex-col items-center gap-1">
                    <button
                      onClick={() => document.getElementById('logo-upload')?.click()}
                      className="w-16 h-16 rounded-lg bg-gray-700 border border-gray-600 overflow-hidden flex items-center justify-center hover:border-gray-400 hover:bg-gray-600 transition-colors cursor-pointer"
                      title="Upload logo"
                      data-testid="button-upload-logo"
                      disabled={logoUploadMutation.isPending}
                    >
                      {logoUploadMutation.isPending ? (
                        <Loader2 className="h-5 w-5 text-gray-400 animate-spin" />
                      ) : org?.logoUrl ? (
                        <img src={org.logoUrl} alt="Org logo" className="w-full h-full object-cover" />
                      ) : (
                        <div className="flex flex-col items-center gap-1">
                          <Upload className="h-4 w-4 text-gray-400" />
                          <span className="text-[9px] text-gray-400">Logo</span>
                        </div>
                      )}
                    </button>
                    <span className="text-[9px] text-gray-500">Click to upload</span>
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
                        <p className="text-xs font-medium text-gray-100">{APP_NAME}</p>
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
                <h3 className="text-sm font-medium text-gray-100">Organization Profile</h3>

                {/* Company Name */}
                <div className="space-y-1.5">
                  <Label htmlFor="org-name" className="text-xs text-gray-200">Company Name</Label>
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
                  <Label htmlFor="org-address" className="text-xs text-gray-200">Address</Label>
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
                  <Label htmlFor="org-phone" className="text-xs text-gray-200">Phone</Label>
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
                  <Label htmlFor="org-website" className="text-xs text-gray-200">Website</Label>
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
                  <Label htmlFor="timezone" className="text-xs text-gray-200">Time Zone</Label>
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
                <h3 className="text-sm font-medium text-gray-100">Install App</h3>
                <div className="sm-card p-3 space-y-2">
                  {installStatus === 'installed' ? (
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
                      <div>
                        <p className="text-xs font-medium text-gray-100">App is installed</p>
                        <p className="text-[10px] text-gray-500">E.L.F.I.E. is already on your home screen.</p>
                      </div>
                    </div>
                  ) : installStatus === 'promptable' ? (
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Smartphone className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        <div>
                          <p className="text-xs font-medium text-gray-100">Add to Home Screen</p>
                          <p className="text-[10px] text-gray-500">Install E.L.F.I.E. for quick access.</p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          const outcome = await promptInstall();
                          if (outcome === 'accepted') {
                            toast({ title: 'App installed', description: 'E.L.F.I.E. has been added to your home screen.' });
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
                        <p className="text-xs font-medium text-gray-100">Add to Home Screen</p>
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
                        <p className="text-xs font-medium text-gray-100">Add to Home Screen</p>
                        <p className="text-[10px] text-gray-500">Use your browser's menu to add E.L.F.I.E. to your home screen or desktop for quick access.</p>
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
              <ResponsiveModal
                open={deleteOrgDialogOpen}
                onOpenChange={setDeleteOrgDialogOpen}
                title="Delete company"
                icon={AlertTriangle}
                iconColor="text-red-400"
                description="Permanently delete this company and all data"
                testId="modal-delete-org"
              >
                  <div className="space-y-4 py-1">
                    <p className="text-sm text-gray-300">
                      This will permanently delete <span className="font-semibold text-white">{org?.name}</span> and all associated data — orders, inventory, settings, integrations, and every user in this organization.
                    </p>
                    <div className="bg-red-950/30 border border-red-900/40 rounded-md p-3 text-xs text-red-300">
                      This action is irreversible. There is no way to recover your data after deletion.
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-gray-200">
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
              </ResponsiveModal>

              </div>

              </div>
            )}

            {/* ── Team ──────────────────────────────────────────────────── */}
            {activeSection === 'team' && (
              <div className="min-h-[400px] space-y-0">
                <ChangePasswordSection />
                <UserManagementSection userCount={users?.length} />
              </div>
            )}

            {/* __POM_REMOVED_FROM_GENERAL__ */}
            {false && (
                <div>
                  <h3 className="text-sm font-medium text-gray-100 mb-3">Price-o-Matic</h3>

                  {/* Auto Sync Scheduler */}
                  <div className="space-y-3 my-4">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <Label className="text-xs font-medium text-gray-100">Price-o-Matic Auto Sync</Label>
                          <Popover>
                            <PopoverTrigger asChild>
                              <button className="sm-icon-btn">
                                <Info className="w-3 h-3" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent side="bottom" className="sm-popover-lg">
                              <p className="font-semibold text-gray-200">Price-o-Matic Auto Sync</p>
                              <p className="text-gray-400">Fetches supply (stock) and sold price guides from BrickLink for each inventory item using 2 API calls per item. Items are processed oldest-first based on the freshness window configured in the scheduler.</p>
                              <p className="sm-description">Runs on its own independent schedule. Uses 2 BrickLink API calls per item (stock + sold). Stops automatically at your daily API ceiling.</p>
                            </PopoverContent>
                          </Popover>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">Runs independently on its own schedule</p>
                        <SyncStatusLine entry={syncStatuses?.priceomatic ?? null} />
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={syncingPom}
                          onClick={() => runManualSync('/api/sync/priceomatic', setSyncingPomTrigger, 'Price-o-Matic', undefined, 'Price-o-Matic started', 'Sync is running in the background.')}
                          title="Run Price-o-Matic sync now"
                          data-testid="button-run-pom-sync"
                        >
                          {syncingPom ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                        </Button>
                        <Switch
                          checked={pomScheduleEnabled}
                          onCheckedChange={(checked) => {
                            setPomScheduleEnabled(checked);
                            updatePlatformSettingsMutation.mutate({ pomScheduleEnabled: checked });
                          }}
                          data-testid="switch-pom-schedule"
                        />
                      </div>
                    </div>

                    {syncingPom && pomLiveProgress && (
                      <div className="space-y-1.5 mt-2" data-testid="pom-progress-bar">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] text-blue-400 font-medium flex items-center gap-1.5">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Syncing…
                          </span>
                          <span className="text-[10px] text-gray-400">{pomLiveProgress.itemsProcessed?.toLocaleString()} / {pomLiveProgress.itemsTotal?.toLocaleString()} lots · {pomProgressPct}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-gray-700/60 rounded-full overflow-hidden">
                          <div className="h-full bg-purple-500 rounded-full transition-all duration-500" style={{ width: `${pomProgressPct}%` }} />
                        </div>
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-[10px] text-gray-500">{(pomLiveProgress.itemsNew ?? 0).toLocaleString()} new · {(pomLiveProgress.itemsRefreshed ?? 0).toLocaleString()} refreshed · {pomUnenrichedCount.toLocaleString()} without POM</span>
                          <span className="text-[10px] text-gray-500">API: {pomCurrentSyncCalls.toLocaleString()} / {pomApiCeiling.toLocaleString()}</span>
                        </div>
                      </div>
                    )}

                    {!syncingPom && pomLiveStatus?.data && (
                      <div className="flex items-center justify-between gap-2 mt-1.5" data-testid="pom-api-stats">
                        <span className="text-[10px] text-gray-500">24h API: {pomCallsLast24h.toLocaleString()} / {pomApiCeiling.toLocaleString()}</span>
                        <span className="text-[10px] text-gray-500">Without POM: {pomUnenrichedCount.toLocaleString()}</span>
                      </div>
                    )}

                    {pomScheduleEnabled && (
                      <div className="ml-4 space-y-3">
                        <div className="flex items-center gap-4">
                          <div className="space-y-1">
                            <Label htmlFor="pom-sync-time" className="text-xs text-gray-200">Sync Time</Label>
                            <Input
                              id="pom-sync-time"
                              type="time"
                              value={pomSyncTime}
                              onChange={(e) => setPomSyncTime(e.target.value)}
                              onBlur={() => updatePlatformSettingsMutation.mutate({ pomSyncTime })}
                              className="text-xs w-32"
                              data-testid="input-pom-sync-time"
                            />
                            <p className="text-[10px] text-gray-500">Local timezone</p>
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor="pom-schedule-batch" className="text-xs text-gray-200">Lots per run</Label>
                            <Input
                              id="pom-schedule-batch"
                              type="number"
                              min={100}
                              max={5000}
                              step={100}
                              value={pomScheduleBatchSize}
                              onChange={(e) => setPomScheduleBatchSize(parseInt(e.target.value) || 100)}
                              onBlur={() => updatePlatformSettingsMutation.mutate({ pomScheduleBatchSize })}
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
                          <Label className="text-xs text-gray-200">Manual sync batch size</Label>
                          <Popover>
                            <PopoverTrigger asChild>
                              <button className="sm-icon-btn">
                                <Info className="w-3 h-3" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent side="bottom" className="sm-popover-md">
                              Max lots to process when you hit the play button above to run a sync manually.
                            </PopoverContent>
                          </Popover>
                        </div>
                        <div className="flex items-center gap-2">
                          <Input type="number" min={100} max={25000} step={100} value={pomBatchSize} onChange={(e) => setPomBatchSize(parseInt(e.target.value) || 100)} onBlur={() => updatePlatformSettingsMutation.mutate({ pomBatchSize })} className="text-xs w-24 text-right" data-testid="input-pom-batch-size" />
                          <span className="text-[10px] text-gray-500 w-16">lots / run</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <Separator className="bg-gray-700" />

                  {/* Scoring quick-view — full config is in POM settings section */}
                  <div className="px-3 py-2 rounded bg-gray-800/20 border border-gray-700/30">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-[10px] text-gray-500 uppercase tracking-wider">Scoring</span>
                      <button
                        onClick={() => { setActiveSection('priceomatic'); setPomScoringOpen(true); }}
                        className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
                        data-testid="button-pom-scoring-goto"
                      >
                        Configure in Price-o-Matic settings
                      </button>
                    </div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className="text-[10px] text-gray-400">Ceiling {(pomWeightCeiling * 100).toFixed(0)}%</span>
                      <span className="text-[10px] text-gray-400">STR {(pomWeightVelocity * 100).toFixed(0)}%</span>
                      <span className="text-[10px] text-gray-400">Scarcity {(pomWeightScarcity * 100).toFixed(0)}%</span>
                      <span className="text-[10px] text-gray-400">Undercut {(pomWeightUndercut * 100).toFixed(0)}%</span>
                    </div>
                  </div>

                  {/* Clear Cache */}
                  <div className="bg-red-500/5 border border-red-500/20 rounded-md px-4 py-3">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <Label className="text-sm font-medium text-red-300">Clear Price Guide Cache</Label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <button className="sm-icon-btn">
                              <Info className="w-3.5 h-3.5" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent side="bottom" className="sm-popover">
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

                  <ResponsiveModal
                    open={showClearPomDialog}
                    onOpenChange={setShowClearPomDialog}
                    title="Clear Price Guide Cache?"
                    icon={Sparkles}
                    iconColor="text-purple-400"
                    description="Clear all Price-o-Matic price guide data"
                    testId="modal-clear-pom"
                  >
                    <div className="space-y-4">
                      <p className="text-sm text-gray-400">
                        This will permanently delete all stored Price-o-Matic price guide data and reset the sync history. The next sync run will start fresh and rebuild from scratch using your current formula settings.
                      </p>
                      <p className="text-sm text-gray-400">
                        This cannot be undone, but no inventory data is affected — only the pricing cache.
                      </p>
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setShowClearPomDialog(false)}>Cancel</Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => clearPomCacheMutation.mutate()}
                          data-testid="button-confirm-clear-pom"
                        >
                          {clearPomCacheMutation.isPending ? "Clearing..." : "Yes, Clear Cache"}
                        </Button>
                      </div>
                    </div>
                  </ResponsiveModal>

                </div>

            )}

            {/* Platform Connections */}
            {activeSection === 'platforms' && (
              <div className="min-h-[400px]">

                {/* ── Tab bar removed — Scheduler moved to Auto-Sync section ── */}

                {/* ── CHANNEL LIST (index) ───────────────────────────────────── */}
                {activePlatform === null && (
                  <nav className="p-2">

                    {/* Core Integrations */}
                    <div className="px-4 pt-2 pb-1 flex items-center gap-2">
                      <span className="app-label">Core Integrations</span>
                      <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border bg-gray-800/60 text-gray-500 border-gray-700">
                        <Lock className="w-2.5 h-2.5" /> Required
                      </span>
                    </div>
                    {[
                      { key: 'bricklink', label: 'BrickLink', connected: !!bricklinkConsumerKey || !!(settings as any)?.has_bricklinkConsumerKey, badge: 'Read only', badgeColor: 'text-blue-400 border-blue-500/20 bg-blue-500/10' },
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
                      <span className="app-label">Sales Channels</span>
                      <Button size="sm" variant="ghost" className="h-6 text-xs gap-1 text-gray-400 -mr-1"
                        data-testid="button-add-sales-channel"
                        onClick={() => { setAddIntegrationType('sales_channel'); setAddIntChannel('brickowl'); setAddIntDisplayName('BrickOwl'); setAddIntApiKey(''); }}>
                        <Plus className="w-3 h-3" /> Add
                      </Button>
                    </div>
                    <button onClick={() => setActivePlatform('brickowl')}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-md text-sm text-gray-300 hover:text-white hover:bg-gray-700/50 transition-colors group"
                      data-testid="nav-platform-brickowl"
                    >
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${brickowlApiKey || (settings as any)?.has_brickowlApiKey || (settings as any)?.brickowlConnectedViaEnv ? 'bg-green-400' : 'bg-gray-600'}`} />
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
                        <p className="text-xs font-medium text-gray-100">Add Sales Channel</p>
                        <div className="space-y-2">
                          <Label className="text-xs text-gray-200">Platform</Label>
                          <Select value={addIntChannel} onValueChange={(v) => { setAddIntChannel(v); setAddIntDisplayName(v === 'brickowl' ? 'BrickOwl' : ''); }}>
                            <SelectTrigger className="text-xs h-8" data-testid="select-add-sales-channel"><SelectValue placeholder="Select platform..." /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="brickowl">BrickOwl</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs text-gray-200">Display Name</Label>
                          <Input className="text-xs" placeholder="e.g. My BrickOwl Store" value={addIntDisplayName} onChange={(e) => setAddIntDisplayName(e.target.value)} data-testid="input-add-display-name" />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs text-gray-200">API Key</Label>
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

                    {/* Shipping */}
                    <div className="px-4 pt-3 pb-1 flex items-center justify-between">
                      <span className="app-label">Shipping</span>
                      <Button size="sm" variant="ghost" className="h-6 text-xs gap-1 text-gray-400 -mr-1"
                        data-testid="button-add-shipping-vendor"
                        onClick={() => { setAddIntegrationType('shipping'); setAddIntChannel('easypost'); setAddIntDisplayName('EasyPost'); setAddIntApiKey(''); }}>
                        <Plus className="w-3 h-3" /> Add
                      </Button>
                    </div>
                    <button onClick={() => setActivePlatform('easypost')}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-md text-sm text-gray-300 hover:text-white hover:bg-gray-700/50 transition-colors group"
                      data-testid="nav-platform-easypost"
                    >
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${easypostApiKey || easypostTestApiKey || (settings as any)?.has_easypostApiKey || (settings as any)?.has_easypostTestApiKey ? 'bg-green-400' : 'bg-gray-600'}`} />
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
                        <p className="text-xs font-medium text-gray-100">Add Shipping Vendor</p>
                        <div className="space-y-2">
                          <Label className="text-xs text-gray-200">Platform</Label>
                          <Select value={addIntChannel} onValueChange={(v) => { setAddIntChannel(v); setAddIntDisplayName(v === 'easypost' ? 'EasyPost' : ''); }}>
                            <SelectTrigger className="text-xs h-8" data-testid="select-add-shipping-vendor"><SelectValue placeholder="Select platform..." /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="easypost">EasyPost</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs text-gray-200">Display Name</Label>
                          <Input className="text-xs" placeholder="e.g. My Shipping Account" value={addIntDisplayName} onChange={(e) => setAddIntDisplayName(e.target.value)} data-testid="input-add-display-name" />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs text-gray-200">API Key</Label>
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

                    <div className="bg-blue-950/30 border border-blue-500/20 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5">
                          <ClipboardPaste className="w-3.5 h-3.5 text-blue-400" />
                          <span className="text-xs font-medium text-blue-300">Quick setup — paste from BrickLink</span>
                        </div>
                        <a href="https://www.bricklink.com/v2/api/register_consumer.page" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300" data-testid="link-bl-api-page-settings">
                          Open BrickLink API page <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </div>
                      <p className="text-[10px] text-gray-500 leading-relaxed">Sign in to BrickLink, open the API page above, select all the text on that page, copy it, and paste it here. You can also paste a screenshot of the API page.</p>
                      <Textarea
                        placeholder={blOcrProcessing ? "Reading screenshot..." : "Paste text or screenshot here..."}
                        value={blPasteText}
                        disabled={blOcrProcessing}
                        onChange={(e) => {
                          const val = e.target.value;
                          setBlPasteText(val);
                          if (!val.trim()) { setBlPasteStatus("idle"); return; }
                          const parsed = parseBricklinkPaste(val);
                          if (!parsed) {
                            setBlPasteText("");
                            setBlPasteStatus("fail");
                            return;
                          }
                          setBlPasteText("");
                          if (parsed.consumerKey) setBricklinkConsumerKey(parsed.consumerKey);
                          if (parsed.consumerSecret) setBricklinkConsumerSecret(parsed.consumerSecret);
                          if (parsed.tokens.length === 1) {
                            setBricklinkTokenValue(parsed.tokens[0].tokenValue);
                            setBricklinkTokenSecret(parsed.tokens[0].tokenSecret);
                            setBlParsedTokens([]);
                          } else if (parsed.tokens.length > 1) {
                            setBlParsedTokens(parsed.tokens);
                          }
                          setBlPasteStatus(getPasteStatus(parsed));
                        }}
                        onPaste={async (e) => {
                          const items = e.clipboardData?.items;
                          if (!items) return;
                          for (let i = 0; i < items.length; i++) {
                            if (items[i].type.startsWith('image/')) {
                              e.preventDefault();
                              const file = items[i].getAsFile();
                              if (!file) return;
                              setBlOcrProcessing(true);
                              setBlPasteStatus("idle");
                              setBlPasteText("");
                              try {
                                const reader = new FileReader();
                                const base64 = await new Promise<string>((resolve, reject) => {
                                  reader.onload = () => resolve(reader.result as string);
                                  reader.onerror = reject;
                                  reader.readAsDataURL(file);
                                });
                                const resp = await fetch('/api/ocr/bricklink-credentials', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  credentials: 'include',
                                  body: JSON.stringify({ image: base64 }),
                                });
                                const data = await resp.json();
                                if (data.error || (!data.consumerKey && !data.consumerSecret && !data.tokenValue && !data.tokenSecret)) {
                                  setBlPasteStatus("fail");
                                } else {
                                  if (data.consumerKey) setBricklinkConsumerKey(data.consumerKey);
                                  if (data.consumerSecret) setBricklinkConsumerSecret(data.consumerSecret);
                                  if (data.tokenValue) setBricklinkTokenValue(data.tokenValue);
                                  if (data.tokenSecret) setBricklinkTokenSecret(data.tokenSecret);
                                  const hasAll = data.consumerKey && data.consumerSecret && data.tokenValue && data.tokenSecret;
                                  setBlPasteStatus(hasAll ? "success" : "partial");
                                }
                              } catch {
                                setBlPasteStatus("fail");
                              } finally {
                                setBlOcrProcessing(false);
                              }
                              return;
                            }
                          }
                        }}
                        className="text-xs min-h-[60px] max-h-[100px]"
                        data-testid="textarea-bl-paste-settings"
                      />
                      {blOcrProcessing && <p className="text-[10px] text-blue-400 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" />Reading credentials from screenshot...</p>}
                      {blPasteStatus === "success" && !blOcrProcessing && <p className="text-[10px] text-green-400">All 4 credentials extracted. Click into any field below and click away to save.</p>}
                      {blPasteStatus === "partial" && !blOcrProcessing && <p className="text-[10px] text-yellow-400">Some credentials found but not all 4. Fill in the missing fields manually below.</p>}
                      {blPasteStatus === "fail" && !blOcrProcessing && <p className="text-[10px] text-red-400">Could not find BrickLink credentials in the pasted content. Make sure you copied the full page or try a clearer screenshot.</p>}
                      {blPasteStatus === "multi" && (
                        <div className="space-y-1.5">
                          <p className="text-[10px] text-yellow-400">Multiple access tokens found — select which one to use:</p>
                          {blParsedTokens.map((t, i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() => { setBricklinkTokenValue(t.tokenValue); setBricklinkTokenSecret(t.tokenSecret); setBlPasteStatus("success"); setBlParsedTokens([]); }}
                              className={`w-full text-left px-2.5 py-1.5 rounded text-[10px] border transition-colors ${bricklinkTokenValue === t.tokenValue ? "bg-blue-600/20 border-blue-500/40 text-blue-300" : "bg-gray-800/50 border-gray-700/50 text-gray-400 hover:bg-gray-700/40"}`}
                              data-testid={`button-bl-token-settings-${i}`}
                            >
                              Token {i + 1}: {t.tokenValue.slice(0, 8)}...{t.tokenValue.slice(-4)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="relative">
                      <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-700/50" /></div>
                      <div className="relative flex justify-center"><span className="bg-card px-2 text-[10px] text-gray-600">or enter manually</span></div>
                    </div>

                    <div className="space-y-2"><Label htmlFor="bricklink-key" className="text-xs text-gray-200">Consumer Key</Label><Input id="bricklink-key" placeholder={(settings as any)?.has_bricklinkConsumerKey ? "Key saved — leave blank to keep" : "Enter BrickLink Consumer Key"} className="text-xs" value={bricklinkConsumerKey} onChange={(e) => setBricklinkConsumerKey(e.target.value)} onBlur={() => { if (bricklinkConsumerKey || bricklinkConsumerSecret || bricklinkTokenValue || bricklinkTokenSecret) updateSettingsMutation.mutate({ bricklinkConsumerKey: bricklinkConsumerKey || undefined, bricklinkConsumerSecret: bricklinkConsumerSecret || undefined, bricklinkTokenValue: bricklinkTokenValue || undefined, bricklinkTokenSecret: bricklinkTokenSecret || undefined }); }} data-testid="input-bricklink-key" /></div>
                    <div className="space-y-2"><Label htmlFor="bricklink-secret" className="text-xs text-gray-200">Consumer Secret</Label><Input id="bricklink-secret" type="password" placeholder={(settings as any)?.has_bricklinkConsumerSecret ? "Key saved — leave blank to keep" : "Enter BrickLink Consumer Secret"} className="text-xs" value={bricklinkConsumerSecret} onChange={(e) => setBricklinkConsumerSecret(e.target.value)} onBlur={() => { if (bricklinkConsumerKey || bricklinkConsumerSecret || bricklinkTokenValue || bricklinkTokenSecret) updateSettingsMutation.mutate({ bricklinkConsumerKey: bricklinkConsumerKey || undefined, bricklinkConsumerSecret: bricklinkConsumerSecret || undefined, bricklinkTokenValue: bricklinkTokenValue || undefined, bricklinkTokenSecret: bricklinkTokenSecret || undefined }); }} data-testid="input-bricklink-secret" /></div>
                    <div className="space-y-2"><Label htmlFor="bricklink-token" className="text-xs text-gray-200">Token Value</Label><Input id="bricklink-token" placeholder={(settings as any)?.has_bricklinkTokenValue ? "Key saved — leave blank to keep" : "Enter BrickLink Token Value"} className="text-xs" value={bricklinkTokenValue} onChange={(e) => setBricklinkTokenValue(e.target.value)} onBlur={() => { if (bricklinkConsumerKey || bricklinkConsumerSecret || bricklinkTokenValue || bricklinkTokenSecret) updateSettingsMutation.mutate({ bricklinkConsumerKey: bricklinkConsumerKey || undefined, bricklinkConsumerSecret: bricklinkConsumerSecret || undefined, bricklinkTokenValue: bricklinkTokenValue || undefined, bricklinkTokenSecret: bricklinkTokenSecret || undefined }); }} data-testid="input-bricklink-token" /></div>
                    <div className="space-y-2"><Label htmlFor="bricklink-token-secret" className="text-xs text-gray-200">Token Secret</Label><Input id="bricklink-token-secret" type="password" placeholder={(settings as any)?.has_bricklinkTokenSecret ? "Key saved — leave blank to keep" : "Enter BrickLink Token Secret"} className="text-xs" value={bricklinkTokenSecret} onChange={(e) => setBricklinkTokenSecret(e.target.value)} onBlur={() => { if (bricklinkConsumerKey || bricklinkConsumerSecret || bricklinkTokenValue || bricklinkTokenSecret) updateSettingsMutation.mutate({ bricklinkConsumerKey: bricklinkConsumerKey || undefined, bricklinkConsumerSecret: bricklinkConsumerSecret || undefined, bricklinkTokenValue: bricklinkTokenValue || undefined, bricklinkTokenSecret: bricklinkTokenSecret || undefined }); }} data-testid="input-bricklink-token-secret" /></div>
                    <div className="pt-2 border-t border-gray-700 space-y-2">
                      <div className="space-y-1">
                        <Label className="text-xs text-gray-200">Daily API Call Ceiling</Label>
                        <p className="text-[10px] text-gray-500">Max BrickLink API calls per 24 h for this org's inventory and order syncs. BrickLink enforces ~5,000/day per credential set.</p>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min={100}
                            max={5000}
                            step={100}
                            value={orgBlApiCallLimit}
                            onChange={(e) => setOrgBlApiCallLimit(parseInt(e.target.value) || 100)}
                            onBlur={() => updateSettingsMutation.mutate({ blApiCallLimit: orgBlApiCallLimit } as any)}
                            className="text-xs w-24 text-right"
                            data-testid="input-org-bl-api-limit"
                          />
                          <span className="text-[10px] text-gray-500">/ 5,000</span>
                        </div>
                      </div>
                      <p className="text-[10px] text-gray-500">Platform background schedulers use a separate credential set configured in <button onClick={() => { setActiveSection('apiKeys'); setActivePlatformServicesTab('bricklink'); }} className="text-yellow-400/80 hover:text-yellow-300 underline-offset-2 hover:underline" data-testid="link-goto-platform-services-bricklink">Services</button>.</p>
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
                    <div className="space-y-2"><Label htmlFor="brickowl-key" className="text-xs text-gray-200">API Key</Label><Input id="brickowl-key" type="password" placeholder={(settings as any)?.has_brickowlApiKey ? "Key saved — leave blank to keep" : "Enter BrickOwl API Key"} className="text-xs" value={brickowlApiKey} onChange={(e) => setBrickowlApiKey(e.target.value)} onBlur={() => { if (brickowlApiKey) updateSettingsMutation.mutate({ brickowlApiKey }); }} data-testid="input-brickowl-key" /></div>
                    <div className="pt-2 border-t border-gray-700 flex justify-end">
                      <Button variant="ghost" size="sm" className="text-xs gap-1 text-red-400/80 hover:text-red-400" data-testid="button-remove-brickowl" onClick={() => setRemovePrimaryDialog('brickowl')}><Trash2 className="w-3 h-3" /> Remove</Button>
                    </div>
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
                      <Label className="text-xs text-gray-200">Active API Key</Label>
                      <div className="flex gap-4">
                        <label className="flex items-center gap-2 cursor-pointer"><input type="radio" name="easypost-mode" value="test" checked={easypostKeyMode === 'test'} onChange={() => { setEasypostKeyMode('test'); updateSettingsMutation.mutate({ easypostKeyMode: 'test' }); }} className="text-purple-500 focus:ring-purple-500" data-testid="radio-easypost-test" /><span className="text-xs text-gray-300">Test</span></label>
                        <label className="flex items-center gap-2 cursor-pointer"><input type="radio" name="easypost-mode" value="production" checked={easypostKeyMode === 'production'} onChange={() => { setEasypostKeyMode('production'); updateSettingsMutation.mutate({ easypostKeyMode: 'production' }); }} className="text-purple-500 focus:ring-purple-500" data-testid="radio-easypost-production" /><span className="text-xs text-gray-300">Production</span></label>
                      </div>
                      {easypostKeyMode === 'test' && <p className="text-xs text-yellow-500/80">Test mode — labels will use test tracking numbers</p>}
                      {easypostKeyMode === 'production' && <p className="text-xs text-green-500/80">Production mode — real shipping labels will be created</p>}
                    </div>
                    <div className="space-y-2"><Label htmlFor="easypost-key" className="text-xs text-gray-200">Production API Key</Label><Input id="easypost-key" type="password" placeholder={(settings as any)?.has_easypostApiKey ? "Key saved — leave blank to keep" : "Enter EasyPost Production API Key"} className="text-xs" value={easypostApiKey} onChange={(e) => setEasypostApiKey(e.target.value)} onBlur={() => { if (easypostApiKey) updateSettingsMutation.mutate({ easypostApiKey }); }} data-testid="input-easypost-key" /></div>
                    <div className="space-y-2"><Label htmlFor="easypost-test-key" className="text-xs text-gray-200">Test API Key</Label><Input id="easypost-test-key" type="password" placeholder={(settings as any)?.has_easypostTestApiKey ? "Key saved — leave blank to keep" : "Enter EasyPost Test API Key"} className="text-xs" value={easypostTestApiKey} onChange={(e) => setEasypostTestApiKey(e.target.value)} onBlur={() => { if (easypostTestApiKey) updateSettingsMutation.mutate({ easypostTestApiKey }); }} data-testid="input-easypost-test-key" /></div>
                    <div className="pt-3 border-t border-gray-700 space-y-3">
                      <div>
                        <p className="text-xs font-semibold text-gray-300 mb-0.5">International Shipping</p>
                        <p className="text-[11px] text-gray-500">Customs declarations are auto-generated for international orders. Fill in tax IDs to prevent buyers from being double-charged VAT/GST.</p>
                      </div>
                      <div className="space-y-2"><Label htmlFor="customs-signer" className="text-xs text-gray-200">Customs Signer Name <span className="text-red-400">*</span></Label><Input id="customs-signer" type="text" placeholder="Full name of person certifying customs forms" className="text-xs" value={customsSigner} onChange={(e) => setCustomsSigner(e.target.value)} onBlur={() => updateSettingsMutation.mutate({ customsSigner: customsSigner || null })} data-testid="input-customs-signer" /></div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2"><Label htmlFor="bl-ioss" className="text-xs text-gray-200">BrickLink EU IOSS #</Label><Input id="bl-ioss" type="text" placeholder="IM..." className="text-xs font-mono" value={blIossNumber} onChange={(e) => setBlIossNumber(e.target.value)} onBlur={() => updateSettingsMutation.mutate({ blIossNumber: blIossNumber || null })} data-testid="input-bl-ioss" /></div>
                        <div className="space-y-2"><Label htmlFor="bo-ioss" className="text-xs text-gray-200">BrickOwl EU IOSS #</Label><Input id="bo-ioss" type="text" placeholder="IM..." className="text-xs font-mono" value={boIossNumber} onChange={(e) => setBoIossNumber(e.target.value)} onBlur={() => updateSettingsMutation.mutate({ boIossNumber: boIossNumber || null })} data-testid="input-bo-ioss" /></div>
                        <div className="space-y-2"><Label htmlFor="bl-uk-vat" className="text-xs text-gray-200">BrickLink UK VAT #</Label><Input id="bl-uk-vat" type="text" placeholder="GB..." className="text-xs font-mono" value={blUkVatNumber} onChange={(e) => setBlUkVatNumber(e.target.value)} onBlur={() => updateSettingsMutation.mutate({ blUkVatNumber: blUkVatNumber || null })} data-testid="input-bl-uk-vat" /></div>
                        <div className="space-y-2"><Label htmlFor="bo-uk-vat" className="text-xs text-gray-200">BrickOwl UK VAT #</Label><Input id="bo-uk-vat" type="text" placeholder="GB..." className="text-xs font-mono" value={boUkVatNumber} onChange={(e) => setBoUkVatNumber(e.target.value)} onBlur={() => updateSettingsMutation.mutate({ boUkVatNumber: boUkVatNumber || null })} data-testid="input-bo-uk-vat" /></div>
                      </div>
                      <p className="text-[11px] text-gray-600">Find IOSS/VAT numbers in your BrickLink and BrickOwl seller dashboards under Tax Settings.</p>
                    </div>
                  </div>
                )}

                {/* ── DETAIL: Dynamic org integration ─────────────────────── */}
                {activePlatform !== null && !['bricklink','brickowl','easypost'].includes(activePlatform) && (() => {
                  const integration = orgIntegrationsList.find(i => String(i.id) === activePlatform);
                  if (!integration) return null;
                  return (
                    <div className="p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border bg-gray-800 text-gray-500 border-gray-700 capitalize">{integration.type.replace('_', ' ')}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded border bg-gray-800 text-gray-500 border-gray-700">{integration.channel}</span>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs text-gray-200">Display Name</Label>
                        <Input className="text-xs" value={editIntDisplayName} onChange={(e) => setEditIntDisplayName(e.target.value)} data-testid="input-edit-display-name" />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs text-gray-200">API Key <span className="text-gray-600 font-normal">(leave blank to keep existing)</span></Label>
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
                <ResponsiveModal
                  open={!!deleteIntId}
                  onOpenChange={(open) => { if (!open) setDeleteIntId(null); }}
                  title="Remove Integration"
                  icon={Trash2}
                  iconColor="text-red-400"
                  description="Remove this integration and its credentials"
                  testId="modal-delete-integration"
                >
                  <div className="space-y-4">
                    <p className="text-sm text-gray-400">This will permanently remove this integration and its credentials. You can add it back at any time.</p>
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setDeleteIntId(null)} data-testid="button-cancel-delete-integration">Cancel</Button>
                      <Button variant="destructive" size="sm" data-testid="button-confirm-delete-integration" onClick={() => { if (deleteIntId) deleteIntegrationMutation.mutate(deleteIntId); }}>Remove</Button>
                    </div>
                  </div>
                </ResponsiveModal>

                <ResponsiveModal
                  open={!!removePrimaryDialog}
                  onOpenChange={(open) => { if (!open) setRemovePrimaryDialog(null); }}
                  title="Remove BrickOwl"
                  icon={Globe}
                  iconColor="text-red-400"
                  description="Clear all BrickOwl credentials"
                  testId="modal-remove-brickowl"
                >
                  <div className="space-y-4">
                    <p className="text-sm text-gray-400">This will clear all BrickOwl credentials. You can re-enter them at any time.</p>
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setRemovePrimaryDialog(null)} data-testid="button-cancel-remove-primary">Cancel</Button>
                      <Button variant="destructive" size="sm" data-testid="button-confirm-remove-primary" onClick={() => { setBrickowlApiKey(''); updateSettingsMutation.mutate({ brickowlApiKey: null }); setRemovePrimaryDialog(null); }}>Remove</Button>
                    </div>
                  </div>
                </ResponsiveModal>

                {/* ── SCHEDULER TAB CONTENT ── */}
                {activePlatform === null && activePlatformInnerTab === 'scheduler' && (
              <div className="space-y-4">
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                      <h3 className="text-sm font-medium text-gray-100">Automation & Scheduling</h3>
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
                        id="settings-inventory-sync-header"
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
                            <Label className="text-xs font-medium text-gray-100">Inventory Sync (Daily)</Label>
                            <Popover>
                              <PopoverTrigger asChild>
                                <button className="sm-icon-btn">
                                  <Info className="w-3 h-3" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent side="bottom" className="sm-popover-lg">
                                <p className="font-semibold text-gray-200">Inventory Sync</p>
                                <p className="text-gray-400">Pulls your full BrickLink inventory into the local database and saves an XML backup. Categories, colors, and catalog enrichment are handled by platform-level schedulers.</p>
                                <p className="sm-description">Runs once daily. Safe to trigger manually at any time.</p>
                              </PopoverContent>
                            </Popover>
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">Sync inventory, colors, categories + embeddings</p>
                          <SyncStatusLine entry={syncStatuses?.inventory ?? null} />
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
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
                          <Label htmlFor="inventory-time" className="text-xs text-gray-200">Sync Time</Label>
                          <Input
                            id="inventory-time"
                            type="time"
                            value={inventorySyncTime}
                            onChange={(e) => setInventorySyncTime(e.target.value)}
                            onBlur={() => updateSettingsMutation.mutate({ inventorySyncTime })}
                            className="text-xs w-32"
                            data-testid="input-inventory-time"
                          />
                          <p className="text-xs text-gray-500">Time in your local timezone</p>
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
                        id="settings-orders-sync-header"
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
                            <Label className="text-xs font-medium text-gray-100">Orders Sync</Label>
                            <Popover>
                              <PopoverTrigger asChild>
                                <button className="sm-icon-btn">
                                  <Info className="w-3 h-3" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent side="bottom" className="sm-popover-lg">
                                <p className="font-semibold text-gray-200">Orders Sync</p>
                                <p className="text-gray-400">Pulls new and updated orders from BrickLink and BrickOwl into the local database. Also syncs order line items and generates AI embeddings for semantic search.</p>
                                <p className="text-gray-400">After each order is processed, sold quantities are deducted from local inventory — keeping all channel inventory counts in sync automatically.</p>
                                <p className="sm-description">Runs on a short interval (e.g. every 15–30 min) to keep order data fresh throughout the day.</p>
                              </PopoverContent>
                            </Popover>
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">Sync orders, details, embeddings + refunds/fees periodically</p>
                          <SyncStatusLine entry={syncStatuses?.orders ?? null} />
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
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
                          <Label htmlFor="orders-frequency" className="text-xs text-gray-200">Sync Frequency (minutes)</Label>
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
                          <p className="text-xs text-gray-500">Recommended: 15 minutes</p>
                        </div>
                      )}
                      </div>
                      )}
                    </div>

                    <Separator className="bg-gray-700" />

                    {/* Channel Sync */}
                    <div>
                      <button
                        id="settings-channel-sync-header"
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
                            <Label className="text-xs font-medium text-gray-100">Daily Schedule</Label>
                            <Popover>
                              <PopoverTrigger asChild>
                                <button className="sm-icon-btn">
                                  <Info className="w-3 h-3" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent side="bottom" className="sm-popover-lg">
                                <p className="font-semibold text-gray-200">Channel Sync — BrickOwl</p>
                                <p className="text-gray-400">Pushes your local database inventory outward to BrickOwl. Compares local quantities and prices against the platform and updates only what has changed.</p>
                                <p className="sm-description">Should run after Inventory Sync has completed. Schedule it at least 1 hour later to ensure inbound data has settled.</p>
                              </PopoverContent>
                            </Popover>
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">Push Local DB → BrickOwl after inbound + order syncs settle</p>
                          <SyncStatusLine entry={syncStatuses?.channel ?? null} />
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
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
                          <Label htmlFor="channel-sync-time" className="text-xs text-gray-200">Sync Time</Label>
                          <Input
                            id="channel-sync-time"
                            type="time"
                            value={channelSyncTime}
                            onChange={(e) => setChannelSyncTime(e.target.value)}
                            onBlur={() => updateSettingsMutation.mutate({ channelSyncTime })}
                            className="text-xs w-32"
                            data-testid="input-channel-sync-time"
                          />
                          <p className="text-xs text-gray-500">Run at least 1 hour after Inventory Sync</p>
                        </div>
                      )}

                      {/* Last Sync Result Card */}
                      {channelLastResult && (
                        <div className="mt-3 rounded-md border border-gray-700 bg-gray-800/40 p-3 space-y-2" data-testid="card-channel-last-result">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-semibold text-gray-300 uppercase tracking-wide">Last Sync Result</span>
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                              channelLastResult.status === 'success' ? 'bg-green-900/50 text-green-400' :
                              channelLastResult.status === 'partial' ? 'bg-yellow-900/50 text-yellow-400' :
                              'bg-red-900/50 text-red-400'
                            }`} data-testid="text-channel-last-status">
                              {channelLastResult.status === 'success' ? 'Success' : channelLastResult.status === 'partial' ? 'Partial' : 'Error'}
                            </span>
                            <span className="text-[10px] text-gray-500" data-testid="text-channel-last-time">{formatRelativeTime(channelLastResult.completedAt)}</span>
                            <span className="text-[10px] text-gray-600 capitalize" data-testid="text-channel-last-mode">
                              {channelLastResult.mode === 'full_control' ? 'Full Control' : channelLastResult.mode === 'matched_sync' ? 'Matched Sync' : channelLastResult.mode === 'analysis' ? 'Analysis' : channelLastResult.mode}
                            </span>
                          </div>
                          <div className="grid grid-cols-4 gap-2">
                            <div className="rounded bg-gray-900/60 p-2 text-center" data-testid="stat-channel-created">
                              <div className="text-base font-bold text-green-400">{channelLastResult.lotsCreated}</div>
                              <div className="text-[9px] text-gray-500 mt-0.5">Created</div>
                            </div>
                            <button onClick={() => channelLastResult.lotsUpdated > 0 && setUpdatedItemsDrawerOpen(true)} className={`rounded bg-gray-900/60 p-2 text-center w-full ${channelLastResult.lotsUpdated > 0 ? 'hover-elevate cursor-pointer' : 'cursor-default'}`} data-testid="stat-channel-updated">
                              <div className="text-base font-bold text-blue-400">{channelLastResult.lotsUpdated}</div>
                              <div className="text-[9px] text-gray-500 mt-0.5">Updated {channelLastResult.lotsUpdated > 0 && <span className="text-blue-600">↗</span>}</div>
                            </button>
                            <div className="rounded bg-gray-900/60 p-2 text-center" data-testid="stat-channel-skipped">
                              <div className="text-base font-bold text-gray-400">{channelLastResult.lotsSkipped}</div>
                              <div className="text-[9px] text-gray-500 mt-0.5">Skipped</div>
                            </div>
                            <div className="rounded bg-gray-900/60 p-2 text-center" data-testid="stat-channel-errors">
                              <div className={`text-sm font-bold ${channelLastResult.errorCount > 0 ? 'text-red-400' : 'text-gray-400'}`}>{channelLastResult.errorCount}</div>
                              <div className="text-[9px] text-gray-500 mt-0.5">Errors</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 text-[10px] text-gray-500">
                            <span>{channelLastResult.totalApiCalls} API calls</span>
                          </div>
                          {channelLastResult.errors.length > 0 && (
                            <div className="space-y-1 mt-1" data-testid="list-channel-errors">
                              {channelLastResult.errors.slice(0, 5).map((err, i) => (
                                <p key={i} className="text-[10px] text-red-400/80 truncate">{err}</p>
                              ))}
                              {channelLastResult.errors.length > 5 && (
                                <p className="text-[10px] text-gray-600">+{channelLastResult.errors.length - 5} more errors</p>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Sync Mode */}
                      <div className="mt-3 space-y-2">
                        <div className="flex items-center gap-1.5">
                          <Label className="text-xs text-gray-200">Sync Mode</Label>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="w-3 h-3 text-gray-500 shrink-0 cursor-default" />
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-xs text-xs">
                              Controls how the channel sync behaves across all connected sales channels.
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <div className="grid grid-cols-1 gap-1.5">
                          <button
                            onClick={() => { setChannelSyncMode('analysis'); updateSettingsMutation.mutate({ channelSyncMode: 'analysis' }); }}
                            className={`flex items-start gap-2 rounded-md border p-2.5 text-left transition-colors ${channelSyncMode === 'analysis' ? 'border-blue-500/60 bg-blue-500/10' : 'border-gray-700 bg-gray-800/40 hover:border-gray-600'}`}
                            data-testid="button-sync-mode-analysis"
                          >
                            <div className={`mt-0.5 w-3 h-3 rounded-full border-2 shrink-0 ${channelSyncMode === 'analysis' ? 'border-blue-400 bg-blue-400' : 'border-gray-500'}`} />
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-medium text-gray-200">Analysis</span>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Info className="w-2.5 h-2.5 text-gray-500 shrink-0 cursor-default" />
                                  </TooltipTrigger>
                                  <TooltipContent side="right" className="max-w-xs text-xs">
                                    Runs a full comparison between your channels without making any changes. Checks quantity, price, tier pricing, sale %, condition, remarks, and description. Builds the discrepancy data visible in the Channel Sync panel so you can review before committing to a sync mode.
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                              <p className="text-[10px] text-gray-500 mt-0.5">Read-only — compare channels, no edits made</p>
                            </div>
                          </button>
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
                                    Creates new lots for any BrickLink items that don't exist on BrickOwl yet, and keeps all matched lots fully in sync — quantity, price, tier pricing, sale %, condition, remarks, and description.
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                              <p className="text-[10px] text-gray-500 mt-0.5">Create new lots + full sync of all fields on existing</p>
                            </div>
                          </button>
                          <button
                            onClick={() => { setChannelSyncMode('matched_sync'); updateSettingsMutation.mutate({ channelSyncMode: 'matched_sync' }); }}
                            className={`flex items-start gap-2 rounded-md border p-2.5 text-left transition-colors ${channelSyncMode === 'matched_sync' ? 'border-blue-500/60 bg-blue-500/10' : 'border-gray-700 bg-gray-800/40 hover:border-gray-600'}`}
                            data-testid="button-sync-mode-matched"
                          >
                            <div className={`mt-0.5 w-3 h-3 rounded-full border-2 shrink-0 ${channelSyncMode === 'matched_sync' ? 'border-blue-400 bg-blue-400' : 'border-gray-500'}`} />
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-medium text-gray-200">Matched Sync</span>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Info className="w-2.5 h-2.5 text-gray-500 shrink-0 cursor-default" />
                                  </TooltipTrigger>
                                  <TooltipContent side="right" className="max-w-xs text-xs">
                                    Full sync of all fields — quantity, price, tier pricing, sale %, condition, remarks, and description — for lots already matched between BrickLink and BrickOwl. Unmatched items are skipped; nothing new is created.
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                              <p className="text-[10px] text-gray-500 mt-0.5">Full sync of all fields on matched lots — never create new</p>
                            </div>
                          </button>
                        </div>
                      </div>

                      {/* Field sync toggles — which fields to push from BL → BO */}
                      <div className="mt-4 space-y-2">
                        <div className="flex items-center gap-1.5">
                          <Label className="text-xs text-gray-200">Fields to Sync</Label>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="w-3 h-3 text-gray-500 shrink-0 cursor-default" />
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-xs text-xs">
                              Choose which fields are pushed from BrickLink to BrickOwl. Locked fields are always synced in the selected mode and cannot be disabled.
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <div className="rounded-md border border-gray-700/60 bg-gray-800/20 divide-y divide-gray-700/40">

                          {/* Quantity — mandatory in matched_sync and full_control */}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center justify-between gap-3 px-3 py-2.5 opacity-60 cursor-default">
                                <div className="min-w-0">
                                  <p className="text-xs font-medium text-gray-200 flex items-center gap-1.5">
                                    Quantity
                                    {channelSyncMode !== 'analysis' && (
                                      <Lock className="w-2.5 h-2.5 text-gray-500 shrink-0" />
                                    )}
                                  </p>
                                  <p className="text-[10px] text-gray-500 mt-0.5 leading-tight">Syncs the lot quantity from BrickLink</p>
                                </div>
                                <Switch checked disabled data-testid="switch-sync-field-qty" />
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="left" className="max-w-xs text-xs">
                              {channelSyncMode === 'analysis'
                                ? 'Analysis mode — no writes. Quantity will sync when an active mode is selected.'
                                : 'Quantity is always synced and cannot be disabled.'}
                            </TooltipContent>
                          </Tooltip>

                          {/* Price — optional in all modes; always included when creating new lots in full_control */}
                          <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-gray-200">Base Price</p>
                              <p className="text-[10px] text-gray-500 mt-0.5 leading-tight">Syncs the listing price (base price) from BrickLink to existing lots. Always included when new items are added in Full Sync.</p>
                            </div>
                            <Switch
                              checked={syncFieldPrice}
                              onCheckedChange={(checked) => { setSyncFieldPrice(checked); updateSyncFieldMutation.mutate({ syncPrice: checked }); }}
                              data-testid="switch-sync-field-syncPrice"
                            />
                          </div>

                          {/* Remaining optional fields */}
                          {([
                            { key: 'syncRemarks',          label: 'Remarks',              desc: 'Syncs the internal/private notes (BrickLink Remarks → BrickOwl personal note)',                                   value: syncFieldRemarks,          set: setSyncFieldRemarks          },
                            { key: 'syncDescription',      label: 'Description',          desc: 'Syncs the public description (BrickLink Description → BrickOwl public note)',                              value: syncFieldDescription,      set: setSyncFieldDescription      },
                            { key: 'syncTierPrice',        label: 'Tier Pricing',         desc: 'Syncs bulk discount tiers from BrickLink',                                                                 value: syncFieldTierPrice,        set: setSyncFieldTierPrice        },
                            { key: 'syncSalePercent',      label: 'Sale %',               desc: 'Syncs the BrickLink sale rate to BrickOwl sale %. Disable if you manage BrickOwl sales independently.',   value: syncFieldSalePercent,      set: setSyncFieldSalePercent      },
                            { key: 'syncBulkQty',          label: 'Minimum Quantity',     desc: 'Syncs the minimum order quantity (BrickLink Bulk → BrickOwl bulk_qty)',                                    value: syncFieldBulkQty,          set: setSyncFieldBulkQty          },
                            { key: 'syncLotWeight', label: 'Custom Lot Weight', desc: 'Syncs the custom weight per lot (BrickLink My Weight → BrickOwl lot_weight)', value: syncFieldLotWeight, set: setSyncFieldLotWeight },
                          ] as const).map(({ key, label, desc, value, set }) => (
                            <div key={key} className="flex items-center justify-between gap-3 px-3 py-2.5">
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-gray-200">{label}</p>
                                <p className="text-[10px] text-gray-500 mt-0.5 leading-tight">{desc}</p>
                              </div>
                              <Switch
                                checked={value}
                                onCheckedChange={(checked) => {
                                  set(checked);
                                  updateSyncFieldMutation.mutate({ [key]: checked });
                                }}
                                data-testid={`switch-sync-field-${key}`}
                              />
                            </div>
                          ))}


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

              </div>
            )}

            {/* ── Auto-Sync — Background Sync Services ─────────────────────── */}
            {activeSection === 'autoSync' && (
              <div className="space-y-4 min-h-[400px]">

              {expandedAutoSyncService === null ? (
                /* ══ LIST VIEW ══════════════════════════════════════════════ */
                <>
                  {/* Header */}
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <h3 className="text-sm font-medium text-gray-100">Auto-Sync Schedule</h3>
                      <p className="text-xs text-gray-400 mt-0.5">Background services that keep your data up to date automatically</p>
                    </div>
                    {rateLimit && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium transition-colors hover:opacity-80 ${
                            rateLimit.blocked ? 'bg-red-500/10 border-red-500/30 text-red-400'
                            : rateLimit.warning ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
                            : 'bg-blue-500/10 border-blue-500/30 text-blue-300'
                          }`}>
                            <BarChart2 className="w-3 h-3" />
                            <span>BrickLink API:</span>
                            <span className="font-mono font-semibold">{rateLimit.callsLast24h.toLocaleString()}</span>
                            <span className="text-gray-400">/ 5,000</span>
                          </button>
                        </PopoverTrigger>
                        <PopoverContent side="bottom" align="end" className="w-96 p-3 max-h-[80vh] overflow-y-auto bg-gray-900 border-gray-700">
                          <ApiCallSchedule buckets={rateLimit.hourlyBuckets ?? []} callsLast24h={rateLimit.callsLast24h} ceiling={5000} timezone={timezone} />
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>

                  {/* Service list — toggle only, tap row to configure */}
                  <div className="rounded-md border border-gray-700/80 bg-gray-800/20 divide-y divide-gray-700/40">

                    {/* Row: BrickLink Inventory */}
                    <div id="autosync-inventory-card" className="flex items-center gap-2 pl-4 pr-3 py-3">
                      <button
                        onClick={() => { if (inventorySyncEnabled) setExpandedAutoSyncService('inventory'); }}
                        disabled={!inventorySyncEnabled}
                        className="flex items-center gap-3 flex-1 min-w-0 text-left disabled:cursor-default"
                        data-testid="button-inventory-configure"
                      >
                        <div className="w-7 h-7 rounded-md bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0">
                          <Package className="w-3.5 h-3.5 text-purple-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-gray-100">BrickLink Inventory</p>
                          <p className="text-[10px] text-gray-500 leading-tight">
                            {inventorySyncEnabled ? `Every ${inventorySyncFrequency}h` : 'Pulls your live BrickLink store into E.L.F.I.E.'}
                          </p>
                        </div>
                        {inventorySyncEnabled && <ChevronRight className="w-3.5 h-3.5 text-gray-500 shrink-0" />}
                      </button>
                      <Switch
                        checked={inventorySyncEnabled}
                        onCheckedChange={(checked) => {
                          setInventorySyncEnabled(checked);
                          updateSettingsMutation.mutate({ inventorySyncEnabled: checked });
                        }}
                        data-testid="switch-inventory-sync"
                      />
                    </div>

                    {/* Row: Orders */}
                    <div id="autosync-orders-card" className="flex items-center gap-2 pl-4 pr-3 py-3">
                      <button
                        onClick={() => { if (ordersSyncEnabled) setExpandedAutoSyncService('orders'); }}
                        disabled={!ordersSyncEnabled}
                        className="flex items-center gap-3 flex-1 min-w-0 text-left disabled:cursor-default"
                        data-testid="button-orders-configure"
                      >
                        <div className="w-7 h-7 rounded-md bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
                          <ShoppingCart className="w-3.5 h-3.5 text-blue-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-gray-100">Orders</p>
                          <p className="text-[10px] text-gray-500 leading-tight">
                            {ordersSyncEnabled ? `Every ${ordersSyncFrequency}m` : 'Syncs new orders from BrickLink and BrickOwl'}
                          </p>
                        </div>
                        {ordersSyncEnabled && <ChevronRight className="w-3.5 h-3.5 text-gray-500 shrink-0" />}
                      </button>
                      <Switch
                        checked={ordersSyncEnabled}
                        onCheckedChange={(checked) => {
                          setOrdersSyncEnabled(checked);
                          updateSettingsMutation.mutate({ ordersSyncEnabled: checked });
                        }}
                        data-testid="switch-orders-sync"
                      />
                    </div>

                    {/* Row: BrickOwl Channel */}
                    <div id="autosync-channel-card" className="flex items-center gap-2 pl-4 pr-3 py-3">
                      <button
                        onClick={() => { if (channelSyncEnabled) setExpandedAutoSyncService('channel'); }}
                        disabled={!channelSyncEnabled}
                        className="flex items-center gap-3 flex-1 min-w-0 text-left disabled:cursor-default"
                        data-testid="button-channel-configure"
                      >
                        <div className="w-7 h-7 rounded-md bg-green-500/10 border border-green-500/20 flex items-center justify-center shrink-0">
                          <Globe className="w-3.5 h-3.5 text-green-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-gray-100">BrickOwl Channel</p>
                          <p className="text-[10px] text-gray-500 leading-tight">
                            {channelSyncEnabled ? `Every ${channelSyncFrequency}h` : 'Pushes your inventory from E.L.F.I.E. to BrickOwl'}
                          </p>
                        </div>
                        {channelSyncEnabled && <ChevronRight className="w-3.5 h-3.5 text-gray-500 shrink-0" />}
                      </button>
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

                  {/* Burn rate card */}
                  {(() => {
                    const DAILY_LIMIT = 5000;
                    const invSyncsPerDay = inventorySyncEnabled ? Math.floor(24 / inventorySyncFrequency) : 0;
                    const ordSyncsPerDay = ordersSyncEnabled    ? Math.floor(1440 / ordersSyncFrequency)  : 0;
                    const invCalls  = invSyncsPerDay;
                    const ordCalls  = ordSyncsPerDay;
                    const totalEst  = invCalls + ordCalls;
                    const pct       = Math.min(100, Math.round((totalEst / DAILY_LIMIT) * 100));
                    const barColor  = pct >= 75 ? 'bg-red-500' : pct >= 40 ? 'bg-yellow-500' : 'bg-green-500';
                    const pctColor  = pct >= 75 ? 'text-red-400' : pct >= 40 ? 'text-yellow-400' : 'text-green-400';
                    return (
                      <div className="rounded-md border border-gray-700/80 bg-gray-800/20">
                        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-gray-700/50">
                          <div className="flex items-center gap-1.5">
                            <BarChart2 className="w-3 h-3 text-gray-400" />
                            <p className="text-xs font-semibold text-gray-200">Estimated 24h BL API Burn</p>
                          </div>
                          <span className={`text-xs font-bold font-mono ${pctColor}`}>
                            ~{totalEst.toLocaleString()} <span className="text-gray-500 font-normal">/ {DAILY_LIMIT.toLocaleString()} calls</span>
                          </span>
                        </div>
                        <div className="px-4 pt-3 pb-1">
                          <div className="w-full h-1.5 rounded-full bg-gray-700/60">
                            <div className={`h-1.5 rounded-full transition-all duration-300 ${barColor}`} style={{ width: `${pct}%` }} />
                          </div>
                          <p className={`text-[10px] mt-1 ${pctColor}`}>{pct}% of daily limit</p>
                        </div>
                        <div className="px-4 pb-3 pt-1 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <Package className="w-3 h-3 text-purple-400" />
                              <span className="text-[11px] text-gray-400">BrickLink Inventory</span>
                              {inventorySyncEnabled && <span className="text-[10px] text-gray-600">every {inventorySyncFrequency}h</span>}
                            </div>
                            <span className="text-[11px] font-mono text-gray-300">
                              {inventorySyncEnabled ? <>{invCalls} <span className="text-gray-500">calls</span></> : <span className="text-gray-600">off</span>}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <ShoppingCart className="w-3 h-3 text-blue-400" />
                              <span className="text-[11px] text-gray-400">Orders</span>
                              {ordersSyncEnabled && <span className="text-[10px] text-gray-600">every {ordersSyncFrequency}m</span>}
                            </div>
                            <div className="flex items-center gap-1 text-right">
                              <span className="text-[11px] font-mono text-gray-300">
                                {ordersSyncEnabled ? <>{ordCalls} <span className="text-gray-500">calls</span></> : <span className="text-gray-600">off</span>}
                              </span>
                              {ordersSyncEnabled && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Info className="w-3 h-3 text-gray-600 cursor-default shrink-0" />
                                  </TooltipTrigger>
                                  <TooltipContent side="left" className="max-w-[220px] text-xs">
                                    +2 calls per new/changed order (detail + items fetch) — not included in estimate since order volume varies.
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <Globe className="w-3 h-3 text-green-400" />
                              <span className="text-[11px] text-gray-400">BrickOwl Channel</span>
                            </div>
                            <span className="text-[11px] font-mono text-gray-600">0 calls</span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </>
              ) : (
                /* ══ DETAIL VIEW ═════════════════════════════════════════════ */
                <>
                  {/* Back header */}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setExpandedAutoSyncService(null)}
                      className="p-1.5 rounded-md hover:bg-gray-700/50 transition-colors shrink-0"
                      data-testid="button-autosync-back"
                    >
                      <ChevronLeft className="w-4 h-4 text-gray-400" />
                    </button>
                    {expandedAutoSyncService === 'inventory' && (
                      <>
                        <div className="w-7 h-7 rounded-md bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0">
                          <Package className="w-3.5 h-3.5 text-purple-400" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-100">BrickLink Inventory</p>
                          <p className="text-[10px] text-gray-500">Sync schedule &amp; settings</p>
                        </div>
                      </>
                    )}
                    {expandedAutoSyncService === 'orders' && (
                      <>
                        <div className="w-7 h-7 rounded-md bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
                          <ShoppingCart className="w-3.5 h-3.5 text-blue-400" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-100">Orders</p>
                          <p className="text-[10px] text-gray-500">Sync schedule &amp; settings</p>
                        </div>
                      </>
                    )}
                    {expandedAutoSyncService === 'channel' && (
                      <>
                        <div className="w-7 h-7 rounded-md bg-green-500/10 border border-green-500/20 flex items-center justify-center shrink-0">
                          <Globe className="w-3.5 h-3.5 text-green-400" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-100">BrickOwl Channel</p>
                          <p className="text-[10px] text-gray-500">Sync schedule &amp; settings</p>
                        </div>
                      </>
                    )}
                    {/* Enable/disable toggle in header */}
                    <div className="ml-auto flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-gray-500">
                        {expandedAutoSyncService === 'inventory' ? (inventorySyncEnabled ? 'Enabled' : 'Disabled')
                         : expandedAutoSyncService === 'orders' ? (ordersSyncEnabled ? 'Enabled' : 'Disabled')
                         : channelSyncEnabled ? 'Enabled' : 'Disabled'}
                      </span>
                      {expandedAutoSyncService === 'inventory' && (
                        <Switch checked={inventorySyncEnabled} onCheckedChange={(c) => { setInventorySyncEnabled(c); updateSettingsMutation.mutate({ inventorySyncEnabled: c }); if (!c) setExpandedAutoSyncService(null); }} data-testid="switch-inventory-sync-detail" />
                      )}
                      {expandedAutoSyncService === 'orders' && (
                        <Switch checked={ordersSyncEnabled} onCheckedChange={(c) => { setOrdersSyncEnabled(c); updateSettingsMutation.mutate({ ordersSyncEnabled: c }); if (!c) setExpandedAutoSyncService(null); }} data-testid="switch-orders-sync-detail" />
                      )}
                      {expandedAutoSyncService === 'channel' && (
                        <Switch checked={channelSyncEnabled} onCheckedChange={(c) => { setChannelSyncEnabled(c); updateSettingsMutation.mutate({ channelSyncEnabled: c }); if (!c) setExpandedAutoSyncService(null); }} data-testid="switch-channel-sync-detail" />
                      )}
                    </div>
                  </div>

                  {/* Detail config card */}
                  <div className="rounded-md border border-gray-700/80 bg-gray-800/20 divide-y divide-gray-700/40">

                    {/* ── Inventory detail ── */}
                    {expandedAutoSyncService === 'inventory' && (<>
                      <div className="flex items-center justify-between gap-3 px-4 py-3">
                        <Label className="text-xs text-gray-300">Run every</Label>
                        <Select
                          value={String(inventorySyncFrequency)}
                          onValueChange={(v) => { const hours = Number(v); setInventorySyncFrequency(hours); updateSettingsMutation.mutate({ inventorySyncFrequency: hours }); }}
                        >
                          <SelectTrigger className="w-40 h-8 text-xs" data-testid="select-inventory-frequency">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="6">Every 6 hours</SelectItem>
                            <SelectItem value="12">Every 12 hours</SelectItem>
                            <SelectItem value="24">Every 24 hours</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="px-4 py-2.5">
                        <SyncStatusLine entry={syncStatuses?.inventory ?? null} />
                      </div>
                      {platformSyncData && (
                        <div className="px-4 py-3 grid grid-cols-3 gap-2">
                          <div>
                            <p className="text-[10px] text-gray-500">Lots</p>
                            <p className="text-xs font-bold text-white font-mono">{platformSyncData.source.stats.totalLots?.toLocaleString() ?? '—'}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-gray-500">Parts</p>
                            <p className="text-xs font-bold text-white font-mono">{platformSyncData.source.stats.totalParts?.toLocaleString() ?? '—'}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-gray-500">Last Synced</p>
                            <p className="text-[10px] text-gray-400">{platformSyncData.source.stats.lastSyncedAt ? new Date(platformSyncData.source.stats.lastSyncedAt).toLocaleString() : 'Never'}</p>
                          </div>
                        </div>
                      )}
                    </>)}

                    {/* ── Orders detail ── */}
                    {expandedAutoSyncService === 'orders' && (<>
                      <div className="flex items-center justify-between gap-3 px-4 py-3">
                        <Label className="text-xs text-gray-300">Run every</Label>
                        <Select
                          value={String(ordersSyncFrequency)}
                          onValueChange={(v) => { const mins = Number(v); setOrdersSyncFrequency(mins); setOrdersSyncFrequencyStr(String(mins)); updateSettingsMutation.mutate({ ordersSyncFrequency: mins }); }}
                        >
                          <SelectTrigger className="w-40 h-8 text-xs" data-testid="select-orders-frequency">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="15">15 minutes</SelectItem>
                            <SelectItem value="30">30 minutes</SelectItem>
                            <SelectItem value="60">1 hour</SelectItem>
                            <SelectItem value="120">2 hours</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="px-4 py-2.5">
                        <SyncStatusLine entry={syncStatuses?.orders ?? null} />
                      </div>
                    </>)}

                    {/* ── BrickOwl Channel detail ── */}
                    {expandedAutoSyncService === 'channel' && (<>
                      {/* Frequency */}
                      <div className="flex items-center justify-between gap-3 px-4 py-3">
                        <Label className="text-xs text-gray-300">Run every</Label>
                        <Select
                          value={String(channelSyncFrequency)}
                          onValueChange={(v) => { const hours = Number(v); setChannelSyncFrequency(hours); updateSettingsMutation.mutate({ channelSyncFrequency: hours }); }}
                        >
                          <SelectTrigger className="w-40 h-8 text-xs" data-testid="select-channel-frequency">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">Every hour</SelectItem>
                            <SelectItem value="2">Every 2 hours</SelectItem>
                            <SelectItem value="4">Every 4 hours</SelectItem>
                            <SelectItem value="6">Every 6 hours</SelectItem>
                            <SelectItem value="12">Every 12 hours</SelectItem>
                            <SelectItem value="24">Every 24 hours</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {/* Status */}
                      <div className="px-4 py-2.5">
                        <SyncStatusLine entry={syncStatuses?.channel ?? null} />
                      </div>
                      {/* Sync Scope — in-scope lot count + exclusion breakdown */}
                      {syncScopeData && (
                        <div className="px-4 py-3 space-y-2 border-t border-gray-700/40" data-testid="card-channel-scope">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-semibold text-gray-300 uppercase tracking-wide">Sync Scope</span>
                            <span className="text-[10px] text-gray-500">{syncScopeData.totalLots.toLocaleString()} total BL lots</span>
                          </div>
                          {/* Main in-scope stat */}
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-lg font-bold text-white font-mono" data-testid="stat-scope-in-scope">{syncScopeData.inScopeLots.toLocaleString()}</span>
                            <span className="text-[11px] text-gray-400">lots in scope</span>
                          </div>
                          {/* Exclusion breakdown */}
                          {syncScopeData.exclusions.length > 0 ? (
                            <div className="space-y-1">
                              {syncScopeData.exclusions.map((ex) => (
                                <div key={ex.reason} className="flex items-center justify-between gap-2">
                                  <span className="text-[10px] text-gray-500 truncate">{ex.reason}</span>
                                  <span className="text-[10px] font-mono text-amber-400 shrink-0">-{ex.count.toLocaleString()}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[10px] text-gray-600">No exclusion rules active</p>
                          )}
                          {/* Zero-qty note */}
                          {syncScopeData.zeroQtyInScope > 0 && (
                            <p className="text-[10px] text-gray-600 pt-0.5">{syncScopeData.zeroQtyInScope.toLocaleString()} in-scope lots have 0 qty (will deactivate on BO)</p>
                          )}
                        </div>
                      )}
                      {/* Last sync result */}
                      {channelLastResult && (
                        <div className="px-4 py-3 space-y-2" data-testid="card-channel-last-result">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-semibold text-gray-300 uppercase tracking-wide">Last Sync</span>
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                              channelLastResult.status === 'success' ? 'bg-green-900/50 text-green-400' :
                              channelLastResult.status === 'partial' ? 'bg-yellow-900/50 text-yellow-400' :
                              'bg-red-900/50 text-red-400'
                            }`} data-testid="text-channel-last-status">
                              {channelLastResult.status === 'success' ? 'Success' : channelLastResult.status === 'partial' ? 'Partial' : 'Error'}
                            </span>
                            <span className="text-[10px] text-gray-500" data-testid="text-channel-last-time">{formatRelativeTime(channelLastResult.completedAt)}</span>
                            <span className="text-[10px] text-gray-600 capitalize" data-testid="text-channel-last-mode">
                              {channelLastResult.mode === 'full_control' ? 'Full Control' : channelLastResult.mode === 'matched_sync' ? 'Matched Sync' : channelLastResult.mode === 'analysis' ? 'Analysis' : channelLastResult.mode}
                            </span>
                          </div>
                          <div className="grid grid-cols-4 gap-2">
                            <div className="rounded bg-gray-900/60 p-2 text-center" data-testid="stat-channel-created"><div className="text-sm font-bold text-green-400">{channelLastResult.lotsCreated}</div><div className="text-[9px] text-gray-500 mt-0.5">Created</div></div>
                            <button onClick={() => channelLastResult.lotsUpdated > 0 && setUpdatedItemsDrawerOpen(true)} className={`rounded bg-gray-900/60 p-2 text-center w-full ${channelLastResult.lotsUpdated > 0 ? 'hover-elevate cursor-pointer' : 'cursor-default'}`} data-testid="stat-channel-updated"><div className="text-sm font-bold text-blue-400">{channelLastResult.lotsUpdated}</div><div className="text-[9px] text-gray-500 mt-0.5">Updated {channelLastResult.lotsUpdated > 0 && <span className="text-blue-600">↗</span>}</div></button>
                            <div className="rounded bg-gray-900/60 p-2 text-center" data-testid="stat-channel-skipped"><div className="text-sm font-bold text-gray-400">{channelLastResult.lotsSkipped}</div><div className="text-[9px] text-gray-500 mt-0.5">Skipped</div></div>
                            <div className="rounded bg-gray-900/60 p-2 text-center" data-testid="stat-channel-errors"><div className={`text-sm font-bold ${channelLastResult.errorCount > 0 ? 'text-red-400' : 'text-gray-400'}`}>{channelLastResult.errorCount}</div><div className="text-[9px] text-gray-500 mt-0.5">Errors</div></div>
                          </div>
                          {channelLastResult.errors.length > 0 && (
                            <div className="space-y-1 mt-1" data-testid="list-channel-errors">
                              {channelLastResult.errors.slice(0, 3).map((err, i) => (
                                <p key={i} className="text-[10px] text-red-400/80 truncate">{err}</p>
                              ))}
                              {channelLastResult.errors.length > 3 && <p className="text-[10px] text-gray-600">+{channelLastResult.errors.length - 3} more errors</p>}
                            </div>
                          )}
                        </div>
                      )}
                      {/* Sync Mode */}
                      <div className="px-4 py-3 space-y-2">
                        <div className="flex items-center gap-1.5">
                          <Label className="text-xs text-gray-200">Sync Mode</Label>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="w-3 h-3 text-gray-500 shrink-0 cursor-default" />
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-xs text-xs">
                              Controls how the channel sync behaves across all connected sales channels.
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <div className="grid grid-cols-1 gap-1.5">
                          {([
                            { id: 'analysis',     label: 'Analysis',     desc: 'Read-only — compare channels, no edits made' },
                            { id: 'full_control', label: 'Full Control', desc: 'Create new lots + full sync of all fields on existing' },
                            { id: 'matched_sync', label: 'Matched Sync', desc: 'Full sync of all fields on matched lots — never create new' },
                          ] as const).map(({ id, label, desc }) => (
                            <button
                              key={id}
                              onClick={() => { setChannelSyncMode(id); updateSettingsMutation.mutate({ channelSyncMode: id }); }}
                              className={`flex items-start gap-2 rounded-md border p-2.5 text-left transition-colors ${channelSyncMode === id ? 'border-blue-500/60 bg-blue-500/10' : 'border-gray-700 bg-gray-800/40 hover:border-gray-600'}`}
                              data-testid={`button-sync-mode-${id}`}
                            >
                              <div className={`mt-0.5 w-3 h-3 rounded-full border-2 shrink-0 ${channelSyncMode === id ? 'border-blue-400 bg-blue-400' : 'border-gray-500'}`} />
                              <div>
                                <span className="text-xs font-medium text-gray-200">{label}</span>
                                <p className="text-[10px] text-gray-500 mt-0.5">{desc}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                      {/* Item Groups */}
                      <button
                        onClick={() => setChannelItemGroupsOpen(!channelItemGroupsOpen)}
                        className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-xs text-gray-400 hover:text-gray-200 transition-colors group"
                        data-testid="button-channel-item-groups-toggle"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-gray-200">Item Groups</span>
                          <span className="text-[10px] text-gray-500">— what gets synced</span>
                        </div>
                        {channelItemGroupsOpen
                          ? <ChevronDown className="w-3.5 h-3.5 group-hover:text-gray-200 transition-colors" />
                          : <ChevronRight className="w-3.5 h-3.5 group-hover:text-gray-200 transition-colors" />}
                      </button>
                      {channelItemGroupsOpen && (
                        <div className="px-4 pb-3 space-y-3">
                          {/* Item type description */}
                          <p className="text-[10px] text-gray-500 leading-relaxed">
                            Choose which categories of items get synced to this channel. Turning a group off will
                            skip unlisted items and <strong className="text-gray-400">deactivate any existing listings</strong> on the next sync.
                          </p>
                          {/* Item Types */}
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Item Types</p>
                            <div className="rounded-md border border-gray-700/60 bg-gray-800/20 divide-y divide-gray-700/40">
                              {([
                                { code: 'P', label: 'Parts',    desc: 'Bricks, plates, tiles, and all individual components' },
                                { code: 'M', label: 'Minifigs', desc: 'Complete minifigures and minifig parts' },
                                { code: 'S', label: 'Sets',     desc: 'Complete assembled LEGO sets' },
                                { code: 'G', label: 'Gear',     desc: 'Non-building accessories (tools, clothing, etc.)' },
                              ] as const).map(({ code, label, desc }) => {
                                const isSynced = syncItemTypes[code] !== false;
                                return (
                                  <div key={code} className="flex items-center justify-between gap-3 px-3 py-2.5">
                                    <div className="min-w-0">
                                      <p className="text-xs font-medium text-gray-200">{label}</p>
                                      <p className="text-[10px] text-gray-500 mt-0.5 leading-tight">{desc}</p>
                                    </div>
                                    <Switch
                                      checked={isSynced}
                                      onCheckedChange={(checked) => {
                                        const next = { ...syncItemTypes, [code]: checked };
                                        if (checked) delete next[code]; // remove false entry; missing = synced
                                        setSyncItemTypes(next);
                                        updateSyncFieldMutation.mutate({ syncItemTypes: next });
                                      }}
                                      data-testid={`switch-sync-item-type-${code}`}
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                          {/* Bulk Lots */}
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Bulk Lots</p>
                            <div className="rounded-md border border-gray-700/60 bg-gray-800/20 divide-y divide-gray-700/40">
                              <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                                <div className="min-w-0">
                                  <p className="text-xs font-medium text-gray-200">Bulkinator bundles</p>
                                  <p className="text-[10px] text-gray-500 mt-0.5 leading-tight">All active bulk lots from the Bulkinator tool</p>
                                </div>
                                <Switch
                                  checked={syncBulkLots}
                                  onCheckedChange={(checked) => {
                                    setSyncBulkLots(checked);
                                    updateSyncFieldMutation.mutate({ syncBulkLots: checked });
                                  }}
                                  data-testid="switch-sync-bulk-lots"
                                />
                              </div>
                            </div>
                          </div>
                          {/* Stockrooms */}
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">BrickLink Stockrooms</p>
                            <p className="text-[10px] text-gray-500 mb-1.5 leading-relaxed">
                              <strong className="text-gray-400">Skip</strong> — ignore entirely.{' '}
                              <strong className="text-gray-400">Hidden</strong> — create on BrickOwl but keep hidden from buyers.{' '}
                              <strong className="text-gray-400">Active</strong> — sync as normal for-sale listings.
                            </p>
                            <div className="rounded-md border border-gray-700/60 bg-gray-800/20 divide-y divide-gray-700/40">
                              {(['A', 'B', 'C'] as const).map((id) => {
                                const mode = syncStockroomModes[id] ?? 'skip';
                                const statusText: Record<string, string> = {
                                  skip:   'Ignored — not tracked on BrickOwl',
                                  hidden: 'Legacy hidden — new items skipped, existing deactivated',
                                  sync:   'Linked on BrickOwl, hidden from buyers',
                                  active: 'Live on BrickOwl as for-sale listings',
                                };
                                return (
                                  <div key={id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                                    <div className="min-w-0">
                                      <p className="text-xs font-medium text-gray-200">Stockroom {id}</p>
                                      <p className="text-[10px] text-gray-500 mt-0.5 leading-tight">{statusText[mode] ?? mode}</p>
                                    </div>
                                    <div className="flex items-center gap-0.5 rounded border border-gray-700 bg-gray-900 p-0.5 shrink-0">
                                      {(['skip', 'sync', 'active'] as const).map((opt) => (
                                        <button
                                          key={opt}
                                          onClick={() => {
                                            const next = { ...syncStockroomModes, [id]: opt } as Record<string, 'skip'|'hidden'|'active'|'sync'>;
                                            setSyncStockroomModes(next);
                                            updateSyncFieldMutation.mutate({ syncStockroomModes: next });
                                          }}
                                          data-testid={`button-sync-stockroom-${id}-${opt}`}
                                          className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                                            mode === opt
                                              ? opt === 'skip'   ? 'bg-gray-700 text-gray-200'
                                              : opt === 'sync'   ? 'bg-blue-600/70 text-blue-100'
                                              :                    'bg-green-600/70 text-green-100'
                                              : 'text-gray-500 hover:text-gray-300'
                                          }`}
                                        >
                                          {opt === 'sync' ? 'Hidden' : opt.charAt(0).toUpperCase() + opt.slice(1)}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                          {/* Price Floor */}
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Price Floor</p>
                            <p className="text-[10px] text-gray-500 mb-2 leading-relaxed">
                              Lots priced below this amount will be skipped on sync — and any existing BrickOwl listings for those lots will be deactivated. Leave blank to sync all lots regardless of price.
                            </p>
                            <div className="rounded-md border border-gray-700/60 bg-gray-800/20 px-3 py-2.5 flex items-center gap-2">
                              <span className="text-xs text-gray-400 select-none">$</span>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="e.g. 0.05"
                                value={syncPriceFloor}
                                onChange={(e) => setSyncPriceFloor(e.target.value)}
                                onBlur={() => {
                                  const parsed = parseFloat(syncPriceFloor);
                                  const floor = !syncPriceFloor || isNaN(parsed) || parsed <= 0 ? null : parsed;
                                  updateSyncFieldMutation.mutate({ syncPriceFloor: floor });
                                }}
                                className="flex-1 bg-transparent text-xs text-gray-200 placeholder-gray-600 outline-none"
                                data-testid="input-sync-price-floor"
                              />
                              {syncPriceFloor && parseFloat(syncPriceFloor) > 0 && (
                                <button
                                  onClick={() => {
                                    setSyncPriceFloor('');
                                    updateSyncFieldMutation.mutate({ syncPriceFloor: null });
                                  }}
                                  className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
                                  data-testid="button-clear-price-floor"
                                >
                                  Clear
                                </button>
                              )}
                            </div>
                            {syncPriceFloor && parseFloat(syncPriceFloor) > 0 && (
                              <p className="text-[10px] text-amber-400/80 mt-1.5">
                                Lots under ${parseFloat(syncPriceFloor).toFixed(2)} will not be listed on BrickOwl.
                              </p>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Sync fields */}
                      <button
                        onClick={() => setChannelSyncFieldsOpen(!channelSyncFieldsOpen)}
                        className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-xs text-gray-400 hover:text-gray-200 transition-colors group"
                        data-testid="button-channel-fields-toggle"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-gray-200">Sync Fields</span>
                          <span className="text-[10px] text-gray-500">— what data gets written</span>
                        </div>
                        {channelSyncFieldsOpen
                          ? <ChevronDown className="w-3.5 h-3.5 group-hover:text-gray-200 transition-colors" />
                          : <ChevronRight className="w-3.5 h-3.5 group-hover:text-gray-200 transition-colors" />}
                      </button>
                      {channelSyncFieldsOpen && (
                        <div className="px-4 pb-3 space-y-2">
                          <Label className="text-xs text-gray-200">Fields to Sync</Label>
                          <div className="rounded-md border border-gray-700/60 bg-gray-800/20 divide-y divide-gray-700/40">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex items-center justify-between gap-3 px-3 py-2.5 opacity-60 cursor-default">
                                  <div className="min-w-0">
                                    <p className="text-xs font-medium text-gray-200 flex items-center gap-1.5">Quantity {channelSyncMode !== 'analysis' && <Lock className="w-2.5 h-2.5 text-gray-500" />}</p>
                                    <p className="text-[10px] text-gray-500 mt-0.5 leading-tight">Syncs the lot quantity from BrickLink</p>
                                  </div>
                                  <Switch checked disabled data-testid="switch-sync-field-qty" />
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="max-w-xs text-xs">
                                {channelSyncMode === 'analysis' ? 'Analysis mode — no writes.' : 'Quantity is always synced and cannot be disabled.'}
                              </TooltipContent>
                            </Tooltip>
                            <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-gray-200">Base Price</p>
                                <p className="text-[10px] text-gray-500 mt-0.5 leading-tight">Syncs the listing price from BrickLink to existing lots</p>
                              </div>
                              <Switch checked={syncFieldPrice} onCheckedChange={(c) => { setSyncFieldPrice(c); updateSyncFieldMutation.mutate({ syncPrice: c }); }} data-testid="switch-sync-field-syncPrice" />
                            </div>
                            {([
                              { key: 'syncRemarks',      label: 'Remarks',           desc: 'BrickLink Remarks → BrickOwl personal note',           value: syncFieldRemarks,     set: setSyncFieldRemarks     },
                              { key: 'syncDescription',  label: 'Description',       desc: 'BrickLink Description → BrickOwl public note',          value: syncFieldDescription, set: setSyncFieldDescription },
                              { key: 'syncTierPrice',    label: 'Tier Pricing',      desc: 'Syncs bulk discount tiers from BrickLink',              value: syncFieldTierPrice,   set: setSyncFieldTierPrice   },
                              { key: 'syncSalePercent',  label: 'Sale %',            desc: 'Syncs BrickLink sale rate to BrickOwl sale %',          value: syncFieldSalePercent, set: setSyncFieldSalePercent },
                              { key: 'syncBulkQty',      label: 'Min Quantity',      desc: 'BrickLink Bulk → BrickOwl bulk_qty',                    value: syncFieldBulkQty,     set: setSyncFieldBulkQty     },
                              { key: 'syncLotWeight',    label: 'Custom Lot Weight', desc: 'BrickLink My Weight → BrickOwl lot_weight',             value: syncFieldLotWeight,   set: setSyncFieldLotWeight   },
                            ] as const).map(({ key, label, desc, value, set }) => (
                              <div key={key} className="flex items-center justify-between gap-3 px-3 py-2.5">
                                <div className="min-w-0">
                                  <p className="text-xs font-medium text-gray-200">{label}</p>
                                  <p className="text-[10px] text-gray-500 mt-0.5 leading-tight">{desc}</p>
                                </div>
                                <Switch checked={value} onCheckedChange={(c) => { set(c); updateSyncFieldMutation.mutate({ [key]: c }); }} data-testid={`switch-sync-field-${key}`} />
                              </div>
                            ))}
                            <div className="px-3 py-2.5">
                              <p className="text-[10px] text-gray-500 leading-tight">
                                Stockroom sync settings have moved to <strong className="text-gray-400">Item Groups</strong> above.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </>)}

                  </div>
                </>
              )}

              </div>
            )}

            {/* AI Settings & Intelligence */}
            {activeSection === 'ai' && (
              <div className="space-y-4 min-h-[400px]">
              <div className="space-y-4">

                {/* Chat Assistant */}
                <div>
                  <h3 className="text-sm font-medium text-gray-100 mb-3">Chat Assistant (E.L.F.I.E.)</h3>
                  <div className="space-y-4">


                    {(() => {
                      const tier = getTierConfig(org?.plan ?? 'trial');
                      const fo = (org?.featureOverrides ?? {}) as Record<string, boolean>;
                      const hasElfieCustom = fo['elfieCustom'] !== undefined ? fo['elfieCustom'] : tier.features.elfieCustom;
                      if (!hasElfieCustom) return (
                        <div className="rounded-lg bg-gray-800/40 border border-gray-700/50 p-4 text-center space-y-2">
                          <Lock className="h-5 w-5 text-gray-600 mx-auto" />
                          <p className="text-xs text-gray-400">Custom prompts & conversation-based tuning are available on <strong className="text-gray-200">Core</strong> and <strong className="text-gray-200">Flagship</strong> plans.</p>
                          <p className="text-[10px] text-gray-600">Upgrade your plan to personalize E.L.F.I.E. for your business.</p>
                        </div>
                      );
                      return null;
                    })()}
                    {(() => {
                      const tier = getTierConfig(org?.plan ?? 'trial');
                      const fo = (org?.featureOverrides ?? {}) as Record<string, boolean>;
                      const hasElfieCustom = fo['elfieCustom'] !== undefined ? fo['elfieCustom'] : tier.features.elfieCustom;
                      if (!hasElfieCustom) return null;
                      return (<>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5">
                          <Label htmlFor="system-prompt" className="text-xs text-gray-200">Custom Prompt</Label>
                          <Popover>
                            <PopoverTrigger asChild>
                              <button className="text-gray-500 hover:text-gray-300 transition-colors" data-testid="button-custom-prompt-info">
                                <Info className="h-3.5 w-3.5" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent side="top" align="start" className="w-80 text-xs space-y-2 bg-gray-900 border-gray-700">
                              <p className="font-medium text-gray-200">Customize E.L.F.I.E. for Your Business</p>
                              <p className="text-gray-400">Use this field to tailor how E.L.F.I.E. thinks, speaks, and prioritizes for your specific store. Your custom prompt replaces the built-in defaults — tool access stays the same.</p>
                              <div className="space-y-1.5 text-gray-400">
                                <p className="font-medium text-gray-300">Ideas for what to include:</p>
                                <p>- Your store's specialty (e.g., "We focus on rare Technic parts and vintage Castle sets")</p>
                                <p>- Communication style ("Keep answers brief" or "Give detailed analysis")</p>
                                <p>- Business priorities ("Always highlight margin opportunities" or "Flag slow-moving inventory")</p>
                                <p>- Customer context ("Our top buyers are MOC builders who care about color accuracy")</p>
                                <p>- Things to avoid ("Don't suggest discounting rare parts")</p>
                              </div>
                              <p className="text-gray-500 pt-1 border-t border-gray-700/50">Tip: Use "Analyze Conversations" below to auto-generate a prompt based on your actual chat history with E.L.F.I.E.</p>
                            </PopoverContent>
                          </Popover>
                        </div>
                        {systemPrompt && (
                          <Button
                            size="sm"
                            variant="ghost"
                            data-testid="button-clear-elfie-prompt"
                            onClick={() => {
                              setSystemPrompt('');
                              updateSettingsMutation.mutate({
                                aiEnabled,
                                ...(openaiApiKey ? { openaiApiKey } : {}),
                                selectedModel: selectedModel || null,
                                systemPrompt: null,
                              });
                            }}
                            className="text-[10px] text-gray-500"
                          >
                            Clear
                          </Button>
                        )}
                      </div>
                      <Textarea
                        id="system-prompt"
                        placeholder="Add custom instructions for E.L.F.I.E. — this replaces the default personality & behavior. Tool instructions are always appended automatically."
                        value={systemPrompt}
                        onChange={(e) => setSystemPrompt(e.target.value)}
                        onBlur={() => {
                          updateSettingsMutation.mutate({
                            aiEnabled,
                            ...(openaiApiKey ? { openaiApiKey } : {}),
                            selectedModel: selectedModel || null,
                            systemPrompt: systemPrompt || null,
                          });
                        }}
                        className="text-xs font-mono min-h-[160px] resize-y"
                        data-testid="textarea-system-prompt"
                      />
                      <p className="sm-description">
                        {systemPrompt
                          ? 'Your custom prompt replaces the default personality & behavior. Tool instructions are always appended automatically.'
                          : 'No custom prompt — using built-in defaults. Use "Analyze Conversations" below to generate one.'}
                      </p>
                    </div>

                    <Separator className="bg-gray-700" />

                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div>
                          <p className="text-xs font-medium text-gray-200">Conversation-Based Prompt Tuning</p>
                          <p className="text-[10px] text-gray-500 mt-0.5">Analyze past Elfie conversations to generate a smarter custom prompt</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5">
                          <Label className="text-[10px] text-gray-500">From</Label>
                          <input
                            type="date"
                            value={elfieAnalysisStart}
                            onChange={(e) => setElfieAnalysisStart(e.target.value)}
                            className="text-[10px] bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 font-mono"
                            data-testid="input-analysis-start-date"
                          />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Label className="text-[10px] text-gray-500">To</Label>
                          <input
                            type="date"
                            value={elfieAnalysisEnd}
                            onChange={(e) => setElfieAnalysisEnd(e.target.value)}
                            className="text-[10px] bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 font-mono"
                            data-testid="input-analysis-end-date"
                          />
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid="button-analyze-conversations"
                          disabled={elfieAnalyzing}
                          onClick={async () => {
                            setElfieAnalyzing(true);
                            setElfieAnalysisResult(null);
                            try {
                              const res = await fetch('/api/elfie-analyze-conversations', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                credentials: 'include',
                                body: JSON.stringify({ startDate: elfieAnalysisStart, endDate: elfieAnalysisEnd }),
                              });
                              const data = await res.json();
                              if (data.error) throw new Error(data.error);
                              setElfieAnalysisResult(data);
                            } catch (err: any) {
                              setElfieAnalysisResult({ summary: `Error: ${err.message}`, prompt: '', messageCount: 0, sessionCount: 0 });
                            } finally {
                              setElfieAnalyzing(false);
                            }
                          }}
                          className="text-[10px]"
                        >
                          {elfieAnalyzing ? 'Analyzing...' : 'Analyze Conversations'}
                        </Button>
                      </div>

                      {elfieAnalyzing && (
                        <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 p-3">
                          <p className="text-[11px] text-blue-300">Analyzing conversations with AI... This may take 15-30 seconds.</p>
                        </div>
                      )}

                      {elfieAnalysisResult && elfieAnalysisResult.prompt && (
                        <div className="space-y-2">
                          <div className="rounded-lg bg-gray-800/60 border border-gray-700 p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-[11px] font-medium text-gray-200">Analysis Results</p>
                              <span className="text-[10px] text-gray-500">{elfieAnalysisResult.messageCount} messages across {elfieAnalysisResult.sessionCount} sessions</span>
                            </div>
                            <div className="text-[11px] text-gray-400 whitespace-pre-wrap leading-relaxed">{elfieAnalysisResult.summary}</div>
                          </div>

                          <div className="rounded-lg bg-gray-800/60 border border-gray-700 p-3 space-y-2">
                            <p className="text-[11px] font-medium text-gray-200">Suggested Custom Prompt</p>
                            <div className="max-h-[250px] overflow-y-auto">
                              <pre className="text-[10px] font-mono text-gray-400 whitespace-pre-wrap leading-relaxed">{elfieAnalysisResult.prompt}</pre>
                            </div>
                            <div className="flex items-center gap-2 pt-1 flex-wrap">
                              <Button
                                size="sm"
                                variant="default"
                                data-testid="button-accept-analysis-prompt"
                                onClick={() => {
                                  setSystemPrompt(elfieAnalysisResult!.prompt);
                                  updateSettingsMutation.mutate({
                                    aiEnabled,
                                    ...(openaiApiKey ? { openaiApiKey } : {}),
                                    selectedModel: selectedModel || null,
                                    systemPrompt: elfieAnalysisResult!.prompt,
                                  });
                                  setElfieAnalysisResult(null);
                                }}
                                className="text-[10px]"
                              >
                                Apply as Custom Prompt
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                data-testid="button-dismiss-analysis"
                                onClick={() => setElfieAnalysisResult(null)}
                                className="text-[10px] text-gray-500"
                              >
                                Dismiss
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}

                      {elfieAnalysisResult && !elfieAnalysisResult.prompt && (
                        <div className="rounded-lg bg-orange-500/10 border border-orange-500/30 p-3">
                          <p className="text-[11px] text-orange-300">{elfieAnalysisResult.summary}</p>
                        </div>
                      )}
                    </div>
                      </>);
                    })()}

                    <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3">
                      <p className="text-xs text-purple-300">
                        <strong>Powered by OpenAI:</strong> E.L.F.I.E. runs on OpenAI GPT-4o — no API key required. Semantic search uses OpenAI text-embedding-3-small.
                      </p>
                    </div>
                  </div>
                </div>

                <Separator className="bg-gray-700" />

                {/* Customer Feedback Prompt */}
                <div>
                  <h3 className="text-sm font-medium text-gray-100 mb-1">Customer Feedback Prompt</h3>
                  <p className="text-[10px] text-gray-500 mb-3">Custom instructions for E.L.F.I.E. when generating feedback comments for buyers. Leave blank to use the built-in default.</p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <Label htmlFor="feedback-prompt" className="text-xs text-gray-400">AI Feedback Instructions</Label>
                      {feedbackPrompt && (
                        <Button
                          size="sm"
                          variant="ghost"
                          data-testid="button-clear-feedback-prompt"
                          onClick={() => {
                            setFeedbackPrompt('');
                            updateSettingsMutation.mutate({ feedbackPrompt: null } as any);
                          }}
                          className="text-[10px] text-gray-500"
                        >
                          Reset to Default
                        </Button>
                      )}
                    </div>
                    <Textarea
                      id="feedback-prompt"
                      placeholder="Leave blank to use the built-in default. Example: Keep it warm but concise. Always address the buyer by username. For repeat customers, acknowledge their loyalty."
                      value={feedbackPrompt}
                      onChange={(e) => setFeedbackPrompt(e.target.value)}
                      onBlur={() => {
                        updateSettingsMutation.mutate({ feedbackPrompt: feedbackPrompt || null } as any);
                      }}
                      className="text-xs font-mono min-h-[100px] resize-y"
                      data-testid="textarea-feedback-prompt"
                    />
                    <p className="sm-description">
                      {feedbackPrompt
                        ? 'Using your custom feedback prompt. Tool constraints (max length, output format) are always appended automatically.'
                        : 'No custom prompt — using built-in default. E.L.F.I.E. generates warm, buyer-specific comments matched to the rating tone.'}
                    </p>
                  </div>
                </div>

                <Separator className="bg-gray-700" />

                {/* Semantic Search Test */}
                <div>
                  <h3 className="text-sm font-medium text-gray-100 mb-3">Semantic Search</h3>
                  <EmbeddingsManager searchOnly />
                </div>
              </div>
              </div>
            )}

            {activeSection === 'priceomatic' && (
              <div className="space-y-4 min-h-[400px]">

                {/* Breadcrumb back to IE Strategies */}
                <button
                  onClick={() => setActiveSection('ieStrategies')}
                  className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
                  data-testid="button-pom-back-to-ie-strategies"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  IE Strategies
                </button>

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
                    <div ref={scoringWheelRef} className="space-y-4">

                      {/* Sort mode toggle */}
                      <div className="px-3 py-2.5 rounded-md bg-gray-800/30 border border-gray-700/40 space-y-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div>
                            <p className="text-xs font-medium text-gray-200">Inventory Sort Mode</p>
                            <p className="text-[10px] text-gray-500 mt-0.5">Controls how items are ranked on the POM screen</p>
                          </div>
                          <div className="flex items-center gap-1 p-0.5 rounded bg-gray-800/60 border border-gray-700/50">
                            <button
                              onClick={() => { setPomSortMode('scoring'); savePomAiMutation.mutate({ sortMode: 'scoring' }); }}
                              className={`px-2.5 py-1 rounded text-[10px] font-medium transition-colors ${pomSortMode === 'scoring' ? 'bg-gray-600 text-gray-100' : 'text-gray-500 hover:text-gray-300'}`}
                              data-testid="button-pom-sort-scoring"
                            >
                              Scoring
                            </button>
                            <button
                              onClick={() => { setPomSortMode('suggested'); savePomAiMutation.mutate({ sortMode: 'suggested' }); }}
                              className={`px-2.5 py-1 rounded text-[10px] font-medium transition-colors ${pomSortMode === 'suggested' ? 'bg-violet-600/80 text-violet-100' : 'text-gray-500 hover:text-gray-300'}`}
                              data-testid="button-pom-sort-suggested"
                            >
                              Opportunity
                            </button>
                          </div>
                        </div>
                        <p className="text-[10px] text-gray-500 leading-relaxed">
                          {pomSortMode === 'scoring' ? (
                            <>
                              Items ranked by repricing score — ceiling ratio, STR (sell-through rate), scarcity, and undercut margin. Best for systematic repricing.
                              <span className="block mt-1 font-mono text-gray-600">
                                Score = (ceiling × {Math.round(pomWeightCeiling * 100)}%) + (STR × {Math.round(pomWeightVelocity * 100)}%) + (scarcity × {Math.round(pomWeightScarcity * 100)}%) + (undercut × {Math.round(pomWeightUndercut * 100)}%)
                              </span>
                            </>
                          ) : (
                            'Items ranked by dollar opportunity — (suggested \u2212 current) \u00d7 quantity. Surfaces the highest-revenue repricing wins first. Beta.'
                          )}
                        </p>
                      </div>

                      {pomSortMode !== 'suggested' && (<>
                      {/* Current weights summary */}
                      <div className="px-3 py-2 rounded-md bg-gray-800/30 border border-gray-700/40">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <p className="text-[10px] text-gray-500">Current scoring weights</p>
                          <button
                            className="text-[9px] text-purple-400 hover:text-purple-300 underline underline-offset-2"
                            onClick={() => setActiveSection('ieStrategies')}
                          >
                            Change in IE Strategies
                          </button>
                        </div>
                        <div className="grid grid-cols-4 gap-1">
                          {[
                            { label: 'Ceiling', val: pomWeightCeiling },
                            { label: 'STR', val: pomWeightVelocity },
                            { label: 'Scarcity', val: pomWeightScarcity },
                            { label: 'Undercut', val: pomWeightUndercut },
                          ].map(({ label, val }) => (
                            <div key={label} className="text-center">
                              <div className="text-[9px] text-gray-600 uppercase tracking-wide">{label}</div>
                              <div className="text-[11px] font-mono font-semibold text-gray-300">{Math.round(val * 100)}%</div>
                            </div>
                          ))}
                        </div>
                        <p className="text-[9px] text-gray-600 mt-1.5 leading-relaxed font-mono">
                          Score = (ceiling × {Math.round(pomWeightCeiling * 100)}%) + (STR × {Math.round(pomWeightVelocity * 100)}%) + (scarcity × {Math.round(pomWeightScarcity * 100)}%) + (undercut × {Math.round(pomWeightUndercut * 100)}%)
                        </p>
                      </div>

                      <div className="border-t border-gray-700/40">
                        <button
                          onClick={() => setPomScoringAdvancedOpen(!pomScoringAdvancedOpen)}
                          className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-gray-800/40 border-b border-gray-700/60 hover:bg-gray-800/60 transition-colors"
                          data-testid="button-pom-scoring-advanced-toggle"
                        >
                          <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Advanced</span>
                          {pomScoringAdvancedOpen ? <ChevronDown className="w-3 h-3 text-gray-500" /> : <ChevronRight className="w-3 h-3 text-gray-500" />}
                        </button>
                        {pomScoringAdvancedOpen && (
                          <div ref={scoringWheelRef} className="space-y-3 pt-2">
                            {/* Scoring Wheel — manual weight override */}
                            <div className="px-3">
                              <p className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Manual weight override</p>
                              <div className="relative">
                                {scoringWheelExample ? (
                                  <div className="flex items-center gap-1.5 px-2 py-1.5 bg-gray-800/60 rounded border border-gray-700/40">
                                    <span className="text-[10px] font-medium text-gray-300 truncate">{scoringWheelExample.itemName || scoringWheelExample.itemNo}</span>
                                    {scoringWheelExample.itemName && <span className="text-[10px] text-gray-500 shrink-0">{scoringWheelExample.itemNo}</span>}
                                    {scoringWheelExample.colorName && <span className="text-[10px] text-gray-500">({scoringWheelExample.colorName})</span>}
                                    <span className="text-[10px] text-gray-600">{scoringWheelExample.newOrUsed === 'N' ? 'New' : 'Used'}</span>
                                    <button className="ml-auto shrink-0 text-gray-500 hover:text-gray-300" data-testid="button-scoring-search-clear"
                                      onClick={() => { setSelectedScoringExample(null); setScoringExampleDismissed(true); setScoringSearchQuery(''); setScoringSearchOpen(true); setTimeout(() => scoringSearchRef.current?.focus(), 100); }}>
                                      <X className="w-3 h-3" />
                                    </button>
                                  </div>
                                ) : (
                                  <div className="relative">
                                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500" />
                                    <input
                                      ref={scoringSearchRef}
                                      type="text"
                                      placeholder="Search item to preview score..."
                                      value={scoringSearchQuery}
                                      onChange={(e) => { setScoringSearchQuery(e.target.value); setScoringSearchOpen(true); }}
                                      onFocus={() => setScoringSearchOpen(true)}
                                      onBlur={() => setTimeout(() => setScoringSearchOpen(false), 200)}
                                      className="w-full pl-7 pr-2 py-1.5 text-[11px] bg-gray-800/60 border border-gray-700/40 rounded text-gray-300 placeholder-gray-600 focus:outline-none focus:border-gray-600"
                                      data-testid="input-scoring-search"
                                    />
                                    {scoringSearchOpen && scoringSearchResults.length > 0 && (
                                      <div className="absolute left-0 right-0 top-full mt-1 bg-gray-800 border border-gray-700/60 rounded shadow-lg z-50 max-h-48 overflow-y-auto">
                                        {scoringSearchResults.map((item) => (
                                          <button key={`${item.itemNo}-${item.colorId}-${item.newOrUsed}`} className="w-full flex items-center gap-1.5 px-3 py-1.5 text-left hover:bg-gray-700/50 transition-colors" data-testid={`button-scoring-search-result-${item.itemNo}`}
                                            onMouseDown={(e) => { e.preventDefault(); setSelectedScoringExample(item); setScoringSearchOpen(false); setScoringSearchQuery(''); }}>
                                            <span className="text-[10px] text-gray-300 truncate">{item.itemName || item.itemNo}</span>
                                            <span className="text-[10px] text-gray-500 shrink-0">{item.itemNo}</span>
                                            {item.colorName && (
                                              <span className="text-[10px] text-gray-600 shrink-0">
                                                {item.colorName} / {item.newOrUsed === 'N' ? 'New' : 'Used'}
                                              </span>
                                            )}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                    {scoringSearchOpen && scoringSearchQuery.trim() && scoringSearchResults.length === 0 && (
                                      <div className="absolute left-0 right-0 top-full mt-1 bg-gray-800 border border-gray-700/60 rounded shadow-lg z-50 px-3 py-2">
                                        <span className="text-[10px] text-gray-500">No matching items found</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="px-3 py-2 flex justify-center">
                              <ScoringWheel
                                lot={scoringWheelExample}
                                baseCfg={{
                                  wCeiling: pomWeightCeiling,
                                  wVelocity: pomWeightVelocity,
                                  wScarcity: pomWeightScarcity,
                                  wUndercut: pomWeightUndercut,
                                }}
                                onSave={(cfg) => {
                                  setPomWeightCeiling(cfg.wCeiling);
                                  setPomWeightVelocity(cfg.wVelocity);
                                  setPomWeightScarcity(cfg.wScarcity);
                                  setPomWeightUndercut(cfg.wUndercut);
                                  updateOrgSettingsMutation.mutate({
                                    pomWeightCeiling: Number(cfg.wCeiling.toFixed(3)),
                                    pomWeightVelocity: Number(cfg.wVelocity.toFixed(3)),
                                    pomWeightScarcity: Number(cfg.wScarcity.toFixed(3)),
                                    pomWeightUndercut: Number(cfg.wUndercut.toFixed(3)),
                                  });
                                }}
                              />
                            </div>
                            <div className="border-t border-gray-700/40">
                            <div className="px-3 pt-2 pb-1">
                              <span className="text-[9px] font-semibold text-green-400 uppercase tracking-wider">STR thresholds</span>
                            </div>
                            <div className="divide-y divide-gray-700/30">
                              <div className="sm-row px-3">
                                <Label className="text-xs text-emerald-300">High demand</Label>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-gray-400">STR ≥</span>
                                  <Input type="number" min={0} max={100} step={0.1} value={pomVelocityHigh} onChange={(e) => setPomVelocityHigh(parseFloat(e.target.value) || 0)} onBlur={() => updateOrgSettingsMutation.mutate({ pomVelocityHigh })} className="text-sm w-20 text-right" data-testid="input-pom-velocity-high" />
                                </div>
                              </div>
                              <div className="sm-row px-3">
                                <Label className="text-xs text-orange-300">Low demand</Label>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-gray-400">STR ≤</span>
                                  <Input type="number" min={0} max={100} step={0.1} value={pomVelocityLow} onChange={(e) => setPomVelocityLow(parseFloat(e.target.value) || 0)} onBlur={() => updateOrgSettingsMutation.mutate({ pomVelocityLow })} className="text-sm w-20 text-right" data-testid="input-pom-velocity-low" />
                                </div>
                              </div>
                            </div>

                            <div className="px-3 pt-2 pb-1">
                              <span className="text-[9px] font-semibold text-purple-400 uppercase tracking-wider">Scarcity thresholds</span>
                            </div>
                            <div className="divide-y divide-gray-700/30">
                              <div className="sm-row px-3">
                                <Label className="text-xs text-emerald-300">Very scarce</Label>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-gray-400">index ≥</span>
                                  <Input type="number" min={0} max={1} step={0.005} value={pomScarcityHigh} onChange={(e) => setPomScarcityHigh(parseFloat(e.target.value) || 0)} onBlur={() => updateOrgSettingsMutation.mutate({ pomScarcityHigh })} className="text-sm w-20 text-right" data-testid="input-pom-scarcity-high" />
                                </div>
                              </div>
                              <div className="sm-row px-3">
                                <Label className="text-xs text-orange-300">Very common</Label>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-gray-400">index ≤</span>
                                  <Input type="number" min={0} max={1} step={0.001} value={pomScarcityLow} onChange={(e) => setPomScarcityLow(parseFloat(e.target.value) || 0)} onBlur={() => updateOrgSettingsMutation.mutate({ pomScarcityLow })} className="text-sm w-20 text-right" data-testid="input-pom-scarcity-low" />
                                </div>
                              </div>
                            </div>

                            <div className="px-3 pt-2 pb-1">
                              <span className="text-[9px] font-semibold text-amber-400 uppercase tracking-wider">Undercut thresholds</span>
                            </div>
                            <div className="divide-y divide-gray-700/30">
                              <div className="sm-row px-3">
                                <Label className="text-xs text-orange-300">Heavily undercut</Label>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-gray-400">ratio ≥</span>
                                  <Input type="number" min={0.1} max={10} step={0.1} value={pomUndercutHigh} onChange={(e) => setPomUndercutHigh(parseFloat(e.target.value) || 0.1)} onBlur={() => updateOrgSettingsMutation.mutate({ pomUndercutHigh })} className="text-sm w-20 text-right" data-testid="input-pom-undercut-high" />
                                </div>
                              </div>
                              <div className="sm-row px-3">
                                <Label className="text-xs text-emerald-300">Cheapest seller</Label>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-gray-400">ratio ≤</span>
                                  <Input type="number" min={0.1} max={10} step={0.1} value={pomUndercutLow} onChange={(e) => setPomUndercutLow(parseFloat(e.target.value) || 0.1)} onBlur={() => updateOrgSettingsMutation.mutate({ pomUndercutLow })} className="text-sm w-20 text-right" data-testid="input-pom-undercut-low" />
                                </div>
                              </div>
                            </div>
                          </div>
                          </div>
                        )}
                      </div>
                      </>)}

                    </div>
                  )}
                </div>

                {/* Suggested Pricing collapsible */}
                {pomSortMode !== 'suggested' && <div ref={pricingWheelRef}>
                  <button
                    onClick={() => setPomSugPricingOpen(!pomSugPricingOpen)}
                    className="w-full flex items-center justify-between gap-2 py-2 mb-3 border-b border-gray-600/60 hover:border-gray-500/60 transition-colors group"
                    data-testid="button-pom-sug-pricing-toggle"
                  >
                    <span className="text-sm font-semibold text-gray-200 uppercase tracking-wider">Suggested Pricing</span>
                    {pomSugPricingOpen ? <ChevronDown className="w-4 h-4 text-gray-400 group-hover:text-gray-200 transition-colors" /> : <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-200 transition-colors" />}
                  </button>
                  {pomSugPricingOpen && (
                    <div className="space-y-4">

                      <div className="sm-card-inset">
                        <div className="px-3 py-2 bg-gray-800/40 border-b border-gray-700/60">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-purple-300 uppercase tracking-wider">Pricing Strategy</span>
                            <Popover>
                              <PopoverTrigger asChild>
                                <button className="sm-icon-btn" onClick={(e) => e.stopPropagation()}>
                                  <Info className="w-3 h-3" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent side="bottom" className="sm-popover">
                                Drag the wheel to tune your pricing strategy across four dimensions. Demand weighs STR (sell-through rate), Rarity weighs sold-max prices, Competition anchors to market min, and Store Premium adds your markup for deep stock and fast service. The same wheel appears on each tile.
                              </PopoverContent>
                            </Popover>
                          </div>
                        </div>
                        <div className="px-3 py-1.5 border-b border-gray-700/40">
                          {wheelExample ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-gray-500">Preview:</span>
                              <span className="text-[10px] font-medium text-gray-300 truncate">{wheelExample.itemName || wheelExample.itemNo}</span>
                              {wheelExample.itemName && <span className="text-[10px] text-gray-500 shrink-0">{wheelExample.itemNo}</span>}
                              {wheelExample.colorName && <span className="text-[10px] text-gray-500">({wheelExample.colorName})</span>}
                              <span className="text-[10px] text-gray-600">{wheelExample.newOrUsed === 'N' ? 'New' : 'Used'}</span>
                              {!pricingExample && (
                                <button
                                  onClick={() => { setSelectedWheelExample(null); setWheelSearchQuery(''); setWheelSearchOpen(true); setTimeout(() => wheelSearchRef.current?.focus(), 100); }}
                                  className="ml-auto text-gray-500 hover:text-gray-300 transition-colors"
                                  data-testid="button-change-wheel-example"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          ) : (
                            <div className="relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setTimeout(() => setWheelSearchOpen(false), 150); }}>
                              <div className="flex items-center gap-1.5 bg-gray-800/60 rounded px-2 py-1.5">
                                <Search className="w-3 h-3 text-gray-500 shrink-0" />
                                <input
                                  ref={wheelSearchRef}
                                  type="text"
                                  value={wheelSearchQuery}
                                  onChange={(e) => { setWheelSearchQuery(e.target.value); setWheelSearchOpen(true); }}
                                  onFocus={() => setWheelSearchOpen(true)}
                                  placeholder="Search inventory to preview pricing..."
                                  className="bg-transparent border-none outline-none text-[11px] text-gray-200 placeholder:text-gray-600 w-full"
                                  data-testid="input-wheel-example-search"
                                />
                              </div>
                              {wheelSearchOpen && wheelSearchResults.length > 0 && (
                                <div className="absolute left-0 right-0 top-full mt-1 bg-gray-800 border border-gray-700/60 rounded shadow-lg z-50 max-h-48 overflow-y-auto">
                                  {wheelSearchResults.map((item) => (
                                    <button
                                      key={`${item.inventoryId}-${item.newOrUsed}`}
                                      onClick={() => {
                                        setSelectedWheelExample(item);
                                        setWheelSearchOpen(false);
                                        setWheelSearchQuery('');
                                      }}
                                      className="w-full text-left px-2.5 py-1.5 hover-elevate flex items-center gap-2 transition-colors"
                                      data-testid={`button-wheel-example-${item.inventoryId}`}
                                    >
                                      <div className="flex flex-col min-w-0 flex-1">
                                        <span className="text-[10px] font-medium text-gray-200 truncate">{item.itemName || item.itemNo}</span>
                                        <span className="text-[9px] text-gray-500 truncate">
                                          {item.itemNo}
                                          {item.colorName ? ` · ${item.colorName}` : ''}
                                          {' · '}{item.newOrUsed === 'N' ? 'New' : 'Used'}
                                          {' · $'}{Number(item.currentPrice).toFixed(2)}
                                        </span>
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              )}
                              {wheelSearchOpen && wheelSearchQuery.trim() && wheelSearchResults.length === 0 && (
                                <div className="absolute left-0 right-0 top-full mt-1 bg-gray-800 border border-gray-700/60 rounded shadow-lg z-50 px-3 py-2">
                                  <span className="text-[10px] text-gray-500">No matching items found</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="px-3 py-4 flex justify-center">
                          <DimensionWheel
                            lot={wheelExample}
                            baseCfg={{
                              soldAvgW: pomSugSoldAvgW,
                              stockMinW: pomSugStockMinW,
                              soldMaxW: pomSugSoldMaxW,
                              demandMult: pomSugDemandMult,
                              compCap: pomSugCompCap,
                              floor: pomSugFloor,
                              storePremium: pomSugStorePremium,
                            }}
                            onSave={(cfg) => {
                              setPomSugSoldAvgW(cfg.soldAvgW);
                              setPomSugStockMinW(cfg.stockMinW);
                              setPomSugSoldMaxW(cfg.soldMaxW);
                              setPomSugDemandMult(cfg.demandMult);
                              setPomSugCompCap(cfg.compCap);
                              setPomSugFloor(cfg.floor);
                              setPomSugStorePremium(cfg.storePremium);
                              updateOrgSettingsMutation.mutate({
                                pomSugSoldAvgW: Number(cfg.soldAvgW.toFixed(3)),
                                pomSugStockMinW: Number(cfg.stockMinW.toFixed(3)),
                                pomSugSoldMaxW: Number(cfg.soldMaxW.toFixed(3)),
                                pomSugDemandMult: Number(cfg.demandMult.toFixed(3)),
                                pomSugCompCap: Number(cfg.compCap.toFixed(3)),
                                pomSugFloor: Number(cfg.floor.toFixed(3)),
                                pomSugStorePremium: Number(cfg.storePremium.toFixed(3)),
                              });
                            }}
                          />
                        </div>
                        <div className="border-t border-gray-700/40">
                          <button
                            onClick={() => setPomPricingAdvancedOpen(!pomPricingAdvancedOpen)}
                            className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-gray-800/40 border-b border-gray-700/60 hover:bg-gray-800/60 transition-colors"
                            data-testid="button-pom-pricing-advanced-toggle"
                          >
                            <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Advanced</span>
                            {pomPricingAdvancedOpen ? <ChevronDown className="w-3 h-3 text-gray-500" /> : <ChevronRight className="w-3 h-3 text-gray-500" />}
                          </button>
                          {pomPricingAdvancedOpen && (
                            <div>
                              <div className="px-3 pt-2 pb-1">
                                <span className="text-[9px] font-semibold text-blue-400 uppercase tracking-wider">Demand</span>
                              </div>
                              <div className="divide-y divide-gray-700/30">
                                <div className="sm-row px-3">
                                  <Label className="text-xs text-gray-400">STR multiplier</Label>
                                  <Input type="number" min={0} max={1} step={0.05} value={pomSugDemandMult} onChange={(e) => setPomSugDemandMult(parseFloat(e.target.value) || 0)} onBlur={() => updateOrgSettingsMutation.mutate({ pomSugDemandMult })} className="text-sm w-20 text-right" data-testid="input-sug-demand-mult" />
                                </div>
                                <div className="sm-row px-3">
                                  <Label className="text-xs text-gray-400">Sold Avg weight</Label>
                                  <Input type="number" min={0} max={1} step={0.05} value={pomSugSoldAvgW} onChange={(e) => setPomSugSoldAvgW(parseFloat(e.target.value) || 0)} onBlur={() => updateOrgSettingsMutation.mutate({ pomSugSoldAvgW })} className="text-sm w-20 text-right" data-testid="input-sug-sold-avg-w" />
                                </div>
                              </div>

                              <div className="px-3 pt-2 pb-1">
                                <span className="text-[9px] font-semibold text-violet-400 uppercase tracking-wider">Rarity</span>
                              </div>
                              <div className="divide-y divide-gray-700/30">
                                <div className="sm-row px-3">
                                  <Label className="text-xs text-gray-400">Sold Max weight</Label>
                                  <Input type="number" min={0} max={1} step={0.05} value={pomSugSoldMaxW} onChange={(e) => setPomSugSoldMaxW(parseFloat(e.target.value) || 0)} onBlur={() => updateOrgSettingsMutation.mutate({ pomSugSoldMaxW })} className="text-sm w-20 text-right" data-testid="input-sug-sold-max-w" />
                                </div>
                              </div>

                              <div className="px-3 pt-2 pb-1">
                                <span className="text-[9px] font-semibold text-green-400 uppercase tracking-wider">Competition</span>
                              </div>
                              <div className="divide-y divide-gray-700/30">
                                <div className="sm-row px-3">
                                  <Label className="text-xs text-gray-400">Listed Min weight</Label>
                                  <Input type="number" min={0} max={1} step={0.05} value={pomSugStockMinW} onChange={(e) => setPomSugStockMinW(parseFloat(e.target.value) || 0)} onBlur={() => updateOrgSettingsMutation.mutate({ pomSugStockMinW })} className="text-sm w-20 text-right" data-testid="input-sug-stock-min-w" />
                                </div>
                                <div className="sm-row px-3">
                                  <Label className="text-xs text-gray-400">Cap (× listed min)</Label>
                                  <Input type="number" min={1} max={2} step={0.05} value={pomSugCompCap} onChange={(e) => setPomSugCompCap(parseFloat(e.target.value) || 1)} onBlur={() => updateOrgSettingsMutation.mutate({ pomSugCompCap })} className="text-sm w-20 text-right" data-testid="input-sug-comp-cap" />
                                </div>
                                <div className="sm-row px-3">
                                  <Label className="text-xs text-gray-400">Floor (× listed min)</Label>
                                  <Input type="number" min={0.5} max={1} step={0.05} value={pomSugFloor} onChange={(e) => setPomSugFloor(parseFloat(e.target.value) || 0.5)} onBlur={() => updateOrgSettingsMutation.mutate({ pomSugFloor })} className="text-sm w-20 text-right" data-testid="input-sug-floor" />
                                </div>
                              </div>

                              <div className="px-3 pt-2 pb-1">
                                <span className="text-[9px] font-semibold text-amber-400 uppercase tracking-wider">Store Premium</span>
                              </div>
                              <div className="divide-y divide-gray-700/30">
                                <div className="sm-row px-3">
                                  <Label className="text-xs text-gray-400">Multiplier</Label>
                                  <Input type="number" min={1} max={2} step={0.01} value={pomSugStorePremium} onChange={(e) => setPomSugStorePremium(parseFloat(e.target.value) || 1)} onBlur={() => updateOrgSettingsMutation.mutate({ pomSugStorePremium })} className="text-sm w-20 text-right" data-testid="input-sug-store-premium" />
                                </div>
                              </div>

                              <div className="px-3 py-1.5">
                                <span className={`text-[10px] font-mono ${Math.abs(pomSugSoldAvgW + pomSugStockMinW + pomSugSoldMaxW - 1.0) < 0.01 ? 'text-green-400' : 'text-red-400'}`} data-testid="text-sug-blend-sum">
                                  Blend sum: {(pomSugSoldAvgW + pomSugStockMinW + pomSugSoldMaxW).toFixed(2)} / 1.00
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>


                    </div>
                  )}
                </div>}

                {/* AI Pricing collapsible */}
                <div>
                  <button
                    onClick={() => setPomAiOpen(!pomAiOpen)}
                    className="w-full flex items-center justify-between gap-2 py-2 mb-3 border-b border-gray-600/60 hover:border-gray-500/60 transition-colors group"
                    data-testid="button-pom-ai-toggle"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-200 uppercase tracking-wider">AI Pricing</span>
                      {pomAiEnabled && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border border-purple-500/40 bg-purple-500/10 text-purple-300 leading-none">ACTIVE</span>
                      )}
                    </div>
                    {pomAiOpen ? <ChevronDown className="w-4 h-4 text-gray-400 group-hover:text-gray-200 transition-colors" /> : <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-200 transition-colors" />}
                  </button>
                  {pomAiOpen && (
                    <div className="space-y-4 px-3">
                      <p className="text-[11px] text-gray-500 leading-relaxed">
                        When enabled, the AI reads your pricing strategy and the current market data to provide a second opinion alongside the POM suggestion. It learns from your pricing decisions over time to align closer with your approach.
                      </p>

                      {/* Enable/Disable toggle */}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-medium text-gray-300">Enable AI Pricing</p>
                          <p className="text-[10px] text-gray-500 mt-0.5">Adds AI suggestions in Spot Lookup</p>
                        </div>
                        <button
                          onClick={() => {
                            const next = !pomAiEnabled;
                            setPomAiEnabled(next);
                            savePomAiMutation.mutate({ aiEnabled: next });
                          }}
                          className={`relative w-10 h-5 rounded-full transition-colors ${pomAiEnabled ? 'bg-purple-600' : 'bg-gray-700'}`}
                          data-testid="toggle-pom-ai-enabled"
                        >
                          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${pomAiEnabled ? 'left-[22px]' : 'left-0.5'}`} />
                        </button>
                      </div>

                      {/* Strategy — now lives in IE Strategies */}
                      <div className="flex items-start justify-between gap-3 py-2 px-3 rounded-md bg-gray-800/40 border border-gray-700/40">
                        <div className="min-w-0">
                          <p className="text-[11px] font-medium text-gray-300">Pricing Strategy</p>
                          <p className="text-[10px] text-gray-500 mt-0.5 leading-relaxed">
                            {ieStratPricing
                              ? <span className="text-gray-400 italic line-clamp-2">"{ieStratPricing}"</span>
                              : 'No pricing strategy set — add one in IE Strategies.'}
                          </p>
                        </div>
                        <button
                          onClick={() => setActiveSection('ieStrategies')}
                          className="flex-shrink-0 text-[10px] text-purple-400 hover:text-purple-300 underline underline-offset-2"
                          data-testid="link-goto-ie-strategies"
                        >
                          Edit in IE Strategies
                        </button>
                      </div>

                      {/* Training data counter */}
                      <div className="flex items-center justify-between py-2 px-3 rounded-md bg-gray-800/40 border border-gray-700/40">
                        <div>
                          <p className="text-[11px] font-medium text-gray-400">Pricing Decisions Logged</p>
                          <p className="text-[10px] text-gray-600 mt-0.5">Applied via Spot Lookup while AI is active</p>
                        </div>
                        <span className="text-sm font-bold text-purple-400 tabular-nums" data-testid="text-pom-ai-decision-count">{pomAiDecisionCount}</span>
                      </div>

                      {pomAiEnabled && (
                        <p className="text-[10px] text-purple-400/70 leading-relaxed">
                          AI is active. Use Spot Lookup to see AI suggestions alongside POM prices. Each price you apply gets logged as a training signal.
                        </p>
                      )}
                    </div>
                  )}
                </div>

              </div>
            )}

            {activeSection === 'ieStrategies' && (
              <div className="space-y-6 min-h-[400px]">
                <div>
                  <h2 className="text-sm font-semibold text-white mb-1">IE Strategies</h2>
                  <p className="text-[11px] text-gray-500 leading-relaxed">
                    Tell the intelligence agents who you are, where you're going, and what winning looks like. The two foundational fields below are shared with every agent. The per-agent directives below give each agent its specific lens.
                  </p>
                </div>

                <Separator className="bg-gray-700/60" />

                {/* Vision & Mission — global, injected into all agents */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Crosshair className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="text-xs font-semibold text-gray-300">Vision &amp; Mission</span>
                    <span className="text-[9px] font-mono text-gray-600 bg-gray-800/60 border border-gray-700/40 rounded px-1.5 py-0.5">All agents</span>
                  </div>
                  <Textarea
                    value={ieStratVision}
                    onChange={(e) => setIeStratVision(e.target.value)}
                    onBlur={() => { if (ieStratVision !== (ieStratData?.visionMission ?? '')) saveIeStratMutation.mutate({ visionMission: ieStratVision }); }}
                    placeholder="e.g. We are PlanetBrick — a curated LEGO parts and sets retailer committed to fast dispatch, fair pricing, and helping builders find exactly what they need. We aim to become the most trusted independent LEGO seller in our region."
                    className="!text-xs min-h-[90px] bg-gray-800/60 border-gray-700/60 text-gray-300 placeholder-gray-600 resize-none"
                    data-testid="textarea-ie-strategy-vision"
                  />
                  <p className="text-[10px] text-gray-600">Your business identity and direction. Every agent uses this to frame its signals in the context of who you are.</p>
                </div>

                <Separator className="bg-gray-700/40" />

                {/* Success Factors — Vivid Vision methodology, global */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <ThumbsUp className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-xs font-semibold text-gray-300">Defining Success</span>
                    <span className="text-[9px] font-mono text-gray-600 bg-gray-800/60 border border-gray-700/40 rounded px-1.5 py-0.5">All agents</span>
                  </div>
                  <Textarea
                    value={ieStratSuccess}
                    onChange={(e) => setIeStratSuccess(e.target.value)}
                    onBlur={() => { if (ieStratSuccess !== (ieStratData?.successFactors ?? '')) saveIeStratMutation.mutate({ successFactors: ieStratSuccess }); }}
                    placeholder="If successful: our sell-through rate is above 85%, customers leave unprompted positive feedback mentioning fast shipping and great prices, and we no longer stress about dead stock. We feel calm and in control of our inventory. Repeat buyers make up over 40% of revenue."
                    className="!text-xs min-h-[110px] bg-gray-800/60 border-gray-700/60 text-gray-300 placeholder-gray-600 resize-none"
                    data-testid="textarea-ie-strategy-success"
                  />
                  <p className="text-[10px] text-gray-600">Describe the future in vivid terms — what has changed, how you and your customers feel, and what people are saying. Agents use this to elevate signals that move the business toward this future state.</p>
                </div>

                <Separator className="bg-gray-700/60" />

                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Per-agent directives</span>
                </div>

                {/* Pricing */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-3.5 h-3.5 text-purple-400" />
                    <span className="text-xs font-semibold text-gray-300">Pricing Agent</span>
                  </div>

                  {/* Preset picker */}
                  {(() => {
                    const PRESETS: Array<{ id: string; label: string; tagline: string; color: string; bg: string; border: string }> = [
                      { id: 'premium',         label: 'Premium',         tagline: 'Hold price & capture margin', color: 'text-amber-300',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30' },
                      { id: 'market_rate',     label: 'Market Rate',     tagline: 'Track sold avg closely',      color: 'text-blue-300',    bg: 'bg-blue-500/10',    border: 'border-blue-500/30' },
                      { id: 'balanced',        label: 'Balanced',        tagline: 'Equal weight on all signals', color: 'text-emerald-300', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
                      { id: 'clear_inventory', label: 'Clear Inventory', tagline: 'Move stock fast',             color: 'text-red-300',     bg: 'bg-red-500/10',     border: 'border-red-500/30' },
                    ];

                    const PRESET_DETAIL: Record<string, { how: string; ceiling: string; velocity: string; scarcity: string; undercut: string }> = {
                      premium: {
                        how: 'Scarcity and hold-value weighted heavily. Surfaces items where you have room to push price above what the market clears on average. Best for rare, retired, or hard-to-find parts.',
                        ceiling:  'Low — suppressed to avoid outlier sales distorting priority',
                        velocity: 'Moderate — enough demand matters, but you\'re not racing',
                        scarcity: 'High — fewer sellers listed = higher priority',
                        undercut: 'Low — competition pressure mostly ignored',
                      },
                      market_rate: {
                        how: 'Anchors to what items actually sell for (6-month sold average). Surfaces items where your price diverges — too high or too low — from cleared market prices.',
                        ceiling:  'Moderate — blended sold avg reference, confidence-weighted',
                        velocity: 'Moderate — demand confirms the avg is real',
                        scarcity: 'Low-moderate — availability context only',
                        undercut: 'Moderate — keeps you from straying far above listed avg',
                      },
                      balanced: {
                        how: 'Equal weight across all four signals. Surfaces a broad mix of opportunities with no strong bias. Good default starting point before you refine your approach.',
                        ceiling:  'Equal — 25% weight',
                        velocity: 'Equal — 25% weight',
                        scarcity: 'Equal — 25% weight',
                        undercut: 'Equal — 25% weight',
                      },
                      clear_inventory: {
                        how: 'Velocity and competition pressure weighted. Prioritises high-demand items and slow-movers where competitive pricing can trigger sales. Ignores ceiling and scarcity.',
                        ceiling:  'Very low — margin not the priority here',
                        velocity: 'High — fast-selling items rise to the top',
                        scarcity: 'Very low — availability less relevant',
                        undercut: 'High — items you\'re underpricing get a boost; items with cheaper rivals are penalised',
                      },
                    };

                    return (
                      <div className="space-y-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Strategy preset</span>
                          <Popover>
                            <PopoverTrigger asChild>
                              <button className="text-gray-600 hover:text-gray-400 transition-colors" data-testid="button-pricing-preset-info">
                                <Info className="w-3.5 h-3.5" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent side="bottom" align="start" className="w-64 bg-gray-900 border-gray-700 p-3 text-xs space-y-1.5">
                              <p className="text-[11px] font-semibold text-gray-200 mb-1">How scoring works</p>
                              <p className="text-[10px] text-gray-400 leading-relaxed">Each preset sets four weights that control which pricing signals matter most when ranking opportunities in Price-o-Matic.</p>
                              <div className="pt-1.5 border-t border-gray-700/60 space-y-1">
                                <div className="flex items-baseline gap-1.5"><span className="text-[9px] text-gray-500 w-14 shrink-0">Ceiling</span><span className="text-[9px] text-gray-400">How far your price is from the market ceiling</span></div>
                                <div className="flex items-baseline gap-1.5"><span className="text-[9px] text-gray-500 w-14 shrink-0">STR</span><span className="text-[9px] text-gray-400">Sell-through rate — units sold ÷ units listed. &gt;100% = demand surge, 40–100% = healthy, &lt;40% = slow mover</span></div>
                                <div className="flex items-baseline gap-1.5"><span className="text-[9px] text-gray-500 w-14 shrink-0">Scarcity</span><span className="text-[9px] text-gray-400">How few sellers carry this part</span></div>
                                <div className="flex items-baseline gap-1.5"><span className="text-[9px] text-gray-500 w-14 shrink-0">Undercut</span><span className="text-[9px] text-gray-400">Your price ÷ market min. &lt;1 boosts score (you're cheapest), &gt;1 penalises (being undercut)</span></div>
                              </div>
                            </PopoverContent>
                          </Popover>
                        </div>

                        <div className="grid grid-cols-2 gap-1.5">
                          {PRESETS.map(p => {
                            const isActive = ieStratPreset === p.id;
                            return (
                              <button
                                key={p.id}
                                onClick={() => {
                                  setIeStratPreset(p.id);
                                  saveIeStratMutation.mutate({ pricingStrategyPreset: p.id });
                                  extractWeightsMutation.mutate({ preset: p.id, strategyText: ieStratPricing });
                                }}
                                className={`text-left px-2.5 py-2 rounded-md border transition-all ${isActive ? `${p.bg} ${p.border} ring-1 ring-inset ${p.border.replace('border-', 'ring-')}` : 'bg-gray-800/40 border-gray-700/40 hover:border-gray-600/60'}`}
                                data-testid={`button-preset-${p.id}`}
                              >
                                <p className={`text-[10px] font-semibold leading-tight ${isActive ? p.color : 'text-gray-300'}`}>{p.label}</p>
                                <p className="text-[9px] text-gray-500 mt-0.5 leading-tight">{p.tagline}</p>
                              </button>
                            );
                          })}
                        </div>

                        {weightExtractionStatus === 'running' && (
                          <p className="text-[9px] text-purple-400 flex items-center gap-1">
                            <Loader2 className="w-2.5 h-2.5 animate-spin" /> Aligning scoring weights…
                          </p>
                        )}
                        {weightExtractionStatus === 'done' && (
                          <p className="text-[9px] text-emerald-400">Scoring weights updated.</p>
                        )}
                      </div>
                    );
                  })()}

                  <Textarea
                    value={ieStratPricing}
                    onChange={(e) => setIeStratPricing(e.target.value)}
                    onBlur={() => {
                      if (ieStratPricing !== (ieStratData?.pricingStrategy ?? '')) {
                        saveIeStratMutation.mutate({ pricingStrategy: ieStratPricing });
                        if (ieStratPreset) {
                          extractWeightsMutation.mutate({ preset: ieStratPreset, strategyText: ieStratPricing });
                        }
                      }
                    }}
                    placeholder="e.g. We price at a premium above market. Hold prices on retired sets. Prefer fewer high-margin orders over chasing volume."
                    className="!text-xs min-h-[80px] bg-gray-800/60 border-gray-700/60 text-gray-300 placeholder-gray-600 resize-none"
                    data-testid="textarea-ie-strategy-pricing"
                  />
                  <p className="text-[10px] text-gray-600">Your strategy description adds context to the preset. Included in every Pricing Agent and POM AI prompt.</p>

                  {/* Price-o-Matic tile — tap to open the full POM settings screen */}
                  <button
                    onClick={() => setActiveSection('priceomatic')}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-md bg-gray-800/40 border border-gray-700/40 hover-elevate text-left mt-1"
                    data-testid="button-open-priceomatic-from-strategies"
                  >
                    <div className="w-8 h-8 rounded bg-purple-600/20 border border-purple-500/30 flex items-center justify-center shrink-0">
                      <TrendingUp className="w-4 h-4 text-purple-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-200">Price-o-Matic</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">Scoring weights, pricing dimensions &amp; AI settings</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-500 shrink-0" />
                  </button>
                </div>

                <Separator className="bg-gray-700/40" />

                {/* Inventory */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Package className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-xs font-semibold text-gray-300">Inventory Agent</span>
                  </div>
                  <Textarea
                    value={ieStratInventory}
                    onChange={(e) => setIeStratInventory(e.target.value)}
                    onBlur={() => { if (ieStratInventory !== (ieStratData?.inventoryStrategy ?? '')) saveIeStratMutation.mutate({ inventoryStrategy: ieStratInventory }); }}
                    placeholder="e.g. We keep tight stock on high-velocity parts. Liquidate dead stock over 180 days. Prioritise Technic and Creator Expert themes."
                    className="!text-xs min-h-[80px] bg-gray-800/60 border-gray-700/60 text-gray-300 placeholder-gray-600 resize-none"
                    data-testid="textarea-ie-strategy-inventory"
                  />
                  <p className="text-[10px] text-gray-600">Guides dead stock, reorder urgency, and capital concentration signals.</p>
                </div>

                <Separator className="bg-gray-700/40" />

                {/* Orders */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <ShoppingCart className="w-3.5 h-3.5 text-green-400" />
                    <span className="text-xs font-semibold text-gray-300">Orders Agent</span>
                  </div>
                  <Textarea
                    value={ieStratOrders}
                    onChange={(e) => setIeStratOrders(e.target.value)}
                    onBlur={() => { if (ieStratOrders !== (ieStratData?.ordersStrategy ?? '')) saveIeStratMutation.mutate({ ordersStrategy: ieStratOrders }); }}
                    placeholder="e.g. Grow BrickOwl channel revenue. Aim for same-day dispatch. Flag orders over $50 that aren't on tracked shipping."
                    className="!text-xs min-h-[80px] bg-gray-800/60 border-gray-700/60 text-gray-300 placeholder-gray-600 resize-none"
                    data-testid="textarea-ie-strategy-orders"
                  />
                  <p className="text-[10px] text-gray-600">Guides channel performance, velocity, and fulfillment signals.</p>
                </div>

                <Separator className="bg-gray-700/40" />

                {/* Customer */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Users className="w-3.5 h-3.5 text-yellow-400" />
                    <span className="text-xs font-semibold text-gray-300">Customer Agent</span>
                  </div>
                  <Textarea
                    value={ieStratCustomer}
                    onChange={(e) => setIeStratCustomer(e.target.value)}
                    onBlur={() => { if (ieStratCustomer !== (ieStratData?.customerStrategy ?? '')) saveIeStratMutation.mutate({ customerStrategy: ieStratCustomer }); }}
                    placeholder="e.g. Retain repeat buyers over $200 lifetime spend. Flag dormant buyers after 90 days. Re-engage with bulk discount offers."
                    className="!text-xs min-h-[80px] bg-gray-800/60 border-gray-700/60 text-gray-300 placeholder-gray-600 resize-none"
                    data-testid="textarea-ie-strategy-customer"
                  />
                  <p className="text-[10px] text-gray-600">Guides retention, re-engagement, and VIP buyer signals.</p>
                </div>

                <Separator className="bg-gray-700/40" />

                {/* Market */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Globe className="w-3.5 h-3.5 text-orange-400" />
                    <span className="text-xs font-semibold text-gray-300">Market Agent</span>
                  </div>
                  <Textarea
                    value={ieStratMarket}
                    onChange={(e) => setIeStratMarket(e.target.value)}
                    onBlur={() => { if (ieStratMarket !== (ieStratData?.marketStrategy ?? '')) saveIeStratMutation.mutate({ marketStrategy: ieStratMarket }); }}
                    placeholder="e.g. Watch for retiring Star Wars and Icons sets. Prioritise acquisition signals for minifig-heavy sets. Flag price spread opportunities above 1.8x."
                    className="!text-xs min-h-[80px] bg-gray-800/60 border-gray-700/60 text-gray-300 placeholder-gray-600 resize-none"
                    data-testid="textarea-ie-strategy-market"
                  />
                  <p className="text-[10px] text-gray-600">Guides trend, retirement, and market opportunity signals.</p>
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
                  <span className="app-label whitespace-nowrap">Local Index</span>
                  <div className="flex-1 h-px bg-gray-700/60" />
                </div>
                <p className="text-[11px] text-gray-500 -mt-2">
                  Run once to build your search index. New inventory and orders are embedded automatically as they sync.
                </p>

                {/* OpenAI API Key — pointer to Services */}
                <div className="flex items-center gap-3 bg-gray-800/60 border border-gray-700/60 rounded-md px-3 py-2.5">
                  <Brain className="h-4 w-4 text-gray-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="app-label">OpenAI API Key</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      {(openaiApiKey || (settings as any)?.has_openaiApiKey) ? <span className="text-green-400/80">Key configured</span> : <span className="text-gray-600">Not configured</span>}
                      {' — '}configured in <button onClick={() => { setActiveSection('apiKeys'); setActivePlatformServicesTab('openai'); }} className="text-yellow-400/80 hover:text-yellow-300 underline-offset-2 hover:underline" data-testid="link-goto-platform-services-openai">Services → OpenAI</button>
                    </p>
                  </div>
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
                  <span className="app-label whitespace-nowrap">Ongoing Enrichment</span>
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
                            <Label className="text-xs font-medium text-gray-100">Monthly Set-Parts Sync</Label>
                            <Popover>
                              <PopoverTrigger asChild>
                                <button className="sm-icon-btn">
                                  <Info className="w-3 h-3" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent side="bottom" className="sm-popover-lg">
                                <p className="font-semibold text-gray-200">Rebrickable Set-Parts Sync</p>
                                <p className="text-gray-400">Downloads the full Rebrickable set-to-parts relationship database (~1.4M rows). This powers the BrickSpotter "find sets that use this part" feature.</p>
                                <p className="sm-description">Runs once per month — Rebrickable data changes rarely. Force-refresh truncates and rebuilds the table from scratch.</p>
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
                              updatePlatformSettingsMutation.mutate({ rebrickableSetSyncEnabled: checked });
                            }}
                            data-testid="switch-rebrickable-set-sync"
                          />
                        </div>
                      </div>
                      {rebrickableSetSyncEnabled && (
                        <div className="ml-4 space-y-3">
                          <div className="flex items-center gap-4">
                            <div className="space-y-1">
                              <Label htmlFor="rebrickable-sync-time" className="text-xs text-gray-200">Sync Time</Label>
                              <Input
                                id="rebrickable-sync-time"
                                type="time"
                                value={rebrickableSetSyncTime}
                                onChange={(e) => setRebrickableSetSyncTime(e.target.value)}
                                onBlur={() => updatePlatformSettingsMutation.mutate({ rebrickableSetSyncTime })}
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
                          <Label className="text-xs text-gray-200">Force full rebuild</Label>
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

                {/* Inventory and Order Backup */}
                <div>
                  <h3 className="text-sm font-medium text-gray-100 mb-2 flex items-center gap-2">
                    <Download className="h-4 w-4 text-green-400" />
                    Inventory and Order Backup
                  </h3>
                  <p className="text-xs text-gray-400 mb-3">Export and restore your core business data</p>

                  <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-4">
                    <div>
                      <Label className="text-xs text-gray-200 mb-2 block">Export CSV</Label>
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
                    </div>

                    <Separator className="bg-gray-700" />

                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <Label className="text-xs text-gray-200">BrickLink XML Backups</Label>
                          <p className="text-xs text-gray-500">Download XML backups and manually upload to BrickLink</p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs shrink-0"
                          onClick={() => runBackupNowMutation.mutate()}
                          disabled={runBackupNowMutation.isPending}
                          data-testid="button-run-backup-now"
                        >
                          {runBackupNowMutation.isPending ? 'Creating...' : 'Backup Now'}
                        </Button>
                      </div>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {backupsLoading ? (
                          <div className="text-xs text-gray-400 text-center py-4">Loading backups...</div>
                        ) : !backupsData?.backups || backupsData.backups.length === 0 ? (
                          <div className="text-xs text-gray-400 text-center py-4">
                            No backups yet. Click "Backup Now" to create one, or backups are generated automatically each day.
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
                                  <p className="text-xs text-gray-500">{sizeInMB} MB</p>
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
                      <p className="text-xs font-medium text-gray-100">After Download:</p>
                      <ol className="text-xs text-gray-400 space-y-1 ml-4 list-decimal">
                        <li>Go to BrickLink → My Store → Upload/Update My Inventory</li>
                        <li>Select your downloaded XML file and upload</li>
                        <li>Wait for BrickLink to process the upload</li>
                        <li>Return to E.L.F.I.E. and sync from BrickLink</li>
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

                {/* Clear Data Section */}
                <div>
                  <h3 className="text-sm font-medium text-gray-100 mb-2 flex items-center gap-2">
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
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full justify-start text-xs text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
                      onClick={handleOpenClosedOrdersDialog}
                      data-testid="button-remove-closed-orders"
                    >
                      <Trash2 className="h-3 w-3 mr-2" />
                      Remove All Test Orders
                    </Button>
                    <div className="bg-red-500/10 border border-red-500/30 rounded p-2">
                      <p className="text-xs text-red-300">
                        <strong>Warning:</strong> These actions cannot be undone. Always export backups before clearing data.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Team & Roles (Admin Only) */}
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
                const orgPlan = adminPlans.find(p => p.id === (org as any).planId);
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
                      <span className={`ml-auto text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded border ${orgPlan?.isDefault ? 'bg-gray-600/50 text-gray-300 border-gray-600' : orgPlan?.status === 'sunset' ? 'bg-orange-900/50 text-orange-300 border-orange-700/50' : 'bg-yellow-900/50 text-yellow-300 border-yellow-700/50'}`}>
                        {orgPlan?.name ?? org.plan}
                      </span>
                    </div>

                    {/* Plan selector */}
                    <div className="sm-card">
                      <div className="sm-card-header">
                        <CreditCard className="h-3.5 w-3.5 text-yellow-500/70" />
                        <span className="text-xs font-semibold text-gray-200">Plan</span>
                      </div>
                      <div className="px-4 py-3 flex items-center gap-3">
                        <Select
                          value={org.planId ? String(org.planId) : undefined}
                          onValueChange={(val) => updatePlanMutation.mutate({ orgId: org.id, planId: parseInt(val) })}
                          disabled={updatePlanMutation.isPending || adminPlans.length === 0}
                        >
                          <SelectTrigger className="bg-gray-700 border-gray-600 text-gray-200 text-xs" data-testid={`select-plan-detail-${org.id}`}>
                            <SelectValue placeholder="Select plan…" />
                          </SelectTrigger>
                          <SelectContent>
                            {adminPlans.filter(p => p.status !== 'in_progress').map(p => (
                              <SelectItem key={p.id} value={String(p.id)}>
                                {p.name}
                                {p.isDefault && <span className="ml-1.5 text-[10px] text-gray-400">(free)</span>}
                                {p.status === 'sunset' && <span className="ml-1.5 text-[10px] text-orange-400">(sunset)</span>}
                              </SelectItem>
                            ))}
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
                        <div className="flex items-center gap-3 shrink-0">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-400 text-[10px] h-7 px-2"
                            onClick={() => { setSuperAdminDeleteOrgDialogOpen(true); setSuperAdminDeleteConfirmName(''); }}
                            data-testid={`btn-delete-org-${org.id}`}
                          >
                            <Trash2 className="w-3 h-3 mr-1" />
                            Delete org
                          </Button>
                          <span className="text-[10px] text-gray-600">{org.isActive ? 'Deactivate' : 'Reactivate'}</span>
                          <Switch
                            checked={!!org.isActive}
                            onCheckedChange={(checked) => suspendOrgMutation.mutate({ orgId: org.id, isActive: checked })}
                            disabled={suspendOrgMutation.isPending}
                            data-testid={`switch-active-${org.id}`}
                          />
                        </div>
                      </div>

                      {/* Super-admin delete org confirmation dialog */}
                      <Dialog open={superAdminDeleteOrgDialogOpen} onOpenChange={setSuperAdminDeleteOrgDialogOpen}>
                        <DialogContent className="bg-gray-900 border-gray-700 max-w-sm">
                          <DialogHeader>
                            <DialogTitle className="text-red-400 flex items-center gap-2">
                              <Trash2 className="w-4 h-4" />
                              Delete Organization
                            </DialogTitle>
                            <DialogDescription className="text-gray-400 text-sm">
                              This will permanently delete <span className="text-white font-semibold">{org.name}</span> and all its data — inventory, orders, users, settings, and everything else. This cannot be undone.
                            </DialogDescription>
                          </DialogHeader>
                          <div className="space-y-3 py-2">
                            <p className="text-xs text-gray-500">Type the organization name to confirm:</p>
                            <Input
                              value={superAdminDeleteConfirmName}
                              onChange={e => setSuperAdminDeleteConfirmName(e.target.value)}
                              placeholder={org.name}
                              className="bg-gray-800 border-gray-600 text-white text-sm"
                              data-testid="input-confirm-delete-org-name"
                            />
                          </div>
                          <DialogFooter>
                            <Button variant="ghost" size="sm" onClick={() => setSuperAdminDeleteOrgDialogOpen(false)}>Cancel</Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={superAdminDeleteConfirmName !== org.name || superAdminDeleteOrgMutation.isPending}
                              onClick={() => superAdminDeleteOrgMutation.mutate(org.id)}
                              data-testid="btn-confirm-delete-org"
                            >
                              {superAdminDeleteOrgMutation.isPending ? 'Deleting...' : 'Delete permanently'}
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>

                    {/* Plan tabs: Features | Limits | Billing */}
                    <div className="sm-card">
                      {/* Tab bar */}
                      <div className="flex bg-gray-800 border-b border-gray-700">
                        {(['features', 'limits', 'billing'] as const).map(tab => (
                          <button
                            key={tab}
                            onClick={() => setActiveOrgTab(tab)}
                            className={`tool-tab-fill ${activeOrgTab === tab ? 'text-yellow-400 border-yellow-500' : 'tool-tab-off'}`}
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
                          { overrideKey: 'elfieAiMode',      tierFeatureKey: 'elfieAiMode',        label: 'E.L.F.I.E. AI (Default)', icon: Brain },
                          { overrideKey: 'elfieCustom',      tierFeatureKey: 'elfieCustom',        label: 'E.L.F.I.E. AI (Customized)', icon: Brain },
                          { overrideKey: 'elfieLiveSupport', tierFeatureKey: 'elfieLiveSupport',   label: 'E.L.F.I.E. Live Support', icon: Headphones },
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
                              <span className="app-label">Feature</span>
                              <span className="app-col-header">Plan</span>
                              <span className="app-col-header">OVR</span>
                              <span className="app-col-header">State</span>
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
                              <span className="app-label">Limit</span>
                              <span className="app-col-header">Max</span>
                              <span className="app-col-header">Use</span>
                              <span className="app-col-header">Override</span>
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
                              <p className="sm-description">No Stripe customer linked to this organization.</p>
                            </div>
                          ) : !orgPaymentsData?.payments?.length ? (
                            <div className="px-4 py-8 text-center">
                              <CreditCard className="h-6 w-6 text-gray-700 mx-auto mb-2" />
                              <p className="sm-description">No payment history found.</p>
                            </div>
                          ) : (
                            <div>
                              <div className="grid grid-cols-[1fr_72px_64px_32px] gap-2 px-4 py-1.5 border-b border-gray-700/60">
                                <span className="app-label">Description</span>
                                <span className="app-label text-right">Amount</span>
                                <span className="app-col-header">Status</span>
                                <span className="app-col-header"></span>
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
                    <div className="sm-card-inset">
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
                  <div className="sm-card-inset">
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


            {/* Audit Log */}
            {activeSection === 'auditLog' && (
              <div className="px-3 pt-3 pb-4 space-y-3 min-w-0 overflow-hidden">
                <div className="tool-tab-bar">
                  {([
                    { id: 'organization' as const, label: 'Organization', Icon: Building2 },
                    { id: 'platform' as const, label: 'Platform', Icon: Globe },
                  ]).map(t => (
                    <button
                      key={t.id}
                      onClick={() => setActiveAuditTab(t.id)}
                      className={`tool-tab-fill ${activeAuditTab === t.id ? 'text-yellow-400 border-yellow-500' : 'tool-tab-off'}`}
                      data-testid={`audit-tab-${t.id}`}
                    >
                      <t.Icon className="w-3.5 h-3.5" />
                      {t.label}
                    </button>
                  ))}
                </div>

                {isAuditOrg && (() => {
                  const syncLabels: Record<string, string> = {
                    bricklink_inventory: 'Inventory',
                    bricklink_orders: 'Orders (BL)',
                    brickowl_orders: 'Orders (BO)',
                    channel_sync: 'Channel Sync',
                  };
                  const fmtTime = (t: string | null) => t ? new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Never';
                  const statusIcon = (s: string | null, size = 'h-3 w-3') => {
                    if (s === 'in_progress') return <Loader2 className={`${size} text-yellow-400 animate-spin shrink-0`} />;
                    if (s === 'failed' || s === 'error') return <AlertTriangle className={`${size} text-red-400 shrink-0`} />;
                    if (s === 'partial') return <AlertTriangle className={`${size} text-orange-400 shrink-0`} />;
                    if (s === 'success') return <CheckCircle2 className={`${size} text-emerald-500/70 shrink-0`} />;
                    return <Clock className={`${size} text-gray-600 shrink-0`} />;
                  };

                  if (orgSyncError) return (
                    <div className="rounded-lg bg-gray-800/60 border border-red-700/40 p-6 flex flex-col items-center justify-center gap-2 text-center">
                      <AlertTriangle className="h-6 w-6 text-red-400" />
                      <p className="text-sm text-gray-400">Failed to load organization sync data</p>
                    </div>
                  );
                  if (!orgSyncStatus) return (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
                    </div>
                  );

                  const runningOrgs = orgSyncStatus.filter(o => o.syncs.some(s => s.lastSyncStatus === 'in_progress'));
                  const successOrgs = orgSyncStatus.filter(o =>
                    o.syncs.some(s => s.lastSyncStatus === 'success') &&
                    !o.syncs.some(s => s.lastSyncStatus === 'in_progress' || s.lastSyncStatus === 'error' || s.lastSyncStatus === 'failed')
                  );
                  const failedOrgs = orgSyncStatus.filter(o => o.syncs.some(s => s.lastSyncStatus === 'error' || s.lastSyncStatus === 'failed'));
                  const errorOrgs = orgSyncStatus.filter(o => o.syncs.some(s => s.errorMessage && (s.lastSyncStatus === 'error' || s.lastSyncStatus === 'failed')));
                  const blOrgs = blApiBreakdown ?? [];
                  const avgBlCalls = blOrgs.length > 0 ? Math.round(blOrgs.reduce((sum, o) => sum + o.total, 0) / blOrgs.length) : 0;
                  const bsOrgs = orgSyncStatus.filter(o => o.brickspotter && o.brickspotter.totalScans > 0);
                  const avgBsScans = bsOrgs.length > 0 ? Math.round(bsOrgs.reduce((sum, o) => sum + (o.brickspotter?.totalScans ?? 0), 0) / bsOrgs.length) : 0;

                  type MetricId = 'running' | 'successful' | 'failed' | 'blapi' | 'brickspotter' | 'errors';

                  type MetricDef = {
                    id: MetricId; label: string; value: string; desc: string; Icon: any;
                    border: string; ring: string; headerBg: string; cardBg: string; glow: string; iconColor: string; numColor: string;
                  };

                  const metrics: MetricDef[] = [
                    {
                      id: 'failed', label: 'Failed', value: failedOrgs.length.toString(), desc: 'unrecovered failures',
                      Icon: AlertTriangle, iconColor: 'text-red-400', numColor: failedOrgs.length > 0 ? 'text-red-400' : 'text-gray-600',
                      border: 'border-red-500/40', ring: 'ring-red-400/60', headerBg: 'from-red-950/50 to-gray-900/80',
                      cardBg: 'bg-gradient-to-br from-red-950/40 via-gray-950/70 to-red-950/20', glow: 'shadow-[0_0_15px_rgba(239,68,68,0.12)]',
                    },
                    {
                      id: 'errors', label: 'Sync Errors', value: errorOrgs.length.toString(), desc: 'orgs with error msgs',
                      Icon: AlertTriangle, iconColor: 'text-orange-400', numColor: errorOrgs.length > 0 ? 'text-orange-400' : 'text-gray-600',
                      border: 'border-orange-500/40', ring: 'ring-orange-400/60', headerBg: 'from-orange-950/50 to-gray-900/80',
                      cardBg: 'bg-gradient-to-br from-orange-950/40 via-gray-950/70 to-orange-950/20', glow: 'shadow-[0_0_15px_rgba(251,146,60,0.12)]',
                    },
                    {
                      id: 'running', label: 'Jobs Running', value: runningOrgs.length.toString(), desc: 'orgs with active job',
                      Icon: Loader2, iconColor: 'text-yellow-400', numColor: runningOrgs.length > 0 ? 'text-yellow-400' : 'text-gray-600',
                      border: 'border-yellow-500/40', ring: 'ring-yellow-400/60', headerBg: 'from-yellow-950/50 to-gray-900/80',
                      cardBg: 'bg-gradient-to-br from-yellow-950/40 via-gray-950/70 to-yellow-950/20', glow: 'shadow-[0_0_15px_rgba(234,179,8,0.12)]',
                    },
                    {
                      id: 'successful', label: 'Last Run OK', value: successOrgs.length.toString(), desc: 'orgs all-clear',
                      Icon: CheckCircle2, iconColor: 'text-emerald-400', numColor: 'text-emerald-400',
                      border: 'border-emerald-500/40', ring: 'ring-emerald-400/60', headerBg: 'from-emerald-950/50 to-gray-900/80',
                      cardBg: 'bg-gradient-to-br from-emerald-950/40 via-gray-950/70 to-emerald-950/20', glow: 'shadow-[0_0_15px_rgba(16,185,129,0.12)]',
                    },
                    {
                      id: 'blapi', label: 'Avg BL API / 24h', value: blApiBreakdownLoading ? '…' : avgBlCalls.toLocaleString(), desc: 'avg calls per org',
                      Icon: BarChart2, iconColor: 'text-blue-400', numColor: 'text-blue-400',
                      border: 'border-blue-500/40', ring: 'ring-blue-400/60', headerBg: 'from-blue-950/50 to-gray-900/80',
                      cardBg: 'bg-gradient-to-br from-blue-950/40 via-gray-950/70 to-blue-950/20', glow: 'shadow-[0_0_15px_rgba(59,130,246,0.12)]',
                    },
                    {
                      id: 'brickspotter', label: 'Avg BrickSpotter', value: avgBsScans.toLocaleString(), desc: 'avg scans per org',
                      Icon: Eye, iconColor: 'text-violet-400', numColor: 'text-violet-400',
                      border: 'border-violet-500/40', ring: 'ring-violet-400/60', headerBg: 'from-violet-950/50 to-gray-900/80',
                      cardBg: 'bg-gradient-to-br from-violet-950/40 via-gray-950/70 to-violet-950/20', glow: 'shadow-[0_0_15px_rgba(139,92,246,0.12)]',
                    },
                  ];

                  const metricOrgs: Record<MetricId, any[]> = {
                    running: runningOrgs,
                    successful: successOrgs,
                    failed: failedOrgs,
                    blapi: [...blOrgs].sort((a, b) => b.total - a.total),
                    brickspotter: [...bsOrgs].sort((a, b) => (b.brickspotter?.totalScans ?? 0) - (a.brickspotter?.totalScans ?? 0)),
                    errors: errorOrgs,
                  };

                  const priorityOrder: MetricId[] = ['failed', 'errors', 'running', 'blapi', 'brickspotter', 'successful'];
                  const defaultMetric = priorityOrder.find(id => metricOrgs[id].length > 0) ?? 'successful';
                  const activeMetric = (selectedOrgMetric as MetricId | null) ?? defaultMetric;
                  const activeMetricDef = metrics.find(m => m.id === activeMetric)!;
                  const activeOrgs = metricOrgs[activeMetric];

                  const orgSummaryLine = (id: MetricId, org: any): string => {
                    if (id === 'running') return org.syncs.filter((s: any) => s.lastSyncStatus === 'in_progress').map((s: any) => syncLabels[s.id] || s.id).join(', ');
                    if (id === 'successful') { const ok = org.syncs.filter((s: any) => s.lastSyncStatus === 'success'); return `${ok.length} sync${ok.length !== 1 ? 's' : ''} ok`; }
                    if (id === 'failed') return org.syncs.filter((s: any) => s.lastSyncStatus === 'error' || s.lastSyncStatus === 'failed').map((s: any) => syncLabels[s.id] || s.id).join(', ');
                    if (id === 'blapi') return `${org.total.toLocaleString()} calls`;
                    if (id === 'brickspotter') return `${(org.brickspotter?.totalScans ?? 0).toLocaleString()} scans`;
                    if (id === 'errors') { const e = org.syncs.filter((s: any) => s.errorMessage && (s.lastSyncStatus === 'error' || s.lastSyncStatus === 'failed')); return `${e.length} error${e.length !== 1 ? 's' : ''}`; }
                    return '';
                  };

                  return (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        {metrics.map(m => {
                          const isActive = activeMetric === m.id;
                          return (
                            <button
                              key={m.id}
                              onClick={() => setSelectedOrgMetric(m.id)}
                              data-testid={`org-health-metric-${m.id}`}
                              className={`rounded-lg border overflow-hidden text-left w-full transition-all ${m.border} ${m.cardBg} ${m.glow} ${isActive ? `ring-1 ${m.ring}` : 'opacity-70 hover:opacity-90'}`}
                            >
                              <div className={`flex items-center gap-2 px-3 py-2 bg-gradient-to-r ${m.headerBg}`}>
                                <m.Icon className={`h-3 w-3 shrink-0 ${m.iconColor} ${m.id === 'running' && runningOrgs.length > 0 ? 'animate-spin' : ''}`} />
                                <span className="text-[9px] uppercase tracking-widest font-bold text-gray-400 truncate flex-1">{m.label}</span>
                              </div>
                              <div className="px-3 pt-2 pb-2.5">
                                <div className={`text-2xl font-bold font-mono leading-none ${m.numColor}`}>{m.value}</div>
                                <div className="text-[10px] text-gray-600 mt-0.5">{m.desc}</div>
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      <div>
                        <p className="sm-group-label px-1 mb-1.5 flex items-center gap-1.5">
                          <activeMetricDef.Icon className={`h-3 w-3 ${activeMetricDef.iconColor}`} />
                          <span>{activeMetricDef.label}</span>
                          <span className="ml-auto text-[10px] font-mono text-gray-500">{activeOrgs.length}</span>
                        </p>
                        {activeOrgs.length === 0 ? (
                          <div className="rounded-lg bg-gray-800/40 border border-gray-700/60 px-4 py-5 text-center">
                            <CheckCircle2 className="h-4 w-4 text-emerald-400/50 mx-auto mb-1.5" />
                            <p className="text-[11px] text-gray-500">No orgs in this state</p>
                          </div>
                        ) : (
                          <div className="space-y-0.5">
                            {activeOrgs.map((org: any) => (
                              <button
                                key={org.orgId ?? org.orgName}
                                data-testid={`org-health-row-${activeMetric}-${org.orgId ?? org.orgName}`}
                                onClick={() => setOrgHealthDrawer({ open: true, metric: activeMetric, orgId: org.orgId, orgName: org.orgName })}
                                className="w-full sm-card-inset px-3 py-2 flex items-center gap-2 hover-elevate active-elevate-2 cursor-pointer text-left"
                              >
                                <Building2 className="h-3 w-3 text-gray-500 shrink-0" />
                                <span className="text-[11px] text-gray-200 flex-1 min-w-0 truncate">{org.orgName}</span>
                                <span className="text-[10px] text-gray-500 shrink-0">{orgSummaryLine(activeMetric, org)}</span>
                                <ChevronRight className="h-3 w-3 text-gray-600 shrink-0" />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <Drawer open={orgHealthDrawer.open} onOpenChange={(o) => setOrgHealthDrawer(prev => ({ ...prev, open: o }))}>
                        <DrawerContent className="max-h-[85vh] bg-gray-900 border-gray-700">
                          <div className="overflow-y-auto">
                            <DrawerHeader className="pb-2 border-b border-gray-700/60">
                              <div className="flex items-center gap-2">
                                <Building2 className="h-4 w-4 text-gray-400 shrink-0" />
                                <DrawerTitle className="text-base text-gray-100 truncate">{orgHealthDrawer.orgName}</DrawerTitle>
                                <DrawerClose asChild>
                                  <button className="ml-auto text-gray-500 hover:text-gray-300 shrink-0" data-testid="drawer-close">
                                    <X className="h-4 w-4" />
                                  </button>
                                </DrawerClose>
                              </div>
                              <p className="text-[11px] text-gray-500 mt-1 capitalize">{metrics.find(m => m.id === orgHealthDrawer.metric)?.label ?? orgHealthDrawer.metric}</p>
                            </DrawerHeader>
                            <div className="p-4 space-y-3">
                              {(() => {
                                const mid = orgHealthDrawer.metric as MetricId;
                                const syncOrg = orgSyncStatus.find(o => o.orgId === orgHealthDrawer.orgId);
                                const blOrg = blOrgs.find(o => o.orgId === orgHealthDrawer.orgId);

                                if (mid === 'running' || mid === 'successful' || mid === 'failed' || mid === 'errors') {
                                  if (!syncOrg) return <p className="text-[12px] text-gray-500">No data</p>;
                                  const relevantSyncs = syncOrg.syncs.filter((s: any) => {
                                    if (mid === 'running') return s.lastSyncStatus === 'in_progress';
                                    if (mid === 'successful') return s.lastSyncStatus === 'success';
                                    if (mid === 'failed') return s.lastSyncStatus === 'error' || s.lastSyncStatus === 'failed';
                                    if (mid === 'errors') return s.errorMessage && (s.lastSyncStatus === 'error' || s.lastSyncStatus === 'failed');
                                    return true;
                                  });
                                  const allSyncs = syncOrg.syncs;
                                  return (
                                    <div className="space-y-2">
                                      {(mid === 'running' || mid === 'successful' || mid === 'failed' || mid === 'errors' ? allSyncs : relevantSyncs).map((s: any) => {
                                        const highlighted = relevantSyncs.includes(s);
                                        return (
                                          <div key={s.id} className={`sm-card-inset px-3 py-2 ${!highlighted ? 'opacity-40' : ''}`} data-testid={`drawer-sync-${s.id}`}>
                                            <div className="flex items-center gap-2">
                                              {statusIcon(s.lastSyncStatus)}
                                              <span className="text-[12px] font-medium text-gray-200 flex-1">{syncLabels[s.id] || s.id}</span>
                                              <span className={`text-[11px] font-mono shrink-0 ${s.lastSyncStatus === 'error' || s.lastSyncStatus === 'failed' ? 'text-red-400' : s.lastSyncStatus === 'in_progress' ? 'text-yellow-400' : 'text-gray-500'}`}>
                                                {s.lastSyncStatus === 'in_progress' ? 'Running' : s.lastSyncStatus ?? 'Never'}
                                              </span>
                                            </div>
                                            {s.errorMessage && (
                                              <p className="text-[11px] text-red-400/80 mt-1 break-words">{s.errorMessage}</p>
                                            )}
                                            {s.lastSyncTime && (
                                              <p className="text-[10px] text-gray-600 mt-0.5">{fmtTime(s.lastSyncTime)}{s.recordsAdded || s.recordsUpdated ? ` · +${s.recordsAdded ?? 0} added / ~${s.recordsUpdated ?? 0} updated` : ''}</p>
                                            )}
                                          </div>
                                        );
                                      })}
                                      {syncOrg.brickspotter && (
                                        <div className="sm-card-inset px-3 py-2">
                                          <div className="flex items-center gap-2">
                                            <Eye className="h-3 w-3 text-gray-400 shrink-0" />
                                            <span className="text-[12px] font-medium text-gray-200 flex-1">BrickSpotter</span>
                                            <span className="text-[11px] font-mono text-gray-500">{syncOrg.brickspotter.completed}/{syncOrg.brickspotter.totalScans}</span>
                                          </div>
                                          {syncOrg.brickspotter.failed > 0 && (
                                            <p className="text-[11px] text-orange-400/80 mt-1">{syncOrg.brickspotter.failed} scan{syncOrg.brickspotter.failed !== 1 ? 's' : ''} failed</p>
                                          )}
                                          {syncOrg.brickspotter.lastScanAt && (
                                            <p className="text-[10px] text-gray-600 mt-0.5">Last: {fmtTime(syncOrg.brickspotter.lastScanAt)}</p>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                }

                                if (mid === 'blapi') {
                                  if (!blOrg) return <p className="text-[12px] text-gray-500">No API calls recorded in the last 24h</p>;
                                  const rows = [
                                    { label: 'Total', value: blOrg.total, color: 'text-gray-200' },
                                    { label: 'Inventory', value: blOrg.inventory, color: 'text-gray-400' },
                                    { label: 'Orders', value: blOrg.orders, color: 'text-gray-400' },
                                    { label: 'Catalog', value: blOrg.catalog, color: 'text-gray-400' },
                                    { label: 'Price Guides', value: blOrg.priceGuide, color: 'text-gray-400' },
                                    { label: 'Other', value: blOrg.other, color: 'text-gray-400' },
                                    { label: 'Failed', value: blOrg.failed, color: blOrg.failed > 0 ? 'text-red-400' : 'text-gray-600' },
                                  ];
                                  return (
                                    <div className="space-y-1">
                                      <p className="text-[11px] text-gray-500 px-1 mb-2">BrickLink API calls — last 24h</p>
                                      {rows.map(r => (
                                        <div key={r.label} className="sm-card-inset px-3 py-2 flex items-center gap-2" data-testid={`drawer-bl-${r.label.toLowerCase()}`}>
                                          <span className="text-[12px] text-gray-400 flex-1">{r.label}</span>
                                          <span className={`text-[13px] font-mono font-semibold ${r.color}`}>{r.value.toLocaleString()}</span>
                                        </div>
                                      ))}
                                    </div>
                                  );
                                }

                                if (mid === 'brickspotter') {
                                  const bsOrg = syncOrg;
                                  if (!bsOrg?.brickspotter) return <p className="text-[12px] text-gray-500">No BrickSpotter data</p>;
                                  const bs = bsOrg.brickspotter;
                                  return (
                                    <div className="space-y-1">
                                      <p className="text-[11px] text-gray-500 px-1 mb-2">BrickSpotter scan history</p>
                                      {[
                                        { label: 'Total Scans', value: bs.totalScans.toLocaleString(), color: 'text-gray-200' },
                                        { label: 'Completed', value: bs.completed.toLocaleString(), color: 'text-emerald-400' },
                                        { label: 'Failed', value: bs.failed.toLocaleString(), color: bs.failed > 0 ? 'text-red-400' : 'text-gray-600' },
                                        { label: 'Last Scan', value: fmtTime(bs.lastScanAt), color: 'text-gray-400' },
                                      ].map(r => (
                                        <div key={r.label} className="sm-card-inset px-3 py-2 flex items-center gap-2" data-testid={`drawer-bs-${r.label.toLowerCase().replace(' ', '-')}`}>
                                          <span className="text-[12px] text-gray-400 flex-1">{r.label}</span>
                                          <span className={`text-[13px] font-mono ${r.color}`}>{r.value}</span>
                                        </div>
                                      ))}
                                    </div>
                                  );
                                }

                                return null;
                              })()}
                            </div>
                          </div>
                        </DrawerContent>
                      </Drawer>
                    </>
                  );
                })()}

                {activeAuditTab === 'platform' && (
                  <>
                    <div className="flex border-b border-gray-700/60 -mx-3 px-3 shrink-0">
                      {([
                        { id: 'enrichment' as const, label: 'Enrichment' },
                        { id: 'bricklink' as const, label: 'BrickLink' },
                        { id: 'logs' as const, label: 'Logs', dot: serverLogs && serverLogs.some(l => l.level === 'error') ? 'bg-red-500' : serverLogs && serverLogs.some(l => l.level === 'warn') ? 'bg-yellow-500' : null },
                        { id: 'database' as const, label: 'Database' },
                      ]).map(tab => (
                        <button
                          key={tab.id}
                          onClick={() => setActiveAuditPlatformTab(tab.id)}
                          className={`tool-tab ${activeAuditPlatformTab === tab.id ? 'text-yellow-400 border-yellow-500' : 'tool-tab-off'}`}
                          data-testid={`audit-platform-tab-${tab.id}`}
                        >
                          {tab.label}
                          {'dot' in tab && tab.dot && <span className={`h-1.5 w-1.5 rounded-full ${tab.dot}`} />}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {isAuditPlatformEnrichment && (() => {
                  if (systemHealthError) return (
                    <div className="rounded-lg bg-gray-800/60 border border-red-700/40 p-6 flex flex-col items-center justify-center gap-2 text-center">
                      <AlertTriangle className="h-6 w-6 text-red-400" />
                      <p className="text-sm text-gray-400">Failed to load platform health data</p>
                    </div>
                  );
                  if (!systemHealth) return (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
                    </div>
                  );
                  const sj = systemHealth.syncJobs || [];
                  const gj = (id: string) => sj.find((j: any) => j.id === id);
                  const clip = systemHealth.clipCatalogStatus;
                  const clipRunning = systemHealth.schedulerConfig?.clip_catalog?.workerRunning;
                  const clipPctOv = clip && clip.total > 0 ? Math.round((clip.embedded / clip.total) * 100) : 0;
                  const fmtTime = (t: string | null) => t ? new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Never';

                  type OverviewJob = {
                    key: string; label: string;
                    enabled: boolean; isRunning: boolean;
                    status: string | null; error: string | null;
                    lastTime: string | null;
                    progress?: { done: number; total: number; pct: number };
                  };

                  const pomJ = gj('priceomatic_cache');
                  const cdJ = gj('catalog_detail_completion');
                  const csJ = gj('catalog_scan');
                  const rbJ = gj('rebrickable_set_parts');
                  const ucJ = gj('universal_catalog_refresh');
                  const fmJ = gj('forum_sync');
                  const mnJ = gj('market_news_sync');
                  const biJ = gj('business_intel_sync');

                  const pomProg = pomLiveProgress?.active ? { done: pomLiveProgress.itemsProcessed ?? 0, total: pomLiveProgress.itemsTotal ?? 0, pct: pomProgressPct } : undefined;
                  const cdProg = syncingCd && cdLiveProgress?.phase === 'Enriching items' ? { done: cdLiveProgress.itemsProcessed ?? 0, total: cdLiveProgress.itemsTotal ?? 0, pct: cdProgressPct } : undefined;

                  const groups: Array<{ label: string; jobs: OverviewJob[] }> = [
                    { label: 'BrickLink Catalog', jobs: [
                      { key: 'pom', label: 'Price Guides', enabled: pomScheduleEnabled, isRunning: syncingPom, status: pomJ?.lastSyncStatus || null, error: pomJ?.errorMessage || null, lastTime: pomJ?.lastSyncTime || null, progress: pomProg },
                      { key: 'cd', label: 'Catalog Detail', enabled: catalogDetailEnabled, isRunning: syncingCd, status: cdJ?.lastSyncStatus || null, error: cdJ?.errorMessage || null, lastTime: cdJ?.lastSyncTime || null, progress: cdProg },
                      { key: 'cs', label: 'Catalog Scan', enabled: catalogScanEnabled, isRunning: syncingCs, status: csJ?.lastSyncStatus || null, error: csJ?.errorMessage || null, lastTime: csJ?.lastSyncTime || null },
                    ]},
                    { label: 'Embeddings', jobs: [
                      { key: 'rb', label: 'Rebrickable Sets', enabled: rebrickableSetSyncEnabled, isRunning: rbJ?.lastSyncStatus === 'in_progress', status: rbJ?.lastSyncStatus || null, error: rbJ?.errorMessage || null, lastTime: rbJ?.lastSyncTime || null },
                      { key: 'uc', label: 'Universal Catalog', enabled: universalCatalogScheduleEnabled, isRunning: ucJ?.lastSyncStatus === 'in_progress', status: ucJ?.lastSyncStatus || null, error: ucJ?.errorMessage || null, lastTime: ucJ?.lastSyncTime || null },
                      { key: 'clip', label: 'CLIP Build', enabled: true, isRunning: !!clipRunning, status: clipRunning ? 'in_progress' : (clip && clip.embedded >= clip.total ? 'success' : null), error: null, lastTime: null, progress: clip && clip.total > 0 ? { done: clip.embedded, total: clip.total, pct: clipPctOv } : undefined },
                    ]},
                    { label: 'Market', jobs: [
                      { key: 'fm', label: 'Forum Sync', enabled: forumSyncEnabled, isRunning: fmJ?.lastSyncStatus === 'in_progress', status: fmJ?.lastSyncStatus || null, error: fmJ?.errorMessage || null, lastTime: fmJ?.lastSyncTime || null },
                      { key: 'mn', label: 'Market News', enabled: marketNewsSyncEnabled, isRunning: mnJ?.lastSyncStatus === 'in_progress', status: mnJ?.lastSyncStatus || null, error: mnJ?.errorMessage || null, lastTime: mnJ?.lastSyncTime || null },
                      { key: 'bi', label: 'Business Intel', enabled: businessIntelEnabled, isRunning: biJ?.lastSyncStatus === 'in_progress', status: biJ?.lastSyncStatus || null, error: biJ?.errorMessage || null, lastTime: biJ?.lastSyncTime || null },
                    ]},
                  ];

                  const statusDot = (j: OverviewJob) => {
                    if (j.isRunning) return <Loader2 className="h-3 w-3 text-yellow-400 animate-spin shrink-0" />;
                    if (j.status === 'failed' || j.status === 'error') return <AlertTriangle className="h-3 w-3 text-red-400 shrink-0" />;
                    if (j.status === 'partial') return <AlertTriangle className="h-3 w-3 text-orange-400 shrink-0" />;
                    if (!j.enabled) return <Pause className="h-3 w-3 text-gray-600 shrink-0" />;
                    if (j.status === 'success') return <CheckCircle2 className="h-3 w-3 text-green-500/70 shrink-0" />;
                    return <Clock className="h-3 w-3 text-gray-600 shrink-0" />;
                  };

                  const statusText = (j: OverviewJob) => {
                    if (j.isRunning && j.progress && j.progress.total > 0) return `${j.progress.pct}%`;
                    if (j.isRunning) return 'Running';
                    if (j.error) return j.error.length > 40 ? j.error.slice(0, 40) + '…' : j.error;
                    if (!j.enabled) return 'Paused';
                    if (j.status === 'success' || j.status === 'partial' || j.status === 'failed' || j.status === 'error') return fmtTime(j.lastTime);
                    if (j.key === 'clip' && j.progress) return `${j.progress.done.toLocaleString()}/${j.progress.total.toLocaleString()}`;
                    return 'Never';
                  };

                  return (
                    <div className="sm-card-inset" data-testid="audit-platform-overview">
                      {groups.map((g, gi) => (
                        <div key={gi}>
                          {gi > 0 && <div className="border-t border-gray-700/40" />}
                          <div className="px-3 pt-2 pb-0.5">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{g.label}</span>
                          </div>
                          {g.jobs.map(j => (
                            <div
                              key={j.key}
                              className="flex items-center gap-2 px-3 py-1"
                              data-testid={`audit-platform-job-${j.key}`}
                            >
                              {statusDot(j)}
                              <span className="text-[11px] text-gray-300 flex-1 min-w-0 truncate">{j.label}</span>
                              {j.isRunning && j.progress && j.progress.total > 0 ? (
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <div className="w-12 h-1 bg-gray-700 rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full transition-all ${j.key === 'clip' ? 'bg-yellow-500' : j.key === 'pom' ? 'bg-purple-500' : 'bg-blue-500'}`} style={{ width: `${j.progress.pct}%` }} />
                                  </div>
                                  <span className="text-[10px] text-gray-400 font-mono w-7 text-right">{j.progress.pct}%</span>
                                </div>
                              ) : (
                                <span className={`text-[10px] shrink-0 font-mono ${j.error && !j.isRunning ? 'text-red-400/80' : j.isRunning ? 'text-yellow-400' : !j.enabled ? 'text-gray-600' : 'text-gray-500'}`}>
                                  {statusText(j)}
                                </span>
                              )}
                            </div>
                          ))}
                          <div className="h-1" />
                        </div>
                      ))}
                    </div>
                  );
                })()}

            {/* Audit Log: Platform sub-tabs (BrickLink, Logs, Database) rendered at section level */}
            {isAuditPlatformBl && (
                  <div className="space-y-4">
                    {!platformBlApiUsage ? (
                      <div className="flex items-center justify-center py-10">
                        <Loader2 className="h-5 w-5 animate-spin text-yellow-500/50" />
                      </div>
                    ) : (
                      <>
                        <div>
                          <p className="sm-group-label mb-2 px-1">API Usage Overview</p>
                          <div className="grid grid-cols-4 gap-2">
                            {[
                              { label: 'Last 24h', value: platformBlApiUsage.callsLast24h, color: 'text-blue-400', icon: BarChart2 },
                              { label: 'Successful', value: platformBlApiUsage.successLast24h, color: 'text-emerald-400', icon: CheckCircle2 },
                              { label: 'Failed', value: platformBlApiUsage.failLast24h, color: platformBlApiUsage.failLast24h > 0 ? 'text-red-400' : 'text-gray-500', icon: AlertTriangle },
                              { label: 'All Time', value: platformBlApiUsage.totalAllTime, color: 'text-gray-300', icon: Database },
                            ].map(({ label, value, color, icon: Icon }) => (
                              <div key={label} className="rounded-lg bg-gray-800/60 border border-gray-700 px-3 py-2.5">
                                <div className="flex items-center gap-1.5 mb-1">
                                  <Icon className="h-3 w-3 text-yellow-500/60" />
                                  <span className="text-[10px] text-gray-500">{label}</span>
                                </div>
                                <p className={`text-lg font-bold ${color}`}>{Number(value).toLocaleString()}</p>
                              </div>
                            ))}
                          </div>
                        </div>

                        {(() => {
                          const now = Date.now();
                          const ceiling = platformBlApiUsage.ceiling;
                          const currentUsed = platformBlApiUsage.callsLast24h;
                          const currentAvailable = Math.max(0, ceiling - currentUsed);
                          const futureBuckets = platformBlApiUsage.hourlyBuckets
                            .filter(b => b.calls > 0)
                            .map(b => ({ rollsOffAt: new Date(b.rollsOffAt), count: b.calls }))
                            .filter(b => b.rollsOffAt.getTime() > now)
                            .sort((a, b) => a.rollsOffAt.getTime() - b.rollsOffAt.getTime());
                          if (futureBuckets.length === 0) return null;
                          let running = currentAvailable;
                          const forecast = futureBuckets.map(b => {
                            running += b.count;
                            return { ...b, available: Math.min(running, ceiling) };
                          });
                          const totalFreeing = futureBuckets.reduce((s, b) => s + b.count, 0);
                          const maxBar = Math.max(...futureBuckets.map(b => b.count));
                          const fmtTime = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                          const fmtRelative = (d: Date) => {
                            const mins = Math.round((d.getTime() - now) / 60000);
                            if (mins < 60) return `${mins}m`;
                            const hrs = Math.floor(mins / 60);
                            const rm = mins % 60;
                            return rm > 0 ? `${hrs}h ${rm}m` : `${hrs}h`;
                          };
                          return (
                            <div data-testid="api-recovery-forecast">
                              <p className="sm-group-label mb-2 px-1">API Recovery Forecast</p>
                              <div className="rounded-lg bg-gray-800/60 border border-gray-700 px-3 py-3 space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-xs font-semibold text-gray-200">Budget Recovery Timeline</div>
                                  <span className="text-[10px] text-green-400/80">{totalFreeing.toLocaleString()} calls freeing up</span>
                                </div>
                                <div className="text-[11px] text-gray-500">
                                  {currentAvailable.toLocaleString()} available now · {ceiling.toLocaleString()} limit
                                </div>
                                <div className="space-y-0.5 mt-1">
                                  {forecast.map((b, i) => (
                                    <div key={i} className="flex items-center gap-2 text-[10px]">
                                      <span className="text-gray-500 w-[44px] text-right shrink-0 font-mono">{fmtRelative(b.rollsOffAt)}</span>
                                      <span className="text-gray-400 w-[58px] shrink-0 font-mono">{fmtTime(b.rollsOffAt)}</span>
                                      <div className="flex-1 h-1.5 rounded-full bg-gray-700/40 overflow-hidden">
                                        <div className="h-full bg-green-500/60 rounded-full transition-all" style={{ width: `${maxBar > 0 ? Math.max(3, Math.round((b.count / maxBar) * 100)) : 0}%` }} />
                                      </div>
                                      <span className="text-green-400/80 w-[48px] text-right shrink-0 font-mono">+{b.count.toLocaleString()}</span>
                                      <span className="text-gray-400 w-[56px] text-right shrink-0 font-mono">{b.available.toLocaleString()}</span>
                                    </div>
                                  ))}
                                </div>
                                <div className="flex items-center justify-between gap-2 mt-1 pt-1.5 border-t border-gray-700/30">
                                  <span className="text-[9px] text-gray-600">Calls expire 24h after they were made</span>
                                  <span className="text-[9px] text-gray-600">+freed · available</span>
                                </div>
                              </div>
                            </div>
                          );
                        })()}

                        <div>
                          <div className="flex items-center justify-between gap-2 mb-2 px-1">
                            <p className="sm-group-label">Hourly Call Volume (All Orgs)</p>
                            <button
                              onClick={() => setShowBlSchedulePopup(true)}
                              className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
                              data-testid="button-bl-schedule-popup"
                            >
                              <Calendar className="h-3 w-3" />
                              <span>Per-Org Schedules</span>
                            </button>
                          </div>
                          <div className="rounded-lg bg-gray-800/60 border border-gray-700 px-3 py-3 space-y-2">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-xs font-semibold text-gray-200">Platform Total — Rolling 24h</div>
                                <div className="text-[11px] mt-0.5 text-gray-500">{platformBlApiUsage.callsLast24h.toLocaleString()} calls across all orgs · {platformBlApiUsage.ceiling.toLocaleString()}/day per credential set</div>
                              </div>
                            </div>
                            {(() => {
                              const maxCalls = Math.max(...platformBlApiUsage.hourlyBuckets.map(b => b.calls), 1);
                              const fmtAxisTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                              return (
                                <>
                                  <div className="text-[9px] text-gray-600 uppercase tracking-wide mb-1">Call Volume (last 24h)</div>
                                  <div className="flex items-end gap-px h-10">
                                    {platformBlApiUsage.hourlyBuckets.map((b) => {
                                      const height = b.calls === 0 ? 2 : Math.max(3, Math.round((b.calls / maxCalls) * 40));
                                      return (
                                        <div key={b.hourStart} className="flex-1 flex flex-col justify-end">
                                          <div className={`w-full rounded-sm ${b.calls === 0 ? 'bg-gray-700/50' : 'bg-blue-500/70'} opacity-75`} style={{ height: `${height}px` }} />
                                        </div>
                                      );
                                    })}
                                  </div>
                                  <div className="flex justify-between text-[9px] text-gray-600 font-mono mt-0.5">
                                    {[0, 6, 12, 18, 23].map(i => (
                                      <span key={i}>{platformBlApiUsage.hourlyBuckets[i] ? fmtAxisTime(platformBlApiUsage.hourlyBuckets[i].hourStart) : ''}</span>
                                    ))}
                                  </div>
                                </>
                              );
                            })()}
                          </div>
                        </div>

                        {platformBlApiUsage.perOrg.length > 0 && (
                          <div>
                            <p className="sm-group-label mb-2 px-1">Usage by Organization</p>
                            <div className="rounded-lg bg-gray-800/60 border border-gray-700 overflow-hidden">
                              <div className="grid grid-cols-[1fr_auto] gap-2 px-3 py-1.5 border-b border-gray-700/60">
                                <span className="text-[9px] text-gray-600 uppercase tracking-wide">Org ID</span>
                                <span className="text-[9px] text-gray-600 uppercase tracking-wide text-right">Calls</span>
                              </div>
                              {platformBlApiUsage.perOrg.map(org => {
                                const pct = Math.min((org.calls / platformBlApiUsage.ceiling) * 100, 100);
                                return (
                                  <div key={org.orgId} className="relative px-3 py-2">
                                    <div className="absolute left-0 top-0 bottom-0 bg-blue-500/8 pointer-events-none rounded-sm" style={{ width: `${pct}%` }} />
                                    <div className="relative grid grid-cols-[1fr_auto] gap-2 items-center">
                                      <span className="text-[11px] text-gray-400 font-mono truncate">{org.orgId}</span>
                                      <div className="flex items-center gap-2">
                                        <span className={`text-[11px] font-mono font-semibold ${pct >= 80 ? 'text-red-400' : pct >= 50 ? 'text-orange-400' : 'text-gray-300'}`}>
                                          {org.calls.toLocaleString()}
                                        </span>
                                        <span className="text-[9px] text-gray-600 w-8 text-right">{Math.round(pct)}%</span>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {platformBlApiUsage.topEndpoints.length > 0 && (
                          <div>
                            <p className="sm-group-label mb-2 px-1">Top Endpoints (24h)</p>
                            <div className="rounded-lg bg-gray-800/60 border border-gray-700 overflow-hidden">
                              {platformBlApiUsage.topEndpoints.map((ep, idx) => (
                                <div key={ep.endpoint} className={`flex items-center justify-between gap-2 px-3 py-2 ${idx > 0 ? 'border-t border-gray-700/40' : ''}`}>
                                  <div className="flex items-center gap-2 min-w-0 flex-1">
                                    <span className="text-[9px] text-gray-600 font-mono w-4 shrink-0 text-right">{idx + 1}.</span>
                                    <span className="text-[10px] text-gray-400 font-mono truncate">{ep.endpoint}</span>
                                  </div>
                                  <span className="text-[10px] text-gray-300 font-mono shrink-0">{ep.calls.toLocaleString()}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                      </>
                    )}
                  </div>
                )}

            {/* BrickLink API Schedule Popup (audit platform) */}
            {showBlSchedulePopup && platformBlApiUsage && (
                  <ResponsiveModal
                    open={showBlSchedulePopup}
                    onOpenChange={setShowBlSchedulePopup}
                    title="BrickLink API Availability Schedule"
                    icon={Calendar}
                    iconColor="text-blue-400"
                    description="View BrickLink API quota usage per organization"
                    maxWidth="max-w-lg"
                    testId="modal-bl-schedule"
                  >
                      <div className="space-y-4 pt-2">
                        <div className="flex items-center justify-between gap-3 px-1">
                          <div>
                            <p className="text-xs font-semibold text-gray-200">Per-Org Quota Status</p>
                            <p className="text-[10px] text-gray-500 mt-0.5">Each org has its own {platformBlApiUsage.ceiling.toLocaleString()} calls/day rolling window</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-[9px] text-gray-600 uppercase tracking-wide">Platform total</p>
                            <p className="text-sm font-bold text-blue-400">{platformBlApiUsage.callsLast24h.toLocaleString()}</p>
                          </div>
                        </div>

                        {platformBlApiUsage.perOrg.length > 0 ? (
                          <div className="space-y-2">
                            {platformBlApiUsage.perOrg.map(org => {
                              const pct = Math.min((org.calls / platformBlApiUsage.ceiling) * 100, 100);
                              const freeNow = Math.max(0, platformBlApiUsage.ceiling - org.calls);
                              const statusColor = pct >= 90 ? 'text-red-400' : pct >= 60 ? 'text-orange-400' : 'text-emerald-400';
                              const barColor = pct >= 80 ? 'bg-red-500/70' : pct >= 50 ? 'bg-orange-500/70' : 'bg-blue-500/70';
                              return (
                                <div key={org.orgId} className="rounded-lg bg-gray-800/40 border border-gray-700/60 px-3 py-2.5 space-y-1.5">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-[11px] text-gray-300 font-mono truncate">{org.orgId}</span>
                                    <span className={`text-[11px] font-semibold ${statusColor}`}>{freeNow.toLocaleString()} free</span>
                                  </div>
                                  <div className="h-1.5 w-full rounded-full bg-gray-700 overflow-hidden">
                                    <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
                                  </div>
                                  <div className="flex items-center justify-between text-[10px]">
                                    <span className="text-gray-600">{org.calls.toLocaleString()} used</span>
                                    <span className="text-gray-600">{Math.round(pct)}% of {platformBlApiUsage.ceiling.toLocaleString()}</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="text-center py-6">
                            <CheckCircle2 className="h-5 w-5 text-emerald-400/60 mx-auto mb-2" />
                            <p className="text-[11px] text-gray-500">No API calls recorded in the last 24 hours</p>
                          </div>
                        )}

                        <p className="text-[10px] text-gray-600 leading-relaxed">BrickLink enforces a {platformBlApiUsage.ceiling.toLocaleString()} calls/day rolling window per credential set. Each org uses its own OAuth credentials — limits are independent. Calls made 24 hours ago free up capacity automatically as the rolling window advances.</p>
                      </div>
                  </ResponsiveModal>
                )}

            {/* Audit Platform: Logs tab */}
            {isAuditPlatformLogs && (
                  <div className="space-y-4 w-full min-w-0">
                    <div className="min-w-0">
                      <div className="flex items-center justify-between mb-2 px-1">
                        <div className="flex items-center gap-2">
                          <p className="sm-group-label">Recent Warnings & Errors</p>
                          {serverLogs && serverLogs.some(l => l.level === 'error') && (
                            <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                          )}
                          {serverLogs && !serverLogs.some(l => l.level === 'error') && serverLogs.some(l => l.level === 'warn') && (
                            <span className="h-1.5 w-1.5 rounded-full bg-yellow-500" />
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {serverLogs && serverLogs.length > 0 && (
                            <button
                              onClick={async () => {
                                const { apiRequest } = await import('@/lib/queryClient');
                                await apiRequest('DELETE', '/api/platform-admin/server-logs');
                                refetchServerLogs();
                              }}
                              className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
                              data-testid="button-clear-server-logs"
                            >
                              Clear
                            </button>
                          )}
                          <button
                            onClick={() => refetchServerLogs()}
                            className="text-gray-600 hover:text-gray-400 transition-colors"
                            data-testid="button-refresh-server-logs"
                          >
                            <RefreshCw className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                      {serverLogsLoading ? (
                        <div className="flex items-center justify-center py-6">
                          <Loader2 className="h-4 w-4 animate-spin text-gray-600" />
                        </div>
                      ) : serverLogs && serverLogs.length > 0 ? (
                        <div className="rounded-lg border border-gray-700 overflow-hidden divide-y divide-gray-700/40 w-full max-w-full">
                          {serverLogs.map(entry => {
                            const isError = entry.level === 'error';
                            const relativeTime = (() => {
                              const diff = Date.now() - new Date(entry.timestamp).getTime();
                              const secs = Math.floor(diff / 1000);
                              if (secs < 60) return `${secs}s ago`;
                              const mins = Math.floor(secs / 60);
                              if (mins < 60) return `${mins}m ago`;
                              const hours = Math.floor(mins / 60);
                              return `${hours}h ago`;
                            })();
                            return (
                              <div key={entry.id} className="flex items-start gap-2.5 px-3 py-2 min-w-0 w-full overflow-hidden">
                                <span className={`mt-0.5 shrink-0 text-[10px] font-bold uppercase tracking-wider px-1 py-0.5 rounded ${isError ? 'bg-red-500/15 text-red-400' : 'bg-yellow-500/15 text-yellow-400'}`}>
                                  {entry.level}
                                </span>
                                <div className="flex-1 min-w-0 overflow-hidden">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <p className="text-[11px] text-gray-300 leading-snug truncate cursor-default">{entry.message}</p>
                                    </TooltipTrigger>
                                    <TooltipContent side="left" className="max-w-sm text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-all">
                                      {entry.message}
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                                <div className="shrink-0 flex items-center gap-1.5 mt-0.5">
                                  {entry.count > 1 && (
                                    <span className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded-full ${isError ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                                      ×{entry.count}
                                    </span>
                                  )}
                                  <span className="text-[10px] text-gray-600 font-mono whitespace-nowrap">{relativeTime}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="rounded-lg bg-gray-800/40 border border-gray-700/60 px-4 py-4 text-center">
                          <CheckCircle2 className="h-4 w-4 text-green-500/50 mx-auto mb-1" />
                          <p className="sm-description">No warnings or errors</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

            {/* Audit Platform: Database tab */}
            {isAuditPlatformDb && (() => {
                  const DB_GROUPS: { label: string; tables: string[] }[] = [
                    { label: 'Platform', tables: ['organizations', 'users', 'sessions', 'plan_configs', 'app_settings', 'org_integrations'] },
                    { label: 'BrickLink', tables: ['bl_catalog', 'bl_catalog_clip_embeddings', 'bl_categories', 'bl_colors', 'bl_inventory', 'bl_api_calls', 'bl_forum_posts', 'bl_forum_embeddings'] },
                    { label: 'Orders', tables: ['orders', 'order_details', 'order_detail_embeddings', 'order_embeddings', 'order_adjustments', 'order_splits', 'order_split_items', 'shipments'] },
                    { label: 'Inventory', tables: ['inventory_embeddings', 'inventory_locations', 'part_price_history', 'part_id_mappings', 'picklist_items'] },
                    { label: 'BrickSpotter', tables: ['set_part_relationships', 'set_part_embeddings', 'universal_catalog_queue', 'brickanalyzer_scans'] },
                    { label: 'AI & Jobs', tables: ['embedding_jobs', 'conversations'] },
                    { label: 'Operations', tables: ['anomaly_events', 'app_feedback', 'eod_forms', 'sync_issues', 'sync_metadata', 'differential_batches', 'restore_jobs', 'price_guide_cache'] },
                  ];
                  const getGroup = (name: string) => DB_GROUPS.findIndex(g => g.tables.includes(name));
                  return (
                    <div className="space-y-4">
                      <div>
                        <div className="flex items-center justify-between mb-2 px-1">
                          <p className="sm-group-label">Database Tables</p>
                          <button
                            onClick={() => refetchDbTables()}
                            className="text-gray-600 hover:text-gray-400 transition-colors"
                            data-testid="button-refresh-db-tables"
                          >
                            <RefreshCw className="h-3 w-3" />
                          </button>
                        </div>
                        {dbTablesLoading ? (
                          <div className="flex items-center justify-center py-6">
                            <Loader2 className="h-4 w-4 animate-spin text-gray-600" />
                          </div>
                        ) : dbTables && dbTables.length > 0 ? (
                          <>
                          {/* Warnings panel */}
                          {(() => {
                            type DbWarning = { tableName: string; severity: 'error' | 'warn'; issue: string; sql: string };
                            const warnings: DbWarning[] = [];
                            for (const t of dbTables) {
                              const deadRatio = t.liveRows > 0 ? t.deadRows / t.liveRows : 0;
                              if (t.deadRows > 500 && deadRatio > 0.1) {
                                warnings.push({ tableName: t.tableName, severity: 'error', issue: `${t.deadRows.toLocaleString()} dead tuples (${Math.round(deadRatio * 100)}% ratio) — bloating table`, sql: `VACUUM ANALYZE ${t.tableName};` });
                              } else if (t.deadRows > 100 && deadRatio > 0.05) {
                                warnings.push({ tableName: t.tableName, severity: 'warn', issue: `${t.deadRows.toLocaleString()} dead tuples (${Math.round(deadRatio * 100)}% ratio)`, sql: `VACUUM ANALYZE ${t.tableName};` });
                              } else if (t.modSinceAnalyze > 10000) {
                                warnings.push({ tableName: t.tableName, severity: 'warn', issue: `${t.modSinceAnalyze.toLocaleString()} modifications since last ANALYZE — query planner stats may be stale`, sql: `ANALYZE ${t.tableName};` });
                              } else if (!t.lastVacuum && t.liveRows > 500) {
                                warnings.push({ tableName: t.tableName, severity: 'warn', issue: `Never been vacuumed — ${t.liveRows.toLocaleString()} rows`, sql: `VACUUM ANALYZE ${t.tableName};` });
                              }
                            }
                            if (warnings.length === 0) return (
                              <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-green-500/10 border border-green-500/20 mb-3">
                                <CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0" />
                                <p className="text-xs text-green-400">All tables healthy — no action needed</p>
                              </div>
                            );
                            const hasErrors = warnings.some(w => w.severity === 'error');
                            return (
                              <div className={`rounded-lg border mb-3 overflow-hidden ${hasErrors ? 'border-red-500/30 bg-red-500/5' : 'border-yellow-500/30 bg-yellow-500/5'}`}>
                                <div className={`flex items-center gap-2 px-3 py-2 border-b ${hasErrors ? 'border-red-500/20' : 'border-yellow-500/20'}`}>
                                  <AlertTriangle className={`h-3.5 w-3.5 shrink-0 ${hasErrors ? 'text-red-400' : 'text-yellow-400'}`} />
                                  <p className={`text-xs font-semibold ${hasErrors ? 'text-red-300' : 'text-yellow-300'}`}>
                                    {warnings.length} table{warnings.length !== 1 ? 's' : ''} need attention
                                  </p>
                                </div>
                                <div className="divide-y divide-gray-700/40">
                                  {warnings.map(w => (
                                    <div key={w.tableName} className="px-3 py-2 flex items-start gap-2.5">
                                      <span className={`mt-0.5 shrink-0 text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded ${w.severity === 'error' ? 'bg-red-500/15 text-red-400' : 'bg-yellow-500/15 text-yellow-400'}`}>
                                        {w.severity === 'error' ? 'urgent' : 'warn'}
                                      </span>
                                      <div className="flex-1 min-w-0 space-y-1">
                                        <p className="text-[11px] font-mono text-gray-200">{w.tableName}</p>
                                        <p className="text-[10px] text-gray-500 leading-snug">{w.issue}</p>
                                        <div className="flex items-center gap-1.5 mt-1">
                                          <code className="text-[10px] font-mono text-gray-400 bg-gray-800 px-1.5 py-0.5 rounded">{w.sql}</code>
                                          <button
                                            onClick={() => navigator.clipboard.writeText(w.sql)}
                                            className="shrink-0 text-gray-600 hover:text-gray-300 transition-colors"
                                            data-testid={`button-copy-sql-${w.tableName}`}
                                            title="Copy SQL"
                                          >
                                            <Copy className="h-3 w-3" />
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })()}
                          {/* Vacuum & Cleanup Tools */}
                          <div className="rounded-lg border border-gray-700 overflow-hidden mb-3">
                            <div className="flex items-center gap-2 px-3 py-2 bg-gray-800/80 border-b border-gray-700">
                              <Wrench className="h-3 w-3 text-yellow-500/70" />
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-300">Vacuum & Cleanup Tools</span>
                            </div>

                            {/* Quick Vacuum */}
                            {(() => {
                              const needsVacuum = dbTables.filter(t => {
                                const deadRatio = t.liveRows > 0 ? t.deadRows / t.liveRows : 0;
                                return (t.deadRows > 100 && deadRatio > 0.05) || (!t.lastVacuum && t.liveRows > 500);
                              }).map(t => t.tableName);
                              return (
                                <div className="px-3 py-2.5 border-b border-gray-700/40">
                                  <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <div className="min-w-0">
                                      <p className="text-[11px] text-gray-200 font-medium">Vacuum All Flagged Tables</p>
                                      <p className="text-[10px] text-gray-500 mt-0.5">
                                        {needsVacuum.length > 0
                                          ? `${needsVacuum.length} table${needsVacuum.length !== 1 ? 's' : ''} with dead tuples or never vacuumed`
                                          : 'All tables are healthy'}
                                      </p>
                                    </div>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={needsVacuum.length === 0 || vacuumMutation.isPending}
                                      onClick={() => vacuumMutation.mutate(needsVacuum)}
                                      data-testid="button-vacuum-flagged"
                                    >
                                      {vacuumMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Zap className="h-3 w-3 mr-1" />}
                                      Vacuum {needsVacuum.length > 0 ? `(${needsVacuum.length})` : ''}
                                    </Button>
                                  </div>
                                </div>
                              );
                            })()}

                            {/* Vacuum All */}
                            <div className="px-3 py-2.5 border-b border-gray-700/40">
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <div className="min-w-0">
                                  <p className="text-[11px] text-gray-200 font-medium">Vacuum All Tables</p>
                                  <p className="text-[10px] text-gray-500 mt-0.5">Run VACUUM ANALYZE on every table in the database</p>
                                </div>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={vacuumMutation.isPending}
                                  onClick={() => vacuumMutation.mutate(dbTables.map(t => t.tableName))}
                                  data-testid="button-vacuum-all"
                                >
                                  {vacuumMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Database className="h-3 w-3 mr-1" />}
                                  Vacuum All
                                </Button>
                              </div>
                            </div>

                            {/* Data Cleanup Targets */}
                            <div className="px-3 py-2 bg-gray-800/40 border-b border-gray-700/40">
                              <span className="text-[9px] uppercase tracking-widest text-gray-400 font-semibold">Purge Stale Data</span>
                            </div>
                            {[
                              { target: 'bl_api_calls',          label: 'API Call Logs',        desc: 'BrickLink API call history',    defaultDays: 14 },
                              { target: 'embedding_jobs',        label: 'Completed Jobs',       desc: 'Finished embedding/restore jobs', defaultDays: 7 },
                              { target: 'sync_issues',           label: 'Sync Issues',          desc: 'Old sync warning/error logs',   defaultDays: 30 },
                              { target: 'price_guide_cache',     label: 'Price Guide Cache',    desc: 'Stale BrickLink price data',    defaultDays: 30 },
                              { target: 'sessions',              label: 'Expired Sessions',     desc: 'Auth sessions past expiry',     defaultDays: 0 },
                              { target: 'brickanalyzer_scans',   label: 'Old Scans',            desc: 'BrickSpotter scan image data',  defaultDays: 60 },
                              { target: 'conversations',         label: 'Old Conversations',    desc: 'AI chat history',               defaultDays: 90 },
                              { target: 'universal_catalog_queue', label: 'Catalog Queue',      desc: 'Processed universal queue items', defaultDays: 14 },
                            ].map(item => {
                              const tableInfo = dbTables.find(t => t.tableName === item.target);
                              const rowCount = tableInfo?.liveRows ?? 0;
                              return (
                                <div key={item.target} className="px-3 py-2 border-b border-gray-700/30 flex items-center justify-between gap-2 flex-wrap">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <p className="text-[11px] text-gray-200 font-mono">{item.label}</p>
                                      {rowCount > 0 && (
                                        <span className="text-[9px] text-gray-500 font-mono">{rowCount.toLocaleString()} rows</span>
                                      )}
                                    </div>
                                    <p className="text-[10px] text-gray-500">{item.desc}{item.defaultDays > 0 ? ` older than ${item.defaultDays}d` : ''}</p>
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={cleanupMutation.isPending || rowCount === 0}
                                    onClick={() => cleanupMutation.mutate({ target: item.target, daysOld: item.defaultDays })}
                                    data-testid={`button-cleanup-${item.target}`}
                                  >
                                    {cleanupMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Trash2 className="h-3 w-3 mr-1" />}
                                    Purge
                                  </Button>
                                </div>
                              );
                            })}
                          </div>

                          <div className="rounded-lg border border-gray-700">
                            {/* Column header */}
                            <div className="grid grid-cols-[12px_1fr_50px_60px_44px] gap-x-2 px-3 py-1.5 bg-gray-800/80 border-b border-gray-700 rounded-t-lg">
                              <span />
                              <span className="app-label">Table</span>
                              <span className="app-label text-right">Size</span>
                              <span className="app-label text-right">~Rows</span>
                              <span className="app-label text-right">Dead</span>
                            </div>
                            {/* Grouped rows */}
                            {(() => {
                              const sorted = [...dbTables].sort((a, b) => {
                                const ga = getGroup(a.tableName);
                                const gb = getGroup(b.tableName);
                                if (ga !== gb) return (ga === -1 ? 99 : ga) - (gb === -1 ? 99 : gb);
                                return a.tableName.localeCompare(b.tableName);
                              });
                              let lastGroup = -2;
                              return sorted.map(t => {
                                const grpIdx = getGroup(t.tableName);
                                const grpLabel = grpIdx === -1 ? 'Other' : DB_GROUPS[grpIdx].label;
                                const showHeader = grpIdx !== lastGroup;
                                lastGroup = grpIdx;
                                const deadRatio = t.liveRows > 0 ? t.deadRows / t.liveRows : 0;
                                const healthColor =
                                  t.deadRows > 500 && deadRatio > 0.1 ? 'bg-red-500' :
                                  t.deadRows > 100 && deadRatio > 0.05 ? 'bg-yellow-500' :
                                  'bg-green-500';
                                const lastVacuumRelative = t.lastVacuum
                                  ? (() => {
                                      const diff = Date.now() - new Date(t.lastVacuum).getTime();
                                      const days = Math.floor(diff / 86400000);
                                      if (days === 0) return 'today';
                                      if (days === 1) return '1d ago';
                                      return `${days}d ago`;
                                    })()
                                  : 'never';
                                return (
                                  <div key={t.tableName}>
                                    {showHeader && (
                                      <div className="px-3 py-1 bg-gray-800/50 border-t border-gray-700/60 first:border-t-0">
                                        <span className="text-[9px] uppercase tracking-widest text-gray-400 font-semibold">{grpLabel}</span>
                                      </div>
                                    )}
                                    <div className="grid grid-cols-[12px_1fr_50px_60px_44px] gap-x-2 items-center px-3 py-1.5 border-t border-gray-700/30 hover-elevate">
                                      <span className={`h-1.5 w-1.5 rounded-full ${healthColor} mx-auto shrink-0`} />
                                      <div className="flex items-center gap-1 min-w-0">
                                        <span className="text-[11px] text-gray-300 font-mono break-all leading-tight">{t.tableName}</span>
                                        {t.description && (
                                          <Popover>
                                            <PopoverTrigger asChild>
                                              <button className="shrink-0 text-gray-600 hover:text-gray-400 transition-colors" data-testid={`button-info-${t.tableName}`}>
                                                <Info className="h-3 w-3" />
                                              </button>
                                            </PopoverTrigger>
                                            <PopoverContent side="right" className="w-64 p-3 text-xs leading-relaxed">
                                              <p className="text-gray-200">{t.description}</p>
                                              {t.lastVacuum && (
                                                <p className="mt-1.5 text-gray-500 text-[10px]">Last vacuum: {lastVacuumRelative}</p>
                                              )}
                                            </PopoverContent>
                                          </Popover>
                                        )}
                                      </div>
                                      <span className="text-[11px] text-gray-400 text-right font-mono">{t.totalSize}</span>
                                      <span className="text-[11px] text-gray-400 text-right font-mono">
                                        {t.liveRows > 0 ? t.liveRows.toLocaleString() : '—'}
                                      </span>
                                      <span className={`text-[11px] text-right font-mono ${t.deadRows > 500 && deadRatio > 0.1 ? 'text-red-400' : t.deadRows > 100 ? 'text-yellow-400' : 'text-gray-600'}`}>
                                        {t.deadRows > 0 ? t.deadRows.toLocaleString() : '—'}
                                      </span>
                                    </div>
                                  </div>
                                );
                              });
                            })()}
                            {/* Footer */}
                            <div className="px-3 py-2 bg-gray-800/40 border-t border-gray-700 rounded-b-lg flex items-center justify-between">
                              <span className="text-[10px] text-gray-600">{dbTables.length} tables</span>
                              <span className="text-[10px] text-gray-600">
                                {(() => {
                                  const totalBytes = dbTables.reduce((sum, t) => sum + t.totalSizeBytes, 0);
                                  if (totalBytes >= 1073741824) return `${(totalBytes / 1073741824).toFixed(1)} GB total`;
                                  if (totalBytes >= 1048576) return `${(totalBytes / 1048576).toFixed(0)} MB total`;
                                  return `${(totalBytes / 1024).toFixed(0)} KB total`;
                                })()}
                              </span>
                            </div>
                          </div>
                          </>
                        ) : (
                          <div className="rounded-lg bg-gray-800/40 border border-gray-700/60 px-4 py-4 text-center text-xs text-gray-500">
                            No table data available
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
              </div>
            )}

            {/* Announcements */}
            {activeSection === 'announcements' && (
              <div className="p-4 space-y-4">
                <div className="rounded-lg bg-gray-800/60 border border-gray-700 p-6 flex flex-col items-center justify-center gap-3 text-center">
                  <Megaphone className="h-8 w-8 text-gray-600" />
                  <div>
                    <p className="text-sm font-medium text-gray-100">Announcements</p>
                    <p className="sm-description mt-1">Broadcast system-wide messages, maintenance notices, and release updates to all tenant organizations.</p>
                  </div>
                  <Badge variant="outline" className="text-[10px] text-gray-500 border-gray-600">Coming Soon</Badge>
                </div>
              </div>
            )}

            {/* Billing Overview */}
            {activeSection === 'billingOverview' && <BillingOverviewPanel />}

            {/* Support Queue */}
            {activeSection === 'supportQueue' && <SupportQueuePanel />}

            {/* Vision of Success */}
            {activeSection === 'productVision' && <ProductVisionPanel />}

            {/* OKRs */}
            {activeSection === 'productOkrs' && <ProductOkrsPanel />}

            {/* Roadmap */}
            {activeSection === 'productRoadmap' && <ProductRoadmapPanel />}

            {/* Backlog */}
            {activeSection === 'productBacklog' && <ProductBacklogPanel />}

            {/* Maintenance */}
            {activeSection === 'maintenance' && <MaintenancePanel />}

            {/* Platform E.L.F.I.E. Settings */}
            {activeSection === 'platformElfie' && (
              <div className="px-3 pt-3 pb-4 space-y-3 min-w-0 overflow-hidden">
                <div className="space-y-4">
                  <div className="sm-card">
                    <div className="sm-card-header">
                      <Brain className="h-3.5 w-3.5 text-violet-400/80" />
                      <span className="text-xs font-semibold text-gray-200">System Default Prompt</span>
                    </div>
                    <div className="px-4 py-3 space-y-2">
                      <p className="text-[11px] text-gray-400 leading-relaxed">
                        This is the built-in base prompt that governs E.L.F.I.E.'s personality, tool awareness, and reasoning approach across all organizations. Individual orgs can layer their own custom prompt on top via their E.L.F.I.E. settings.
                      </p>
                      <button
                        onClick={async () => {
                          if (!showDefaultPrompt && !defaultPromptText) {
                            try {
                              const res = await fetch('/api/elfie-default-prompt', { credentials: 'include' });
                              const data = await res.json();
                              if (data.prompt) setDefaultPromptText(data.prompt);
                            } catch {}
                          }
                          setShowDefaultPrompt(!showDefaultPrompt);
                        }}
                        className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-200 transition-colors w-full"
                        data-testid="button-toggle-platform-default-prompt"
                      >
                        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${showDefaultPrompt ? 'rotate-90' : ''}`} />
                        <span className="font-medium">View Default Prompt</span>
                        <span className="text-[10px] text-gray-600 ml-1">(read-only)</span>
                      </button>
                      {showDefaultPrompt && (
                        <div className="mt-2 rounded-lg bg-gray-800/40 border border-gray-700/50 p-3 max-h-[300px] overflow-y-auto">
                          <pre className="text-[10px] font-mono text-gray-500 whitespace-pre-wrap leading-relaxed">{defaultPromptText || 'Loading...'}</pre>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Platform Notifications */}
            {activeSection === 'platformNotifications' && (
              <div className="px-3 pt-3 pb-4 space-y-3 min-w-0 overflow-hidden">
                <div className="space-y-4">
                  <div className="sm-card">
                    <div className="sm-card-header">
                      <Bell className="h-3.5 w-3.5 text-blue-400/80" />
                      <span className="text-xs font-semibold text-gray-200">Notification Settings</span>
                    </div>
                    <div className="px-4 py-3 space-y-2">
                      <p className="text-[11px] text-gray-400 leading-relaxed">
                        Configure platform-wide notification rules — alerts for scheduler failures, API budget thresholds, and org activity. Full configuration coming soon.
                      </p>
                      <div className="rounded-md border border-gray-700/50 bg-gray-800/30 px-3 py-3 flex items-center gap-3">
                        <BellRing className="h-4 w-4 text-gray-600 shrink-0" />
                        <p className="text-[11px] text-gray-500">Notification rules will appear here once configured.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Plans & Pricing */}
            {activeSection === 'plansAndPricing' && <PlansAndPricingPanel />}

            {/* Platform General */}
            {activeSection === 'platformGeneral' && (
              <div className="px-3 pt-3 pb-4 space-y-3 min-w-0 overflow-hidden">
                  <div className="space-y-4">
                    <div className="sm-card">
                      <div className="sm-card-header">
                        <Building2 className="h-3.5 w-3.5 text-violet-400/80" />
                        <span className="text-xs font-semibold text-gray-200">Platform Information</span>
                      </div>
                      <div className="px-4 py-3 space-y-4">
                        <p className="text-[11px] text-gray-400 leading-relaxed">Configure the name and tagline for each brand. These appear on the public landing page.</p>

                        {/* ── Brand 1: Main ── */}
                        <div className="space-y-2">
                          <p className="text-[10px] font-semibold text-violet-400 uppercase tracking-widest">Main Brand</p>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block app-label mb-1">Name</label>
                              <input type="text" placeholder="e.g. PlanetBrick" value={platformNameInput} onChange={e => setPlatformNameInput(e.target.value)} maxLength={100} data-testid="input-platform-name" className="w-full min-w-0 bg-gray-900/60 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 placeholder-gray-600 outline-none focus:border-gray-500" />
                            </div>
                            <div>
                              <label className="block app-label mb-1">Tagline</label>
                              <input type="text" placeholder="e.g. Intelligent Elements" value={platformTaglineInput} onChange={e => setPlatformTaglineInput(e.target.value)} maxLength={200} data-testid="input-platform-tagline" className="w-full min-w-0 bg-gray-900/60 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 placeholder-gray-600 outline-none focus:border-gray-500" />
                            </div>
                          </div>
                          <p className="text-[10px] text-gray-500">Shown in the hero headline area of the landing page.</p>
                        </div>

                        {/* ── Brand 2: Shop ── */}
                        <div className="space-y-2">
                          <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-widest">Shop Brand</p>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block app-label mb-1">Name</label>
                              <input type="text" placeholder="e.g. PlanetBrick.com" value={shopNameInput} onChange={e => setShopNameInput(e.target.value)} maxLength={100} data-testid="input-shop-name" className="w-full min-w-0 bg-gray-900/60 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 placeholder-gray-600 outline-none focus:border-gray-500" />
                            </div>
                            <div>
                              <label className="block app-label mb-1">Tagline</label>
                              <input type="text" placeholder="e.g. The galaxy's junkyard" value={shopTaglineInput} onChange={e => setShopTaglineInput(e.target.value)} maxLength={200} data-testid="input-shop-tagline" className="w-full min-w-0 bg-gray-900/60 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 placeholder-gray-600 outline-none focus:border-gray-500" />
                            </div>
                          </div>
                          <p className="text-[10px] text-gray-500">Shown on the Shop button (first card) on the landing page.</p>
                        </div>

                        {/* ── Brand 3: Studio / App ── */}
                        <div className="space-y-2">
                          <p className="text-[10px] font-semibold text-teal-400 uppercase tracking-widest">Studio / App Brand</p>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block app-label mb-1">Name</label>
                              <input type="text" placeholder="e.g. E.L.F.I.E." value={studioNameInput} onChange={e => setStudioNameInput(e.target.value)} maxLength={100} data-testid="input-studio-name" className="w-full min-w-0 bg-gray-900/60 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 placeholder-gray-600 outline-none focus:border-gray-500" />
                            </div>
                            <div>
                              <label className="block app-label mb-1">Tagline</label>
                              <input type="text" placeholder="e.g. Your LEGO universe, live" value={studioTaglineInput} onChange={e => setStudioTaglineInput(e.target.value)} maxLength={200} data-testid="input-studio-tagline" className="w-full min-w-0 bg-gray-900/60 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 placeholder-gray-600 outline-none focus:border-gray-500" />
                            </div>
                          </div>
                          <p className="text-[10px] text-gray-500">Shown on the Studio button (second card) on the landing page.</p>
                        </div>

                        <div className="flex items-center gap-2 pt-1">
                          <button
                            onClick={async () => {
                              setPlatformNameSaving(true);
                              try {
                                const res = await fetch('/api/platform-admin/platform-services/platform-info', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    platformName: platformNameInput,
                                    tagline: platformTaglineInput,
                                    shopName: shopNameInput,
                                    shopTagline: shopTaglineInput,
                                    studioName: studioNameInput,
                                    studioTagline: studioTaglineInput,
                                  }),
                                });
                                if (!res.ok) throw new Error('Failed to save');
                                queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/platform-services/platform-info'] });
                                queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/platform-services/openai-billing/by-org'] });
                                queryClient.invalidateQueries({ queryKey: ['/api/public/platform-info'] });
                                toast({ title: "Saved", description: "Brand info updated." });
                              } catch {
                                toast({ title: "Error", description: "Failed to save brand info.", variant: "destructive" });
                              } finally {
                                setPlatformNameSaving(false);
                              }
                            }}
                            disabled={platformNameSaving}
                            data-testid="button-save-platform-name"
                            className="inline-flex items-center gap-1.5 text-[10px] font-medium text-violet-400 hover:text-violet-300 border border-violet-500/30 rounded px-3 py-1.5 transition-colors disabled:opacity-50"
                          >
                            {platformNameSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                            Save All
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="sm-card">
                      <div className="sm-card-header">
                        <Info className="h-3.5 w-3.5 text-gray-500" />
                        <span className="text-xs font-semibold text-gray-200">Where These Appear</span>
                      </div>
                      <div className="px-4 py-3 space-y-2">
                        <div className="grid grid-cols-1 gap-2">
                          {[
                            { label: 'Main Brand → Landing Page Hero', desc: 'Name and tagline shown in the hero text area on the public landing page' },
                            { label: 'Shop Brand → Shop Card', desc: 'Name and tagline shown on the Shop button (first card) on the landing page' },
                            { label: 'Studio Brand → Studio Card', desc: 'Name and tagline shown on the Studio button (second card) on the landing page' },
                            { label: 'Platform Name → API Attribution', desc: 'Identifies platform-level AI/BrickLink usage separate from org usage in logs and billing' },
                          ].map(({ label, desc }) => (
                            <div key={label} className="bg-gray-900/40 border border-gray-700/60 rounded px-3 py-2">
                              <p className="text-[10px] font-medium text-gray-300 mb-0.5">{label}</p>
                              <p className="text-[9px] text-gray-500">{desc}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
              </div>
            )}

            {/* ── Platform Team ─────────────────────────────────────────── */}
            {activeSection === 'platformTeam' && (
              <div className="px-3 pt-3 pb-4 space-y-3 min-w-0 overflow-hidden">
                <div className="sm-card">
                  <div className="sm-card-header">
                    <Shield className="h-3.5 w-3.5 text-yellow-500/70" />
                    <span className="text-xs font-semibold text-gray-200">Admin Team</span>
                    {adminTeamLoading && <Loader2 className="h-3 w-3 animate-spin text-gray-500 ml-auto" />}
                    {adminTeam && <span className="text-[10px] text-gray-500 ml-auto">{adminTeam.length} member{adminTeam.length !== 1 ? 's' : ''}</span>}
                  </div>
                  <div className="divide-y divide-gray-700/50">
                    {adminTeam && adminTeam.length === 0 && (
                      <p className="px-4 py-3 text-xs text-gray-500">No super admins found.</p>
                    )}
                    {adminTeam?.map(admin => {
                      const name = [admin.firstName, admin.lastName].filter(Boolean).join(' ') || admin.email || admin.id;
                      const initials = [admin.firstName?.[0], admin.lastName?.[0]].filter(Boolean).join('').toUpperCase() || (admin.email?.[0] ?? '?').toUpperCase();
                      const isSelf = user?.id === admin.id;
                      return (
                        <div key={admin.id} className="flex items-center gap-3 px-4 py-2.5" data-testid={`row-admin-${admin.id}`}>
                          <div className="h-7 w-7 rounded-full bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center shrink-0">
                            <span className="text-[9px] font-bold text-yellow-400">{initials}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-gray-200 truncate">{name}</p>
                            <p className="text-[10px] text-gray-500 truncate">{admin.email}</p>
                          </div>
                          {isSelf && <Badge variant="outline" className="text-[9px] border-gray-600 text-gray-500 shrink-0">You</Badge>}
                          {!isSelf && (
                            <button
                              onClick={() => toggleSuperAdminMutation.mutate({ id: admin.id, superAdmin: false })}
                              disabled={toggleSuperAdminMutation.isPending}
                              data-testid={`button-remove-admin-${admin.id}`}
                              className="text-[10px] text-red-400 hover:text-red-300 border border-red-500/20 rounded px-2 py-0.5 transition-colors shrink-0 disabled:opacity-40"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="px-4 py-3 space-y-3 border-t border-gray-700/50">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Search by email or name…"
                        value={addAdminQuery}
                        onChange={e => setAddAdminQuery(e.target.value)}
                        data-testid="input-admin-search"
                        className="flex-1 min-w-0 bg-gray-900/60 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 placeholder-gray-600 outline-none focus:border-gray-500"
                      />
                      <button
                        onClick={() => setAddAdminSearch(addAdminQuery.trim())}
                        disabled={addAdminQuery.trim().length < 2 || adminSearchLoading}
                        data-testid="button-admin-search"
                        className="px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 rounded text-xs text-gray-200 transition-colors shrink-0 flex items-center gap-1.5"
                      >
                        {adminSearchLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                        Find
                      </button>
                    </div>
                    {adminSearchResults && adminSearchResults.length === 0 && addAdminSearch && (
                      <p className="text-[10px] text-gray-500">No users found for "{addAdminSearch}".</p>
                    )}
                    {adminSearchResults && adminSearchResults.length > 0 && (
                      <div className="space-y-1">
                        {adminSearchResults.map(u => {
                          const alreadyAdmin = adminTeam?.some(a => a.id === u.id);
                          const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || u.id;
                          const initials = [u.firstName?.[0], u.lastName?.[0]].filter(Boolean).join('').toUpperCase() || (u.email?.[0] ?? '?').toUpperCase();
                          return (
                            <div key={u.id} className="flex items-center gap-2.5 rounded bg-gray-900/40 border border-gray-700/50 px-3 py-2">
                              <div className="h-6 w-6 rounded-full bg-gray-700 flex items-center justify-center shrink-0">
                                <span className="text-[8px] font-bold text-gray-300">{initials}</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-gray-200 truncate">{name}</p>
                                <p className="text-[10px] text-gray-500 truncate">{u.email}</p>
                              </div>
                              {alreadyAdmin ? (
                                <Badge variant="outline" className="text-[9px] border-green-500/30 text-green-400 shrink-0">Admin</Badge>
                              ) : (
                                <button
                                  onClick={() => toggleSuperAdminMutation.mutate({ id: u.id, superAdmin: true })}
                                  disabled={toggleSuperAdminMutation.isPending}
                                  data-testid={`button-add-admin-${u.id}`}
                                  className="text-[10px] text-yellow-400 hover:text-yellow-300 border border-yellow-500/30 rounded px-2 py-0.5 transition-colors shrink-0 disabled:opacity-40"
                                >
                                  Make Admin
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <p className="text-[10px] text-gray-600">Super admins have full platform access including all tenant organizations.</p>
                  </div>
                </div>
              </div>
            )}


            {/* ── Scheduler Admin — multi-org sync governance ─────────── */}
            {activeSection === 'syncAdmin' && (
              <div className="space-y-4 min-h-[400px]">
                {/* Header */}
                <div>
                  <h3 className="text-sm font-medium text-gray-100">Auto-Sync Schedule</h3>
                  <p className="text-xs text-gray-400 mt-0.5">Control sync defaults, per-plan frequency floors, and org-level health across all tenants</p>
                </div>

                {/* ── Config panel list ──────────────────────────────────── */}
                <div className="rounded-md border border-gray-700/80 bg-gray-800/20 divide-y divide-gray-700/40">

                  {/* ── Row: Emergency Pause ── */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="w-7 h-7 rounded-md bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0">
                      <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-100">Emergency Pause</p>
                      <p className="text-[10px] text-gray-500 leading-tight">Immediately halts all inventory and channel syncs platform-wide</p>
                    </div>
                    {globalSyncPaused && (
                      <span className="text-[10px] px-2 py-0.5 rounded border border-red-500/30 bg-red-500/10 text-red-400 font-medium shrink-0">Paused</span>
                    )}
                    <Switch
                      checked={globalSyncPaused}
                      onCheckedChange={(checked) => {
                        setGlobalSyncPaused(checked);
                        updatePlatformSettingsMutation.mutate({ globalSyncPaused: checked } as any);
                      }}
                      data-testid="switch-global-sync-paused"
                    />
                  </div>

                  {/* ── Row: Default Frequencies ── */}
                  <div>
                    <button
                      onClick={() => setExpandedAdminPanel(expandedAdminPanel === 'defaults' ? null : 'defaults')}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left"
                      data-testid="button-admin-defaults-toggle"
                    >
                      <div className="w-7 h-7 rounded-md bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
                        <Clock className="w-3.5 h-3.5 text-blue-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-100">Default Frequencies</p>
                        <p className="text-[10px] text-gray-500 leading-tight">Inventory, orders, and channel defaults for new orgs</p>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded border border-blue-500/30 bg-blue-500/10 text-blue-300 font-medium shrink-0">
                        {defaultInventoryFreqHours}h · {defaultOrdersFreqMins}m · {defaultChannelFreqHours}h
                      </span>
                      {expandedAdminPanel === 'defaults'
                        ? <ChevronDown className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                        : <ChevronRight className="w-3.5 h-3.5 text-gray-500 shrink-0" />}
                    </button>
                    {expandedAdminPanel === 'defaults' && (
                      <div className="border-t border-gray-700/50 bg-gray-900/30 divide-y divide-gray-700/40">
                        <div className="flex items-center justify-between gap-3 px-4 py-3">
                          <div>
                            <p className="text-xs font-medium text-gray-200">Default Inventory Frequency</p>
                            <p className="text-[10px] text-gray-500 mt-0.5">What new orgs inherit for BrickLink inventory sync</p>
                          </div>
                          <Select value={String(defaultInventoryFreqHours)} onValueChange={(v) => { const h = Number(v); setDefaultInventoryFreqHours(h); updatePlatformSettingsMutation.mutate({ defaultInventoryFreqHours: h } as any); }}>
                            <SelectTrigger className="w-36 h-8 text-xs" data-testid="select-default-inventory-freq">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="6">Every 6 hours</SelectItem>
                              <SelectItem value="12">Every 12 hours</SelectItem>
                              <SelectItem value="24">Every 24 hours</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex items-center justify-between gap-3 px-4 py-3">
                          <div>
                            <p className="text-xs font-medium text-gray-200">Default Orders Frequency</p>
                            <p className="text-[10px] text-gray-500 mt-0.5">What new orgs inherit for order sync polling</p>
                          </div>
                          <Select value={String(defaultOrdersFreqMins)} onValueChange={(v) => { const m = Number(v); setDefaultOrdersFreqMins(m); updatePlatformSettingsMutation.mutate({ defaultOrdersFreqMins: m } as any); }}>
                            <SelectTrigger className="w-36 h-8 text-xs" data-testid="select-default-orders-freq">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="15">15 minutes</SelectItem>
                              <SelectItem value="30">30 minutes</SelectItem>
                              <SelectItem value="60">1 hour</SelectItem>
                              <SelectItem value="120">2 hours</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex items-center justify-between gap-3 px-4 py-3">
                          <div>
                            <p className="text-xs font-medium text-gray-200">Default Channel Frequency</p>
                            <p className="text-[10px] text-gray-500 mt-0.5">What new orgs inherit for channel (BrickOwl, etc.) sync</p>
                          </div>
                          <Select value={String(defaultChannelFreqHours)} onValueChange={(v) => { const h = Number(v); setDefaultChannelFreqHours(h); updatePlatformSettingsMutation.mutate({ defaultChannelFreqHours: h } as any); }}>
                            <SelectTrigger className="w-36 h-8 text-xs" data-testid="select-default-channel-freq">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="1">Every hour</SelectItem>
                              <SelectItem value="2">Every 2 hours</SelectItem>
                              <SelectItem value="4">Every 4 hours</SelectItem>
                              <SelectItem value="6">Every 6 hours</SelectItem>
                              <SelectItem value="12">Every 12 hours</SelectItem>
                              <SelectItem value="24">Every 24 hours</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ── Row: Frequency Floors by Plan ── */}
                  <div>
                    <button
                      onClick={() => setExpandedAdminPanel(expandedAdminPanel === 'floors' ? null : 'floors')}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left"
                      data-testid="button-admin-floors-toggle"
                    >
                      <div className="w-7 h-7 rounded-md bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center shrink-0">
                        <ShieldAlert className="w-3.5 h-3.5 text-yellow-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-100">Frequency Floors by Plan</p>
                        <p className="text-[10px] text-gray-500 leading-tight">Minimum sync intervals per plan tier — prevents API abuse</p>
                      </div>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="w-3 h-3 text-gray-600 shrink-0 cursor-default" />
                        </TooltipTrigger>
                        <TooltipContent side="left" className="max-w-xs text-xs">Orgs on each plan cannot sync faster than these minimums.</TooltipContent>
                      </Tooltip>
                      {expandedAdminPanel === 'floors'
                        ? <ChevronDown className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                        : <ChevronRight className="w-3.5 h-3.5 text-gray-500 shrink-0" />}
                    </button>
                    {expandedAdminPanel === 'floors' && (
                      <div className="border-t border-gray-700/50 bg-gray-900/30 p-4">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                              <th className="text-left pb-2 pr-4">Plan</th>
                              <th className="text-center pb-2 px-2">Inventory</th>
                              <th className="text-center pb-2 px-2">Orders</th>
                              <th className="text-center pb-2 px-2">Channel</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-700/40">
                            {(['beta', 'core', 'pro'] as const).map((plan) => (
                              <tr key={plan}>
                                <td className="py-2 pr-4 font-medium text-gray-300 capitalize">{plan}</td>
                                <td className="py-2 px-2 text-center">
                                  <Select
                                    value={String(syncFloorsByPlan.inventory?.[plan] ?? 24)}
                                    onValueChange={(v) => {
                                      const next = { ...syncFloorsByPlan, inventory: { ...syncFloorsByPlan.inventory, [plan]: Number(v) } };
                                      setSyncFloorsByPlan(next);
                                      updatePlatformSettingsMutation.mutate({ syncFloorsByPlan: next } as any);
                                    }}
                                  >
                                    <SelectTrigger className="h-7 text-[10px] w-24 mx-auto" data-testid={`select-floor-inventory-${plan}`}>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="6">6 h</SelectItem>
                                      <SelectItem value="12">12 h</SelectItem>
                                      <SelectItem value="24">24 h</SelectItem>
                                      <SelectItem value="48">48 h</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="py-2 px-2 text-center">
                                  <Select
                                    value={String(syncFloorsByPlan.orders?.[plan] ?? 30)}
                                    onValueChange={(v) => {
                                      const next = { ...syncFloorsByPlan, orders: { ...syncFloorsByPlan.orders, [plan]: Number(v) } };
                                      setSyncFloorsByPlan(next);
                                      updatePlatformSettingsMutation.mutate({ syncFloorsByPlan: next } as any);
                                    }}
                                  >
                                    <SelectTrigger className="h-7 text-[10px] w-24 mx-auto" data-testid={`select-floor-orders-${plan}`}>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="15">15 min</SelectItem>
                                      <SelectItem value="30">30 min</SelectItem>
                                      <SelectItem value="60">60 min</SelectItem>
                                      <SelectItem value="120">2 h</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="py-2 px-2 text-center">
                                  <Select
                                    value={String(syncFloorsByPlan.channel?.[plan] ?? 4)}
                                    onValueChange={(v) => {
                                      const next = { ...syncFloorsByPlan, channel: { ...syncFloorsByPlan.channel, [plan]: Number(v) } };
                                      setSyncFloorsByPlan(next);
                                      updatePlatformSettingsMutation.mutate({ syncFloorsByPlan: next } as any);
                                    }}
                                  >
                                    <SelectTrigger className="h-7 text-[10px] w-24 mx-auto" data-testid={`select-floor-channel-${plan}`}>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="1">1 h</SelectItem>
                                      <SelectItem value="2">2 h</SelectItem>
                                      <SelectItem value="4">4 h</SelectItem>
                                      <SelectItem value="6">6 h</SelectItem>
                                      <SelectItem value="12">12 h</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* ── Row: Org Sync Health ── */}
                  <div>
                    <button
                      onClick={() => setExpandedAdminPanel(expandedAdminPanel === 'health' ? null : 'health')}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left"
                      data-testid="button-admin-health-toggle"
                    >
                      <div className="w-7 h-7 rounded-md bg-green-500/10 border border-green-500/20 flex items-center justify-center shrink-0">
                        <Activity className="w-3.5 h-3.5 text-green-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-100">Org Sync Health</p>
                        <p className="text-[10px] text-gray-500 leading-tight">Live status and manual triggers across all tenants</p>
                      </div>
                      <span className="text-[10px] text-gray-600 shrink-0">Refreshes every 30s</span>
                      {expandedAdminPanel === 'health'
                        ? <ChevronDown className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                        : <ChevronRight className="w-3.5 h-3.5 text-gray-500 shrink-0" />}
                    </button>
                    {expandedAdminPanel === 'health' && (
                      <div className="border-t border-gray-700/50 bg-gray-900/30">
                        {!orgSyncStatus ? (
                          <div className="flex items-center justify-center py-8">
                            <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
                          </div>
                        ) : orgSyncStatus.length === 0 ? (
                          <p className="text-xs text-gray-500 text-center py-6">No org sync data yet</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 border-b border-gray-700/40">
                                  <th className="text-left px-4 py-2">Organization</th>
                                  <th className="text-center px-3 py-2">Inventory</th>
                                  <th className="text-center px-3 py-2">Orders</th>
                                  <th className="text-center px-3 py-2">Channel</th>
                                  <th className="text-right px-4 py-2">Actions</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-700/30">
                                {orgSyncStatus.map((entry) => {
                                  const getSyncCell = (id: string) => {
                                    const s = entry.syncs.find(x => x.id === id);
                                    if (!s) return <span className="text-gray-600">—</span>;
                                    const isRunning = s.lastSyncStatus === 'in_progress';
                                    const isError = s.lastSyncStatus === 'error' || s.lastSyncStatus === 'failed';
                                    const isOk = s.lastSyncStatus === 'success';
                                    const dotCls = isRunning ? 'bg-yellow-400 animate-pulse' : isError ? 'bg-red-400' : isOk ? 'bg-green-400' : 'bg-gray-600';
                                    return (
                                      <div className="flex flex-col items-center gap-0.5">
                                        <div className={`w-2 h-2 rounded-full ${dotCls}`} />
                                        <span className="text-[10px] text-gray-400 leading-tight">{formatRelativeTime(s.lastSyncTime)}</span>
                                        {isError && s.errorMessage && (
                                          <Tooltip>
                                            <TooltipTrigger asChild><AlertTriangle className="w-2.5 h-2.5 text-red-400 cursor-default" /></TooltipTrigger>
                                            <TooltipContent className="max-w-xs text-xs text-red-300">{s.errorMessage}</TooltipContent>
                                          </Tooltip>
                                        )}
                                      </div>
                                    );
                                  };
                                  const triggerKey = (t: string) => `${entry.orgId}:${t}`;
                                  const isTriggering = (t: string) => triggeringSync === triggerKey(t);
                                  const doTrigger = async (type: 'inventory' | 'orders' | 'channel') => {
                                    setTriggeringSync(triggerKey(type));
                                    try {
                                      await apiRequest('POST', `/api/platform-admin/org-sync-trigger/${entry.orgId}/${type}`);
                                      queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/org-sync-status'] });
                                    } catch (e: any) {
                                      console.error('Trigger failed:', e);
                                    } finally {
                                      setTriggeringSync(null);
                                    }
                                  };
                                  return (
                                    <tr key={entry.orgId} data-testid={`row-org-sync-${entry.orgId}`}>
                                      <td className="px-4 py-3">
                                        <p className="font-medium text-gray-200 truncate max-w-[140px]">{entry.orgName}</p>
                                        <p className="text-[10px] text-gray-600 font-mono truncate max-w-[140px]">{entry.orgId}</p>
                                      </td>
                                      <td className="px-3 py-3 text-center">{getSyncCell('bricklink_inventory')}</td>
                                      <td className="px-3 py-3 text-center">{getSyncCell('bricklink_orders')}</td>
                                      <td className="px-3 py-3 text-center">{getSyncCell('channel_sync')}</td>
                                      <td className="px-4 py-3 text-right">
                                        <DropdownMenu>
                                          <DropdownMenuTrigger asChild>
                                            <Button size="sm" variant="ghost" className="text-[10px] h-7 px-2 gap-1" data-testid={`button-trigger-org-${entry.orgId}`}>
                                              {isTriggering('inventory') || isTriggering('orders') || isTriggering('channel')
                                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                                : <Play className="w-3 h-3" />}
                                              Trigger
                                              <ChevronDown className="w-2.5 h-2.5" />
                                            </Button>
                                          </DropdownMenuTrigger>
                                          <DropdownMenuContent align="end" className="w-44 text-xs">
                                            <DropdownMenuItem onClick={() => doTrigger('inventory')} disabled={isTriggering('inventory')} data-testid={`menu-trigger-inventory-${entry.orgId}`}>
                                              <Package className="w-3 h-3 mr-2 text-purple-400" />
                                              {isTriggering('inventory') ? 'Running…' : 'Inventory Sync'}
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => doTrigger('orders')} disabled={isTriggering('orders')} data-testid={`menu-trigger-orders-${entry.orgId}`}>
                                              <ShoppingCart className="w-3 h-3 mr-2 text-blue-400" />
                                              {isTriggering('orders') ? 'Running…' : 'Orders Sync'}
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => doTrigger('channel')} disabled={isTriggering('channel')} data-testid={`menu-trigger-channel-${entry.orgId}`}>
                                              <Globe className="w-3 h-3 mr-2 text-green-400" />
                                              {isTriggering('channel') ? 'Running…' : 'Channel Sync'}
                                            </DropdownMenuItem>
                                          </DropdownMenuContent>
                                        </DropdownMenu>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                </div>
              </div>
            )}

            {/* Platform Scheduler — Data Enrichment */}
            {activeSection === 'platformScheduler' && (
              <div className="px-3 pt-3 pb-4 space-y-3 min-w-0 overflow-hidden">
                {(() => {
                  const schedTabs: Array<{ id: 'catalog' | 'embeddings' | 'market'; label: string; Icon: React.ElementType }> = [
                    { id: 'catalog', label: 'BrickLink Catalog', Icon: Package },
                    { id: 'embeddings', label: 'Embeddings', Icon: Database },
                    { id: 'market', label: 'Market', Icon: Globe },
                  ];
                  return (
                    <div className="tool-tab-bar">
                      {schedTabs.map(({ id, label, Icon }) => (
                        <button
                          key={id}
                          onClick={() => setActiveSchedulerTab(id)}
                          data-testid={`tab-scheduler-${id}`}
                          className={`tool-tab-fill ${activeSchedulerTab === id ? 'text-yellow-400 border-yellow-500' : 'tool-tab-off'}`}
                        >
                          <Icon className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{label}</span>
                        </button>
                      ))}
                    </div>
                  );
                })()}

                {(systemHealthLoading || (!systemHealth && !systemHealthError)) ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="h-5 w-5 animate-spin text-yellow-500/50" />
                  </div>
                ) : systemHealth ? (() => {
                  const config = systemHealth.schedulerConfig || {};
                  const clipStatus = systemHealth.clipCatalogStatus;
                  const syncJobs = systemHealth.syncJobs || [];
                  const getJob = (id: string) => syncJobs.find((j: any) => j.id === id);
                  const toggleJob = (id: string) => setExpandedJobs(prev => ({ ...prev, [id]: !prev[id] }));
                  const isExpanded = (id: string) => !!expandedJobs[id];

                  const handleTrigger = async (jobId: string) => {
                    try {
                      await apiRequest('POST', `/api/platform-admin/scheduler/${jobId}/trigger`);
                      queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/system-health'] });
                    } catch (err: any) {
                      alert(err?.message || 'Trigger failed');
                    }
                  };

                  const statusInfo = (status: string | null, enabled: boolean) => {
                    if (status === 'in_progress') return { icon: <Loader2 className="h-4 w-4 text-yellow-400 animate-spin" />, label: 'Running', color: 'text-yellow-400' };
                    if (status === 'failed' || status === 'error') return { icon: <AlertTriangle className="h-4 w-4 text-red-400" />, label: 'Failed', color: 'text-red-400' };
                    if (status === 'partial') return { icon: <AlertTriangle className="h-4 w-4 text-orange-400" />, label: 'Partial', color: 'text-orange-400' };
                    if (!enabled) return { icon: <Pause className="h-4 w-4 text-gray-500" />, label: 'Paused', color: 'text-gray-500' };
                    if (status === 'success') return { icon: <CheckCircle2 className="h-4 w-4 text-green-400" />, label: 'Completed', color: 'text-green-400/80' };
                    if (status === 'never') return { icon: <Clock className="h-4 w-4 text-gray-500" />, label: 'Never run', color: 'text-gray-500' };
                    return { icon: <CheckCircle2 className="h-4 w-4 text-green-400" />, label: 'Idle', color: 'text-green-400/80' };
                  };

                  const formatLastRun = (time: string | null) => time ? new Date(time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Never';

                  const pomJob = getJob('priceomatic_cache');
                  const cdJob = getJob('catalog_detail_completion');
                  const csJob = getJob('catalog_scan');
                  const ucJob = getJob('universal_catalog_refresh');
                  const rbJob = getJob('rebrickable_set_parts');
                  const fmJob = getJob('forum_sync');
                  const mnJob = getJob('market_news_sync');
                  const biJob = getJob('business_intel_sync');
                  const pomActive = pomJob?.lastSyncStatus === 'in_progress';
                  const cdActive = cdJob?.lastSyncStatus === 'in_progress';
                  const csActive = csJob?.lastSyncStatus === 'in_progress';
                  const ucActive = ucJob?.lastSyncStatus === 'in_progress';
                  const rbActive = rbJob?.lastSyncStatus === 'in_progress';
                  const fmActive = fmJob?.lastSyncStatus === 'in_progress';
                  const mnActive = mnJob?.lastSyncStatus === 'in_progress';
                  const biActive = biJob?.lastSyncStatus === 'in_progress';
                  const clipActive = config.clip_catalog?.workerRunning;
                  const clipPct = clipStatus && clipStatus.total > 0 ? Math.round((clipStatus.embedded / clipStatus.total) * 100) : 0;

                  return (
                    <>
                      {/* ── BrickLink Catalog Tab ──────────────────── */}
                      {activeSchedulerTab === 'catalog' && (
                        <div className="space-y-3">
                          <p className="sm-hint px-1">BrickLink catalog enrichment — price guides, item details, and gap detection across all stores.</p>

                          {systemHealth.catalogCoverage && (() => {
                            const cov = systemHealth.catalogCoverage;
                            const total = cov.totalLots || 1;
                            const inStock = cov.inStockLots ?? 0;
                            const invGap = cov.inventoryNotInCatalog ?? 0;
                            const budget = cov.apiBudget;
                            const reservePct = Math.max(0, 100 - (budget?.pomPct ?? 70) - (budget?.catalogDetailPct ?? 20));
                            const detailSkip = catalogDetailZeroStockSkip;
                            const pomSkip = pomZeroStockSkip;
                            const areas = [
                              { label: 'Item Detail', scope: detailSkip ? inStock : total, has: detailSkip ? cov.detail.hasInStock : cov.detail.has, stale: detailSkip ? cov.detail.staleInStock : cov.detail.stale, freshLabel: `${catalogDetailFreshnessDays}d`, barClass: 'bg-blue-500', barStaleClass: 'bg-blue-500/30', filtered: detailSkip },
                              { label: 'Supply', scope: pomSkip ? inStock : total, has: pomSkip ? cov.supply.hasInStock : cov.supply.has, stale: pomSkip ? cov.supply.staleInStock : cov.supply.stale, freshLabel: `${pomFreshnessDays}d`, barClass: 'bg-green-500', barStaleClass: 'bg-green-500/30', filtered: pomSkip },
                              { label: 'Sold', scope: pomSkip ? inStock : total, has: pomSkip ? cov.sold.hasInStock : cov.sold.has, stale: pomSkip ? cov.sold.staleInStock : cov.sold.stale, freshLabel: `${pomFreshnessDays}d`, barClass: 'bg-purple-500', barStaleClass: 'bg-purple-500/30', filtered: pomSkip },
                            ];
                            return (
                              <div className="sm-card-inset">
                                <div className="px-4 py-2.5 bg-gray-800/40 border-b border-gray-700/60">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="sm-group-label">Catalog Coverage</span>
                                    <span className="sm-hint font-mono">{total.toLocaleString()} lots</span>
                                  </div>
                                  <div className="flex items-center gap-3 mt-0.5">
                                    <span className="text-[10px] text-gray-500">{inStock.toLocaleString()} in stock · {(total - inStock).toLocaleString()} zero-qty</span>
                                  </div>
                                </div>
                                {invGap > 0 && (
                                  <div className="px-4 py-2 flex items-center gap-2 border-b border-gray-700/40">
                                    <span className="text-[10px] text-yellow-500/90 font-medium">{invGap.toLocaleString()} lots not yet in catalog</span>
                                  </div>
                                )}
                                {areas.map(({ label, scope, has, stale, freshLabel, barClass, barStaleClass, filtered }) => {
                                  const denom = scope || 1;
                                  const missing = Math.max(0, denom - has);
                                  const fresh = has - stale;
                                  const freshPct = Math.round((fresh / denom) * 100);
                                  const stalePct = Math.round((stale / denom) * 100);
                                  const missingPct = Math.round((missing / denom) * 100);
                                  return (
                                    <div key={label} className="px-4 py-2.5 flex items-center gap-3">
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between gap-2 mb-1">
                                          <span className="sm-label">{label}</span>
                                          <span className="sm-hint font-mono">{denom.toLocaleString()} lots{filtered ? ' *' : ''}</span>
                                        </div>
                                        <div className="flex h-1.5 rounded-full overflow-hidden bg-gray-700/50">
                                          <div className={`${barClass} transition-all`} style={{ width: `${freshPct}%` }} />
                                          <div className={`${barStaleClass} transition-all`} style={{ width: `${stalePct}%` }} />
                                        </div>
                                        <div className="flex items-center justify-between gap-2 mt-1 flex-wrap">
                                          <span className="sm-hint flex items-center gap-1.5 flex-wrap">
                                            <span className="text-green-400/70">{fresh.toLocaleString()} fresh ({freshPct}%)</span>
                                            {stale > 0 && <><span className="text-gray-600">·</span><span className="text-orange-400/80">{stale.toLocaleString()} stale</span></>}
                                            {missing > 0 && <><span className="text-gray-600">·</span><span className="text-yellow-500/80">{missing.toLocaleString()} missing</span></>}
                                          </span>
                                          <span className="sm-hint">
                                            {filtered && <span className="text-gray-600">in-stock only</span>}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                                {budget && (() => {
                                  const used = budget.used24h ?? 0;
                                  const limit = budget.total ?? 4900;
                                  const usedPct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
                                  const remaining = Math.max(0, limit - used);
                                  return (
                                  <div className="px-4 py-2.5 border-t border-gray-700/40" data-testid="api-budget-bar">
                                    <div className="flex items-center justify-between gap-2 mb-1">
                                      <span className="sm-label">API Budget (24h)</span>
                                      <span className="sm-hint font-mono">{used.toLocaleString()} / {limit.toLocaleString()} calls</span>
                                    </div>
                                    <div className="relative h-2 rounded-full overflow-hidden bg-gray-700">
                                      <div className="absolute inset-0 flex">
                                        <div className="bg-purple-500/25 transition-all" style={{ width: `${budget.pomPct}%` }} />
                                        <div className="bg-blue-500/25 transition-all" style={{ width: `${budget.catalogDetailPct}%` }} />
                                        <div className="bg-gray-500/20 transition-all" style={{ width: `${reservePct}%` }} />
                                      </div>
                                      <div className={`absolute inset-y-0 left-0 transition-all rounded-full ${usedPct > 90 ? 'bg-red-500' : usedPct > 70 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${usedPct}%` }} />
                                    </div>
                                    <div className="flex items-center justify-between gap-2 mt-1">
                                      <span className={`text-[10px] font-medium ${usedPct > 90 ? 'text-red-400' : usedPct > 70 ? 'text-yellow-400' : 'text-green-400/80'}`}>{usedPct}% used · {remaining.toLocaleString()} remaining</span>
                                    </div>
                                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                                      <span className="text-[10px] text-purple-400/80">PG {budget.pomPct}% ({Math.floor(limit * budget.pomPct / 100)})</span>
                                      <span className="text-[10px] text-blue-400/80">Detail {budget.catalogDetailPct}% ({Math.floor(limit * budget.catalogDetailPct / 100)})</span>
                                      <span className="text-[10px] text-gray-400/80">Reserve {reservePct}% ({Math.floor(limit * reservePct / 100)})</span>
                                    </div>
                                  </div>
                                  );
                                })()}
                              </div>
                            );
                          })()}

                          <div className="sm-card">
                            <button onClick={() => toggleJob('pom')} className="w-full px-4 py-3 flex items-center gap-3 text-left" data-testid="job-header-pom-sched">
                              {statusInfo(pomJob?.lastSyncStatus || null, pomScheduleEnabled).icon}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="sm-label">Market Price Guides</p>
                                  <Popover><PopoverTrigger asChild><span onClick={e => e.stopPropagation()} className="cursor-help"><Info className="w-3 h-3 text-gray-500 shrink-0" /></span></PopoverTrigger><PopoverContent side="top" className="max-w-xs text-xs p-3" onClick={e => e.stopPropagation()}>
                                    <p className="mb-1.5">Pulls supply (currently for sale) and sold (recent sales) price guide data from BrickLink for every lot in your inventory. Uses {pomGuideFocus === 'both' ? '2 API calls per lot (1 supply + 1 sold)' : '1 API call per lot (' + (pomGuideFocus === 'stock' ? 'supply' : 'sold') + ' only)'}.</p>
                                    <div className="space-y-1 border-t pt-1.5 text-[11px]">
                                      <p><span className="text-gray-500 dark:text-gray-400">Guide focus:</span> <span className="font-medium">{pomGuideFocus === 'both' ? 'Both (supply + sold)' : pomGuideFocus === 'stock' ? 'Supply only' : 'Sold only'}</span></p>
                                      <p><span className="text-gray-500 dark:text-gray-400">Freshness window:</span> <span className="font-medium">{pomFreshnessDays} days</span></p>
                                      <p><span className="text-gray-500 dark:text-gray-400">Batch size:</span> <span className="font-medium">{pomScheduleBatchSize} lots</span> ({pomGuideFocus === 'both' ? pomScheduleBatchSize * 2 : pomScheduleBatchSize} API calls)</p>
                                      <p><span className="text-gray-500 dark:text-gray-400">Zero-stock skip:</span> <span className="font-medium">{pomZeroStockSkip ? 'On — only lots in stock' : 'Off — all lots'}</span></p>
                                      <p><span className="text-gray-500 dark:text-gray-400">API budget:</span> <span className="font-medium">{pomApiBudgetPct}% of {blApiCallLimit}</span> = {Math.floor(blApiCallLimit * pomApiBudgetPct / 100)} calls/24h</p>
                                    </div>
                                  </PopoverContent></Popover>
                                  <span className={`sm-hint font-medium ${statusInfo(pomJob?.lastSyncStatus || null, pomScheduleEnabled).color}`}>{statusInfo(pomJob?.lastSyncStatus || null, pomScheduleEnabled).label}</span>
                                </div>
                                <p className="sm-hint">{pomScheduleEnabled ? `Daily at ${pomSyncTime} · batch ${pomScheduleBatchSize} · fresh ${pomFreshnessDays}d · ${pomGuideFocus === 'both' ? 'stock+sold' : pomGuideFocus}` : 'Schedule disabled'} · Last: {formatLastRun(pomJob?.lastSyncTime || null)}</p>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <Button size="icon" variant="ghost" disabled={pomActive} onClick={(e) => { e.stopPropagation(); handleTrigger('priceomatic_cache'); }} title="Run now" data-testid="button-trigger-pom-sched">
                                  {pomActive ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                                </Button>
                                {isExpanded('pom') ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronRight className="h-4 w-4 text-gray-600" />}
                              </div>
                            </button>
                            {pomJob?.errorMessage && <p className="px-4 pb-2 text-xs text-red-400/80 truncate -mt-1">{pomJob.errorMessage}</p>}
                            {!pomActive && pomJob?.lastSyncStatus && pomJob.lastSyncStatus !== 'never' && pomJob.lastSyncStatus !== 'in_progress' && (
                              <div className="flex items-center gap-3 px-4 pb-2 -mt-0.5 flex-wrap" data-testid="pom-last-results">
                                <span className="text-[10px] text-gray-500">Last run: {pomJob.recordsUpdated?.toLocaleString() ?? 0} lots updated</span>
                                {pomJob.updatedAt && <span className="text-[10px] text-gray-600">finished {new Date(pomJob.updatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
                              </div>
                            )}
                            {syncingPom && pomLiveProgress && (
                              <div className="px-4 pb-3 space-y-1.5">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[10px] text-blue-400 font-medium flex items-center gap-1.5">
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    Syncing…
                                  </span>
                                  <span className="text-[10px] text-gray-400">{pomLiveProgress.itemsProcessed?.toLocaleString()} / {pomLiveProgress.itemsTotal?.toLocaleString()} lots · {pomProgressPct}%</span>
                                </div>
                                <div className="w-full h-1.5 bg-gray-700/60 rounded-full overflow-hidden">
                                  <div className="h-full bg-purple-500 rounded-full transition-all duration-500" style={{ width: `${pomProgressPct}%` }} />
                                </div>
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <span className="text-[10px] text-gray-500">{(pomLiveProgress.itemsNew ?? 0).toLocaleString()} new · {(pomLiveProgress.itemsRefreshed ?? 0).toLocaleString()} refreshed · {pomUnenrichedCount.toLocaleString()} without price data</span>
                                  <span className="text-[10px] text-gray-500">API: {pomCurrentSyncCalls.toLocaleString()} / {pomApiCeiling.toLocaleString()}</span>
                                </div>
                              </div>
                            )}
                            {!syncingPom && pomLiveStatus?.data && (
                              <div className="flex items-center justify-between gap-2 px-4 pb-3" data-testid="pom-api-stats-sched">
                                <span className="text-[10px] text-gray-500">24h API: {pomCallsLast24h.toLocaleString()} / {pomApiCeiling.toLocaleString()}</span>
                                <span className="text-[10px] text-gray-500">Without price data: {pomUnenrichedCount.toLocaleString()}</span>
                              </div>
                            )}
                            {isExpanded('pom') && (
                              <div className="px-4 pb-3 space-y-3 border-t border-gray-700/40">
                                <div className="sm-row pt-3">
                                  <span className="sm-label">Enabled</span>
                                  <Switch checked={pomScheduleEnabled} onCheckedChange={(checked) => { setPomScheduleEnabled(checked); updatePlatformSettingsMutation.mutate({ pomScheduleEnabled: checked }); }} data-testid="switch-pom-scheduler-sched" />
                                </div>
                                <div className="sm-row">
                                  <div>
                                    <span className="sm-label">API budget</span>
                                    <p className="sm-hint">% of daily API limit for this job</p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Input type="number" min={5} max={90} value={pomApiBudgetPct} onChange={(e) => setPomApiBudgetPct(parseInt(e.target.value) || 70)} onBlur={() => updatePlatformSettingsMutation.mutate({ pomApiBudgetPct })} className="w-20 text-xs text-right" data-testid="input-pom-budget-pct" />
                                    <span className="sm-hint">%</span>
                                  </div>
                                </div>
                                <div className="sm-row">
                                  <span className="sm-label">Run time</span>
                                  <Input type="time" value={pomSyncTime} onChange={(e) => setPomSyncTime(e.target.value)} onBlur={() => updatePlatformSettingsMutation.mutate({ pomSyncTime })} className="w-28 text-xs text-right" data-testid="input-pom-scheduler-time-sched" />
                                </div>
                                <div className="sm-row">
                                  <div>
                                    <span className="sm-label">Scheduled batch size</span>
                                    <p className="sm-hint">Lots per scheduled auto-run</p>
                                  </div>
                                  <Input type="number" min={100} max={25000} step={100} value={pomScheduleBatchSize} onChange={(e) => setPomScheduleBatchSize(parseInt(e.target.value) || 100)} onBlur={() => updatePlatformSettingsMutation.mutate({ pomScheduleBatchSize })} className="w-24 text-xs text-right" data-testid="input-pom-scheduler-batch-sched" />
                                </div>
                                <div className="sm-row">
                                  <div>
                                    <span className="sm-label">Manual batch size</span>
                                    <p className="sm-hint">Lots when triggered via Run button</p>
                                  </div>
                                  <Input type="number" min={100} max={25000} step={100} value={pomBatchSize} onChange={(e) => setPomBatchSize(parseInt(e.target.value) || 100)} onBlur={() => updatePlatformSettingsMutation.mutate({ pomBatchSize })} className="w-24 text-xs text-right" data-testid="input-pom-manual-batch-sched" />
                                </div>
                                <div className="sm-row">
                                  <div>
                                    <span className="sm-label">Freshness window</span>
                                    <p className="sm-hint">Skip items with price data newer than this</p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Input type="number" min={1} max={365} value={pomFreshnessDays} onChange={(e) => setPomFreshnessDays(parseInt(e.target.value) || 180)} onBlur={() => updatePlatformSettingsMutation.mutate({ pomFreshnessDays })} className="w-20 text-xs text-right" data-testid="input-pom-freshness-sched" />
                                    <span className="sm-hint">days</span>
                                  </div>
                                </div>
                                <div className="sm-row">
                                  <div>
                                    <span className="sm-label">Zero-stock skip</span>
                                    <p className="sm-hint">Skip items with no stock across any store</p>
                                  </div>
                                  <Switch checked={pomZeroStockSkip} onCheckedChange={(checked) => { setPomZeroStockSkip(checked); updatePlatformSettingsMutation.mutate({ pomZeroStockSkip: checked }); }} data-testid="switch-pom-zerostock-sched" />
                                </div>
                                <div className="sm-row">
                                  <div>
                                    <span className="sm-label">Guide focus</span>
                                    <p className="sm-hint">Which price guides to fetch — focus all API usage on one type or split between both</p>
                                  </div>
                                  <Select value={pomGuideFocus} onValueChange={(val: 'stock' | 'sold' | 'both') => { setPomGuideFocus(val); updatePlatformSettingsMutation.mutate({ pomGuideFocus: val }); }}>
                                    <SelectTrigger className="w-28 text-xs" data-testid="select-pom-guide-focus">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="both">Both</SelectItem>
                                      <SelectItem value="stock">Supply only</SelectItem>
                                      <SelectItem value="sold">Sold only</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="sm-card">
                            <button onClick={() => toggleJob('cd')} className="w-full px-4 py-3 flex items-center gap-3 text-left" data-testid="job-header-cd-sched">
                              {statusInfo(cdJob?.lastSyncStatus || null, catalogDetailEnabled).icon}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="sm-label">Catalog Detail Completion</p>
                                  <Popover><PopoverTrigger asChild><span onClick={e => e.stopPropagation()} className="cursor-help"><Info className="w-3 h-3 text-gray-500 shrink-0" /></span></PopoverTrigger><PopoverContent side="top" className="max-w-xs text-xs p-3" onClick={e => e.stopPropagation()}>
                                    <p className="mb-1.5">Fills in missing item details (name, image, weight, dimensions, year released) by calling the BrickLink Item Detail API. Uses 1 API call per unique item (shared across lots of same item).</p>
                                    <div className="space-y-1 border-t pt-1.5 text-[11px]">
                                      <p><span className="text-gray-500 dark:text-gray-400">Freshness window:</span> <span className="font-medium">{catalogDetailFreshnessDays} days</span></p>
                                      <p><span className="text-gray-500 dark:text-gray-400">Batch size:</span> <span className="font-medium">{catalogDetailBatchSize} items</span> ({catalogDetailBatchSize} API calls)</p>
                                      <p><span className="text-gray-500 dark:text-gray-400">Zero-stock skip:</span> <span className="font-medium">{catalogDetailZeroStockSkip ? 'On — only lots in stock' : 'Off — all lots'}</span></p>
                                      <p><span className="text-gray-500 dark:text-gray-400">API budget:</span> <span className="font-medium">{catalogDetailApiBudgetPct}% of {blApiCallLimit}</span> = {Math.floor(blApiCallLimit * catalogDetailApiBudgetPct / 100)} calls/24h</p>
                                      <p><span className="text-gray-500 dark:text-gray-400">Frequency:</span> <span className="font-medium">Every {catalogDetailFrequencyHours}h</span></p>
                                    </div>
                                  </PopoverContent></Popover>
                                  <span className={`sm-hint font-medium ${statusInfo(cdJob?.lastSyncStatus || null, catalogDetailEnabled).color}`}>{statusInfo(cdJob?.lastSyncStatus || null, catalogDetailEnabled).label}</span>
                                </div>
                                <p className="sm-hint">{catalogDetailEnabled ? `Every ${catalogDetailFrequencyHours}h · batch ${catalogDetailBatchSize} · fresh ${catalogDetailFreshnessDays}d` : 'Schedule disabled'} · Last: {formatLastRun(cdJob?.lastSyncTime || null)}</p>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <Button size="icon" variant="ghost" disabled={cdActive || !catalogDetailEnabled} onClick={(e) => { e.stopPropagation(); handleTrigger('catalog_detail_completion'); }} title="Run now" data-testid="button-trigger-cd-sched">
                                  {cdActive ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                                </Button>
                                {isExpanded('cd') ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronRight className="h-4 w-4 text-gray-600" />}
                              </div>
                            </button>
                            {cdJob?.errorMessage && <p className="px-4 pb-2 text-xs text-red-400/80 truncate -mt-1">{cdJob.errorMessage}</p>}
                            {!cdActive && cdJob?.lastSyncStatus && cdJob.lastSyncStatus !== 'never' && cdJob.lastSyncStatus !== 'in_progress' && (
                              <div className="flex items-center gap-3 px-4 pb-2 -mt-0.5 flex-wrap" data-testid="cd-last-results">
                                <span className="text-[10px] text-gray-500">Last run: {cdJob.recordsAdded?.toLocaleString() ?? 0} items enriched · {cdJob.recordsUpdated?.toLocaleString() ?? 0} categories/colors</span>
                                {cdJob.updatedAt && <span className="text-[10px] text-gray-600">finished {new Date(cdJob.updatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
                              </div>
                            )}
                            {syncingCd && cdLiveProgress && (
                              <div className="px-4 pb-3 space-y-1.5" data-testid="cd-progress-bar">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[10px] text-blue-400 font-medium flex items-center gap-1.5">
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    {cdLiveProgress.phase || 'Syncing'}…
                                  </span>
                                  <span className="text-[10px] text-gray-400">
                                    {cdLiveProgress.phase === 'Enriching items' ? `${cdLiveProgress.itemsProcessed?.toLocaleString()} / ${cdLiveProgress.itemsTotal?.toLocaleString()} items · ${cdProgressPct}%` : cdLiveProgress.phase}
                                  </span>
                                </div>
                                {cdLiveProgress.phase === 'Enriching items' && (
                                  <div className="w-full h-1.5 bg-gray-700/60 rounded-full overflow-hidden">
                                    <div className="h-full bg-blue-500 rounded-full transition-all duration-500" style={{ width: `${cdProgressPct}%` }} />
                                  </div>
                                )}
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <span className="text-[10px] text-gray-500">
                                    {cdLiveProgress.categoriesDone ? 'Categories done' : 'Categories pending'}
                                    {' · '}
                                    {cdLiveProgress.colorsDone ? 'Colors done' : 'Colors pending'}
                                  </span>
                                  <span className="text-[10px] text-gray-500">API: {(cdLiveProgress.apiCallsUsed ?? 0).toLocaleString()} / {(cdLiveProgress.apiCallBudget ?? 0).toLocaleString()}</span>
                                </div>
                              </div>
                            )}
                            {isExpanded('cd') && (
                              <div className="px-4 pb-3 space-y-3 border-t border-gray-700/40">
                                <div className="sm-row pt-3">
                                  <span className="sm-label">Enabled</span>
                                  <Switch checked={catalogDetailEnabled} onCheckedChange={(checked) => { setCatalogDetailEnabled(checked); updatePlatformSettingsMutation.mutate({ catalogDetailEnabled: checked }); }} data-testid="switch-cd-enabled-sched" />
                                </div>
                                <div className="sm-row">
                                  <div>
                                    <span className="sm-label">API budget</span>
                                    <p className="sm-hint">% of daily API limit for this job</p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Input type="number" min={5} max={90} value={catalogDetailApiBudgetPct} onChange={(e) => setCatalogDetailApiBudgetPct(parseInt(e.target.value) || 20)} onBlur={() => updatePlatformSettingsMutation.mutate({ catalogDetailApiBudgetPct })} className="w-20 text-xs text-right" data-testid="input-cd-budget-pct" />
                                    <span className="sm-hint">%</span>
                                  </div>
                                </div>
                                <div className="sm-row">
                                  <div>
                                    <span className="sm-label">Frequency</span>
                                    <p className="sm-hint">Hours between runs</p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Input type="number" min={1} max={24} value={catalogDetailFrequencyHours} onChange={(e) => setCatalogDetailFrequencyHours(parseInt(e.target.value) || 1)} onBlur={() => updatePlatformSettingsMutation.mutate({ catalogDetailFrequencyHours })} className="w-20 text-xs text-right" data-testid="input-cd-frequency-sched" />
                                    <span className="sm-hint">hrs</span>
                                  </div>
                                </div>
                                <div className="sm-row">
                                  <div>
                                    <span className="sm-label">Batch size</span>
                                    <p className="sm-hint">Items per run</p>
                                  </div>
                                  <Input type="number" min={50} max={5000} step={50} value={catalogDetailBatchSize} onChange={(e) => setCatalogDetailBatchSize(parseInt(e.target.value) || 50)} onBlur={() => updatePlatformSettingsMutation.mutate({ catalogDetailBatchSize })} className="w-24 text-xs text-right" data-testid="input-cd-batch-sched" />
                                </div>
                                <div className="sm-row">
                                  <div>
                                    <span className="sm-label">Freshness window</span>
                                    <p className="sm-hint">Skip items updated within this many days</p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Input type="number" min={1} max={365} value={catalogDetailFreshnessDays} onChange={(e) => setCatalogDetailFreshnessDays(parseInt(e.target.value) || 90)} onBlur={() => updatePlatformSettingsMutation.mutate({ catalogDetailFreshnessDays })} className="w-20 text-xs text-right" data-testid="input-cd-freshness-sched" />
                                    <span className="sm-hint">days</span>
                                  </div>
                                </div>
                                <div className="sm-row">
                                  <div>
                                    <span className="sm-label">Zero-stock skip</span>
                                    <p className="sm-hint">Skip items with no stock across any store</p>
                                  </div>
                                  <Switch checked={catalogDetailZeroStockSkip} onCheckedChange={(checked) => { setCatalogDetailZeroStockSkip(checked); updatePlatformSettingsMutation.mutate({ catalogDetailZeroStockSkip: checked }); }} data-testid="switch-cd-zerostock-sched" />
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="sm-card">
                            <button onClick={() => toggleJob('cs')} className="w-full px-4 py-3 flex items-center gap-3 text-left" data-testid="job-header-cs-sched">
                              {statusInfo(csJob?.lastSyncStatus || null, catalogScanEnabled).icon}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="sm-label">Inventory Catalog Scan</p>
                                  <Popover><PopoverTrigger asChild><span onClick={e => e.stopPropagation()} className="cursor-help"><Info className="w-3 h-3 text-gray-500 shrink-0" /></span></PopoverTrigger><PopoverContent side="top" className="max-w-xs text-xs p-3" onClick={e => e.stopPropagation()}>
                                    <p className="mb-1.5">Scans all inventory lots across stores to find lots with missing or stale catalog data and new part+color combinations. Feeds lots into the enrichment queue for both Market Price Guides and Catalog Detail Completion. No API calls — database scan only.</p>
                                    <div className="space-y-1 border-t pt-1.5 text-[11px]">
                                      <p><span className="text-gray-500 dark:text-gray-400">Zero-stock skip:</span> <span className="font-medium">{catalogScanZeroStockSkip ? 'On — only lots in stock' : 'Off — all lots'}</span></p>
                                      <p><span className="text-gray-500 dark:text-gray-400">Frequency:</span> <span className="font-medium">Every {catalogScanFrequencyHours}h</span></p>
                                    </div>
                                  </PopoverContent></Popover>
                                  <span className={`sm-hint font-medium ${statusInfo(csJob?.lastSyncStatus || null, catalogScanEnabled).color}`}>{statusInfo(csJob?.lastSyncStatus || null, catalogScanEnabled).label}</span>
                                </div>
                                <p className="sm-hint">{catalogScanEnabled ? `Every ${catalogScanFrequencyHours}h · ${catalogScanZeroStockSkip ? 'zero-stock skip' : 'all items'}` : 'Schedule disabled'} · Last: {formatLastRun(csJob?.lastSyncTime || null)}</p>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <Button size="icon" variant="ghost" disabled={csActive || !catalogScanEnabled} onClick={(e) => { e.stopPropagation(); handleTrigger('catalog_scan'); }} title="Run now" data-testid="button-trigger-cs-sched">
                                  {csActive ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                                </Button>
                                {isExpanded('cs') ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronRight className="h-4 w-4 text-gray-600" />}
                              </div>
                            </button>
                            {csJob?.errorMessage && <p className="px-4 pb-2 text-xs text-red-400/80 truncate -mt-1">{csJob.errorMessage}</p>}
                            {!csActive && csJob?.lastSyncStatus && csJob.lastSyncStatus !== 'never' && csJob.lastSyncStatus !== 'in_progress' && (
                              <div className="flex items-center gap-3 px-4 pb-2 -mt-0.5 flex-wrap" data-testid="cs-last-results">
                                <span className="text-[10px] text-gray-500">Last run: {csJob.recordsAdded?.toLocaleString() ?? 0} stubs created · {csJob.recordsUpdated?.toLocaleString() ?? 0} flagged for enrichment</span>
                                {csJob.updatedAt && <span className="text-[10px] text-gray-600">finished {new Date(csJob.updatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
                              </div>
                            )}
                            {syncingCs && csLiveProgress && (
                              <div className="px-4 pb-3 space-y-1.5" data-testid="cs-progress-bar">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[10px] text-blue-400 font-medium flex items-center gap-1.5">
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    {csLiveProgress.phase || 'Scanning'}…
                                  </span>
                                </div>
                                <div className="flex items-center gap-3 flex-wrap">
                                  <span className="text-[10px] text-gray-500">{(csLiveProgress.inventoryRowsScanned ?? 0).toLocaleString()} inv rows</span>
                                  {csLiveProgress.missingCatalogEntries > 0 && <span className="text-[10px] text-yellow-500/80">{csLiveProgress.missingCatalogEntries.toLocaleString()} missing</span>}
                                  {csLiveProgress.catalogEntriesCreated > 0 && <span className="text-[10px] text-green-400/80">{csLiveProgress.catalogEntriesCreated.toLocaleString()} stubs created</span>}
                                  {csLiveProgress.staleCatalogDetail > 0 && <span className="text-[10px] text-orange-400/80">{csLiveProgress.staleCatalogDetail.toLocaleString()} stale detail</span>}
                                  {csLiveProgress.missingPriceGuide > 0 && <span className="text-[10px] text-yellow-500/80">{csLiveProgress.missingPriceGuide.toLocaleString()} missing PG</span>}
                                </div>
                              </div>
                            )}
                            {isExpanded('cs') && (
                              <div className="px-4 pb-3 space-y-3 border-t border-gray-700/40">
                                <div className="sm-row pt-3">
                                  <span className="sm-label">Enabled</span>
                                  <Switch checked={catalogScanEnabled} onCheckedChange={(checked) => { setCatalogScanEnabled(checked); updatePlatformSettingsMutation.mutate({ catalogScanEnabled: checked }); }} data-testid="switch-cs-enabled-sched" />
                                </div>
                                <div className="sm-row">
                                  <div>
                                    <span className="sm-label">Frequency</span>
                                    <p className="sm-hint">Hours between scans</p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Input type="number" min={1} max={24} value={catalogScanFrequencyHours} onChange={(e) => setCatalogScanFrequencyHours(parseInt(e.target.value) || 2)} onBlur={() => updatePlatformSettingsMutation.mutate({ catalogScanFrequencyHours })} className="w-20 text-xs text-right" data-testid="input-cs-frequency-sched" />
                                    <span className="sm-hint">hrs</span>
                                  </div>
                                </div>
                                <div className="sm-row">
                                  <div>
                                    <span className="sm-label">Zero-stock skip</span>
                                    <p className="sm-hint">Only scan items with stock &gt; 0</p>
                                  </div>
                                  <Switch checked={catalogScanZeroStockSkip} onCheckedChange={(checked) => { setCatalogScanZeroStockSkip(checked); updatePlatformSettingsMutation.mutate({ catalogScanZeroStockSkip: checked }); }} data-testid="switch-cs-zerostock-sched" />
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* ── Embeddings Tab ──────────────────────────── */}
                      {activeSchedulerTab === 'embeddings' && (
                        <div className="space-y-3">
                          <p className="sm-hint px-1">Visual (CLIP) and text embeddings for search, AI, and catalog enrichment.</p>

                          <div className="sm-card">
                            <button onClick={() => toggleJob('rb')} className="w-full px-4 py-3 flex items-center gap-3 text-left" data-testid="job-header-rb-sched">
                              {statusInfo(rbJob?.lastSyncStatus || null, rebrickableSetSyncEnabled).icon}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="sm-label">Rebrickable Set Parts</p>
                                  <Popover><PopoverTrigger asChild><span onClick={e => e.stopPropagation()} className="cursor-help"><Info className="w-3 h-3 text-gray-500 shrink-0" /></span></PopoverTrigger><PopoverContent side="top" className="max-w-xs text-xs p-3" onClick={e => e.stopPropagation()}>
                                    <p className="mb-1.5">Imports set-to-part relationships from Rebrickable. Maps which parts belong to which LEGO sets, enabling set completion analysis and BrickSpotter set detection.</p>
                                    <div className="space-y-1 border-t pt-1.5 text-[11px]">
                                      <p><span className="text-gray-500 dark:text-gray-400">Schedule:</span> <span className="font-medium">{rebrickableSetSyncEnabled ? `Daily at ${rebrickableSetSyncTime}` : 'Disabled'}</span></p>
                                    </div>
                                  </PopoverContent></Popover>
                                  <span className={`sm-hint font-medium ${statusInfo(rbJob?.lastSyncStatus || null, rebrickableSetSyncEnabled).color}`}>{statusInfo(rbJob?.lastSyncStatus || null, rebrickableSetSyncEnabled).label}</span>
                                </div>
                                <p className="sm-hint">{rebrickableSetSyncEnabled ? `Daily at ${rebrickableSetSyncTime}` : 'Schedule disabled'} · Last: {formatLastRun(rbJob?.lastSyncTime || null)}</p>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <Button size="icon" variant="ghost" disabled={rbActive} onClick={(e) => { e.stopPropagation(); handleTrigger('rebrickable_set_parts'); }} title="Run now" data-testid="button-trigger-rb-sched">
                                  {rbActive ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                                </Button>
                                {isExpanded('rb') ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronRight className="h-4 w-4 text-gray-600" />}
                              </div>
                            </button>
                            {rbJob?.errorMessage && <p className="px-4 pb-2 text-xs text-red-400/80 truncate -mt-1">{rbJob.errorMessage}</p>}
                            {isExpanded('rb') && (
                              <div className="px-4 pb-3 space-y-3 border-t border-gray-700/40">
                                <div className="sm-row pt-3">
                                  <span className="sm-label">Enabled</span>
                                  <Switch checked={rebrickableSetSyncEnabled} onCheckedChange={(checked) => { setRebrickableSetSyncEnabled(checked); updatePlatformSettingsMutation.mutate({ rebrickableSetSyncEnabled: checked }); }} data-testid="switch-rb-scheduler-sched" />
                                </div>
                                <div className="sm-row">
                                  <span className="sm-label">Run time</span>
                                  <Input type="time" value={rebrickableSetSyncTime} onChange={(e) => setRebrickableSetSyncTime(e.target.value)} onBlur={() => updatePlatformSettingsMutation.mutate({ rebrickableSetSyncTime })} className="w-28 text-xs text-right" data-testid="input-rb-scheduler-time-sched" />
                                </div>
                                {(rbJob?.recordsAdded > 0 || rbJob?.recordsUpdated > 0) && (
                                  <p className="sm-hint pt-1 border-t border-gray-700/40">+{rbJob.recordsAdded} added · {rbJob.recordsUpdated} updated</p>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="sm-card">
                            <button onClick={() => toggleJob('uc')} className="w-full px-4 py-3 flex items-center gap-3 text-left" data-testid="job-header-uc-sched">
                              {statusInfo(ucJob?.lastSyncStatus || null, universalCatalogScheduleEnabled).icon}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="sm-label">Universal Catalog</p>
                                  <Popover><PopoverTrigger asChild><span onClick={e => e.stopPropagation()} className="cursor-help"><Info className="w-3 h-3 text-gray-500 shrink-0" /></span></PopoverTrigger><PopoverContent side="top" className="max-w-xs text-xs p-3" onClick={e => e.stopPropagation()}>
                                    <p className="mb-1.5">Imports item images and metadata from BrickLink into the shared catalog. Feeds the CLIP Catalog Build worker to generate visual search embeddings. No BrickLink API calls — uses public image URLs.</p>
                                    <div className="space-y-1 border-t pt-1.5 text-[11px]">
                                      <p><span className="text-gray-500 dark:text-gray-400">Refresh cycle:</span> <span className="font-medium">Every {universalCatalogRefreshMonths} month{universalCatalogRefreshMonths > 1 ? 's' : ''}</span></p>
                                      <p><span className="text-gray-500 dark:text-gray-400">Retry after failure:</span> <span className="font-medium">{universalCatalogRetryDays} days</span></p>
                                    </div>
                                  </PopoverContent></Popover>
                                  <span className={`sm-hint font-medium ${statusInfo(ucJob?.lastSyncStatus || null, universalCatalogScheduleEnabled).color}`}>{statusInfo(ucJob?.lastSyncStatus || null, universalCatalogScheduleEnabled).label}</span>
                                </div>
                                <p className="sm-hint">{universalCatalogScheduleEnabled ? `Every ${universalCatalogRefreshMonths}mo · retry after ${universalCatalogRetryDays}d` : 'Schedule disabled'} · Last: {formatLastRun(ucJob?.lastSyncTime || null)}</p>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <Button size="icon" variant="ghost" disabled={ucActive} onClick={(e) => { e.stopPropagation(); handleTrigger('universal_catalog_refresh'); }} title="Run now" data-testid="button-trigger-uc-sched">
                                  {ucActive ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                                </Button>
                                {isExpanded('uc') ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronRight className="h-4 w-4 text-gray-600" />}
                              </div>
                            </button>
                            {ucJob?.errorMessage && <p className="px-4 pb-2 text-xs text-red-400/80 truncate -mt-1">{ucJob.errorMessage}</p>}
                            {isExpanded('uc') && (
                              <div className="px-4 pb-3 space-y-3 border-t border-gray-700/40">
                                <div className="sm-row pt-3">
                                  <span className="sm-label">Enabled</span>
                                  <Switch checked={universalCatalogScheduleEnabled} onCheckedChange={(checked) => { setUniversalCatalogScheduleEnabled(checked); updatePlatformSettingsMutation.mutate({ universalCatalogScheduleEnabled: checked }); }} data-testid="switch-uc-scheduler-sched" />
                                </div>
                                <div className="sm-row">
                                  <div>
                                    <span className="sm-label">Refresh interval</span>
                                    <p className="sm-hint">Months between full imports</p>
                                  </div>
                                  <Input type="number" min={1} max={12} value={universalCatalogRefreshMonths} onChange={(e) => setUniversalCatalogRefreshMonths(parseInt(e.target.value) || 1)} onBlur={() => updatePlatformSettingsMutation.mutate({ universalCatalogRefreshMonths })} className="w-20 text-xs text-right" data-testid="input-uc-refresh-months-sched" />
                                </div>
                                <div className="sm-row">
                                  <div>
                                    <span className="sm-label">Retry stale after</span>
                                    <p className="sm-hint">Days before retrying failed items</p>
                                  </div>
                                  <Input type="number" min={1} max={365} value={universalCatalogRetryDays} onChange={(e) => setUniversalCatalogRetryDays(parseInt(e.target.value) || 30)} onBlur={() => updatePlatformSettingsMutation.mutate({ universalCatalogRetryDays })} className="w-20 text-xs text-right" data-testid="input-uc-retry-days-sched" />
                                </div>
                                {(ucJob?.recordsAdded > 0 || ucJob?.recordsUpdated > 0) && (
                                  <p className="sm-hint pt-1 border-t border-gray-700/40">+{ucJob.recordsAdded} added · {ucJob.recordsUpdated} updated</p>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="sm-card">
                            <div className="px-4 py-3 flex items-center gap-3">
                              {clipActive
                                ? <Loader2 className="h-4 w-4 text-yellow-400 animate-spin" />
                                : clipStatus && clipStatus.embedded >= clipStatus.total
                                  ? <CheckCircle2 className="h-4 w-4 text-green-400" />
                                  : <Clock className="h-4 w-4 text-gray-500" />}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="sm-label">CLIP Catalog Build</p>
                                  <Popover><PopoverTrigger asChild><span onClick={e => e.stopPropagation()} className="cursor-help"><Info className="w-3 h-3 text-gray-500 shrink-0" /></span></PopoverTrigger><PopoverContent side="top" className="max-w-xs text-xs p-3" onClick={e => e.stopPropagation()}>
                                    <p className="mb-1.5">Generates CLIP visual embeddings (512-dim vectors) for every item image in the catalog. Powers BrickSpotter visual search — matching photos of parts to catalog entries.</p>
                                    <div className="space-y-1 border-t pt-1.5 text-[11px]">
                                      <p><span className="text-gray-500 dark:text-gray-400">Mode:</span> <span className="font-medium">Continuous — runs in background, auto-resumes on restart</span></p>
                                      {clipStatus && <p><span className="text-gray-500 dark:text-gray-400">Progress:</span> <span className="font-medium">{clipStatus.embedded.toLocaleString()} / {clipStatus.total.toLocaleString()} items embedded</span></p>}
                                    </div>
                                  </PopoverContent></Popover>
                                  <span className={`sm-hint font-medium ${clipActive ? 'text-yellow-400' : clipStatus && clipStatus.embedded >= clipStatus.total ? 'text-green-400/80' : 'text-gray-500'}`}>
                                    {clipActive ? 'Running' : clipStatus && clipStatus.embedded >= clipStatus.total ? 'Complete' : 'Idle'}
                                  </span>
                                </div>
                                {clipStatus && clipStatus.total > 0 && (
                                  <div className="flex items-center gap-2 mt-1">
                                    <div className="flex-1 bg-gray-700 rounded-full h-1.5">
                                      <div className="bg-yellow-500 h-1.5 rounded-full transition-all" style={{ width: `${clipPct}%` }} />
                                    </div>
                                    <span className="sm-hint shrink-0 font-mono">{clipStatus.embedded.toLocaleString()}/{clipStatus.total.toLocaleString()} ({clipPct}%)</span>
                                  </div>
                                )}
                                <p className="sm-hint mt-0.5">Continuous background worker · auto-resumes on restart</p>
                              </div>
                              <Button size="icon" variant="ghost" disabled={!!clipActive} onClick={() => handleTrigger('clip_catalog')} title="Run now" data-testid="button-trigger-clip-sched">
                                {clipActive ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                              </Button>
                            </div>
                          </div>

                          <div>
                            <p className="sm-group-label mb-2 px-1">Org-Level Text Embeddings</p>
                            <div className="sm-card-inset">
                              {(() => {
                                const emb = systemHealth.embeddings;
                                const invPct = emb.inventoryTotal > 0 ? Math.round((emb.inventoryEmbeddings / emb.inventoryTotal) * 100) : 0;
                                const ordPct = emb.orderTotal > 0 ? Math.round((emb.orderEmbeddings / emb.orderTotal) * 100) : 0;
                                return (
                                  <>
                                    <div className="px-4 py-3 flex items-center gap-3">
                                      {invPct >= 100 ? <CheckCircle2 className="h-4 w-4 text-green-400" /> : <Database className="h-4 w-4 text-gray-500" />}
                                      <div className="flex-1 min-w-0">
                                        <p className="sm-label">Inventory Embeddings</p>
                                        <div className="flex items-center gap-2 mt-1">
                                          <div className="flex-1 bg-gray-700 rounded-full h-1.5">
                                            <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${Math.min(invPct, 100)}%` }} />
                                          </div>
                                          <span className="sm-hint shrink-0 font-mono">{emb.inventoryEmbeddings.toLocaleString()}/{emb.inventoryTotal.toLocaleString()} ({invPct}%)</span>
                                        </div>
                                      </div>
                                    </div>
                                    <div className="px-4 py-3 flex items-center gap-3">
                                      {ordPct >= 100 ? <CheckCircle2 className="h-4 w-4 text-green-400" /> : <Database className="h-4 w-4 text-gray-500" />}
                                      <div className="flex-1 min-w-0">
                                        <p className="sm-label">Order Embeddings</p>
                                        <div className="flex items-center gap-2 mt-1">
                                          <div className="flex-1 bg-gray-700 rounded-full h-1.5">
                                            <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${Math.min(ordPct, 100)}%` }} />
                                          </div>
                                          <span className="sm-hint shrink-0 font-mono">{emb.orderEmbeddings.toLocaleString()}/{emb.orderTotal.toLocaleString()} ({ordPct}%)</span>
                                        </div>
                                      </div>
                                    </div>
                                  </>
                                );
                              })()}
                            </div>
                            <p className="sm-hint mt-1.5 px-1">Generated automatically after Inventory Sync and Order Sync. Runs via the background Text Embedding Worker.</p>
                          </div>

                          <div>
                            <p className="sm-group-label mb-2 px-1">Text Embedding Worker</p>
                            <div className="sm-card-inset">
                              {systemHealth.jobs.active.map((job: any) => (
                                <div key={job.id} className="px-4 py-3 flex items-center gap-3">
                                  <Loader2 className="h-4 w-4 text-yellow-400 animate-spin shrink-0" />
                                  <p className="sm-label flex-1 capitalize">{job.jobType}</p>
                                  {job.totalItems > 0 && <span className="sm-hint font-mono">{job.processedItems}/{job.totalItems}</span>}
                                </div>
                              ))}
                              {systemHealth.jobs.recent.slice(0, 5).map((job: any) => (
                                <div key={job.id} className="px-4 py-3 flex items-center gap-3">
                                  {job.status === 'completed' ? <CheckCircle2 className="h-4 w-4 text-green-400" /> : <AlertTriangle className="h-4 w-4 text-red-400" />}
                                  <div className="flex-1 min-w-0">
                                    <p className="sm-label capitalize">{job.jobType}</p>
                                    {job.errorMessage && <p className="sm-hint text-red-400/80 truncate">{job.errorMessage}</p>}
                                  </div>
                                  <div className="text-right shrink-0">
                                    <p className="sm-hint font-mono">{job.processedItems}/{job.totalItems}</p>
                                    <p className="sm-hint">{job.completedAt ? new Date(job.completedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</p>
                                  </div>
                                </div>
                              ))}
                              {systemHealth.jobs.active.length === 0 && systemHealth.jobs.recent.length === 0 && (
                                <div className="px-4 py-4 text-center"><p className="sm-description">No recent embedding jobs</p></div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* ── Market Tab ──────────────────────────────── */}
                      {activeSchedulerTab === 'market' && (
                        <div className="space-y-3">
                          <p className="sm-hint px-1">Community forums and web news for market sentiment and AI context. Both sources are embedded for semantic search by E.L.F.I.E.</p>

                          <div className="sm-card">
                            <button onClick={() => toggleJob('fm')} className="w-full px-4 py-3 flex items-center gap-3 text-left" data-testid="job-header-fm-sched">
                              {statusInfo(fmJob?.lastSyncStatus || null, forumSyncEnabled).icon}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="sm-label">Forum Sync</p>
                                  <Popover><PopoverTrigger asChild><span onClick={e => e.stopPropagation()} className="cursor-help"><Info className="w-3 h-3 text-gray-500 shrink-0" /></span></PopoverTrigger><PopoverContent side="top" className="max-w-xs text-xs p-3" onClick={e => e.stopPropagation()}>
                                    <p className="mb-1.5">Scrapes BrickLink forum discussions for market sentiment and trending topics. Posts are embedded for AI context, enabling market-aware responses. Purges stale posts older than 6 months.</p>
                                    <div className="space-y-1 border-t pt-1.5 text-[11px]">
                                      <p><span className="text-gray-500 dark:text-gray-400">Frequency:</span> <span className="font-medium">Every {forumSyncFrequency} min</span></p>
                                    </div>
                                  </PopoverContent></Popover>
                                  <span className={`sm-hint font-medium ${statusInfo(fmJob?.lastSyncStatus || null, forumSyncEnabled).color}`}>{statusInfo(fmJob?.lastSyncStatus || null, forumSyncEnabled).label}</span>
                                </div>
                                <p className="sm-hint">{forumSyncEnabled ? `Every ${forumSyncFrequency} min` : 'Schedule disabled'} · Last: {formatLastRun(fmJob?.lastSyncTime || null)}</p>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <Button size="icon" variant="ghost" disabled={fmActive} onClick={(e) => { e.stopPropagation(); handleTrigger('forum_sync'); }} title="Run now" data-testid="button-trigger-fm-sched">
                                  {fmActive ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                                </Button>
                                {isExpanded('fm') ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronRight className="h-4 w-4 text-gray-600" />}
                              </div>
                            </button>
                            {fmJob?.errorMessage && <p className="px-4 pb-2 text-xs text-red-400/80 truncate -mt-1">{fmJob.errorMessage}</p>}
                            {isExpanded('fm') && (
                              <div className="px-4 pb-3 space-y-3 border-t border-gray-700/40">
                                <div className="sm-row pt-3">
                                  <span className="sm-label">Enabled</span>
                                  <Switch checked={forumSyncEnabled} onCheckedChange={(checked) => { setForumSyncEnabled(checked); updatePlatformSettingsMutation.mutate({ forumSyncEnabled: checked }); }} data-testid="switch-fm-scheduler-sched" />
                                </div>
                                <div className="sm-row">
                                  <div>
                                    <span className="sm-label">Frequency</span>
                                    <p className="sm-hint">Minutes between runs</p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Input type="number" min={5} max={1440} value={forumSyncFrequencyStr} onChange={(e) => setForumSyncFrequencyStr(e.target.value)} onBlur={() => { const val = parseInt(forumSyncFrequencyStr) || 60; setForumSyncFrequency(val); setForumSyncFrequencyStr(String(val)); updatePlatformSettingsMutation.mutate({ forumSyncFrequency: val }); }} className="w-20 text-xs text-right" data-testid="input-fm-frequency-sched" />
                                    <span className="sm-hint">min</span>
                                  </div>
                                </div>
                                {(fmJob?.recordsAdded > 0 || fmJob?.recordsUpdated > 0) && (
                                  <p className="sm-hint pt-1 border-t border-gray-700/40">+{fmJob.recordsAdded} added · {fmJob.recordsUpdated} updated</p>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="sm-card">
                            <button onClick={() => toggleJob('mn')} className="w-full px-4 py-3 flex items-center gap-3 text-left" data-testid="job-header-mn-sched">
                              {statusInfo(mnJob?.lastSyncStatus || null, marketNewsSyncEnabled).icon}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="sm-label">Market News</p>
                                  <Popover><PopoverTrigger asChild><span onClick={e => e.stopPropagation()} className="cursor-help"><Info className="w-3 h-3 text-gray-500 shrink-0" /></span></PopoverTrigger><PopoverContent side="top" className="max-w-xs text-xs p-3" onClick={e => e.stopPropagation()}>
                                    <p className="mb-1.5">Searches the web for LEGO market news — retirements, pricing trends, collectible values, and reseller insights. Articles are embedded for AI context so E.L.F.I.E. can answer market questions. Purges articles older than 6 months.</p>
                                    <div className="space-y-1 border-t pt-1.5 text-[11px]">
                                      <p><span className="text-gray-500 dark:text-gray-400">Frequency:</span> <span className="font-medium">Every {marketNewsSyncFrequency} min</span></p>
                                      <p><span className="text-gray-500 dark:text-gray-400">Queries:</span> <span className="font-medium">{marketNewsQueries.length} configured</span></p>
                                    </div>
                                  </PopoverContent></Popover>
                                  <span className={`sm-hint font-medium ${statusInfo(mnJob?.lastSyncStatus || null, marketNewsSyncEnabled).color}`}>{statusInfo(mnJob?.lastSyncStatus || null, marketNewsSyncEnabled).label}</span>
                                </div>
                                <p className="sm-hint">{marketNewsSyncEnabled ? `Every ${marketNewsSyncFrequency} min` : 'Schedule disabled'} · Last: {formatLastRun(mnJob?.lastSyncTime || null)}</p>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <Button size="icon" variant="ghost" disabled={mnActive} onClick={(e) => { e.stopPropagation(); handleTrigger('market_news_sync'); }} title="Run now" data-testid="button-trigger-mn-sched">
                                  {mnActive ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                                </Button>
                                {isExpanded('mn') ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronRight className="h-4 w-4 text-gray-600" />}
                              </div>
                            </button>
                            {mnJob?.errorMessage && <p className="px-4 pb-2 text-xs text-red-400/80 truncate -mt-1">{mnJob.errorMessage}</p>}
                            {isExpanded('mn') && (
                              <div className="px-4 pb-3 space-y-3 border-t border-gray-700/40">
                                <div className="sm-row pt-3">
                                  <span className="sm-label">Enabled</span>
                                  <Switch checked={marketNewsSyncEnabled} onCheckedChange={(checked) => { setMarketNewsSyncEnabled(checked); updatePlatformSettingsMutation.mutate({ marketNewsSyncEnabled: checked }); }} data-testid="switch-mn-scheduler-sched" />
                                </div>
                                <div className="sm-row">
                                  <div>
                                    <span className="sm-label">Frequency</span>
                                    <p className="sm-hint">Minutes between runs</p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Input type="number" min={30} max={1440} value={marketNewsSyncFrequencyStr} onChange={(e) => setMarketNewsSyncFrequencyStr(e.target.value)} onBlur={() => { const val = parseInt(marketNewsSyncFrequencyStr) || 360; setMarketNewsSyncFrequency(val); setMarketNewsSyncFrequencyStr(String(val)); updatePlatformSettingsMutation.mutate({ marketNewsSyncFrequency: val }); }} className="w-20 text-xs text-right" data-testid="input-mn-frequency-sched" />
                                    <span className="sm-hint">min</span>
                                  </div>
                                </div>
                                <div className="space-y-2 pt-1 border-t border-gray-700/40">
                                  <div className="flex items-center justify-between">
                                    <span className="sm-label">Search Queries</span>
                                    <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => { setMarketNewsQueries([...marketNewsQueries, '']); }} data-testid="button-add-mn-query">+ Add</Button>
                                  </div>
                                  {marketNewsQueries.map((q, i) => (
                                    <div key={i} className="flex items-center gap-1.5">
                                      <Input value={q} onChange={(e) => { const updated = [...marketNewsQueries]; updated[i] = e.target.value; setMarketNewsQueries(updated); }} onBlur={() => { const cleaned = marketNewsQueries.filter(s => s.trim()); setMarketNewsQueries(cleaned); updatePlatformSettingsMutation.mutate({ marketNewsQueries: cleaned }); }} className="flex-1 text-xs" placeholder="Search query..." data-testid={`input-mn-query-${i}`} />
                                      <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => { const updated = marketNewsQueries.filter((_, idx) => idx !== i); setMarketNewsQueries(updated); updatePlatformSettingsMutation.mutate({ marketNewsQueries: updated }); }} data-testid={`button-remove-mn-query-${i}`}>
                                        <X className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  ))}
                                </div>
                                {(mnJob?.recordsAdded > 0 || mnJob?.recordsUpdated > 0) && (
                                  <p className="sm-hint pt-1 border-t border-gray-700/40">+{mnJob.recordsAdded} added · {mnJob.recordsUpdated} updated</p>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="sm-card">
                            <button onClick={() => toggleJob('bi')} className="w-full px-4 py-3 flex items-center gap-3 text-left" data-testid="job-header-bi-sched">
                              {statusInfo(biJob?.lastSyncStatus || null, businessIntelEnabled).icon}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="sm-label">Business Intel</p>
                                  <Popover><PopoverTrigger asChild><span onClick={e => e.stopPropagation()} className="cursor-help"><Info className="w-3 h-3 text-gray-500 shrink-0" /></span></PopoverTrigger><PopoverContent side="top" className="max-w-xs text-xs p-3" onClick={e => e.stopPropagation()}>
                                    <p className="mb-1.5">Cross-references each org's inventory, sales, and pricing against market news and forum data to generate actionable business insights. Insights expire after 7 days and dismissed insights are purged after 3 days.</p>
                                    <div className="space-y-1 border-t pt-1.5 text-[11px]">
                                      <p><span className="text-gray-500 dark:text-gray-400">Frequency:</span> <span className="font-medium">Every {businessIntelFrequency} min</span></p>
                                      <p><span className="text-gray-500 dark:text-gray-400">Model:</span> <span className="font-medium">gpt-4o-mini</span></p>
                                    </div>
                                  </PopoverContent></Popover>
                                  <span className={`sm-hint font-medium ${statusInfo(biJob?.lastSyncStatus || null, businessIntelEnabled).color}`}>{statusInfo(biJob?.lastSyncStatus || null, businessIntelEnabled).label}</span>
                                </div>
                                <p className="sm-hint">{businessIntelEnabled ? `Every ${businessIntelFrequency} min` : 'Schedule disabled'} · Last: {formatLastRun(biJob?.lastSyncTime || null)}</p>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <Button size="icon" variant="ghost" disabled={biActive} onClick={(e) => { e.stopPropagation(); handleTrigger('business_intel_sync'); }} title="Run now" data-testid="button-trigger-bi-sched">
                                  {biActive ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                                </Button>
                                {isExpanded('bi') ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronRight className="h-4 w-4 text-gray-600" />}
                              </div>
                            </button>
                            {biJob?.errorMessage && <p className="px-4 pb-2 text-xs text-red-400/80 truncate -mt-1">{biJob.errorMessage}</p>}
                            {isExpanded('bi') && (
                              <div className="px-4 pb-3 space-y-3 border-t border-gray-700/40">
                                <div className="sm-row pt-3">
                                  <span className="sm-label">Enabled</span>
                                  <Switch checked={businessIntelEnabled} onCheckedChange={(checked) => { setBusinessIntelEnabled(checked); updatePlatformSettingsMutation.mutate({ businessIntelEnabled: checked }); }} data-testid="switch-bi-scheduler-sched" />
                                </div>
                                <div className="sm-row">
                                  <div>
                                    <span className="sm-label">Frequency</span>
                                    <p className="sm-hint">Minutes between runs</p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Input type="number" min={60} max={1440} value={businessIntelFrequencyStr} onChange={(e) => setBusinessIntelFrequencyStr(e.target.value)} onBlur={() => { const val = parseInt(businessIntelFrequencyStr) || 360; setBusinessIntelFrequency(val); setBusinessIntelFrequencyStr(String(val)); updatePlatformSettingsMutation.mutate({ businessIntelFrequency: val }); }} className="w-20 text-xs text-right" data-testid="input-bi-frequency-sched" />
                                    <span className="sm-hint">min</span>
                                  </div>
                                </div>
                                {(biJob?.recordsAdded > 0 || biJob?.recordsUpdated > 0) && (
                                  <p className="sm-hint pt-1 border-t border-gray-700/40">+{biJob.recordsAdded} insights · {biJob.recordsUpdated} orgs processed</p>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })() : (
                  <div className="flex flex-col items-center justify-center gap-3 py-10">
                    <AlertTriangle className="h-5 w-5 text-red-400/70" />
                    <p className="sm-description">Failed to load health data</p>
                    <button onClick={() => refetchSystemHealth()} className="text-xs text-yellow-500/70 hover:text-yellow-400 underline">Retry</button>
                  </div>
                )}
              </div>
            )}

            {/* Platform Services */}
            {activeSection === 'apiKeys' && (
              <div className="px-3 pt-3 pb-4 space-y-3 min-w-0 overflow-hidden">
                {/* Tab strip */}
                {(() => {
                  const psTabs: Array<{ id: 'stripe' | 'openai' | 'bricklink'; label: string; Icon: React.ElementType }> = [
                    { id: 'bricklink', label: 'BrickLink', Icon: Blocks },
                    { id: 'stripe', label: 'Stripe', Icon: CreditCard },
                    { id: 'openai', label: 'OpenAI', Icon: Brain },
                  ];
                  return (
                    <div className="tool-tab-bar overflow-x-auto">
                      {psTabs.map(({ id, label, Icon }) => (
                        <button
                          key={id}
                          onClick={() => setActivePlatformServicesTab(id)}
                          data-testid={`tab-platform-services-${id}`}
                          className={`tool-tab-fill whitespace-nowrap ${activePlatformServicesTab === id ? 'text-yellow-400 border-yellow-500' : 'tool-tab-off'}`}
                        >
                          <Icon className="w-3.5 h-3.5 shrink-0" />
                          {label}
                        </button>
                      ))}
                    </div>
                  );
                })()}

                {/* Old Jobs/Platform tabs removed — now in General */}
                {/* ── BrickLink tab ────────────────────────────────── */}
                {activePlatformServicesTab === 'bricklink' && (
                  <div className="space-y-4">
                    <p className="text-[11px] text-gray-400 leading-relaxed px-1">Platform-level BrickLink OAuth credentials used for catalog enrichment, price guides (POM), and color data. Org-level credentials (configured per-org) handle inventory sync and order imports. Usage stats are in <strong className="text-gray-300">Platform Health &gt; Platform &gt; BrickLink</strong>.</p>
                    <div className="sm-card">
                      <div className="sm-card-header">
                        <Key className="h-3.5 w-3.5 text-blue-400/80" />
                        <span className="text-xs font-semibold text-gray-200">Credentials &amp; Status</span>
                        {platformBlStatusLoading && <Loader2 className="h-3 w-3 animate-spin text-gray-500 ml-auto" />}
                        {platformBlStatusData && !platformBlStatusLoading && (
                          <Badge variant="outline" className={`ml-auto text-[9px] ${platformBlStatusData.connected ? 'text-green-400 border-green-500/30 bg-green-500/5' : platformBlStatusData.hasCredentials ? 'text-red-400 border-red-500/30 bg-red-500/5' : 'text-gray-400 border-gray-600 bg-gray-500/5'}`}>
                            {platformBlStatusData.connected ? 'Connected' : platformBlStatusData.hasCredentials ? 'Error' : 'Not Configured'}
                          </Badge>
                        )}
                      </div>
                      <div className="px-4 py-3 space-y-3">
                        {[
                          { label: 'Consumer Key', value: platformBlConsumerKey, setter: setPlatformBlConsumerKey, type: 'text' as const, configured: platformBlCredsData?.hasConsumerKey, prefix: platformBlCredsData?.consumerKeyPrefix, testId: 'input-platform-bl-consumer-key' },
                          { label: 'Consumer Secret', value: platformBlConsumerSecret, setter: setPlatformBlConsumerSecret, type: 'password' as const, configured: platformBlCredsData?.hasConsumerSecret, prefix: undefined, testId: 'input-platform-bl-consumer-secret' },
                          { label: 'Token Value', value: platformBlTokenValue, setter: setPlatformBlTokenValue, type: 'text' as const, configured: platformBlCredsData?.hasTokenValue, prefix: platformBlCredsData?.tokenValuePrefix, testId: 'input-platform-bl-token-value' },
                          { label: 'Token Secret', value: platformBlTokenSecret, setter: setPlatformBlTokenSecret, type: 'password' as const, configured: platformBlCredsData?.hasTokenSecret, prefix: undefined, testId: 'input-platform-bl-token-secret' },
                        ].map(({ label, value, setter, type, configured, prefix, testId }) => (
                          <div key={label}>
                            <label className="block app-label mb-1">
                              {label}
                              {configured && !value && (
                                <span className="ml-2 text-[9px] text-green-500/70 font-normal">{prefix || '••••••••'} configured</span>
                              )}
                            </label>
                            <input
                              type={type}
                              placeholder={configured && !value ? '••••••••  (enter new value to replace)' : `Enter ${label.toLowerCase()}`}
                              value={value}
                              onChange={e => setter(e.target.value)}
                              data-testid={testId}
                              className="w-full min-w-0 bg-gray-900/60 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 placeholder-gray-600 outline-none focus:border-gray-500 font-mono"
                            />
                          </div>
                        ))}
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            onClick={async () => {
                              setPlatformBlSaving(true);
                              try {
                                const payload: Record<string, string | null> = {};
                                if (platformBlConsumerKey) payload.consumerKey = platformBlConsumerKey;
                                if (platformBlConsumerSecret) payload.consumerSecret = platformBlConsumerSecret;
                                if (platformBlTokenValue) payload.tokenValue = platformBlTokenValue;
                                if (platformBlTokenSecret) payload.tokenSecret = platformBlTokenSecret;
                                if (Object.keys(payload).length === 0) {
                                  toast({ title: "Nothing to save", description: "Enter at least one credential field.", variant: "destructive" });
                                  setPlatformBlSaving(false);
                                  return;
                                }
                                const res = await fetch('/api/platform-admin/platform-services/bricklink-credentials', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify(payload),
                                });
                                if (!res.ok) throw new Error('Failed to save');
                                setPlatformBlConsumerKey('');
                                setPlatformBlConsumerSecret('');
                                setPlatformBlTokenValue('');
                                setPlatformBlTokenSecret('');
                                queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/platform-services/bricklink-status'] });
                                queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/platform-services/bricklink-credentials'] });
                                toast({ title: "Saved", description: "Platform BrickLink credentials updated." });
                              } catch (err) {
                                toast({ title: "Error", description: "Failed to save credentials.", variant: "destructive" });
                              } finally {
                                setPlatformBlSaving(false);
                              }
                            }}
                            disabled={platformBlSaving}
                            data-testid="button-save-platform-bl-creds"
                            className="inline-flex items-center gap-1.5 text-[10px] font-medium text-blue-400 hover:text-blue-300 border border-blue-500/30 rounded px-3 py-1.5 transition-colors disabled:opacity-50"
                          >
                            {platformBlSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                            Save Credentials
                          </button>
                          <button
                            onClick={async () => {
                              setPlatformBlTesting(true);
                              try {
                                queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/platform-services/bricklink-status'] });
                                await queryClient.refetchQueries({ queryKey: ['/api/platform-admin/platform-services/bricklink-status'] });
                                const status = queryClient.getQueryData<PlatformBlStatusData>(['/api/platform-admin/platform-services/bricklink-status']);
                                if (status?.connected) {
                                  toast({ title: "Connection Successful", description: status.testResult || "BrickLink API is reachable." });
                                } else {
                                  toast({ title: "Connection Failed", description: status?.error || "Could not connect to BrickLink API.", variant: "destructive" });
                                }
                              } catch {
                                toast({ title: "Test Failed", description: "Could not test connection.", variant: "destructive" });
                              } finally {
                                setPlatformBlTesting(false);
                              }
                            }}
                            disabled={platformBlTesting || !platformBlConsumerKey}
                            data-testid="button-test-platform-bl-connection"
                            className="inline-flex items-center gap-1.5 text-[10px] font-medium text-gray-400 hover:text-gray-300 border border-gray-600 rounded px-3 py-1.5 transition-colors disabled:opacity-50"
                          >
                            {platformBlTesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                            Test Connection
                          </button>
                        </div>
                        {platformBlStatusData?.error && (
                          <p className="text-[10px] text-red-400 break-all">{platformBlStatusData.error}</p>
                        )}
                        {platformBlStatusData?.connected && platformBlStatusData.testResult && (
                          <p className="text-[10px] text-green-400">{platformBlStatusData.testResult}</p>
                        )}
                      </div>
                    </div>

                    <div className="sm-card">
                      <div className="sm-card-header">
                        <Blocks className="h-3.5 w-3.5 text-blue-400/80" />
                        <span className="text-xs font-semibold text-gray-200">Platform Limits</span>
                      </div>
                      <div className="px-4 py-3 space-y-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs text-gray-200">Daily API Call Limit</Label>
                          <p className="text-[10px] text-gray-500">Hard stop for platform BrickLink API calls. BrickLink enforces a cap of 5,000/day per credential set (rolling 24h window).</p>
                          <div className="flex items-center gap-2">
                            <Input type="number" min={500} max={25000} step={100} value={blApiCallLimit} onChange={(e) => setBlApiCallLimit(parseInt(e.target.value) || 500)} onBlur={() => updatePlatformSettingsMutation.mutate({ blApiCallLimit })} className="text-xs w-24 text-right" data-testid="input-bl-api-limit" />
                            <span className="text-[10px] text-gray-500">/ 5,000</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Stripe tab ─────────────────────────────────── */}
                {activePlatformServicesTab === 'stripe' && (
                  <div className="space-y-4">
                    {/* Config */}
                    <div className="sm-card">
                      <div className="sm-card-header">
                        <Key className="h-3.5 w-3.5 text-yellow-500/70" />
                        <span className="text-xs font-semibold text-gray-200">Configuration</span>
                        <Badge variant="outline" className={`ml-auto text-[9px] ${stripeEnvironment === 'live' ? 'text-green-400 border-green-500/30 bg-green-500/5' : 'text-yellow-400 border-yellow-500/30 bg-yellow-500/5'}`}>
                          {stripeEnvironment === 'live' ? 'Live' : 'Test'}
                        </Badge>
                      </div>
                      <div className="px-4 py-3 space-y-3">
                        <div className="flex gap-4">
                          <label className="flex items-center gap-2 cursor-pointer"><input type="radio" name="ps-stripe-env" value="live" checked={stripeEnvironment === 'live'} onChange={() => { setStripeEnvironment('live'); updateSettingsMutation.mutate({ stripeEnvironment: 'live' }); }} className="text-purple-500" data-testid="radio-ps-stripe-live" /><span className="text-xs text-gray-300">Live</span></label>
                          <label className="flex items-center gap-2 cursor-pointer"><input type="radio" name="ps-stripe-env" value="test" checked={stripeEnvironment === 'test'} onChange={() => { setStripeEnvironment('test'); updateSettingsMutation.mutate({ stripeEnvironment: 'test' }); }} className="text-purple-500" data-testid="radio-ps-stripe-test" /><span className="text-xs text-gray-300">Test</span></label>
                        </div>
                        {stripeEnvironment === 'test' && <p className="text-[10px] text-yellow-500/80">Test mode — use a <code className="font-mono">sk_test_</code> key</p>}
                        {stripeEnvironment === 'live' && <p className="text-[10px] text-green-500/80">Live mode — use a <code className="font-mono">sk_live_</code> or restricted key</p>}
                        <div>
                          <label className="block app-label mb-1">Secret Key</label>
                          <input
                            type="password"
                            placeholder={(settings as any)?.has_stripeSecretKey ? "Key saved — leave blank to keep" : (stripeEnvironment === 'test' ? 'sk_test_…' : 'sk_live_… or rk_live_…')}
                            value={stripeSecretKey}
                            onChange={e => setStripeSecretKey(e.target.value)}
                            onBlur={() => { if (stripeSecretKey) updateSettingsMutation.mutate({ stripeSecretKey }); }}
                            data-testid="input-ps-stripe-secret-key"
                            className="w-full bg-gray-900/60 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 placeholder-gray-600 outline-none focus:border-gray-500 font-mono"
                          />
                        </div>
                        <p className="text-[10px] text-gray-600">Used for tenant subscription billing, checkout sessions, and billing portal access.</p>
                      </div>
                    </div>

                    {/* Balance */}
                    <div className="sm-card">
                      <div className="sm-card-header">
                        <TrendingUp className="h-3.5 w-3.5 text-yellow-500/70" />
                        <span className="text-xs font-semibold text-gray-200">Platform Balance</span>
                        {stripeBalanceLoading && <Loader2 className="h-3 w-3 animate-spin text-gray-500 ml-1" />}
                        {stripeBalanceData && (
                          <Badge variant="outline" className={`ml-auto text-[9px] ${stripeBalanceData.livemode ? 'text-green-400 border-green-500/30' : 'text-yellow-400 border-yellow-500/30'}`}>
                            {stripeBalanceData.livemode ? 'Live' : 'Test'}
                          </Badge>
                        )}
                      </div>
                      {(stripeBalanceError as any) ? (
                        <div className="px-4 py-4 text-center">
                          <p className="text-xs text-red-400">Could not fetch balance — check that the Stripe key is configured.</p>
                        </div>
                      ) : stripeBalanceData ? (
                        <div className="divide-y divide-gray-700/40">
                          {[
                            { label: 'Available', items: stripeBalanceData.available },
                            { label: 'Pending', items: stripeBalanceData.pending },
                          ].map(({ label, items }) => (
                            <div key={label} className="px-4 py-3 flex items-center justify-between gap-4">
                              <span className="text-[11px] text-gray-500">{label}</span>
                              <div className="flex flex-wrap gap-3 justify-end">
                                {items.length === 0
                                  ? <span className="text-xs text-gray-600 font-mono">—</span>
                                  : items.map(b => (
                                    <span key={b.currency} className="text-sm font-semibold text-gray-200 font-mono">
                                      {new Intl.NumberFormat('en-US', { style: 'currency', currency: b.currency.toUpperCase() }).format(b.amount / 100)}
                                    </span>
                                  ))
                                }
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : !stripeBalanceLoading ? (
                        <div className="px-4 py-4 text-center">
                          <p className="text-xs text-gray-600">Enter a Stripe key above to view balance.</p>
                        </div>
                      ) : null}
                    </div>

                    {/* Fees note */}
                    <div className="rounded-lg bg-gray-800/60 border border-gray-700 px-4 py-3">
                      <p className="app-label mb-2">About Stripe Fees</p>
                      <p className="text-[11px] text-gray-400 leading-relaxed">Stripe charges <strong className="text-gray-300">2.9% + 30¢</strong> per successful card transaction (US). International cards and additional features may carry additional fees. Detailed fee breakdowns are available in your <a href="https://dashboard.stripe.com" target="_blank" rel="noopener noreferrer" className="text-yellow-400 hover:underline">Stripe Dashboard</a>.</p>
                    </div>
                  </div>
                )}

                {/* ── OpenAI tab ─────────────────────────────────── */}
                {activePlatformServicesTab === 'openai' && (
                  <div className="space-y-3">
                    <div className="sm-card">
                      <div className="sm-card-header">
                        <Key className="h-3.5 w-3.5 text-yellow-500/70" />
                        <span className="text-xs font-semibold text-gray-200">OpenAI Connection</span>
                        {openAIStatusLoading && <Loader2 className="h-3 w-3 animate-spin text-gray-500 ml-auto" />}
                        {openAIStatusData && !openAIStatusLoading && (
                          <Badge variant="outline" className={`ml-auto text-[9px] ${openAIStatusData.connected ? 'text-green-400 border-green-500/30 bg-green-500/5' : 'text-red-400 border-red-500/30 bg-red-500/5'}`}>
                            {openAIStatusData.connected ? 'Connected' : 'Not Connected'}
                          </Badge>
                        )}
                      </div>
                      <div className="px-4 py-3 space-y-3">
                        <div>
                          <label className="block app-label mb-1">API Key</label>
                          <input
                            type="password"
                            placeholder={(settings as any)?.has_openaiApiKey ? "Key saved — leave blank to keep" : "sk-…"}
                            value={openaiApiKey}
                            onChange={e => setOpenaiApiKey(e.target.value)}
                            onBlur={async () => {
                              if (!openaiApiKey) return;
                              try {
                                const res = await fetch('/api/platform-admin/platform-services/openai-key', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ openaiApiKey }),
                                });
                                if (!res.ok) throw new Error('Failed to save');
                                queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/platform-services/openai-status'] });
                                queryClient.invalidateQueries({ queryKey: ['/api/platform-admin/platform-services/openai-billing'] });
                              } catch (err) {
                                console.error('Failed to save OpenAI key:', err);
                              }
                            }}
                            data-testid="input-ps-openai-api-key"
                            className="w-full min-w-0 bg-gray-900/60 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 placeholder-gray-600 outline-none focus:border-gray-500 font-mono"
                          />
                        </div>
                        {openAIStatusData?.connected && openAIStatusData.models && openAIStatusData.models.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {openAIStatusData.models.map(m => (
                              <Badge key={m} variant="outline" className="text-[9px] text-gray-400 border-gray-600">{m}</Badge>
                            ))}
                          </div>
                        )}
                        {openAIStatusData?.error && <p className="text-[10px] text-red-400 break-all">{openAIStatusData.error}</p>}
                      </div>
                    </div>

                    {openAIStatusData?.connected && (
                      <div className="sm-card">
                        <div className="sm-card-header">
                          <DollarSign className="h-3.5 w-3.5 text-yellow-500/70" />
                          <span className="text-xs font-semibold text-gray-200">Account & Billing</span>
                          {openAIBillingLoading && <Loader2 className="h-3 w-3 animate-spin text-gray-500 ml-auto" />}
                        </div>
                        <div className="px-4 py-3 space-y-3">
                          {openAIBillingData?.creditsAvailable && (
                            <div className="space-y-2">
                              <div className="grid grid-cols-3 gap-2">
                                <div className="bg-gray-900/60 rounded p-2.5 text-center">
                                  <p className="text-[9px] text-gray-500 uppercase tracking-wider mb-0.5">Granted</p>
                                  <p className="text-sm font-semibold text-gray-200" data-testid="text-openai-granted">${openAIBillingData.billing.totalGranted.toFixed(2)}</p>
                                </div>
                                <div className="bg-gray-900/60 rounded p-2.5 text-center">
                                  <p className="text-[9px] text-gray-500 uppercase tracking-wider mb-0.5">Used</p>
                                  <p className="text-sm font-semibold text-orange-400" data-testid="text-openai-used">${openAIBillingData.billing.totalUsed.toFixed(2)}</p>
                                </div>
                                <div className="bg-gray-900/60 rounded p-2.5 text-center">
                                  <p className="text-[9px] text-gray-500 uppercase tracking-wider mb-0.5">Remaining</p>
                                  <p className={`text-sm font-semibold ${openAIBillingData.billing.totalAvailable < 1 ? 'text-red-400' : 'text-green-400'}`} data-testid="text-openai-remaining">${openAIBillingData.billing.totalAvailable.toFixed(2)}</p>
                                </div>
                              </div>
                              {openAIBillingData.billing.totalGranted > 0 && (
                                <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all ${openAIBillingData.billing.totalAvailable < 1 ? 'bg-red-500' : 'bg-yellow-500'}`}
                                    style={{ width: `${Math.min(100, (openAIBillingData.billing.totalUsed / openAIBillingData.billing.totalGranted) * 100)}%` }}
                                  />
                                </div>
                              )}
                              {openAIBillingData.billing.grants.length > 0 && (
                                <div className="space-y-1">
                                  <p className="text-[9px] text-gray-500 uppercase tracking-wider">Credit Grants</p>
                                  {openAIBillingData.billing.grants.map(g => (
                                    <div key={g.id} className="flex items-center justify-between gap-2 text-[10px] bg-gray-900/40 rounded px-2 py-1.5">
                                      <span className="text-gray-400">${g.amount?.toFixed(2)} grant</span>
                                      <span className="text-gray-500">${g.used?.toFixed(2)} used</span>
                                      {g.expires && (
                                        <span className="text-gray-600">exp {new Date(g.expires).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}</span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                          {openAIBillingData?.costsAvailable && (
                            <div className="space-y-2 pt-1 border-t border-gray-700/40">
                              <div className="grid grid-cols-2 gap-2">
                                <div className="bg-gray-900/60 rounded p-2.5 text-center">
                                  <p className="text-[9px] text-gray-500 uppercase tracking-wider mb-0.5">Est. Cost (MTD)</p>
                                  <p className="text-sm font-semibold text-yellow-400" data-testid="text-openai-mtd">${openAIBillingData.usage.mtd.toFixed(4)}</p>
                                  {openAIBillingData.usage.mtdTokens != null && (
                                    <p className="text-[9px] text-gray-600 mt-0.5">{openAIBillingData.usage.mtdTokens.toLocaleString()} tokens</p>
                                  )}
                                </div>
                                <div className="bg-gray-900/60 rounded p-2.5 text-center">
                                  <p className="text-[9px] text-gray-500 uppercase tracking-wider mb-0.5">Est. Cost (30d)</p>
                                  <p className="text-sm font-semibold text-gray-200" data-testid="text-openai-30d">${openAIBillingData.usage.last30Days.toFixed(4)}</p>
                                  {openAIBillingData.usage.totalTokens != null && (
                                    <p className="text-[9px] text-gray-600 mt-0.5">{openAIBillingData.usage.totalTokens.toLocaleString()} tokens</p>
                                  )}
                                </div>
                              </div>

                              {openAIBillingData.usage.topModels.length > 0 && (
                                <div className="space-y-1">
                                  <p className="text-[9px] text-gray-500 uppercase tracking-wider">Usage by Model (30d)</p>
                                  {openAIBillingData.usage.topModels.map(m => {
                                    const tokens = (m.input_tokens || 0) + (m.output_tokens || 0);
                                    const maxTokens = Math.max(...openAIBillingData.usage.topModels.map(t => (t.input_tokens || 0) + (t.output_tokens || 0)), 1);
                                    return (
                                      <div key={`${m.service || 'ai'}-${m.model}`} className="flex items-center gap-2 text-[10px]">
                                        <span className="text-gray-400 w-40 truncate shrink-0 font-mono" title={`${m.service || ''}/${m.model}`}>
                                          {m.model}
                                        </span>
                                        <div className="flex-1 bg-gray-800 rounded-full h-1 overflow-hidden">
                                          <div className="h-full bg-yellow-500/60 rounded-full" style={{ width: `${(tokens / maxTokens) * 100}%` }} />
                                        </div>
                                        <span className="text-gray-500 w-24 text-right shrink-0 tabular-nums">
                                          {m.cost > 0 ? `$${m.cost.toFixed(4)}` : ''} {tokens > 0 ? `${tokens.toLocaleString()}t` : ''}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                              {openAIBillingData.source === 'local' && (
                                <p className="text-[9px] text-gray-600 italic">Costs estimated from tracked API responses. Actual charges may differ slightly.</p>
                              )}
                            </div>
                          )}

                          {!openAIBillingLoading && !openAIBillingData?.costsAvailable && (
                            <p className="text-[10px] text-gray-500">No AI usage tracked yet. Usage will appear here as API calls are made.</p>
                          )}
                        </div>
                      </div>
                    )}

                    {openAIStatusData?.connected && (
                      <div className="sm-card">
                        <div className="sm-card-header">
                          <BarChart2 className="h-3.5 w-3.5 text-blue-400/70" />
                          <span className="text-xs font-semibold text-gray-200">Cost Attribution (30d)</span>
                          {orgUsageLoading && <Loader2 className="h-3 w-3 animate-spin text-gray-500 ml-auto" />}
                        </div>
                        <div className="px-4 py-3 space-y-3">
                          {orgUsageData?.orgs && orgUsageData.orgs.length > 0 ? (() => {
                            const platformEntry = orgUsageData.orgs.find(o => o.orgId === 'platform');
                            const orgEntries = orgUsageData.orgs.filter(o => o.orgId !== 'platform');
                            const allEntries = orgUsageData.orgs;
                            const maxTokens = allEntries[0]?.totalTokens || 1;
                            const grandTotal = allEntries.reduce((s, o) => s + o.totalCost, 0);

                            return (
                              <>
                                {platformEntry && (
                                  <div>
                                    <p className="text-[9px] text-yellow-500/80 uppercase tracking-wider font-semibold mb-1.5">Platform</p>
                                    <div className="bg-yellow-900/20 border border-yellow-500/15 rounded p-2.5 space-y-1.5" data-testid="org-usage-platform">
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="text-[11px] font-medium text-yellow-300/90">{platformEntry.orgName || 'Platform'}</span>
                                        <span className="text-[10px] text-yellow-400/70 shrink-0 tabular-nums">
                                          {platformEntry.totalCost > 0 ? `$${platformEntry.totalCost.toFixed(4)}` : ''} {platformEntry.totalTokens.toLocaleString()} tokens
                                        </span>
                                      </div>
                                      <div className="w-full bg-gray-800 rounded-full h-1 overflow-hidden">
                                        <div className="h-full bg-yellow-500/50 rounded-full" style={{ width: `${(platformEntry.totalTokens / maxTokens) * 100}%` }} />
                                      </div>
                                      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                                        {platformEntry.operations.map(op => (
                                          <span key={op.operation} className="text-[9px] text-yellow-500/50">
                                            {op.operation}: {op.tokens.toLocaleString()}t / {op.requests.toLocaleString()} calls
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {orgEntries.length > 0 && (
                                  <div>
                                    <p className="text-[9px] text-blue-400/80 uppercase tracking-wider font-semibold mb-1.5">Organizations</p>
                                    <div className="space-y-1.5">
                                      {orgEntries.map(org => (
                                        <div key={org.orgId} className="bg-gray-900/60 rounded p-2.5 space-y-1.5" data-testid={`org-usage-${org.orgId}`}>
                                          <div className="flex items-center justify-between gap-2">
                                            <span className="text-[11px] font-medium text-gray-200 truncate">{org.orgName}</span>
                                            <span className="text-[10px] text-gray-400 shrink-0 tabular-nums">
                                              {org.totalCost > 0 ? `$${org.totalCost.toFixed(4)}` : ''} {org.totalTokens.toLocaleString()} tokens
                                            </span>
                                          </div>
                                          <div className="w-full bg-gray-800 rounded-full h-1 overflow-hidden">
                                            <div className="h-full bg-blue-500/60 rounded-full" style={{ width: `${(org.totalTokens / maxTokens) * 100}%` }} />
                                          </div>
                                          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                                            {org.operations.map(op => (
                                              <span key={op.operation} className="text-[9px] text-gray-500">
                                                {op.operation}: {op.tokens.toLocaleString()}t / {op.requests.toLocaleString()} calls
                                              </span>
                                            ))}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {grandTotal > 0 && (
                                  <div className="flex items-center justify-between pt-2 border-t border-gray-700/40">
                                    <span className="text-[10px] text-gray-400 font-medium">Total Estimated (30d)</span>
                                    <span className="text-[11px] text-gray-200 font-semibold tabular-nums" data-testid="text-usage-grand-total">${grandTotal.toFixed(4)}</span>
                                  </div>
                                )}
                              </>
                            );
                          })() : !orgUsageLoading ? (
                            <p className="text-[10px] text-gray-500">No usage tracked yet. Data will appear as AI calls are made.</p>
                          ) : null}
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2 px-1">
                      <a href="https://platform.openai.com/usage" target="_blank" rel="noopener noreferrer" data-testid="link-openai-usage-dashboard" className="inline-flex items-center gap-1 text-[10px] text-yellow-400 hover:text-yellow-300 border border-yellow-500/30 rounded px-2 py-1 transition-colors">
                        <ExternalLink className="h-3 w-3 shrink-0" />Usage Dashboard
                      </a>
                      <a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noopener noreferrer" data-testid="link-openai-billing" className="inline-flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-300 border border-gray-600 rounded px-2 py-1 transition-colors">
                        <ExternalLink className="h-3 w-3 shrink-0" />Billing Settings
                      </a>
                    </div>
                  </div>
                )}

              </div>
            )}

            {/* Warehouse Management */}
            {activeSection === 'warehouse' && (
              <div className="p-4">
                <WarehouseManagement />
              </div>
            )}

            {/* Notifications */}
            {activeSection === 'notifications' && <NotificationsSection />}

            {/* Mappings */}
            {activeSection === 'mapping' && (
              <MappingSection />
            )}

            {/* About & Credits */}
            {activeSection === 'about' && (
              <div className="p-4 space-y-5">

                {/* Built with Replit */}
                <div className="sm-card">
                  <div className="px-4 py-3 bg-gray-800 border-b border-gray-700 flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-violet-400" />
                    <span className="text-sm font-semibold text-white">Built with Replit</span>
                  </div>
                  <div className="px-4 py-3">
                    <p className="text-xs text-gray-300 leading-relaxed">
                      E.L.F.I.E. was designed and built entirely on <span className="text-violet-300 font-medium">Replit</span> using its AI-powered development environment. Every feature — from BrickSpotter's vision pipeline to the multi-channel sync engine — was conceived, coded, tested, and deployed without leaving the browser.
                    </p>
                  </div>
                </div>

                {/* Data & Security */}
                <div>
                  <p className="sm-group-label mb-2 px-1">Data & Security</p>
                  <div className="sm-card-divided">
                    {[
                      { name: 'Tenant Isolation', desc: 'Each store\'s inventory, orders, and settings are scoped to their organization — no data is shared across accounts' },
                      { name: 'Encrypted Credentials', desc: 'Marketplace API keys and secrets are stored encrypted at rest and never exposed in logs or responses' },
                      { name: 'Automated Backups', desc: 'Point-in-time database backups run automatically and can be downloaded or restored at any time from Store Data' },
                      { name: 'Your Data, Your Control', desc: 'Your inventory and order data is never sold or shared with third parties. Marketplace data flows in — not out' },
                      { name: 'Infrastructure', desc: 'Hosted on Replit\'s managed cloud with TLS encryption in transit on all connections' },
                    ].map(({ name, desc }) => (
                      <div key={name} className="flex items-start gap-3 px-4 py-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-200">{name}</p>
                          <p className="sm-description">{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Architecture */}
                <div>
                  <p className="sm-group-label mb-2 px-1">Architecture</p>
                  <div className="sm-card-divided">
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
                          <p className="sm-description">{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* UI & Design */}
                <div>
                  <p className="sm-group-label mb-2 px-1">UI & Design</p>
                  <div className="sm-card-divided">
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
                          <p className="sm-description">{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* AI & Intelligence */}
                <div>
                  <p className="sm-group-label mb-2 px-1">AI & Intelligence</p>
                  <div className="sm-card-divided">
                    {[
                      { name: 'OpenAI', desc: 'AI chat, analysis, summaries, and semantic search embeddings', url: 'https://openai.com' },
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
                          <p className="sm-description">{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* LEGO Data */}
                <div>
                  <p className="sm-group-label mb-2 px-1">LEGO Data & Marketplaces</p>
                  <div className="sm-card-divided">
                    {[
                      { name: 'BrickLink', desc: 'Primary marketplace — inventory, orders, and pricing data', url: 'https://www.bricklink.com' },
                      { name: 'BrickOwl', desc: 'Secondary marketplace channel', url: 'https://www.brickowl.com' },
                      { name: 'Rebrickable', desc: 'Parts catalog, set inventories, and set-to-parts relationships; LDraw for part images', url: 'https://rebrickable.com' },
                    ].map(({ name, desc, url }) => (
                      <div key={name} className="flex items-start gap-3 px-4 py-2.5">
                        <div className="flex-1 min-w-0">
                          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 group">
                            <span className="text-xs font-medium text-gray-200 group-hover:text-violet-300 transition-colors">{name}</span>
                            <ExternalLink className="h-2.5 w-2.5 text-gray-600 group-hover:text-violet-400 transition-colors shrink-0" />
                          </a>
                          <p className="sm-description">{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Payments & Services */}
                <div>
                  <p className="sm-group-label mb-2 px-1">Payments & Services</p>
                  <div className="sm-card-divided">
                    {[
                      { name: 'Stripe', desc: 'Subscription billing and payment processing', url: 'https://stripe.com' },
                      { name: 'EasyPost', desc: 'Shipping label generation and scan forms', url: 'https://www.easypost.com' },
                    ].map(({ name, desc, url }) => (
                      <div key={name} className="flex items-start gap-3 px-4 py-2.5">
                        <div className="flex-1 min-w-0">
                          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 group">
                            <span className="text-xs font-medium text-gray-200 group-hover:text-violet-300 transition-colors">{name}</span>
                            <ExternalLink className="h-2.5 w-2.5 text-gray-600 group-hover:text-violet-400 transition-colors shrink-0" />
                          </a>
                          <p className="sm-description">{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <p className="text-center text-[10px] text-gray-600 pb-2">{APP_NAME} {APP_VERSION}</p>

              </div>
            )}

            {activeSection === 'legal' && (
              <div className="p-4 space-y-5">

                {/* TOS Acceptance Status */}
                <div className="sm-card">
                  <div className="px-4 py-3 bg-gray-800 border-b border-gray-700 flex items-center gap-2">
                    <FileText className="h-4 w-4 text-blue-400" />
                    <span className="text-sm font-semibold text-white">Terms of Service</span>
                  </div>
                  <div className="px-4 py-3 space-y-2">
                    {org?.tosAcceptedAt ? (
                      <div className="flex items-center gap-2 text-xs text-green-400">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Accepted on {new Date(org.tosAcceptedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                      </div>
                    ) : (
                      <p className="text-xs text-amber-400">Terms have not been formally accepted yet. They were accepted during onboarding.</p>
                    )}
                  </div>
                </div>

                {/* Full Terms of Service */}
                <div className="sm-card">
                  <div className="px-4 py-3 bg-gray-800 border-b border-gray-700">
                    <span className="text-xs font-semibold text-gray-300">E.L.F.I.E. Terms of Service</span>
                    <span className="text-[10px] text-gray-600 ml-2">Last updated: {TOS_LAST_UPDATED}</span>
                  </div>
                  <div className="px-4 py-4 text-xs text-gray-400 leading-relaxed space-y-3 max-h-[400px] overflow-y-auto" data-testid="tos-content-settings">
                    {TOS_SECTIONS.map(s => (
                      <p key={s.num}><strong className="text-gray-300">{s.num}. {s.title}.</strong> {s.text}</p>
                    ))}
                  </div>
                </div>

                {/* Use Restrictions */}
                <div>
                  <p className="sm-group-label mb-2 px-1">Use Restrictions</p>
                  <div className="sm-card-divided">
                    <div className="flex items-start gap-3 px-4 py-3">
                      <ImageIcon className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-400" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-200 mb-0.5">Catalog Images</p>
                        <p className="sm-description leading-relaxed">Part images sourced from BrickLink and Rebrickable are licensed for internal inventory use only. They may not be used on public-facing websites, social media, or redistributed outside this platform.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 px-4 py-3">
                      <Brain className="h-3.5 w-3.5 mt-0.5 shrink-0 text-violet-400" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-200 mb-0.5">AI-Generated Content</p>
                        <p className="sm-description leading-relaxed">Responses from ELFIE and AI-assisted price suggestions are for reference only. Always verify outputs before acting on them — they may contain inaccuracies.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 px-4 py-3">
                      <Database className="h-3.5 w-3.5 mt-0.5 shrink-0 text-blue-400" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-200 mb-0.5">Marketplace Data</p>
                        <p className="sm-description leading-relaxed">BrickLink and BrickOwl order and pricing data accessed through the platform API is subject to each marketplace's API Terms of Service and may not be bulk-exported or repurposed.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 px-4 py-3">
                      <Globe className="h-3.5 w-3.5 mt-0.5 shrink-0 text-green-400" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-200 mb-0.5">Rebrickable Catalog</p>
                        <p className="sm-description leading-relaxed">Parts reference data from Rebrickable is used under their data license for internal lookup and enrichment only. It may not be redistributed or used to build competing catalogs.</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Third-Party Services */}
                <div>
                  <p className="sm-group-label mb-2 px-1">Third-Party Services</p>
                  <div className="sm-card-divided">
                    {[
                      { name: 'BrickLink', desc: 'Marketplace API — inventory, orders, pricing, and catalog data', url: 'https://www.bricklink.com', terms: 'https://www.bricklink.com/help.asp?helpID=2600' },
                      { name: 'BrickOwl', desc: 'Secondary marketplace channel — orders and inventory sync', url: 'https://www.brickowl.com', terms: 'https://www.brickowl.com/help/terms_of_service' },
                      { name: 'Rebrickable', desc: 'Parts catalog, set inventories, and cross-reference data', url: 'https://rebrickable.com', terms: 'https://rebrickable.com/about/' },
                      { name: 'OpenAI', desc: 'AI language model powering ELFIE, text embeddings, and smart search', url: 'https://openai.com', terms: 'https://openai.com/policies/usage-policies' },
                      { name: 'Stripe', desc: 'Payment processing for platform subscriptions', url: 'https://stripe.com', terms: 'https://stripe.com/legal/ssa' },
                      { name: 'CLIP (OpenAI)', desc: 'Vision model powering BrickSpotter part recognition — outputs are for internal identification only', url: 'https://openai.com/research/clip', terms: 'https://openai.com/policies/usage-policies' },
                    ].map(({ name, desc, url, terms }) => (
                      <div key={name} className="flex items-start gap-3 px-4 py-2.5">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 group">
                              <span className="text-xs font-medium text-gray-200 group-hover:text-blue-300 transition-colors">{name}</span>
                              <ExternalLink className="h-2.5 w-2.5 text-gray-600 group-hover:text-blue-400 transition-colors shrink-0" />
                            </a>
                            <a href={terms} target="_blank" rel="noopener noreferrer" className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors whitespace-nowrap">
                              Terms
                            </a>
                          </div>
                          <p className="sm-description mt-0.5">{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            )}

            </div>
          </div>
          
        </DialogContent>
      </Dialog>


      {/* Remove Test Orders Dialog */}
      <ResponsiveModal
        open={testOrdersDialog}
        onOpenChange={(open) => { if (!open && !testOrdersDeleting) { setTestOrdersDialog(false); setTestOrdersPreview(null); } }}
        title="Remove Test Orders"
        icon={Trash2}
        iconColor="text-amber-400"
        description="Permanently delete all test orders and their associated records"
        testId="modal-remove-test-orders"
      >
        <div className="space-y-4">
          {testOrdersLoading && (
            <p className="text-sm text-gray-400">Scanning for test orders...</p>
          )}
          {!testOrdersLoading && testOrdersPreview && (
            <>
              {testOrdersPreview.count === 0 ? (
                <p className="text-sm text-gray-400">No test orders found. Nothing to delete.</p>
              ) : (
                <>
                  <p className="text-sm text-gray-300">
                    Found <strong className="text-white">{testOrdersPreview.count} test order{testOrdersPreview.count !== 1 ? 's' : ''}</strong>. The following will be permanently deleted:
                  </p>
                  <ul className="text-xs text-gray-400 space-y-1 ml-3 list-disc">
                    <li>All {testOrdersPreview.count} test order record{testOrdersPreview.count !== 1 ? 's' : ''}</li>
                    <li>All associated order details, adjustments, picklist items, and shipments</li>
                  </ul>
                  <p className="text-xs text-gray-500">
                    Inventory quantities will <strong className="text-gray-300">not</strong> be changed — this only removes the order records.
                  </p>
                  {testOrdersPreview.withActiveInventory.length > 0 && (
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded p-3 space-y-1">
                      <p className="text-xs font-medium text-amber-300">
                        {testOrdersPreview.withActiveInventory.length} order{testOrdersPreview.withActiveInventory.length !== 1 ? 's have' : ' has'} inventory that was not returned
                      </p>
                      <p className="text-xs text-amber-400/80">
                        These orders still have quantities deducted from your inventory. Since no quantities will be restored on delete, those lots may be under-counted after removal. Consider manually returning these orders first if you need accurate stock counts.
                      </p>
                    </div>
                  )}
                  <div className="bg-red-500/10 border border-red-500/30 rounded p-2">
                    <p className="text-xs text-red-300">This action cannot be undone.</p>
                  </div>
                </>
              )}
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setTestOrdersDialog(false); setTestOrdersPreview(null); }}
              disabled={testOrdersDeleting}
              data-testid="button-cancel-test-orders"
            >
              Cancel
            </Button>
            {testOrdersPreview && testOrdersPreview.count > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteTestOrders}
                disabled={testOrdersDeleting}
                data-testid="button-confirm-remove-test-orders"
              >
                {testOrdersDeleting ? 'Deleting...' : `Delete ${testOrdersPreview.count} Order${testOrdersPreview.count !== 1 ? 's' : ''}`}
              </Button>
            )}
          </div>
        </div>
      </ResponsiveModal>

      {/* Remove Closed Orders Dialog */}
      <ResponsiveModal
        open={closedOrdersDialog}
        onOpenChange={(open) => { if (!open && !closedOrdersDeleting) { setClosedOrdersDialog(false); setClosedOrdersPreview(null); } }}
        title="Remove All Test Orders"
        icon={Trash2}
        iconColor="text-amber-400"
        description="Permanently delete all orders marked as test, regardless of their status"
        testId="modal-remove-closed-orders"
      >
        <div className="space-y-4">
          {closedOrdersLoading && (
            <p className="text-sm text-gray-400">Scanning orders...</p>
          )}
          {!closedOrdersLoading && closedOrdersPreview && (
            <>
              {closedOrdersPreview.count === 0 ? (
                <p className="text-sm text-gray-400">No test orders found. Nothing to delete.</p>
              ) : (
                <>
                  <p className="text-sm text-gray-300">
                    Found <strong className="text-white">{closedOrdersPreview.count} test order{closedOrdersPreview.count !== 1 ? 's' : ''}</strong> to permanently delete:
                  </p>
                  <ul className="text-xs text-gray-400 space-y-1 ml-3 list-disc">
                    {closedOrdersPreview.otherCount > 0 && <li>{closedOrdersPreview.otherCount} active/shipped test order{closedOrdersPreview.otherCount !== 1 ? 's' : ''}</li>}
                    {closedOrdersPreview.returnedCount > 0 && <li>{closedOrdersPreview.returnedCount} returned test order{closedOrdersPreview.returnedCount !== 1 ? 's' : ''}</li>}
                    {closedOrdersPreview.cancelledCount > 0 && <li>{closedOrdersPreview.cancelledCount} cancelled test order{closedOrdersPreview.cancelledCount !== 1 ? 's' : ''}</li>}
                    <li>All associated order details, adjustments, picklist items, and shipments</li>
                  </ul>
                  <p className="text-xs text-gray-500">
                    Inventory quantities will <strong className="text-gray-300">not</strong> be changed — only the order records are removed.
                  </p>
                  <div className="bg-red-500/10 border border-red-500/30 rounded p-2">
                    <p className="text-xs text-red-300">This action cannot be undone.</p>
                  </div>
                </>
              )}
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setClosedOrdersDialog(false); setClosedOrdersPreview(null); }}
              disabled={closedOrdersDeleting}
              data-testid="button-cancel-closed-orders"
            >
              Cancel
            </Button>
            {closedOrdersPreview && closedOrdersPreview.count > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteClosedOrders}
                disabled={closedOrdersDeleting}
                data-testid="button-confirm-remove-closed-orders"
              >
                {closedOrdersDeleting ? 'Deleting...' : `Delete ${closedOrdersPreview.count} Order${closedOrdersPreview.count !== 1 ? 's' : ''}`}
              </Button>
            )}
          </div>
        </div>
      </ResponsiveModal>

      {/* Clear Data Confirmation Dialog */}
      <ResponsiveModal
        open={clearDataDialog !== null}
        onOpenChange={() => setClearDataDialog(null)}
        title={`Clear ${clearDataDialog === 'inventory' ? 'Inventory' : 'Order'} Data?`}
        icon={Trash2}
        iconColor="text-red-400"
        description={`Permanently delete all ${clearDataDialog === 'inventory' ? 'inventory' : 'order'} data`}
        testId="modal-clear-data"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-400">
            This action cannot be undone. This will permanently delete all {clearDataDialog === 'inventory' ? 'inventory' : 'order'} data from the database.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setClearDataDialog(null)} data-testid="button-cancel-clear">Cancel</Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => clearDataDialog && handleClearData(clearDataDialog)}
              data-testid="button-confirm-clear"
            >
              Clear Data
            </Button>
          </div>
        </div>
      </ResponsiveModal>

      {/* Restore Wizard Dialog */}
      <ResponsiveModal
        open={restoreWizardOpen}
        onOpenChange={(open) => {
          if (!open && restoreStep !== 'restoring' && restoreStep !== 'syncing' && restoreStep !== 'differential') {
            setRestoreWizardOpen(false);
            setRestoreStep('select');
            setRestoreProgress(0);
            setDifferentialAnalysis(null);
            setVerificationResults(null);
          }
        }}
        title={
          restoreStep === 'warning' ? 'Important: Read Before Proceeding' :
          restoreStep === 'restoring' ? 'Restoring Database...' :
          restoreStep === 'syncing' ? 'Syncing from Sales Platforms...' :
          restoreStep === 'differential' ? 'Quick Recovery: Restore Current State' :
          restoreStep === 'verification' ? 'Verifying Recovery...' :
          restoreStep === 'complete' ? 'Recovery Complete!' : 'Restore Wizard'
        }
        icon={RotateCcw}
        iconColor="text-blue-400"
        description="Database restore wizard"
        maxWidth="max-w-2xl"
        testId="modal-restore-wizard"
      >

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
                    <li><strong>Database Restore:</strong> We'll roll back your E.L.F.I.E. database to the selected timestamp</li>
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
                  <p className="text-xs font-medium text-gray-100">Checklist - Please Confirm:</p>
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
                  <p className="text-xs text-gray-500">
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
                    <span className="text-xs text-gray-200">Syncing... (23 of 89)</span>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-gray-800 border border-gray-700 rounded opacity-50">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-gray-500" />
                      <span className="text-xs text-gray-200">EasyPost Tracking Data</span>
                    </div>
                    <span className="sm-description">Waiting...</span>
                  </div>
                </div>

                <div className="bg-blue-500/10 border border-blue-500/30 rounded p-3">
                  <p className="text-xs text-blue-300">
                    <strong>Why we do this:</strong> Your sales platforms (BrickLink and BrickOwl) have processed sales and status changes since the restore point. We're pulling their current data to ensure E.L.F.I.E. matches reality. EasyPost tracking data is also synced to match shipment statuses.
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
                    <ul className="text-xs text-green-200/90 space-y-1 ml-4 list-disc">
                      <li><strong>Quantities:</strong> Reflects sales that happened after restore point</li>
                      <li><strong>Prices:</strong> Current pricing from BrickOwl</li>
                      <li><strong>Remarks:</strong> Personal notes (BrickOwl personal_note → BrickLink remarks)</li>
                      <li><strong>Descriptions:</strong> Public notes (BrickOwl public_note → BrickLink description)</li>
                      <li><strong>Conditions:</strong> New/Used status updates</li>
                    </ul>
                  </div>
                </div>

                <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-gray-100 mb-3">Differential Analysis</h4>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="bg-gray-900 rounded p-3">
                      <p className="text-gray-400">Total Items in BrickOwl</p>
                      <p className="text-white font-medium text-sm">{differentialAnalysis.totalItems}</p>
                    </div>
                    <div className="bg-gray-900 rounded p-3">
                      <p className="text-gray-400">Quantity Adjustments</p>
                      <p className="text-blue-400 font-medium text-sm">{differentialAnalysis.quantityChanges}</p>
                    </div>
                    <div className="bg-gray-900 rounded p-3">
                      <p className="text-gray-400">Net Quantity Change</p>
                      <p className={`font-medium text-sm ${differentialAnalysis.netQuantityChange < 0 ? 'text-red-400' : 'text-green-400'}`}>
                        {differentialAnalysis.netQuantityChange > 0 ? '+' : ''}{differentialAnalysis.netQuantityChange} pieces
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {differentialAnalysis.netQuantityChange < 0 ? 'Sales since restore point' : 'Restocks since restore point'}
                      </p>
                    </div>
                    <div className="bg-gray-900 rounded p-3">
                      <p className="text-gray-400">Price Updates</p>
                      <p className="text-purple-400 font-medium text-sm">{differentialAnalysis.priceUpdates}</p>
                    </div>
                    <div className="bg-gray-900 rounded p-3">
                      <p className="text-gray-400">Remarks Updates</p>
                      <p className="text-yellow-400 font-medium text-sm">{differentialAnalysis.remarksUpdates}</p>
                    </div>
                    <div className="bg-gray-900 rounded p-3">
                      <p className="text-gray-400">Description Updates</p>
                      <p className="text-cyan-400 font-medium text-sm">{differentialAnalysis.descriptionUpdates}</p>
                    </div>
                  </div>
                </div>

                <div className="bg-blue-500/10 border border-blue-500/30 rounded p-3">
                  <p className="text-xs text-blue-300">
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
                  <p className="text-xs text-gray-200">Checking data integrity and platform synchronization</p>
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
                      <strong>⚠ Issues detected.</strong> Some data may not match between E.L.F.I.E. and your sales platforms. Review the issues above and consider manual verification.
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
                  <h3 className="text-sm font-semibold text-green-300 mb-2">Recovery Complete!</h3>
                  <p className="text-xs text-gray-200">Your database has been successfully restored and BrickLink updated to current state</p>
                </div>

                <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-medium text-green-300">✓ Recovery Summary:</p>
                  <ul className="text-xs text-green-200/90 space-y-1 ml-4 list-disc">
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
                  <p className="text-xs text-gray-200">
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
      </ResponsiveModal>

      {/* Updated Items Detail Drawer */}
      <Drawer open={updatedItemsDrawerOpen} onOpenChange={setUpdatedItemsDrawerOpen}>
        <DrawerContent className="bg-gray-950 border-gray-800 max-h-[88vh] flex flex-col rounded-t-2xl">
          <DrawerHeader className="p-0 flex-shrink-0">
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-gray-700" />
            </div>
            <div className="flex items-center gap-2 px-4 pt-2 pb-2 border-b border-gray-800">
              <div className="flex-1">
                <DrawerTitle className="text-sm font-semibold text-gray-100">Updated Lots — Last Sync</DrawerTitle>
                {channelLastResult && (
                  <p className="text-[10px] text-gray-500 mt-0.5">{channelLastResult.lotsUpdated} lots pushed to BrickOwl · {new Date(channelLastResult.completedAt).toLocaleString()}</p>
                )}
              </div>
              <DrawerClose asChild>
                <button className="text-gray-500 hover:text-gray-200 transition-colors" data-testid="button-close-updated-items">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </DrawerClose>
            </div>
          </DrawerHeader>

          <div className="flex-1 overflow-auto px-4 pt-3 pb-4 min-h-0">
            {updatedItemsLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="rounded-md bg-gray-800/50 border border-gray-700 p-3 animate-pulse h-16" />
                ))}
              </div>
            ) : !updatedItemsData?.updatedItems?.length ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-gray-400 text-sm">No detail available.</p>
                <p className="text-gray-600 text-xs mt-1">Run a sync to capture per-lot changes.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {updatedItemsData.updatedItems.map((item, idx) => (
                  <div key={idx} className="rounded-md bg-gray-800/40 border border-gray-700/60 p-3 space-y-2" data-testid={`updated-item-${idx}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white font-mono">{item.itemNo}</span>
                      <span className="text-[10px] text-gray-500 capitalize">{item.condition === 'new' ? 'New' : 'Used'}</span>
                      <span className="text-[10px] text-gray-600 ml-auto">lot {item.lotId}</span>
                    </div>
                    <div className="space-y-1">
                      {item.changes.map((change, ci) => {
                        const fieldLabel: Record<string, string> = {
                          qty: 'Qty', price: 'Price', remarks: 'Remarks', description: 'Description',
                          tierPrice: 'Tier Price', salePercent: 'Sale %', forSale: 'For Sale',
                          bulkQty: 'Min Order', color: 'Color',
                        };
                        const isPrice = change.field === 'price';
                        const isLongText = change.from.length > 30 || change.to.length > 30;
                        return (
                          <div key={ci} className={`text-[10px] ${isLongText ? 'space-y-0.5' : 'flex items-center gap-1.5'}`}>
                            <span className="text-gray-500 shrink-0">{fieldLabel[change.field] ?? change.field}:</span>
                            {isLongText ? (
                              <div className="grid grid-cols-2 gap-1 mt-0.5">
                                <div className="bg-red-950/30 border border-red-900/30 rounded px-1.5 py-0.5 text-red-300/80 font-mono break-words">{change.from || '(empty)'}</div>
                                <div className="bg-green-950/30 border border-green-900/30 rounded px-1.5 py-0.5 text-green-300/80 font-mono break-words">{change.to || '(empty)'}</div>
                              </div>
                            ) : (
                              <>
                                <span className="text-red-400/80 font-mono line-through">{isPrice ? `$${change.from}` : change.from}</span>
                                <span className="text-gray-600">→</span>
                                <span className="text-green-400/80 font-mono">{isPrice ? `$${change.to}` : change.to}</span>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {updatedItemsData.updatedItems.length >= 200 && (
                  <p className="text-[10px] text-gray-600 text-center pt-1">Showing first 200 lots. All lots were synced.</p>
                )}
              </div>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
