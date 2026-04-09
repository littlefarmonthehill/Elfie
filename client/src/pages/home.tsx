import { useState, useEffect, useRef } from "react";
import { Package, ClipboardList, RefreshCw, ExternalLink, X, EyeOff, LogOut, ArrowLeft, RotateCw, Mail, Sparkles, ListChecks, ScanSearch, Truck, PackageCheck, SlidersHorizontal, Info, CreditCard, ShoppingCart, Users, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAdminScaling } from "@/hooks/useAdminScaling";
import { useAuth } from "@/hooks/useAuth";
import OnboardingWizard from "@/components/OnboardingWizard";
import EmployeeWelcome, { hasCompletedEmployeeWelcome } from "@/components/EmployeeWelcome";
import BrickSpotterWelcome, { hasCompletedBsWelcome } from "@/components/BrickSpotterWelcome";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Organization } from "@shared/schema";
import Header from "@/components/Header";
import DashboardNav, { DashboardNavRail, DashboardType } from "@/components/DashboardNav";
import SettingsModal from "@/components/SettingsModal";
import InventoryDashboard from "@/components/InventoryDashboard";
import SalesDashboard, { SalesDrawer } from "@/components/SalesDashboard";
import MarketingDashboard, { MarketingDrawer } from "@/components/MarketingDashboard";
import GeneralDashboard from "@/components/GeneralDashboard";
import OrdersDashboard from "@/components/OrdersDashboard";
import ChatInterface from "@/components/ChatInterface";
import DetailModal, { DetailData } from "@/components/DetailModal";
import { DateRangeValue } from "@/components/DateRangeSelector";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ToolDrawer } from "@/components/ui/tool-drawer";
import PriceOMaticDashboard, { type PricingInsight } from "@/components/PriceOMaticDashboard";
import ListomaticPriority from "@/components/ListomaticPriority";
import BrickanalyzerTool from "@/components/BrickanalyzerTool";
import FulfillmentTool from "@/components/FulfillmentTool";
import ShippedOrdersTool from "@/components/ShippedOrdersTool";
import { BillingDrawer } from "@/components/BillingDrawer";
import PlanExpiredScreen from "@/components/PlanExpiredScreen";
import InventoryHealthPanel from "@/components/InventoryHealthPanel";
import InventoryBrowsePanel from "@/components/InventoryBrowsePanel";
import BrickLinkSyncPanel from "@/components/BrickLinkSyncPanel";
import ChannelSyncPanel from "@/components/ChannelSyncPanel";
import BundleTronPanel from "@/components/BundleTronPanel";
import AcquisitionEvaluator from "@/components/AcquisitionEvaluator";
import InsightsDashboard from "@/components/InsightsDashboard";
import OrderSyncPanel, { PLATFORM_CONFIG as ORDER_PLATFORM_CONFIG, OrderSyncPlatform } from "@/components/OrderSyncPanel";

function BridgeQuadPanel({ onTune }: { onTune: (ch: DashboardType) => void }) {
  const { data: dashStats } = useQuery<{ totalOrders: number; totalInventoryItems: number; totalInventoryQuantity: number; totalSales: number }>({
    queryKey: ['/api/dashboard/stats'],
    staleTime: 60000,
  });
  const { data: orderStats } = useQuery<{ totalOrders: number; pendingOrders: number; shippedOrders: number }>({
    queryKey: ['/api/orders/stats', 'mtd'],
    staleTime: 60000,
  });
  const { data: bridgeSignals } = useQuery<{
    agingOrders: number; repeatBuyers: number;
    thisWeekRevenue: number; lastWeekRevenue: number;
  }>({ queryKey: ['/api/bridge/signals'], refetchInterval: 60000, staleTime: 30000 });
  const { data: globalSyncStatuses } = useQuery<any>({ queryKey: ['/api/sync/statuses'], refetchInterval: 15000 });
  const { data: syncStatus } = useQuery<any>({ queryKey: ['/api/platform-sync/status'], refetchInterval: 30000 });
  const { data: fulfillmentStats } = useQuery<{ unfulfilled: number }>({ queryKey: ['/api/fulfillment/stats'], staleTime: 30000 });

  const lastInvSync    = globalSyncStatuses?.inventory;
  const lastOrderSync  = globalSyncStatuses?.orders;
  const lastChannelSync = globalSyncStatuses?.channel;
  const invSyncFailed    = lastInvSync?.lastSyncStatus    === 'failed' || lastInvSync?.lastSyncStatus    === 'error';
  const orderSyncFailed  = lastOrderSync?.lastSyncStatus  === 'failed' || lastOrderSync?.lastSyncStatus  === 'error';
  const channelSyncFailed = lastChannelSync?.lastSyncStatus === 'failed' || lastChannelSync?.lastSyncStatus === 'error';

  const pendingOrders = fulfillmentStats?.unfulfilled ?? orderStats?.pendingOrders ?? 0;
  const agingOrders   = bridgeSignals?.agingOrders ?? 0;
  const repeatBuyers  = bridgeSignals?.repeatBuyers ?? 0;
  const thisWeek  = bridgeSignals?.thisWeekRevenue ?? 0;
  const lastWeek  = bridgeSignals?.lastWeekRevenue ?? 0;
  const revDelta  = lastWeek > 0 ? ((thisWeek - lastWeek) / lastWeek) * 100 : null;

  const targets: any[] = syncStatus?.targets ?? [];
  const channelCount = targets.length;
  const channelDisc  = targets.reduce((s: number, t: any) =>
    s + (t.discrepancies?.missingLots || 0) + (t.discrepancies?.priceDifferences || 0) + (t.discrepancies?.quantityDifferences || 0), 0);

  const fmt      = (n: number) => n.toLocaleString();
  const fmtMoney = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`;

  type Alert = { text: string; color: string };

  const invAlerts: Alert[] = [];
  if (invSyncFailed)    invAlerts.push({ text: 'Inventory sync failed',   color: '#f87171' });
  if (channelSyncFailed) invAlerts.push({ text: 'Channel sync failed',    color: '#f87171' });
  if (!invSyncFailed && !channelSyncFailed) invAlerts.push({ text: 'All syncs nominal', color: '#4ade80' });

  const orderAlerts: Alert[] = [];
  if (orderSyncFailed) orderAlerts.push({ text: 'Order sync failed',    color: '#f87171' });
  if (agingOrders > 0) orderAlerts.push({ text: `${agingOrders} aging >24h`, color: '#fb923c' });
  if (!orderSyncFailed && agingOrders === 0) orderAlerts.push({ text: 'Fulfillment on track', color: '#4ade80' });

  const mktAlerts: Alert[] = [];
  if (channelCount > 0)  mktAlerts.push({ text: `${channelCount} channel${channelCount !== 1 ? 's' : ''} active`, color: '#a3e635' });
  if (channelDisc > 0)   mktAlerts.push({ text: `${channelDisc} discrepanc${channelDisc !== 1 ? 'ies' : 'y'}`, color: '#fbbf24' });
  if (channelCount === 0) mktAlerts.push({ text: 'No channels connected', color: '#94a3b8' });

  const insAlerts: Alert[] = [];
  if (revDelta !== null) insAlerts.push({
    text: revDelta >= 0 ? `+${revDelta.toFixed(0)}% vs last week` : `${revDelta.toFixed(0)}% vs last week`,
    color: revDelta >= 0 ? '#4ade80' : '#f87171',
  });
  if (revDelta === null) insAlerts.push({ text: 'Insights nominal', color: '#4ade80' });

  const cards: Array<{
    id: DashboardType; ch: string; label: string; hex: string; rgb: string;
    Icon: React.ElementType;
    stats: Array<{ label: string; value: string }>;
    desc: string;
    alerts: Alert[];
  }> = [
    {
      id: 'inventory', ch: '02', label: 'INVENTORY', hex: '#1B7CE5', rgb: '27,124,229',
      Icon: Package,
      stats: [
        { label: 'LOTS', value: dashStats ? fmt(dashStats.totalInventoryItems) : '—' },
        { label: 'PCS',  value: dashStats ? fmt(dashStats.totalInventoryQuantity) : '—' },
      ],
      desc: 'Stock · Pricing · Sync',
      alerts: invAlerts,
    },
    {
      id: 'sales', ch: '03', label: 'SALES', hex: '#E8611C', rgb: '232,97,28',
      Icon: ShoppingCart,
      stats: [
        { label: 'PENDING', value: fmt(pendingOrders) },
        { label: 'MTD',     value: orderStats ? fmt(orderStats.totalOrders) : '—' },
      ],
      desc: 'Fulfillment · Workflow',
      alerts: orderAlerts,
    },
    {
      id: 'marketing', ch: '04', label: 'MARKETING', hex: '#F5C200', rgb: '245,194,0',
      Icon: Users,
      stats: [
        { label: 'CHANNELS', value: fmt(channelCount) },
        { label: 'REPEAT',   value: fmt(repeatBuyers) },
      ],
      desc: 'Attract · Engage · Retain',
      alerts: mktAlerts,
    },
    {
      id: 'insights', ch: '05', label: 'INSIGHTS', hex: '#00963C', rgb: '0,150,60',
      Icon: TrendingUp,
      stats: [
        { label: 'THIS WK', value: fmtMoney(thisWeek) },
        { label: 'LAST WK', value: fmtMoney(lastWeek) },
      ],
      desc: 'Analytics · Performance',
      alerts: insAlerts,
    },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: '10px', padding: '12px', height: '100%', boxSizing: 'border-box' }}>
      {cards.map(card => (
        <button
          key={card.id}
          onClick={() => onTune(card.id)}
          data-testid={`quad-card-${card.id}`}
          style={{
            background: `linear-gradient(145deg, rgba(${card.rgb},0.14) 0%, rgba(${card.rgb},0.04) 100%)`,
            border: `1px solid rgba(${card.rgb},0.38)`,
            borderRadius: '10px',
            padding: '12px 14px',
            cursor: 'pointer',
            textAlign: 'left',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            boxShadow: `0 0 16px rgba(${card.rgb},0.12)`,
            overflow: 'hidden',
            position: 'relative',
            transition: 'border-color 0.2s, box-shadow 0.2s',
          }}
        >
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '1px', background: `linear-gradient(90deg, transparent, rgba(${card.rgb},0.65), transparent)` }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
            <card.Icon style={{ width: '12px', height: '12px', color: card.hex, opacity: 0.7, flexShrink: 0 } as React.CSSProperties} />
            <span style={{ fontFamily: 'monospace', fontSize: '8px', color: `rgba(${card.rgb},0.5)`, letterSpacing: '0.22em', textTransform: 'uppercase' }}>CH {card.ch}</span>
            <div style={{ flex: 1, height: '1px', background: `rgba(${card.rgb},0.15)` }} />
            <span style={{ fontFamily: 'monospace', fontSize: '7px', color: `rgba(${card.rgb},0.35)`, letterSpacing: '0.15em' }}>ENTER →</span>
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: 'clamp(13px,1.3vw,17px)', fontWeight: 900, color: card.hex, letterSpacing: '0.1em', textShadow: `0 0 10px ${card.hex}44` }}>
            {card.label}
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: '8px', color: 'rgba(180,200,255,0.32)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{card.desc}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '4px', flex: 1 }}>
            {card.alerts.slice(0, 2).map((a, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: a.color, flexShrink: 0, boxShadow: `0 0 4px ${a.color}88` }} />
                <span style={{ fontFamily: 'monospace', fontSize: '9px', color: a.color, letterSpacing: '0.05em', opacity: 0.9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.text}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '6px', paddingTop: '4px' }}>
            {card.stats.map(s => (
              <div key={s.label} style={{ flex: 1, background: 'rgba(0,0,0,0.38)', borderRadius: '6px', padding: '5px 7px' }}>
                <div style={{ fontFamily: 'monospace', fontSize: 'clamp(12px,1.2vw,15px)', fontWeight: 700, color: card.hex, lineHeight: 1 }}>{s.value}</div>
                <div style={{ fontFamily: 'monospace', fontSize: '7px', color: 'rgba(180,200,255,0.38)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: '2px' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </button>
      ))}
    </div>
  );
}

export default function Home() {
  useAdminScaling();
  const { toast } = useToast();
  const { user, superAdmin } = useAuth();

  const { data: impersonationStatus } = useQuery<{ isImpersonating: boolean; orgId: string | null; orgName: string | null }>({
    queryKey: ['/api/platform-admin/impersonation-status'],
    enabled: !!superAdmin,
    refetchInterval: false,
  });

  const stopImpersonationMutation = useMutation({
    mutationFn: async () => apiRequest('DELETE', '/api/platform-admin/impersonate', {}),
    onSuccess: () => { window.location.reload(); },
    onError: () => toast({ title: 'Failed to exit impersonation', variant: 'destructive' }),
  });
  const { data: org } = useQuery<Organization>({ queryKey: ['/api/org'] });
  const { data: billingStatus } = useQuery<{
    plan: string; planName?: string | null; status: string; trialEndsAt?: string | null; planStatus?: string | null; planSunsetAt?: string | null;
    brickspotter?: { brickspotterOnly?: boolean; scansUsed?: number; scansLimit?: number; apiCallLimit?: number };
  }>({
    queryKey: ['/api/billing/status'],
  });
  const isBrickspotterOnly = !!billingStatus?.brickspotter?.brickspotterOnly;
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 768);
  const [activeDashboard, setActiveDashboard] = useState<DashboardType>('dashboard');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [employeeWelcomeDone, setEmployeeWelcomeDone] = useState(false);
  const [bsWelcomeDone, setBsWelcomeDone] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<'general' | 'platforms' | 'ai' | 'automation' | 'data' | 'users' | 'priceomatic' | null>(null);
  const [settingsFocusTarget, setSettingsFocusTarget] = useState<'channelSync' | 'schedulerInventory' | 'schedulerOrders' | 'schedulerChannel' | undefined>(undefined);
  const [settingsPricingExample, setSettingsPricingExample] = useState<PricingInsight | undefined>(undefined);
  const [settingsScoringExample, setSettingsScoringExample] = useState<PricingInsight | undefined>(undefined);
  const [salesPeriod, setSalesPeriod] = useState<'mtd' | 'ytd' | '1y' | '5y'>('ytd');
  const [dateRange, setDateRange] = useState<DateRangeValue>('mtd');
  const [chatOpen, setChatOpen] = useState(false);
  const [supportNotification, setSupportNotification] = useState(false);
  const [wizardDismissed, setWizardDismissed] = useState(false);
  useEffect(() => {
    if (org?.id) {
      try {
        const dismissed = localStorage.getItem(`onboardingDismissed_${org.id}`) === 'true';
        setWizardDismissed(dismissed);
      } catch {}
    }
  }, [org?.id]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('subscribed') === 'true') {
      apiRequest('PATCH', '/api/org', { onboardingCompleted: true }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: ['/api/billing/status'] });
      queryClient.invalidateQueries({ queryKey: ['/api/org'] });
      toast({ title: "Subscription active", description: "Welcome aboard! Your plan is now live." });
      const url = new URL(window.location.href);
      url.searchParams.delete('subscribed');
      url.searchParams.delete('plan');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ebayStatus = params.get('ebay_status');
    if (!ebayStatus) return;
    const env = params.get('ebay_env') ?? 'production';
    const url = new URL(window.location.href);
    url.searchParams.delete('ebay_status');
    url.searchParams.delete('ebay_env');
    url.searchParams.delete('ebay_error');
    window.history.replaceState({}, '', url.toString());
    if (ebayStatus === 'connected') {
      queryClient.invalidateQueries({ queryKey: ['/api/ebay/connection/status'] });
      queryClient.invalidateQueries({ queryKey: ['/api/org/integrations'] });
      toast({
        title: `eBay ${env} account connected`,
        description: 'Your eBay seller account is linked. You can now sync inventory.',
      });
      openSettings('platforms');
    } else if (ebayStatus === 'error') {
      const errMsg = params.get('ebay_error') ?? 'Unknown error';
      toast({ title: 'eBay connection failed', description: decodeURIComponent(errMsg), variant: 'destructive' });
      openSettings('platforms');
    }
  }, []);
  // Global iOS scroll-freeze recovery.
  // If the body gets stuck with scroll-locking styles (e.g. a vaul Drawer or Radix
  // Dialog fails to clean up on abrupt unmount), the next touch interaction will
  // detect the inconsistent state and restore the body — without needing an app restart.
  useEffect(() => {
    const recover = () => {
      const isLocked =
        document.body.hasAttribute('data-scroll-locked') ||
        document.body.style.overflow === 'hidden' ||
        document.body.style.touchAction === 'none';
      if (!isLocked) return;
      const hasOpenOverlay =
        !!document.querySelector('[data-radix-dialog-content][data-state="open"]') ||
        !!document.querySelector('[data-vaul-drawer][data-state="open"]') ||
        !!document.querySelector('[data-radix-alert-dialog-content][data-state="open"]');
      if (!hasOpenOverlay) {
        document.body.removeAttribute('data-scroll-locked');
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.marginTop = '';
        document.body.style.touchAction = '';
        document.body.style.userSelect = '';
      }
    };
    document.addEventListener('touchstart', recover, { passive: true });
    return () => document.removeEventListener('touchstart', recover);
  }, []);

  useEffect(() => {
    const check = () => {
      const nowDesktop = window.innerWidth >= 768;
      setIsDesktop(nowDesktop);
    };
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
    };
  }, [activeDashboard]);

  const [marketIntel, setMarketIntel] = useState<{
    forum: { count: number; posts: Array<{ title: string; excerpt: string; username: string; postedAt: string; threadUrl: string }> };
    news: { count: number; articles: Array<{ title: string; snippet: string; url: string; source: string; query: string; fetchedAt: string }> };
  } | null>(null);
  const [activeInventoryDrawer, setActiveInventoryDrawer] = useState<'priceomatic' | 'platformsync' | 'brickanalyzer' | 'inventoryhealth' | 'bricklinksync' | `channelsync-${string}` | 'bundletron' | 'acquisition-evaluator' | null>(null);
  const [activeOrdersDrawer, setActiveOrdersDrawer] = useState<'fulfillment' | 'shipped' | 'bricklinksync' | `ordersync-${string}` | null>(null);
  const [inventoryInitialTab, setInventoryInitialTab] = useState<'systems' | 'uplink' | undefined>(undefined);
  const [ordersInitialTab, setOrdersInitialTab] = useState<'systems' | 'uplink' | undefined>(undefined);
  const [rightPanelBrowse, setRightPanelBrowse] = useState<'lots' | 'parts' | 'categories' | null>(null);
  const [planCollapsed, setPlanCollapsed] = useState(false);
  const [tvFlash, setTvFlash] = useState(false);
  const [activeMarketingDrawer, setActiveMarketingDrawer] = useState<MarketingDrawer>(null);
  const [activeSalesDrawer, setActiveSalesDrawer] = useState<SalesDrawer>(null);
  const [billingOpen, setBillingOpen] = useState(false);
  const [detailModal, setDetailModal] = useState<{ open: boolean; data: DetailData | null }>({
    open: false,
    data: null,
  });
  const [brickLinkUrl, setBrickLinkUrl] = useState<string | null>(null);
  const brickLinkIframeRef = useRef<HTMLIFrameElement>(null);
  const [brickLinkLoading, setBrickLinkLoading] = useState(false);

  // BrickSpotter-only: reset any inventory dashboard state so the clean layout renders
  useEffect(() => {
    if (isBrickspotterOnly) {
      setActiveDashboard('dashboard');
      setActiveInventoryDrawer(null);
    }
  }, [isBrickspotterOnly]);

  // Fetch picklist stats for indicator
  const { data: picklistStats } = useQuery<{ toPull: number }>({
    queryKey: ['/api/picklist/stats'],
    enabled: activeDashboard === 'sales',
  });

  // Fetch fulfillment stats for indicator
  const { data: fulfillmentStats } = useQuery<{ unfulfilled: number }>({
    queryKey: ['/api/fulfillment/stats'],
    enabled: activeDashboard === 'sales',
  });

  // Fetch platform sync status for indicator
  const { data: syncStatus } = useQuery<any>({
    queryKey: ['/api/platform-sync/status'],
    enabled: activeDashboard === 'inventory',
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Global sync status watcher — polls continuously so ALL devices see completions
  const { data: globalSyncStatuses } = useQuery<{
    inventory: { lastSyncStatus: string; lastSyncTime: string | null; recordsAdded: number; recordsUpdated: number; errorMessage: string | null } | null;
    priceomatic: { lastSyncStatus: string; lastSyncTime: string | null; recordsAdded: number; recordsUpdated: number; errorMessage: string | null } | null;
    channel: { lastSyncStatus: string; lastSyncTime: string | null; recordsAdded: number; recordsUpdated: number; errorMessage: string | null } | null;
    orders: { lastSyncStatus: string; lastSyncTime: string | null; recordsAdded: number; recordsUpdated: number; errorMessage: string | null } | null;
  }>({
    queryKey: ['/api/sync/statuses'],
    refetchInterval: 15000,
  });

  const prevSyncStatuses = useRef<typeof globalSyncStatuses>(undefined);

  useEffect(() => {
    const prev = prevSyncStatuses.current;
    const curr = globalSyncStatuses;
    if (!prev || !curr) {
      prevSyncStatuses.current = curr;
      return;
    }

    const checks: { key: keyof typeof curr; label: string }[] = [
      { key: 'inventory', label: 'Inventory Sync' },
      { key: 'priceomatic', label: 'Price-o-Matic' },
      { key: 'channel', label: 'Channel Sync' },
      { key: 'orders', label: 'Orders Sync' },
    ];

    for (const { key, label } of checks) {
      const p = prev[key];
      const c = curr[key];
      if (!p || !c) continue;
      if (p.lastSyncStatus === 'in_progress' && c.lastSyncStatus === 'success') {
        const counts = (c.recordsAdded || c.recordsUpdated)
          ? ` · ${c.recordsAdded} added, ${c.recordsUpdated} updated`
          : '';
        toast({ title: `${label} complete`, description: `Finished successfully${counts}.` });
      } else if (p.lastSyncStatus === 'in_progress' && c.lastSyncStatus === 'partial') {
        const counts = c.recordsUpdated ? ` · ${c.recordsUpdated} updated` : '';
        toast({ title: `${label} partial run`, description: `Hit API limit before finishing${counts}. Updates saved.` });
      } else if (p.lastSyncStatus === 'in_progress' && (c.lastSyncStatus === 'failed' || c.lastSyncStatus === 'error')) {
        const isRestartInterrupt = c.errorMessage?.toLowerCase().includes('server restart') || c.errorMessage?.toLowerCase().includes('interrupted');
        if (isRestartInterrupt) {
          toast({ title: `${label} interrupted`, description: 'Server restarted mid-sync — will resume on next scheduled run.' });
        } else {
          toast({ title: `${label} failed`, description: c.errorMessage || 'Sync encountered an error.', variant: 'destructive' });
        }
      }
    }

    prevSyncStatuses.current = curr;
  }, [globalSyncStatuses]);

  // Calculate total discrepancies across all platforms
  const totalDiscrepancies = syncStatus?.targets?.reduce((total: number, platform: any) => {
    return total + 
      (platform.discrepancies?.missingLots || 0) +
      (platform.discrepancies?.priceDifferences || 0) +
      (platform.discrepancies?.quantityDifferences || 0);
  }, 0) || 0;

  // Shared helper: fetch inventory data and open it in the provided modal setter.
  // Handles both bricklink-prefixed catalog IDs and real numeric inventory IDs.
  const openInventoryDetail = async (
    id: number | string,
    initialTab: string | undefined,
    setModal: (state: { open: boolean; data: DetailData | null }) => void,
  ): Promise<boolean> => {
    const isBrickLinkCatalog = String(id).startsWith('bricklink-');

    if (isBrickLinkCatalog) {
      const raw = String(id).replace('bricklink-', '');
      const colorMatch = raw.match(/__c(\d+)$/);
      const itemNo = colorMatch ? raw.slice(0, raw.length - colorMatch[0].length) : raw;
      const colorId = colorMatch ? colorMatch[1] : null;

      try {
        if (colorId) {
          const searchParams = new URLSearchParams({ itemNo, colorId, limit: '50' });
          const searchRes = await fetch(`/api/inventory/search?${searchParams}`);
          if (searchRes.ok) {
            const lots = await searchRes.json();
            if (Array.isArray(lots) && lots.length > 0) {
              return openInventoryDetail(lots[0].id, initialTab, setModal);
            }
          }
        }
        const fallbackParams = new URLSearchParams({ itemNo, limit: '50' });
        const fallbackRes = await fetch(`/api/inventory/search?${fallbackParams}`);
        if (fallbackRes.ok) {
          const lots = await fallbackRes.json();
          if (Array.isArray(lots) && lots.length > 0) {
            return openInventoryDetail(lots[0].id, initialTab, setModal);
          }
        }
      } catch { /* fall through to catalog view */ }

      const itemType = sessionStorage.getItem(`bl-itemtype-${itemNo}`) ?? 'PART';
      setModal({ open: true, data: { type: 'inventory', data: { id: String(id), loading: true } as any, initialTab } });

      try {
        const params = new URLSearchParams({ ...(colorId ? { colorId } : {}) });
        const catalogRes = await fetch(`/api/catalog/lookup/${encodeURIComponent(itemType)}/${encodeURIComponent(itemNo)}?${params}`);
        if (catalogRes.ok) {
          const catalogData = await catalogRes.json();
          setModal({ open: true, data: { type: 'inventory', data: { ...catalogData, loadingPriceOMagic: false }, initialTab } });
          return true;
        }
      } catch { /* fall through */ }

      setModal({ open: false, data: null });
      return false;
    }

    // Numeric inventory ID
    setModal({ open: true, data: { type: 'inventory', data: { id, loading: true } as any, initialTab } });

    try {
      const response = await fetch(`/api/inventory/${id}`);
      if (response.ok) {
        const inventoryData = await response.json();
        setModal({ open: true, data: { type: 'inventory', data: { ...inventoryData, loadingPriceOMagic: true }, initialTab } });

        const params = new URLSearchParams();
        if (inventoryData.colorId) params.append('color_id', inventoryData.colorId.toString());
        if (inventoryData.newOrUsed) params.append('new_or_used', inventoryData.newOrUsed);
        const priceGuideUrl = `/api/inventory/price-guide/${inventoryData.itemNo}/${inventoryData.itemType}${params.toString() ? `?${params.toString()}` : ''}`;

        const priceResponse = await fetch(priceGuideUrl);
        let priceOMagicData = null;
        if (priceResponse.ok) priceOMagicData = await priceResponse.json();

        setModal({ open: true, data: { type: 'inventory', data: { ...inventoryData, priceOMagic: priceOMagicData, loadingPriceOMagic: false }, initialTab } });
      } else {
        console.error('Failed to fetch inventory:', response.statusText);
      }
    } catch (error) {
      console.error('Error fetching inventory:', error);
    }
    return true;
  };

  const handleDashboardItemClick = async (type: 'order' | 'inventory', id: number | string, initialTab?: string): Promise<boolean> => {
    if (type === 'inventory') {
      return openInventoryDetail(id, initialTab, setDetailModal);
    }

    // Order type — open modal immediately with loading state then fetch
    setDetailModal({ open: true, data: { type: 'order', data: { id, loading: true } as any, initialTab } });

    try {
      const response = await fetch(`/api/orders/${id}`);
      if (response.ok) {
        const orderData = await response.json();
        setDetailModal({ open: true, data: { type: 'order', data: orderData } });
      } else {
        console.error('Failed to fetch order:', response.statusText);
        const orderNumber = String(id).replace(/^(ord-|ss-|bl-|bo-)/, '');
        setDetailModal({
          open: true,
          data: {
            type: 'order',
            data: {
              orderId: String(id),
              orderNumber: orderNumber,
              platform: 'BrickLink' as const,
              status: 'Paid' as const,
              customer: { name: 'Customer', email: 'customer@example.com', address: '123 Main St', city: 'City', state: 'ST', zip: '12345', country: 'US' },
              orderDate: new Date().toISOString(),
              items: [],
              shipping: 0,
              tax: 0,
              total: 0,
            }
          }
        });
      }
    } catch (error) {
      console.error('Error fetching order:', error);
    }
    return true;
  };

  const renderDynamicDashboard = (isDesktopMode?: boolean, tvSplit?: 'left' | 'right', compact?: boolean) => {
    switch (activeDashboard) {
      case 'inventory':
        return <InventoryDashboard onItemClick={handleDashboardItemClick} activeDrawer={activeInventoryDrawer} onDrawerChange={setActiveInventoryDrawer} onOpenSettings={(section, focus) => { setSettingsInitialSection(section ?? null); setSettingsFocusTarget(focus); setSettingsOpen(true); }} desktopMode={isDesktopMode} onBrowseOpen={(type) => { setRightPanelBrowse(type); }} tvSplit={tvSplit} compact={compact} initialPanelTab={inventoryInitialTab} />;
      case 'sales':
        return <OrdersDashboard dateRange={dateRange} onItemClick={handleDashboardItemClick} activeDrawer={activeOrdersDrawer} onDrawerChange={setActiveOrdersDrawer} onSalesDrawer={setActiveSalesDrawer} onOpenSettings={(section, focus) => { setSettingsInitialSection(section ?? null); setSettingsFocusTarget(focus); setSettingsOpen(true); }} desktopMode={isDesktopMode} tvSplit={tvSplit} compact={compact} initialPanelTab={ordersInitialTab} />;
      case 'insights':
        return <InsightsDashboard onOpenSettings={(section) => { setSettingsInitialSection(section ?? null); setSettingsOpen(true); }} compact={compact} />;
      case 'marketing':
        return <MarketingDashboard dateRange={dateRange} onItemClick={handleDashboardItemClick} activeDrawer={activeMarketingDrawer} onDrawerChange={setActiveMarketingDrawer} tvSplit={tvSplit} compact={compact} />;
      default:
        return <InventoryDashboard onItemClick={handleDashboardItemClick} activeDrawer={activeInventoryDrawer} onDrawerChange={setActiveInventoryDrawer} onOpenSettings={(section, focus) => { setSettingsInitialSection(section ?? null); setSettingsFocusTarget(focus); setSettingsOpen(true); }} />;
    }
  };

  const renderMobileDashboard = () => {
    if (activeDashboard === 'dashboard') {
      return <GeneralDashboard onItemClick={handleDashboardItemClick} onOpenFulfillment={() => { setActiveDashboard('sales'); setActiveOrdersDrawer('fulfillment'); }} onOpenBrickanalyzer={() => { setActiveDashboard('inventory'); setActiveInventoryDrawer('brickanalyzer'); }} onOpenPriceomatic={() => { setActiveDashboard('inventory'); setActiveInventoryDrawer('priceomatic'); }} onOpenBilling={() => setBillingOpen(true)} onOpenSettings={(section) => { setSettingsInitialSection(section); setSettingsOpen(true); }} onNavigate={(tab, panelTab) => { setActiveDashboard(tab as DashboardType); if (panelTab) { if (tab === 'inventory') setInventoryInitialTab(panelTab); if (tab === 'sales') setOrdersInitialTab(panelTab); } }} />;
    }
    // Pass isDesktop so that when the desktop layout is active, the mobile/tablet
    // copies of this dashboard (CSS-hidden but still in the DOM) also suppress any
    // Vaul Drawers / portals that would fire through the hidden containers.
    return renderDynamicDashboard(isDesktop);
  };

  const closeActiveDrawer = () => {
    setActiveInventoryDrawer(null);
    setActiveOrdersDrawer(null);
    setActiveMarketingDrawer(null);
    setActiveSalesDrawer(null);
    setBillingOpen(false);
    setRightPanelBrowse(null);
  };

  const applyDefaultDesktopDrawer = (_dashboard: DashboardType) => {
    setActiveInventoryDrawer(null);
    setActiveOrdersDrawer(null);
    setActiveMarketingDrawer(null);
    setActiveSalesDrawer(null);
    setBillingOpen(false);
    setRightPanelBrowse(null);
  };

  const switchDashboardDesktop = (dashboard: DashboardType) => {
    setActiveDashboard(dashboard);
    applyDefaultDesktopDrawer(dashboard);
  };

  const tuneChannel = (dashboard: DashboardType) => {
    if (tvFlash || dashboard === activeDashboard) return;
    setTvFlash(true);
    setTimeout(() => {
      if (dashboard === 'dashboard') {
        setActiveDashboard('dashboard');
        closeActiveDrawer();
      } else {
        switchDashboardDesktop(dashboard);
      }
      setTvFlash(false);
    }, 180);
  };

  /** Navigate to a dashboard AND open a specific panel tab. */
  const tuneChannelWithTab = (dashboard: DashboardType, panelTab: 'systems' | 'uplink') => {
    if (dashboard === 'inventory') setInventoryInitialTab(panelTab);
    if (dashboard === 'sales') setOrdersInitialTab(panelTab);
    tuneChannel(dashboard);
  };

  useEffect(() => {
    if (isDesktop) {
      applyDefaultDesktopDrawer(activeDashboard);
    }
  }, [isDesktop]);  // eslint-disable-line react-hooks/exhaustive-deps

  const openSettings = (section?: string, pricingExampleOrFocusTarget?: PricingInsight | string, scoringExample?: PricingInsight) => {
    setSettingsInitialSection(section as any);
    if (typeof pricingExampleOrFocusTarget === 'string') {
      setSettingsFocusTarget(pricingExampleOrFocusTarget as any);
      setSettingsPricingExample(undefined);
    } else {
      setSettingsFocusTarget(undefined);
      setSettingsPricingExample(pricingExampleOrFocusTarget);
    }
    setSettingsScoringExample(scoringExample);
    setSettingsOpen(true);
  };

  const renderActiveDrawer = () => {
    if (activeInventoryDrawer === 'priceomatic') {
      return (
        <ToolDrawer icon={Sparkles} iconColor="text-purple-400" title="Price-o-Matic" onClose={closeActiveDrawer} actions={
          <Button size="sm" variant="ghost" className="text-xs text-gray-400 gap-1" onClick={() => openSettings('priceomatic')} data-testid="button-pom-settings">
            <SlidersHorizontal className="w-3.5 h-3.5" /> Settings
          </Button>
        }>
          <PriceOMaticDashboard onItemClick={(type, id) => handleDashboardItemClick(type, id, 'pricing')} onOpenSettings={openSettings} />
        </ToolDrawer>
      );
    }
    if (activeInventoryDrawer === 'platformsync') {
      return (
        <ToolDrawer icon={ListChecks} iconColor="text-green-400" title="List-o-Matic" onClose={closeActiveDrawer} actions={
          <Button size="sm" variant="ghost" className="text-xs text-gray-400 gap-1" onClick={() => openSettings('automation')} data-testid="button-lom-settings">
            <SlidersHorizontal className="w-3.5 h-3.5" /> Settings
          </Button>
        }>
          <ListomaticPriority />
        </ToolDrawer>
      );
    }
    if (activeInventoryDrawer === 'brickanalyzer') {
      return (
        <ToolDrawer icon={ScanSearch} iconColor="text-lego-yellow" title="Brick Spotter 3000" onClose={isBrickspotterOnly ? undefined : closeActiveDrawer}>
          <BrickanalyzerTool onItemClick={(type, id, tab) => handleDashboardItemClick(type, id, tab)} />
        </ToolDrawer>
      );
    }
    if (activeOrdersDrawer === 'fulfillment') {
      return (
        <ToolDrawer icon={Truck} iconColor="text-orange-400" title="Fulfillment & Shipping" onClose={closeActiveDrawer} actions={
          <Button size="sm" variant="ghost" className="text-xs text-gray-400 gap-1" onClick={() => openSettings('automation')} data-testid="button-fulfillment-settings">
            <SlidersHorizontal className="w-3.5 h-3.5" /> Settings
          </Button>
        }>
          <FulfillmentTool onOrderDetail={handleOrderSelect} onItemClick={handleDashboardItemClick} />
        </ToolDrawer>
      );
    }
    if (activeOrdersDrawer === 'shipped') {
      return (
        <ToolDrawer icon={PackageCheck} iconColor="text-green-400" title="Shipped Orders" onClose={closeActiveDrawer} actions={
          <Button size="sm" variant="ghost" className="text-xs text-gray-400 gap-1" onClick={() => openSettings('platforms')} data-testid="button-shipped-settings">
            <SlidersHorizontal className="w-3.5 h-3.5" /> Settings
          </Button>
        }>
          <ShippedOrdersTool
            onItemClick={(type, id) => {
              closeActiveDrawer();
              handleDashboardItemClick(type, id);
            }}
          />
        </ToolDrawer>
      );
    }
    if (activeInventoryDrawer === 'inventoryhealth') {
      return (
        <ToolDrawer icon={SlidersHorizontal} iconColor="text-blue-400" title="Inventory Health" onClose={closeActiveDrawer}>
          <InventoryHealthPanel open={true} onOpenChange={() => {}} inline onItemClick={handleDashboardItemClick} />
        </ToolDrawer>
      );
    }
    if (activeInventoryDrawer === 'bricklinksync') {
      return (
        <BrickLinkSyncPanel
          inlineMode
          onClose={closeActiveDrawer}
          onOpenSettings={(section, focus) => { setSettingsInitialSection(section ?? null); setSettingsFocusTarget(focus); setSettingsOpen(true); }}
        />
      );
    }
    if (activeInventoryDrawer?.startsWith('channelsync-')) {
      const channelKey = activeInventoryDrawer.slice('channelsync-'.length);
      return (
        <ChannelSyncPanel
          inlineMode
          initialChannel={channelKey}
          onClose={closeActiveDrawer}
          onOpenSettings={(section, focus) => { setSettingsInitialSection(section ?? null); setSettingsFocusTarget(focus); setSettingsOpen(true); }}
        />
      );
    }
    if (activeInventoryDrawer === 'bundletron') {
      return (
        <ToolDrawer icon={SlidersHorizontal} iconColor="text-orange-400" title="BundleTron" onClose={closeActiveDrawer}>
          <BundleTronPanel />
        </ToolDrawer>
      );
    }
    if (activeInventoryDrawer === 'acquisition-evaluator') {
      return (
        <ToolDrawer icon={Package} iconColor="text-violet-400" title="Acquisition Evaluator" onClose={closeActiveDrawer} contentClassName="flex-1 overflow-y-auto px-4 pt-4 pb-4">
          <AcquisitionEvaluator />
        </ToolDrawer>
      );
    }
    if (activeOrdersDrawer === 'bricklinksync') {
      return (
        <ToolDrawer icon={SlidersHorizontal} iconColor="text-blue-400" title="BrickLink Orders Sync" onClose={closeActiveDrawer}>
          <OrderSyncPanel platform="bricklink" onOpenSettings={(section, focus) => { setSettingsInitialSection(section ?? null); setSettingsFocusTarget(focus); setSettingsOpen(true); }} />
        </ToolDrawer>
      );
    }
    if (activeOrdersDrawer?.startsWith('ordersync-')) {
      const platformKey = activeOrdersDrawer.slice('ordersync-'.length) as OrderSyncPlatform;
      const platformCfg = ORDER_PLATFORM_CONFIG[platformKey];
      if (platformCfg) {
        return (
          <ToolDrawer icon={SlidersHorizontal} iconColor={platformCfg.accentIcon} title={`${platformCfg.label} — Order Sync`} onClose={closeActiveDrawer}>
            <OrderSyncPanel platform={platformKey} onOpenSettings={(section, focus) => { setSettingsInitialSection(section ?? null); setSettingsFocusTarget(focus); setSettingsOpen(true); }} />
          </ToolDrawer>
        );
      }
    }
    if (rightPanelBrowse) {
      return (
        <ToolDrawer icon={SlidersHorizontal} iconColor="text-blue-400" title={rightPanelBrowse === 'lots' ? 'Browse Lots' : rightPanelBrowse === 'parts' ? 'Browse Parts' : 'Browse Categories'} onClose={() => setRightPanelBrowse(null)}>
          <InventoryBrowsePanel type={rightPanelBrowse!} onItemClick={handleDashboardItemClick} />
        </ToolDrawer>
      );
    }
    if (activeMarketingDrawer) {
      return (
        <MarketingDashboard
          dateRange={dateRange}
          onItemClick={handleDashboardItemClick}
          activeDrawer={activeMarketingDrawer}
          onDrawerChange={setActiveMarketingDrawer}
          renderDrawerOnly
        />
      );
    }
    if (activeSalesDrawer) {
      return (
        <SalesDashboard
          period={salesPeriod}
          dateRange={dateRange}
          onItemClick={handleDashboardItemClick}
          activeDrawer={activeSalesDrawer}
          onDrawerChange={setActiveSalesDrawer}
          renderDrawerOnly
        />
      );
    }
    if (billingOpen) {
      return <BillingDrawer onClose={closeActiveDrawer} />;
    }
    return null;
  };

  const getChatContext = () => {
    switch (activeDashboard) {
      case 'inventory':
        return 'Inventory';
      case 'sales':
        return 'Sales';
      case 'insights':
        return 'Insights';
      case 'marketing':
        return 'Marketing';
      default:
        return 'Business';
    }
  };

  const getThemeColor = (): 'red' | 'blue' | 'yellow' | 'green' | 'orange' => {
    switch (activeDashboard) {
      case 'inventory':
        return 'blue';
      case 'sales':
        return 'orange';
      case 'insights':
        return 'green';
      case 'marketing':
        return 'yellow';
      default:
        return 'red';
    }
  };


  const handlePromptAction = (prompt: string) => {
    if (activeDashboard === 'insights') {
      const periodMap: { [key: string]: 'mtd' | 'ytd' | '1y' | '5y' } = {
        'MTD': 'mtd',
        'YTD': 'ytd',
        '1 Year': '1y',
        '5 Years': '5y',
      };
      if (periodMap[prompt]) {
        setSalesPeriod(periodMap[prompt]);
      }
    }
  };

  // Mock order database with previous orders for repeat customers
  const mockOrderDatabase: { [key: string]: any } = {
    'ord-1001': {
      orderId: 'ord-1001',
      orderNumber: '1001',
      platform: 'BrickLink' as const,
      status: 'Paid' as const,
      customer: {
        name: 'John Smith',
        email: 'john.smith@example.com',
        address: '123 Main St',
        city: 'Springfield',
        state: 'IL',
        zip: '62701',
        country: 'United States',
      },
      items: [
        { partNumber: '3001', name: 'Brick 2 x 4', quantity: 10, price: 0.35 },
        { partNumber: '3003', name: 'Brick 2 x 2', quantity: 25, price: 0.25 },
      ],
      shipping: 8.50,
      tax: 12.30,
      total: 156.80,
      orderDate: '2024-01-20T10:30:00',
      isRepeatCustomer: true,
      previousOrders: [
        { orderId: 'ord-900', orderNumber: '900', orderDate: '2023-12-15T08:00:00', total: 89.50, status: 'Shipped' as const },
        { orderId: 'ord-750', orderNumber: '750', orderDate: '2023-10-22T14:30:00', total: 134.20, status: 'Shipped' as const },
      ],
    },
    'ord-1002': {
      orderId: 'ord-1002',
      orderNumber: '1002',
      platform: 'BrickOwl' as const,
      status: 'Pending' as const,
      customer: {
        name: 'Sarah Johnson',
        email: 'sarah.j@example.com',
        address: '456 Oak Ave',
        city: 'Portland',
        state: 'OR',
        zip: '97201',
        country: 'United States',
      },
      items: [
        { partNumber: '6141', name: 'Plate 1 x 1 Round', quantity: 50, price: 0.10 },
        { partNumber: '3069', name: 'Tile 1 x 2', quantity: 30, price: 0.15 },
      ],
      shipping: 6.00,
      tax: 7.50,
      total: 89.50,
      orderDate: '2024-01-21T14:15:00',
      isRepeatCustomer: false,
    },
    'ord-1003': {
      orderId: 'ord-1003',
      orderNumber: '1003',
      platform: 'BrickLink' as const,
      status: 'Shipped' as const,
      customer: {
        name: 'Michael Brown',
        email: 'mbrown@example.com',
        address: '789 Pine Rd',
        city: 'Austin',
        state: 'TX',
        zip: '78701',
        country: 'United States',
      },
      items: [
        { partNumber: '3023', name: 'Plate 1 x 2', quantity: 100, price: 0.12 },
        { partNumber: '3024', name: 'Plate 1 x 1', quantity: 200, price: 0.08 },
      ],
      shipping: 12.00,
      tax: 21.00,
      total: 245.00,
      orderDate: '2024-01-18T09:00:00',
      shippedDate: '2024-01-19T15:30:00',
      trackingNumber: 'TRK123456789',
      isRepeatCustomer: true,
      previousOrders: [
        { orderId: 'ord-850', orderNumber: '850', orderDate: '2023-11-10T12:00:00', total: 198.75, status: 'Shipped' as const },
        { orderId: 'ord-620', orderNumber: '620', orderDate: '2023-08-05T09:30:00', total: 276.40, status: 'Shipped' as const },
        { orderId: 'ord-430', orderNumber: '430', orderDate: '2023-05-18T16:45:00', total: 156.00, status: 'Shipped' as const },
      ],
    },
    // Previous orders data
    'ord-900': {
      orderId: 'ord-900',
      orderNumber: '900',
      platform: 'BrickLink' as const,
      status: 'Shipped' as const,
      customer: {
        name: 'John Smith',
        email: 'john.smith@example.com',
        address: '123 Main St',
        city: 'Springfield',
        state: 'IL',
        zip: '62701',
        country: 'United States',
      },
      items: [
        { partNumber: '3002', name: 'Brick 2 x 3', quantity: 15, price: 0.28 },
        { partNumber: '3004', name: 'Brick 1 x 2', quantity: 40, price: 0.15 },
      ],
      shipping: 7.50,
      tax: 9.80,
      total: 89.50,
      orderDate: '2023-12-15T08:00:00',
      shippedDate: '2023-12-16T10:00:00',
      trackingNumber: 'TRK987654321',
      isRepeatCustomer: true,
      previousOrders: [
        { orderId: 'ord-750', orderNumber: '750', orderDate: '2023-10-22T14:30:00', total: 134.20, status: 'Shipped' as const },
      ],
    },
    'ord-750': {
      orderId: 'ord-750',
      orderNumber: '750',
      platform: 'BrickLink' as const,
      status: 'Shipped' as const,
      customer: {
        name: 'John Smith',
        email: 'john.smith@example.com',
        address: '123 Main St',
        city: 'Springfield',
        state: 'IL',
        zip: '62701',
        country: 'United States',
      },
      items: [
        { partNumber: '3010', name: 'Brick 1 x 4', quantity: 50, price: 0.22 },
        { partNumber: '3020', name: 'Plate 2 x 4', quantity: 30, price: 0.18 },
      ],
      shipping: 8.00,
      tax: 11.20,
      total: 134.20,
      orderDate: '2023-10-22T14:30:00',
      shippedDate: '2023-10-23T11:00:00',
      trackingNumber: 'TRK555666777',
      isRepeatCustomer: false,
    },
    'ord-850': {
      orderId: 'ord-850',
      orderNumber: '850',
      platform: 'BrickLink' as const,
      status: 'Shipped' as const,
      customer: {
        name: 'Michael Brown',
        email: 'mbrown@example.com',
        address: '789 Pine Rd',
        city: 'Austin',
        state: 'TX',
        zip: '78701',
        country: 'United States',
      },
      items: [
        { partNumber: '3062', name: 'Brick 1 x 1 Round', quantity: 80, price: 0.12 },
        { partNumber: '3068', name: 'Tile 2 x 2', quantity: 60, price: 0.20 },
      ],
      shipping: 10.00,
      tax: 16.75,
      total: 198.75,
      orderDate: '2023-11-10T12:00:00',
      shippedDate: '2023-11-11T14:00:00',
      trackingNumber: 'TRK111222333',
      isRepeatCustomer: true,
      previousOrders: [
        { orderId: 'ord-620', orderNumber: '620', orderDate: '2023-08-05T09:30:00', total: 276.40, status: 'Shipped' as const },
        { orderId: 'ord-430', orderNumber: '430', orderDate: '2023-05-18T16:45:00', total: 156.00, status: 'Shipped' as const },
      ],
    },
    'ord-620': {
      orderId: 'ord-620',
      orderNumber: '620',
      platform: 'BrickLink' as const,
      status: 'Shipped' as const,
      customer: {
        name: 'Michael Brown',
        email: 'mbrown@example.com',
        address: '789 Pine Rd',
        city: 'Austin',
        state: 'TX',
        zip: '78701',
        country: 'United States',
      },
      items: [
        { partNumber: '3070', name: 'Tile 1 x 1', quantity: 150, price: 0.08 },
        { partNumber: '3040', name: 'Slope 45° 2 x 1', quantity: 100, price: 0.18 },
      ],
      shipping: 15.00,
      tax: 23.40,
      total: 276.40,
      orderDate: '2023-08-05T09:30:00',
      shippedDate: '2023-08-06T13:00:00',
      trackingNumber: 'TRK444555666',
      isRepeatCustomer: true,
      previousOrders: [
        { orderId: 'ord-430', orderNumber: '430', orderDate: '2023-05-18T16:45:00', total: 156.00, status: 'Shipped' as const },
      ],
    },
    'ord-430': {
      orderId: 'ord-430',
      orderNumber: '430',
      platform: 'BrickLink' as const,
      status: 'Shipped' as const,
      customer: {
        name: 'Michael Brown',
        email: 'mbrown@example.com',
        address: '789 Pine Rd',
        city: 'Austin',
        state: 'TX',
        zip: '78701',
        country: 'United States',
      },
      items: [
        { partNumber: '3005', name: 'Brick 1 x 1', quantity: 200, price: 0.06 },
        { partNumber: '3022', name: 'Plate 2 x 2', quantity: 80, price: 0.15 },
      ],
      shipping: 9.00,
      tax: 13.00,
      total: 156.00,
      orderDate: '2023-05-18T16:45:00',
      shippedDate: '2023-05-19T10:00:00',
      trackingNumber: 'TRK777888999',
      isRepeatCustomer: false,
    },
  };

  const handleItemClick = async (type: 'inventory' | 'order' | 'sales' | 'marketing', id: string) => {
    // Use the unified dashboard item click handler for inventory and orders
    if (type === 'inventory' || type === 'order') {
      await handleDashboardItemClick(type, id);
      return;
    }

    // Generate mock detail data for sales/marketing only
    let detailData: any = {};

    if (type === 'sales') {
      detailData = {
        period: 'Year to Date',
        totalRevenue: 320450,
        totalOrders: 2847,
        averageOrderValue: 112.50,
        topProducts: [
          { partNumber: '3001', name: 'Brick 2 x 4', sales: 45230, quantity: 12500 },
          { partNumber: '3003', name: 'Brick 2 x 2', sales: 38900, quantity: 15000 },
          { partNumber: '6141', name: 'Plate 1 x 1 Round', sales: 28750, quantity: 28000 },
        ],
        dailyData: [
          { date: 'Jan', sales: 12500 },
          { date: 'Feb', sales: 15200 },
          { date: 'Mar', sales: 18900 },
          { date: 'Apr', sales: 22100 },
        ],
      };
    } else if (type === 'marketing') {
      detailData = {
        campaignName: 'Spring LEGO Sale 2024',
        status: 'Active' as const,
        platform: 'Google Ads',
        impressions: 125000,
        clicks: 3750,
        conversions: 180,
        spent: 1250,
        revenue: 8900,
        startDate: '2024-01-01',
      };
    }

    setDetailModal({
      open: true,
      data: { type, data: detailData },
    });
  };

  const handleOrderSelect = async (orderId: string) => {
    try {
      const response = await fetch(`/api/orders/${orderId}`);
      if (response.ok) {
        const orderData = await response.json();
        setDetailModal({
          open: true,
          data: { type: 'order', data: orderData }
        });
      } else {
        console.error('Failed to fetch order:', response.statusText);
      }
    } catch (error) {
      console.error('Error fetching order:', error);
    }
  };

  // Background polling for support messages when chat is closed
  useEffect(() => {
    if (chatOpen) {
      setSupportNotification(false);
      return;
    }
    const storedSessionId = localStorage.getItem('elfie-session-id');
    if (!storedSessionId) return;
    const checkSupport = async () => {
      try {
        const res = await fetch(`/api/support/ticket-status?sessionId=${encodeURIComponent(storedSessionId)}`, { credentials: 'include' });
        if (!res.ok) return;
        const ticket = await res.json();
        if (ticket && (ticket.status === 'active' || ticket.status === 'escalated')) {
          const msgsRes = await fetch(`/api/support/messages?sessionId=${encodeURIComponent(storedSessionId)}&since=0`, { credentials: 'include' });
          if (msgsRes.ok) {
            const msgs = await msgsRes.json();
            if (msgs.some((m: any) => m.role === 'support')) {
              setSupportNotification(true);
            }
          }
        }
      } catch {}
    };
    checkSupport();
    const interval = setInterval(checkSupport, 15000);
    return () => clearInterval(interval);
  }, [chatOpen]);

  const handleElfieClick = async () => {
    setChatOpen(true);
    setSupportNotification(false);
    
    try {
      const response = await fetch('/api/market-intel/recent?days=7');
      if (response.ok) {
        const data = await response.json();
        if (data.success && (data.forum.count > 0 || data.news.count > 0)) {
          setMarketIntel({ forum: data.forum, news: data.news });
        } else {
          setMarketIntel(null);
        }
      } else {
        setMarketIntel(null);
      }
    } catch (error) {
      console.error('Error fetching market intel:', error);
      setMarketIntel(null);
    }
  };

  const handleChatClose = () => {
    setChatOpen(false);
    setMarketIntel(null);
  };

  // Grace period: hard block only fires 7 days after sunset.
  const GRACE_DAYS = 7;

  const now = new Date();
  const msPerDay = 86400000;

  // Sunset-plan expiry: org is on a plan that has been sunset and the grace period has passed
  const sunsetDate = billingStatus?.planSunsetAt ? new Date(billingStatus.planSunsetAt) : null;
  const isSunsetPlan = !superAdmin && billingStatus?.planStatus === 'sunset' && !!sunsetDate;
  const daysSinceSunset = sunsetDate ? Math.floor((now.getTime() - sunsetDate.getTime()) / msPerDay) : null;
  const sunsetExpired = isSunsetPlan && daysSinceSunset !== null && daysSinceSunset > GRACE_DAYS;

  // Trial expiry: org is on a trial and trialEndsAt has passed
  const trialEndDate = billingStatus?.trialEndsAt ? new Date(billingStatus.trialEndsAt) : null;
  const trialExpired = !superAdmin && billingStatus?.status === 'trial' && !!trialEndDate && trialEndDate < now;

  const planExpired = sunsetExpired || trialExpired;
  const expiredAt = sunsetExpired ? billingStatus!.planSunsetAt! : billingStatus?.trialEndsAt ?? '';
  const expiredReason: 'sunset' | 'trial' = sunsetExpired ? 'sunset' : 'trial';

  if (planExpired && billingStatus) {
    return (
      <PlanExpiredScreen
        sunsetAt={expiredAt}
        planName={billingStatus.planName ?? billingStatus.plan}
        reason={expiredReason}
        isBrickspotterOnly={isBrickspotterOnly}
      />
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#04080F] text-foreground">
      {/* Impersonation Banner — shown when super admin is viewing as another org */}
      {impersonationStatus?.isImpersonating && (
        <div className="flex-shrink-0 bg-amber-500/20 border-b border-amber-500/40 px-4 py-2 flex items-center gap-3 z-[100]">
          <EyeOff className="h-3.5 w-3.5 text-amber-400 shrink-0" />
          <p className="flex-1 text-xs text-amber-200 font-medium">
            Viewing as <span className="font-bold text-amber-100">{impersonationStatus.orgName}</span> — all actions are real and affect this organization
          </p>
          <Button
            size="sm"
            variant="secondary"
            className="text-xs h-7 shrink-0 bg-amber-900/60 border border-amber-700/60 text-amber-200 hover:bg-amber-800/80"
            onClick={() => stopImpersonationMutation.mutate()}
            disabled={stopImpersonationMutation.isPending}
            data-testid="button-exit-impersonation"
          >
            <LogOut className="h-3 w-3 mr-1" />
            Exit
          </Button>
        </div>
      )}

      {/* Sticky Header */}
      <div className="sticky top-0 z-50">
        <Header 
          onSettingsClick={() => setSettingsOpen(true)} 
          onElfieClick={handleElfieClick}
          supportNotification={supportNotification}
          hideSettings={isBrickspotterOnly}
        />
      </div>
      
      
      {/* Dashboard area */}
      <div className="flex-1 overflow-hidden bg-[#04080F]">

        {isBrickspotterOnly ? (
          <>
            {/* BS-only MOBILE layout (< md) — single GeneralDashboard, all sections */}
            <div className="md:hidden h-full overflow-y-auto">
              <div className="h-full p-2 border-lego-yellow/30 bg-gradient-to-br from-lego-yellow/10 via-gray-950/80 to-lego-yellow/5 rounded-lg border overflow-hidden">
                <GeneralDashboard
                  onItemClick={handleDashboardItemClick}
                  onOpenBrickanalyzer={() => setActiveInventoryDrawer('brickanalyzer')}
                  onOpenBilling={() => setBillingOpen(true)}
                  onOpenSettings={(section) => { setSettingsInitialSection(section); setSettingsOpen(true); }}
                  onNavigate={(tab, panelTab) => { setActiveDashboard(tab as DashboardType); if (panelTab) { if (tab === 'inventory') setInventoryInitialTab(panelTab); if (tab === 'sales') setOrdersInitialTab(panelTab); } }}
                />
              </div>
            </div>

            {/* BS-only TABLET + DESKTOP layout (md+) — Plan info (left) + The Bridge (right) */}
            <div className="hidden md:flex h-full p-3 gap-3">
              <div className="flex h-full w-full rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/50 via-gray-950/90 to-gray-900/50 shadow-[0_0_60px_rgba(0,0,0,0.5)] overflow-hidden relative">
                <div className="absolute top-0 left-0 w-5 h-5 border-t-2 border-l-2 border-white/15 rounded-tl-2xl pointer-events-none z-10" />
                <div className="absolute top-0 right-0 w-5 h-5 border-t-2 border-r-2 border-white/15 rounded-tr-2xl pointer-events-none z-10" />
                <div className="absolute bottom-0 left-0 w-5 h-5 border-b-2 border-l-2 border-white/15 rounded-bl-2xl pointer-events-none z-10" />
                <div className="absolute bottom-0 right-0 w-5 h-5 border-b-2 border-r-2 border-white/15 rounded-br-2xl pointer-events-none z-10" />
                <div
                  className="flex-shrink-0 h-full overflow-y-auto border-r border-white/5"
                  style={{ width: 'clamp(260px, 32vw, 500px)' }}
                >
                  <GeneralDashboard
                    onOpenBrickanalyzer={() => setActiveInventoryDrawer('brickanalyzer')}
                    onOpenBilling={() => setBillingOpen(true)}
                    onOpenSettings={(section) => { setSettingsInitialSection(section); setSettingsOpen(true); }}
                    section="plan"
                  />
                </div>
                <div className="flex-1 h-full overflow-y-auto p-3">
                  <GeneralDashboard
                    onItemClick={handleDashboardItemClick}
                    onOpenBrickanalyzer={() => setActiveInventoryDrawer('brickanalyzer')}
                    onOpenBilling={() => setBillingOpen(true)}
                    onOpenSettings={(section) => { setSettingsInitialSection(section); setSettingsOpen(true); }}
                    section="ops"
                  />
                </div>
              </div>
            </div>

            {/* BrickSpotter slide-in panel for BS-only users */}
            <Sheet open={activeInventoryDrawer === 'brickanalyzer'} onOpenChange={(open) => { if (!open) setActiveInventoryDrawer(null); }}>
              <SheetContent side="right" className="w-full sm:w-[680px] sm:max-w-none p-0 flex flex-col border-l border-white/10 bg-gray-950" data-testid="sheet-brickspotter">
                <ToolDrawer icon={ScanSearch} iconColor="text-lego-yellow" title="Brick Spotter 3000">
                  <BrickanalyzerTool onItemClick={(type, id, tab) => handleDashboardItemClick(type, id, tab)} />
                </ToolDrawer>
              </SheetContent>
            </Sheet>
          </>
        ) : (
          <>
            {/* MOBILE layout (< md): single column with bottom nav */}
            <div className="md:hidden h-full overflow-y-auto">
              <div className="h-full p-2 pb-20">
                <div className={`h-full rounded-lg border overflow-hidden ${
                  activeDashboard === 'dashboard' ? 'border-lego-red/30 bg-gradient-to-br from-lego-red/15 via-gray-950/80 to-lego-red/5' :
                  activeDashboard === 'inventory' ? 'border-lego-blue/30 bg-gradient-to-br from-lego-blue/15 via-gray-950/80 to-lego-blue/5' :
                  activeDashboard === 'sales' ? 'border-lego-orange/30 bg-gradient-to-br from-lego-orange/15 via-gray-950/80 to-lego-orange/5' :
                  activeDashboard === 'insights' ? 'border-lego-green/30 bg-gradient-to-br from-lego-green/15 via-gray-950/80 to-lego-green/5' :
                  'border-lego-yellow/30 bg-gradient-to-br from-lego-yellow/15 via-gray-950/80 to-lego-yellow/5'
                }`}>
                  <div className="h-full overflow-y-auto">
                    {renderMobileDashboard()}
                  </div>
                </div>
              </div>
            </div>

            {/* TABLET layout (md to lg, portrait only): vertical rail nav + active dashboard */}
            <div className="hidden md:flex lg:hidden tablet-ls:hidden h-full p-2 gap-2">
              {/* Control panel outer frame */}
              <div className="flex h-full w-full rounded-xl border border-white/10 bg-gradient-to-br from-gray-900/50 via-gray-950/90 to-gray-900/50 shadow-[0_0_60px_rgba(0,0,0,0.5)] overflow-hidden relative">
                {/* Corner accent brackets — cockpit chrome */}
                <div className="absolute top-0 left-0 w-5 h-5 border-t-2 border-l-2 border-white/15 rounded-tl-xl pointer-events-none z-10" />
                <div className="absolute top-0 right-0 w-5 h-5 border-t-2 border-r-2 border-white/15 rounded-tr-xl pointer-events-none z-10" />
                <div className="absolute bottom-0 left-0 w-5 h-5 border-b-2 border-l-2 border-white/15 rounded-bl-xl pointer-events-none z-10" />
                <div className="absolute bottom-0 right-0 w-5 h-5 border-b-2 border-r-2 border-white/15 rounded-br-xl pointer-events-none z-10" />

                {/* Vertical nav rail */}
                <div className="w-[62px] flex-shrink-0 border-r border-white/5 bg-gray-950/60 h-full">
                  <DashboardNavRail
                    active={activeDashboard}
                    onSelect={(d) => { closeActiveDrawer(); setActiveDashboard(d); }}
                    ordersCount={fulfillmentStats?.unfulfilled ?? 0}
                    superAdmin={!!superAdmin}
                  />
                </div>

                {/* Active dashboard content */}
                <div className="flex-1 min-w-0 h-full relative overflow-hidden">
                  <div className={`h-full overflow-y-auto ${
                    activeDashboard === 'dashboard' ? 'bg-gradient-to-br from-lego-red/8 via-transparent to-lego-red/4' :
                    activeDashboard === 'inventory' ? 'bg-gradient-to-br from-lego-blue/8 via-transparent to-lego-blue/4' :
                    activeDashboard === 'sales' ? 'bg-gradient-to-br from-lego-orange/8 via-transparent to-lego-orange/4' :
                    activeDashboard === 'insights' ? 'bg-gradient-to-br from-lego-green/8 via-transparent to-lego-green/4' :
                    'bg-gradient-to-br from-lego-yellow/8 via-transparent to-lego-yellow/4'
                  }`}>
                    {renderMobileDashboard()}
                  </div>
                </div>
              </div>
            </div>

            {/* DESKTOP layout (lg+): Full TV with 1/3 | 2/3 split screen */}
            {(() => {
              const TV_CHANNELS = [
                { id: 'dashboard' as DashboardType, num: '01', label: 'BRIDGE',    hex: '#DC2626', rgb: '220,38,38'  },
                { id: 'inventory' as DashboardType, num: '02', label: 'INVENTORY', hex: '#1B7CE5', rgb: '27,124,229' },
                { id: 'sales'     as DashboardType, num: '03', label: 'SALES',     hex: '#E8611C', rgb: '232,97,28'  },
                { id: 'marketing' as DashboardType, num: '04', label: 'MARKETING', hex: '#F5C200', rgb: '245,194,0'  },
                { id: 'insights'  as DashboardType, num: '05', label: 'INSIGHTS',  hex: '#00963C', rgb: '0,150,60'   },
              ];
              const activeCh  = TV_CHANNELS.find(c => c.id === activeDashboard) ?? TV_CHANNELS[1];
              const screenRgb = activeCh.rgb;
              const screenHex = activeCh.hex;

              const renderRightPanel = () => {
                if (detailModal.open) {
                  return (
                    <DetailModal
                      open={detailModal.open}
                      onClose={() => setDetailModal({ open: false, data: null })}
                      detail={detailModal.data}
                      onOrderSelect={handleOrderSelect}
                      onBrickLinkClick={setBrickLinkUrl}
                      onOpenSettings={(section) => { setDetailModal({ open: false, data: null }); openSettings(section); }}
                      onItemClick={handleDashboardItemClick}
                      inline
                    />
                  );
                }
                const drawer = renderActiveDrawer();
                if (drawer) return <div className="flex flex-col h-full overflow-hidden">{drawer}</div>;
                if (activeDashboard === 'dashboard') {
                  return <BridgeQuadPanel onTune={tuneChannel} />;
                }
                // Non-Bridge: empty workspace — tools open here
                return (
                  <div style={{ height:'100%', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:'16px', padding:'24px', position:'relative', overflow:'hidden' }}>
                    {/* Ambient channel glow */}
                    <div style={{ position:'absolute', inset:0, background:`radial-gradient(ellipse 60% 50% at 50% 50%, rgba(${screenRgb},0.07) 0%, transparent 70%)`, pointerEvents:'none' }} />
                    {/* Corner grid marks */}
                    {(['top-4 left-4','top-4 right-4','bottom-4 left-4','bottom-4 right-4'] as const).map((pos,i) => (
                      <div key={i} className={`absolute ${pos}`} style={{ width:'18px', height:'18px', borderTop: i<2 ? `1px solid rgba(${screenRgb},0.25)` : 'none', borderBottom: i>=2 ? `1px solid rgba(${screenRgb},0.25)` : 'none', borderLeft: i%2===0 ? `1px solid rgba(${screenRgb},0.25)` : 'none', borderRight: i%2===1 ? `1px solid rgba(${screenRgb},0.25)` : 'none' }} />
                    ))}
                    {/* Channel ID badge */}
                    <div style={{ display:'flex', alignItems:'center', gap:'8px', padding:'4px 10px', border:`1px solid rgba(${screenRgb},0.30)`, borderRadius:'6px', background:`rgba(${screenRgb},0.07)` }}>
                      <div style={{ width:'6px', height:'6px', borderRadius:'50%', background:screenHex, boxShadow:`0 0 8px ${screenHex}`, animation:'tv-dot-pulse 2s ease-in-out infinite' }} />
                      <span style={{ fontSize:'9px', fontFamily:'monospace', color:screenHex, letterSpacing:'0.25em', textTransform:'uppercase', fontWeight:700 }}>CH {activeCh.num} · {activeCh.label}</span>
                    </div>
                    {/* Main workspace label */}
                    <div style={{ textAlign:'center', display:'flex', flexDirection:'column', gap:'8px' }}>
                      <div style={{ fontSize:'11px', fontFamily:'monospace', color:`rgba(${screenRgb},0.5)`, letterSpacing:'0.3em', textTransform:'uppercase' }}>WORKSPACE</div>
                      <div style={{ fontSize:'9px', fontFamily:'monospace', color:'rgba(180,200,255,0.22)', letterSpacing:'0.15em', textTransform:'uppercase', lineHeight:1.6 }}>Select a tool from the left panel<br/>to open it here</div>
                    </div>
                    {/* Dashed border frame */}
                    <div style={{ position:'absolute', inset:'20px', border:`1px dashed rgba(${screenRgb},0.10)`, borderRadius:'8px', pointerEvents:'none' }} />
                  </div>
                );
              };

              return (
                <div className="hidden tablet-ls:flex lg:flex h-full p-1.5 lg:p-3" style={{
                  background: `radial-gradient(ellipse 80% 70% at 50% 40%, rgba(${screenRgb},0.10) 0%, rgba(${screenRgb},0.03) 50%, transparent 75%)`,
                  transition: 'background 0.6s ease',
                }}>
                  <style>{`
                    @keyframes tv-scan     { 0%{top:-2px;opacity:0} 4%{opacity:0.55} 96%{opacity:0.25} 100%{top:100%;opacity:0} }
                    @keyframes tv-bgring   { from{transform:translate(-50%,-50%) rotate(0deg)} to{transform:translate(-50%,-50%) rotate(360deg)} }
                    @keyframes tv-bgring-r { from{transform:translate(-50%,-50%) rotate(0deg)} to{transform:translate(-50%,-50%) rotate(-360deg)} }
                    @keyframes tv-ledpulse { 0%,100%{text-shadow:0 0 8px var(--tv-led-hex,#00FFEE)} 50%{text-shadow:0 0 18px var(--tv-led-hex,#00FFEE),0 0 36px var(--tv-led-hex,#00FFEE)} }
                    @keyframes tv-chglow   { 0%,100%{box-shadow:0 0 10px var(--tv-ch-hex,#1B7CE5),inset 0 0 6px rgba(0,0,0,0.5)} 50%{box-shadow:0 0 20px var(--tv-ch-hex,#1B7CE5),inset 0 0 10px rgba(0,0,0,0.3)} }
                    @keyframes tv-dot-pulse{ 0%,100%{opacity:1} 50%{opacity:0.35} }
                  `}</style>

                  {/* TV body */}
                  <div className="flex h-full w-full flex-col relative" style={{
                    background: 'linear-gradient(165deg, #20204A 0%, #1A1A3C 35%, #141432 70%, #101028 100%)',
                    borderRadius: 'clamp(16px,2.5vw,28px)',
                    border: '2px solid rgba(255,255,255,0.18)',
                    boxShadow: `0 0 0 1px rgba(80,100,200,0.35) inset, 0 0 0 2px rgba(40,60,140,0.20) inset, 0 20px 80px rgba(0,0,0,0.85), 0 0 100px rgba(${screenRgb},0.14)`,
                    padding: 'clamp(10px,1.2vw,14px)',
                    paddingBottom: 0,
                    gap: 'clamp(8px,0.9vw,10px)',
                    overflow: 'hidden',
                    transition: 'box-shadow 0.6s ease',
                  }}>
                    {/* Top highlight edge */}
                    <div style={{ position: 'absolute', top: 0, left: '6%', right: '6%', height: '1px', background: 'linear-gradient(90deg,transparent,rgba(0,255,238,0.3),transparent)', pointerEvents: 'none' }} />
                    {/* Corner accent squares */}
                    {([{ top:'11px',left:'16px' },{ top:'11px',right:'16px' },{ bottom:'11px',left:'16px' },{ bottom:'11px',right:'16px' }] as const).map((pos,i) => (
                      <div key={i} style={{ position:'absolute',...pos, width:'11px', height:'11px', border:'1px solid rgba(0,255,238,0.18)', borderRadius:'3px', pointerEvents:'none', zIndex:10 }} />
                    ))}

                    {/* Chrome bezel + full-face glass screen */}
                    <div style={{ flex:1, display:'flex', flexDirection:'column', minHeight:0 }}>
                      <div style={{
                        flex:1, display:'flex', flexDirection:'column', minHeight:0,
                        background:'linear-gradient(145deg,#38385A 0%,#484870 18%,#282844 55%,#383860 80%,#1E1E3A 100%)',
                        borderRadius:'14px', padding:'5px',
                        boxShadow:'inset 0 3px 8px rgba(0,0,0,0.8),0 2px 6px rgba(0,0,0,0.5),0 0 0 1px rgba(0,255,238,0.1)',
                      }}>
                        {/* Glass screen */}
                        <div style={{ flex:1, position:'relative', background:'#090E22', borderRadius:'10px', overflow:'hidden', minHeight:0 }}>
                          {/* Scanlines */}
                          <div style={{ position:'absolute',inset:0,zIndex:15,pointerEvents:'none',backgroundImage:'repeating-linear-gradient(0deg,rgba(0,0,0,0) 0px,rgba(0,0,0,0) 2px,rgba(0,0,0,0.07) 2px,rgba(0,0,0,0.07) 4px)' }} />
                          {/* Phosphor glow — channel-colored center bloom */}
                          <div style={{ position:'absolute',inset:0,zIndex:14,pointerEvents:'none',background:`radial-gradient(ellipse 75% 60% at 50% 40%,rgba(${screenRgb},0.20) 0%,rgba(${screenRgb},0.06) 50%,transparent 72%)`,transition:'background 0.6s ease' }} />
                          {/* Glass reflection */}
                          <div style={{ position:'absolute',top:0,left:0,right:0,height:'11%',zIndex:16,pointerEvents:'none',background:'linear-gradient(to bottom,rgba(255,255,255,0.040),transparent)',borderRadius:'10px 10px 0 0' }} />
                          {/* Scan sweep */}
                          <div style={{ position:'absolute',left:0,right:0,height:'2px',background:`linear-gradient(90deg,transparent 0%,rgba(${screenRgb},0.28) 30%,rgba(${screenRgb},0.65) 50%,rgba(${screenRgb},0.28) 70%,transparent 100%)`,animation:'tv-scan 10s ease-in-out 2s infinite',pointerEvents:'none',zIndex:17 }} />
                          {/* Orbital rings */}
                          <div style={{ position:'absolute',left:'50%',top:'50%',width:'180%',height:'180%',border:'1px solid rgba(0,255,238,0.03)',borderRadius:'50%',animation:'tv-bgring 90s linear infinite',pointerEvents:'none',zIndex:3 }} />
                          <div style={{ position:'absolute',left:'50%',top:'50%',width:'140%',height:'140%',border:'1px solid rgba(168,85,247,0.025)',borderRadius:'50%',transform:'translate(-50%,-50%) rotate(30deg)',animation:'tv-bgring-r 55s linear infinite',pointerEvents:'none',zIndex:3 }} />
                          {/* Channel flash static */}
                          {tvFlash && (
                            <div style={{ position:'absolute',inset:0,zIndex:20,backgroundImage:`repeating-linear-gradient(0deg,rgba(0,255,238,0.1) 0px,transparent 1px,rgba(0,0,0,0.5) 3px,rgba(255,255,255,0.08) 5px),repeating-linear-gradient(90deg,rgba(255,255,255,0.03) 0px,transparent 2px)`,opacity:0.9 }} />
                          )}

                          {/* ── 1/3 | 2/3 screen split ── */}
                          <div style={{ position:'absolute',inset:0,display:'flex',zIndex:5,opacity:tvFlash?0:1,transition:'opacity 0.1s ease' }}>

                            {/* LEFT panel — Plan (Bridge) or channel metrics (other channels) */}
                            <div style={{ flex:'0 0 clamp(360px, 40%, 460px)',display:'flex',flexDirection:'column',borderRight:'1px solid rgba(0,255,238,0.15)',background:'rgba(12,16,40,0.75)',overflow:'hidden' }}>
                              {activeDashboard === 'dashboard' ? (
                                <>
                                  {!planCollapsed && (
                                    <div style={{ flex:1,minHeight:0,overflowY:'auto' }}>
                                      <GeneralDashboard
                                        onItemClick={handleDashboardItemClick}
                                        onOpenFulfillment={() => { tuneChannel('sales'); setTimeout(() => setActiveOrdersDrawer('fulfillment'), 250); }}
                                        onOpenBrickanalyzer={() => { tuneChannel('inventory'); setTimeout(() => setActiveInventoryDrawer('brickanalyzer'), 250); }}
                                        onOpenPriceomatic={() => { tuneChannel('inventory'); setTimeout(() => setActiveInventoryDrawer('priceomatic'), 250); }}
                                        onOpenBilling={() => setBillingOpen(true)}
                                        onOpenSettings={(section) => { setSettingsInitialSection(section); setSettingsOpen(true); }}
                                        onNavigate={(tab, panelTab) => panelTab ? tuneChannelWithTab(tab as DashboardType, panelTab) : tuneChannel(tab as DashboardType)}
                                        section="plan"
                                      />
                                    </div>
                                  )}
                                  {/* Station ID / collapse bar — Bridge only */}
                                  <div style={{ flexShrink:0,padding:'3px 6px 3px 10px',background:'rgba(0,255,238,0.06)',borderTop:planCollapsed?'none':'1px solid rgba(0,255,238,0.16)',borderBottom:'1px solid rgba(0,255,238,0.16)',display:'flex',alignItems:'center',gap:'5px' }}>
                                    <div style={{ width:'4px',height:'4px',borderRadius:'50%',background:'#00FFEE',boxShadow:'0 0 4px #00FFEE',flexShrink:0 }} />
                                    <span style={{ fontSize:'7px',fontFamily:'monospace',color:'rgba(0,255,238,0.6)',letterSpacing:'0.22em',textTransform:'uppercase',flex:1 }}>Station ID</span>
                                    <button onClick={() => setPlanCollapsed(c => !c)} data-testid="button-plan-toggle" title={planCollapsed ? 'Show My Plan' : 'Hide My Plan'} style={{ fontSize:'7px',fontFamily:'monospace',color:'rgba(0,255,238,0.45)',letterSpacing:'0.1em',background:'none',border:'1px solid rgba(0,255,238,0.18)',borderRadius:'3px',padding:'1px 4px',cursor:'pointer',flexShrink:0 }}>
                                      {planCollapsed ? 'PLAN ▲' : 'PLAN ▼'}
                                    </button>
                                  </div>
                                </>
                              ) : (
                                <div style={{ flex:1,minHeight:0,overflowY:'auto' }}>
                                  {renderDynamicDashboard(true, undefined, true)}
                                </div>
                              )}
                              {/* Now-viewing indicator — always visible */}
                              <div style={{ flexShrink:0,padding:'4px 10px',borderTop:'1px solid rgba(0,255,238,0.08)',display:'flex',flexDirection:'column',gap:'2px' }}>
                                <div style={{ fontSize:'7px',fontFamily:'monospace',color:'rgba(0,255,238,0.3)',letterSpacing:'0.2em',textTransform:'uppercase' }}>Now Viewing</div>
                                <div style={{ display:'flex',alignItems:'center',gap:'7px' }}>
                                  <div style={{ width:'6px',height:'6px',borderRadius:'50%',background:screenHex,boxShadow:`0 0 6px ${screenHex}`,flexShrink:0,animation:'tv-dot-pulse 2s ease-in-out infinite' }} />
                                  <span style={{ fontSize:'11px',fontFamily:'monospace',color:screenHex,fontWeight:700,letterSpacing:'0.12em',textShadow:`0 0 8px ${screenHex}66` }}>{activeCh.label}</span>
                                  <span style={{ fontSize:'8px',fontFamily:'monospace',color:'rgba(180,200,255,0.28)',letterSpacing:'0.1em' }}>CH {activeCh.num}</span>
                                </div>
                              </div>
                            </div>

                            {/* RIGHT 2/3 — Active channel content */}
                            <div style={{ flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minWidth:0 }}>
                              {renderRightPanel()}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Bottom controls strip */}
                    <div style={{ display:'flex',alignItems:'center',gap:'clamp(8px,1.2vw,16px)',flexShrink:0,flexWrap:'nowrap',padding:'clamp(6px,0.9vw,10px) 0',borderTop:'1px solid rgba(0,255,238,0.12)' }}>
                      {/* LED channel display */}
                      <div style={{ '--tv-led-hex': screenHex } as React.CSSProperties}>
                        <div style={{ background:'#060612',border:`1px solid ${screenHex}55`,borderRadius:'10px',padding:'clamp(4px,0.6vw,7px) clamp(8px,1vw,14px)',textAlign:'center',fontFamily:'monospace',color:screenHex,fontWeight:900,lineHeight:1,fontSize:'clamp(15px,1.8vw,22px)',boxShadow:`0 0 14px ${screenHex}33,inset 0 0 12px rgba(0,0,0,0.95)`,animation:'tv-ledpulse 2.5s ease-in-out infinite',flexShrink:0,display:'flex',flexDirection:'column',alignItems:'center',gap:'2px' }}>
                          {activeCh.num}
                          <div style={{ fontSize:'clamp(5px,0.5vw,7px)',letterSpacing:'0.2em',color:`${screenHex}BB` }}>CH</div>
                        </div>
                      </div>

                      {/* Channel buttons */}
                      <div style={{ display:'flex',gap:'clamp(4px,0.7vw,9px)',flex:1,justifyContent:'center',minWidth:0 }}>
                        {TV_CHANNELS.map(ch => {
                          const isActive = ch.id === activeDashboard;
                          return (
                            <button
                              key={ch.id}
                              onClick={() => tuneChannel(ch.id)}
                              data-testid={`button-channel-${ch.id}`}
                              style={{
                                '--tv-ch-hex': ch.hex,
                                background: isActive ? `${ch.hex}18` : 'rgba(255,255,255,0.04)',
                                border: `1px solid ${isActive ? ch.hex : 'rgba(200,220,255,0.2)'}`,
                                borderRadius: '8px',
                                padding: 'clamp(5px,0.7vw,9px) clamp(8px,1.2vw,16px)',
                                cursor: 'pointer',
                                color: isActive ? ch.hex : 'rgba(215,230,255,0.82)',
                                fontFamily: 'monospace',
                                fontWeight: 700,
                                letterSpacing: '0.08em',
                                animation: isActive ? 'tv-chglow 2s ease-in-out infinite' : 'none',
                                transition: 'all 0.15s',
                                textAlign: 'center' as const,
                                lineHeight: 1.3,
                                textShadow: isActive ? `0 0 8px ${ch.hex}` : 'none',
                                display: 'flex',
                                flexDirection: 'column' as const,
                                alignItems: 'center',
                                gap: '2px',
                                flex: 1,
                                minWidth: 0,
                                outline: 'none',
                              } as React.CSSProperties}
                            >
                              <div style={{ fontSize:'clamp(9px,1.1vw,14px)' }}>{ch.num}</div>
                              <div style={{ fontSize:'clamp(6px,0.6vw,9px)',opacity:0.85,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:'100%' }}>{ch.label}</div>
                            </button>
                          );
                        })}
                      </div>

                      {/* Decorative knobs */}
                      <div style={{ display:'flex',gap:'clamp(6px,0.9vw,12px)',flexShrink:0,alignItems:'center' }}>
                        {([{ label:'PWR',color:'#00FFEE' },{ label:'HUE',color:'#A855F7' }] as const).map(k => (
                          <div key={k.label} style={{ textAlign:'center' }}>
                            <div style={{ width:'clamp(22px,2.4vw,32px)',height:'clamp(22px,2.4vw,32px)',borderRadius:'50%',background:'radial-gradient(circle at 35% 30%,rgba(100,100,180,0.3),rgba(10,10,40,0.95))',border:`1px solid ${k.color}44`,boxShadow:`0 0 10px ${k.color}33,inset 0 0 8px rgba(0,0,0,0.9)`,margin:'0 auto',position:'relative' }}>
                              <div style={{ position:'absolute',width:'2px',height:'36%',background:k.color,top:'14%',left:'50%',transform:'translateX(-50%)',borderRadius:'2px',boxShadow:`0 0 4px ${k.color}` }} />
                            </div>
                            <div style={{ fontSize:'clamp(4px,0.45vw,6px)',color:`${k.color}88`,letterSpacing:'0.15em',marginTop:'2px' }}>{k.label}</div>
                          </div>
                        ))}
                      </div>

                      {/* Signal bars */}
                      <div style={{ display:'flex',alignItems:'flex-end',gap:'2px',flexShrink:0 }}>
                        {[3,5,7,9,11].map((h,i) => (
                          <div key={i} style={{ width:'clamp(2px,0.28vw,4px)',height:`${h}px`,borderRadius:'1px',background:i<3?'#00FFEE':'rgba(0,255,238,0.18)',boxShadow:i<3?'0 0 4px #00FFEE':'none' }} />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </>
        )}
      </div>

      {/* Elfie Chat Drawer - Jetsons Style */}
      <Sheet open={chatOpen}>
        <SheetContent 
          side="bottom" 
          className="h-[92vh] p-0 border-0 overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, #1a0a2e 0%, #2d1b4e 50%, #0f0524 100%)',
          }}
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {/* Jetsons-style chrome border with scan lines */}
          <div className="absolute inset-0 pointer-events-none">
            {/* Top chrome trim */}
            <div 
              className="absolute top-0 left-0 right-0 h-2"
              style={{
                background: 'linear-gradient(to bottom, #e5e7eb 0%, #9ca3af 50%, #6b7280 100%)',
                boxShadow: '0 2px 8px rgba(168, 85, 247, 0.4)',
              }}
            />
            
            {/* Atomic-age corner accents */}
            <div className="absolute top-2 left-4 w-12 h-12 rounded-full border-2 border-purple-400/30" />
            <div className="absolute top-2 right-4 w-12 h-12 rounded-full border-2 border-purple-400/30" />
            <div className="absolute top-4 left-6 w-8 h-8 rounded-full border-2 border-cyan-400/30" />
            <div className="absolute top-4 right-6 w-8 h-8 rounded-full border-2 border-cyan-400/30" />
            
            {/* Scan lines effect */}
            <div 
              className="absolute inset-0 opacity-10"
              style={{
                backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(168, 85, 247, 0.3) 2px, rgba(168, 85, 247, 0.3) 4px)',
              }}
            />
            
            {/* Retro glow overlay */}
            <div 
              className="absolute inset-0 opacity-20"
              style={{
                background: 'radial-gradient(ellipse at center top, rgba(168, 85, 247, 0.4) 0%, transparent 50%)',
              }}
            />
          </div>

          <div className="h-full flex flex-col relative z-10">
            <ChatInterface 
              dashboardContext={getChatContext()} 
              themeColor={getThemeColor()} 
              prompts={[]} 
              onPromptAction={handlePromptAction}
              onItemClick={handleItemClick}
              isMinimized={false}
              onToggleMinimize={handleChatClose}
              marketIntel={marketIntel}
              onSupportNotification={setSupportNotification}
            />
          </div>
        </SheetContent>
      </Sheet>
      
      {!user?.isAdmin && !isBrickspotterOnly && user?.orgRole === 'owner' && org && !org.onboardingCompleted && !wizardDismissed && (
        <OnboardingWizard
          org={org}
          onComplete={() => queryClient.invalidateQueries({ queryKey: ['/api/org'] })}
          onDismiss={() => {
            setWizardDismissed(true);
            try { localStorage.setItem(`onboardingDismissed_${org.id}`, 'true'); } catch {}
          }}
        />
      )}

      {user && user.orgRole !== 'owner' && !user.isAdmin && org && !employeeWelcomeDone && !hasCompletedEmployeeWelcome(user.id) && !isBrickspotterOnly && (
        <EmployeeWelcome
          user={user}
          orgName={org.name}
          onComplete={() => setEmployeeWelcomeDone(true)}
        />
      )}

      {/* BrickSpotter-only welcome — shown once on first login for BS members */}
      {user && isBrickspotterOnly && !bsWelcomeDone && !hasCompletedBsWelcome(user.id) && (
        <BrickSpotterWelcome
          userId={user.id}
          onComplete={() => setBsWelcomeDone(true)}
        />
      )}

      <SettingsModal open={settingsOpen} onClose={() => { setSettingsOpen(false); setSettingsPricingExample(undefined); setSettingsScoringExample(undefined); setSettingsFocusTarget(undefined); }} initialSection={settingsInitialSection ?? undefined} focusTarget={settingsFocusTarget} pricingExample={settingsPricingExample} scoringExample={settingsScoringExample} isBrickspotterOnly={isBrickspotterOnly} />
      
      {/* Detail modal — mobile always; desktop only for BS-only layout (no center column overlay there) */}
      {(!isDesktop || isBrickspotterOnly) && (
        <DetailModal 
          open={detailModal.open} 
          onClose={() => setDetailModal({ open: false, data: null })} 
          detail={detailModal.data}
          onOrderSelect={handleOrderSelect}
          onBrickLinkClick={setBrickLinkUrl}
          onOpenSettings={(section) => { setDetailModal({ open: false, data: null }); openSettings(section); }}
          onItemClick={handleDashboardItemClick}
        />
      )}

      {/* Tool drawers — Vaul drawer on mobile only; desktop uses inline overlay in center column */}
      {!isDesktop && (
        <Drawer open={!!(
          (activeInventoryDrawer && activeInventoryDrawer !== 'inventoryhealth' && activeInventoryDrawer !== 'bricklinksync' && !activeInventoryDrawer.startsWith('channelsync-')) ||
          (activeOrdersDrawer && activeOrdersDrawer !== 'bricklinksync' && !activeOrdersDrawer.startsWith('ordersync-')) ||
          activeMarketingDrawer || activeSalesDrawer || billingOpen
        )} onOpenChange={(open) => { if (!open) closeActiveDrawer(); }}>
          <DrawerContent className="bg-gray-950 border-gray-800 h-[92vh] flex flex-col rounded-t-2xl">
            <DrawerHeader className="p-0 flex-shrink-0">
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-14 h-1.5 rounded-full bg-gray-500" />
              </div>
              <div className="flex items-center gap-2 px-4 pt-2 pb-2 border-b border-gray-800">
                <DrawerTitle className="flex items-center gap-2 text-sm font-semibold text-gray-100 flex-1">
                  {activeInventoryDrawer === 'priceomatic' && <><Sparkles className="w-4 h-4 text-purple-400 flex-shrink-0" /> Price-o-Matic</>}
                  {activeInventoryDrawer === 'platformsync' && <><ListChecks className="w-4 h-4 text-green-400 flex-shrink-0" /> List-o-Matic</>}
                  {activeInventoryDrawer === 'brickanalyzer' && <><ScanSearch className="w-4 h-4 text-lego-yellow flex-shrink-0" /> Brick Spotter 3000</>}
                  {activeInventoryDrawer === 'bundletron' && <><Package className="w-4 h-4 text-orange-400 flex-shrink-0" /> BundleTron</>}
                  {activeInventoryDrawer === 'acquisition-evaluator' && <><Package className="w-4 h-4 text-violet-400 flex-shrink-0" /> Acquisition Evaluator</>}
                  {activeOrdersDrawer === 'fulfillment' && <><Truck className="w-4 h-4 text-orange-400 flex-shrink-0" /> Fulfillment & Shipping</>}
                  {activeOrdersDrawer === 'shipped' && <><PackageCheck className="w-4 h-4 text-green-400 flex-shrink-0" /> Shipped Orders</>}
                  {activeMarketingDrawer && <><Mail className="w-4 h-4 text-yellow-400 flex-shrink-0" /> Marketing</>}
                  {activeSalesDrawer && <><Package className="w-4 h-4 text-green-400 flex-shrink-0" /> Insights</>}
                  {billingOpen && <><CreditCard className="w-4 h-4 text-blue-400 flex-shrink-0" /> Payments & Billing</>}
                </DrawerTitle>
                <button onClick={closeActiveDrawer} className="ml-2 text-gray-500 hover:text-gray-200 transition-colors" data-testid="button-close-tool-drawer">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <DrawerDescription className="sr-only">Tool drawer</DrawerDescription>
            </DrawerHeader>
            <div className="flex-1 overflow-y-auto px-4 pt-3 min-h-0">
              {activeInventoryDrawer === 'priceomatic' && <PriceOMaticDashboard onItemClick={(type, id) => handleDashboardItemClick(type, id, 'pricing')} onOpenSettings={(section, pricingExample, scoringExample) => { setSettingsInitialSection(section as any); setSettingsPricingExample(pricingExample); setSettingsScoringExample(scoringExample); setSettingsOpen(true); }} />}
              {activeInventoryDrawer === 'platformsync' && <ListomaticPriority />}
              {activeInventoryDrawer === 'brickanalyzer' && <BrickanalyzerTool onItemClick={(type, id, tab) => handleDashboardItemClick(type, id, tab)} />}
              {activeInventoryDrawer === 'bundletron' && <BundleTronPanel />}
              {activeInventoryDrawer === 'acquisition-evaluator' && <AcquisitionEvaluator />}
              {activeOrdersDrawer === 'fulfillment' && <FulfillmentTool onOrderDetail={handleOrderSelect} onItemClick={handleDashboardItemClick} />}
              {activeOrdersDrawer === 'shipped' && <ShippedOrdersTool onItemClick={(type, id) => { closeActiveDrawer(); handleDashboardItemClick(type, id); }} />}
              {activeMarketingDrawer && <MarketingDashboard dateRange={dateRange} onItemClick={handleDashboardItemClick} activeDrawer={activeMarketingDrawer} onDrawerChange={setActiveMarketingDrawer} renderDrawerOnly />}
              {activeSalesDrawer && <SalesDashboard period={salesPeriod} dateRange={dateRange} onItemClick={handleDashboardItemClick} activeDrawer={activeSalesDrawer} onDrawerChange={setActiveSalesDrawer} renderDrawerOnly />}
              {billingOpen && <BillingDrawer onClose={closeActiveDrawer} />}
            </div>
          </DrawerContent>
        </Drawer>
      )}

      {/* BrickLink in-app browser dialog */}
      <Dialog open={!!brickLinkUrl} onOpenChange={() => setBrickLinkUrl(null)}>
        <DialogContent className="p-0 flex flex-col gap-0 rounded-none border-0" style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', maxWidth: 'none', transform: 'none' }} aria-describedby="bricklink-description">
          <DialogTitle className="sr-only">BrickLink</DialogTitle>
          <p id="bricklink-description" className="sr-only">BrickLink catalog page displaying item information</p>
          {/* Browser chrome toolbar */}
          <div className="flex items-center gap-2 px-3 py-2 border-b shrink-0">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => brickLinkIframeRef.current?.contentWindow?.history.back()}
              data-testid="button-bricklink-back"
              title="Go back"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                setBrickLinkLoading(true);
                if (brickLinkIframeRef.current) {
                  brickLinkIframeRef.current.src = brickLinkIframeRef.current.src;
                }
              }}
              data-testid="button-bricklink-refresh"
              title="Refresh"
            >
              <RotateCw className={`h-4 w-4 ${brickLinkLoading ? 'animate-spin' : ''}`} />
            </Button>
            {/* URL bar */}
            <div className="flex-1 flex items-center gap-2 bg-muted rounded-md px-3 py-1 min-w-0">
              <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span
                className="text-xs text-muted-foreground truncate font-mono"
                data-testid="text-bricklink-url"
              >
                {brickLinkUrl ?? ''}
              </span>
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => brickLinkUrl && window.open(brickLinkUrl, '_blank', 'noopener,noreferrer')}
              data-testid="button-bricklink-open-external"
              title="Open in browser"
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setBrickLinkUrl(null)}
              data-testid="button-close-bricklink"
              title="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          {brickLinkUrl && (
            <iframe
              ref={brickLinkIframeRef}
              src={brickLinkUrl}
              className="w-full flex-1 min-h-0"
              title="BrickLink"
              sandbox="allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms"
              data-testid="iframe-bricklink"
              onLoad={() => setBrickLinkLoading(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Bottom Nav — phone only (< md); tablets use the vertical rail, desktop has tab bar */}
      {!isBrickspotterOnly && (
        <div className="md:hidden">
          <DashboardNav
            active={activeDashboard}
            onSelect={(d) => { closeActiveDrawer(); setActiveDashboard(d); }}
            hideOpsCentral={false}
            ordersCount={fulfillmentStats?.unfulfilled ?? 0}
            superAdmin={!!superAdmin}
          />
        </div>
      )}
    </div>
  );
}
