import { useState, useEffect, useRef } from "react";
import { Package, ClipboardList, RefreshCw, ExternalLink, X, EyeOff, LogOut, ArrowLeft, RotateCw } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAdminScaling } from "@/hooks/useAdminScaling";
import { useAuth } from "@/hooks/useAuth";
import OnboardingWizard from "@/components/OnboardingWizard";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Organization } from "@shared/schema";
import Header from "@/components/Header";
import DashboardNav, { DashboardType } from "@/components/DashboardNav";
import SettingsModal from "@/components/SettingsModal";
import InventoryDashboard from "@/components/InventoryDashboard";
import SalesDashboard from "@/components/SalesDashboard";
import MarketingDashboard, { MarketingDrawer } from "@/components/MarketingDashboard";
import GeneralDashboard, { SystemPulse } from "@/components/GeneralDashboard";
import OrdersDashboard from "@/components/OrdersDashboard";
import ChatInterface from "@/components/ChatInterface";
import DetailModal, { DetailData } from "@/components/DetailModal";
import DateRangeSelector, { DateRangeValue } from "@/components/DateRangeSelector";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ElfieCharacter } from "@/components/ElfieCharacter";

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
  const { data: billingStatus } = useQuery<{ plan: string; status: string; interval: string | null; trialEndsAt: string | null; subscriptionEndsAt: string | null; brickspotter: { scansUsed: number; scansLimit: number } }>({
    queryKey: ['/api/billing/status'],
    refetchInterval: 60000,
  });
  const { data: blRateLimit } = useQuery<{ allowed: boolean; callsLast24h: number; blocked?: boolean }>({
    queryKey: ['/api/bricklink/rate-limit'],
    refetchInterval: 60000,
  });
  const { data: appSettingsHome } = useQuery<{ bricklinkConsumerKey?: string | null; paypalClientId?: string | null; stripeSecretKey?: string | null; paypalConnectedViaEnv?: boolean; stripeConnectedViaEnv?: boolean; blApiCallLimit?: number }>({
    queryKey: ['/api/settings'],
  });
  const systemPulseSetupItems = (() => {
    const items: Array<{ id: string; label: string; section: 'general' | 'platforms' }> = [];
    if (org?.onboardingCompleted) {
      if (!org?.address) items.push({ id: 'address', label: 'Add business address', section: 'general' });
      if (!appSettingsHome?.bricklinkConsumerKey) items.push({ id: 'bricklink', label: 'Connect BrickLink', section: 'platforms' });
      if (!appSettingsHome?.paypalClientId && !appSettingsHome?.paypalConnectedViaEnv) items.push({ id: 'paypal', label: 'Connect PayPal', section: 'platforms' });
      if (!appSettingsHome?.stripeSecretKey && !appSettingsHome?.stripeConnectedViaEnv) items.push({ id: 'stripe', label: 'Connect Stripe', section: 'platforms' });
    }
    return items;
  })();
  const [activeDashboard, setActiveDashboard] = useState<DashboardType>('dashboard');
  const [isPanelMode, setIsPanelMode] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1280);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<'general' | 'platforms' | 'ai' | 'automation' | 'data' | 'users' | 'priceomatic' | null>(null);
  const [salesPeriod, setSalesPeriod] = useState<'mtd' | 'ytd' | '1y' | '5y'>('ytd');
  const [dateRange, setDateRange] = useState<DateRangeValue>('mtd');
  const [chatOpen, setChatOpen] = useState(false);
  const [showElfie, setShowElfie] = useState(false);
  const [elfieClosing, setElfieClosing] = useState(false);
  const [elfieResting, setElfieResting] = useState(false);
  const [elfieThinking, setElfieThinking] = useState(false);
  const [forumNews, setForumNews] = useState<{
    count: number;
    posts: Array<{
      title: string;
      username: string;
      postedAt: string;
      threadUrl: string;
    }>;
  } | null>(null);
  const [activeInventoryDrawer, setActiveInventoryDrawer] = useState<'priceomatic' | 'warehouse' | 'platformsync' | 'brickanalyzer' | null>(null);
  const [activeOrdersDrawer, setActiveOrdersDrawer] = useState<'fulfillment' | 'shipped' | null>(null);
  const [activeMarketingDrawer, setActiveMarketingDrawer] = useState<MarketingDrawer>(null);
  const [detailModal, setDetailModal] = useState<{ open: boolean; data: DetailData | null }>({
    open: false,
    data: null,
  });
  const [brickLinkUrl, setBrickLinkUrl] = useState<string | null>(null);
  const brickLinkIframeRef = useRef<HTMLIFrameElement>(null);
  const [brickLinkLoading, setBrickLinkLoading] = useState(false);

  // Fetch picklist stats for indicator
  const { data: picklistStats } = useQuery<{ toPull: number }>({
    queryKey: ['/api/picklist/stats'],
    enabled: activeDashboard === 'orders',
  });

  // Fetch fulfillment stats for indicator
  const { data: fulfillmentStats } = useQuery<{ unfulfilled: number }>({
    queryKey: ['/api/fulfillment/stats'],
    enabled: activeDashboard === 'orders',
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
        toast({ title: `${label} failed`, description: c.errorMessage || 'Sync encountered an error.', variant: 'destructive' });
      }
    }

    prevSyncStatuses.current = curr;
  }, [globalSyncStatuses]);

  // Panel mode: switch between tabbed and side-by-side column layout
  useEffect(() => {
    const check = () => setIsPanelMode(window.innerWidth >= 1280);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Calculate total discrepancies across all platforms
  const totalDiscrepancies = syncStatus?.targets?.reduce((total: number, platform: any) => {
    return total + 
      (platform.discrepancies?.missingLots || 0) +
      (platform.discrepancies?.priceDifferences || 0) +
      (platform.discrepancies?.quantityDifferences || 0);
  }, 0) || 0;

  const handleDashboardItemClick = async (type: 'order' | 'inventory', id: number | string, initialTab?: string) => {
    // Check if this is a BrickLink catalog item
    const isBrickLinkCatalog = String(id).startsWith('bricklink-');
    
    // Open modal immediately with loading state
    setDetailModal({
      open: true,
      data: { type, data: { id, loading: true } as any, initialTab }
    });

    // Handle BrickLink catalog items
    if (isBrickLinkCatalog && type === 'inventory') {
      const itemNo = String(id).replace('bricklink-', '');
      const catalogItemKey = `bricklink-item-${itemNo}`;
      const storedData = sessionStorage.getItem(catalogItemKey);
      
      if (storedData) {
        const bricklinkItem = JSON.parse(storedData);
        
        // Format BrickLink catalog data to match inventory structure
        // Build correct BrickLink URL based on item type
        const itemTypePrefix = bricklinkItem.itemType === 'SET' ? 'S' :
                               bricklinkItem.itemType === 'MINIFIG' ? 'M' :
                               bricklinkItem.itemType === 'PART' ? 'P' :
                               bricklinkItem.itemType === 'BOOK' ? 'B' :
                               bricklinkItem.itemType === 'GEAR' ? 'G' :
                               bricklinkItem.itemType === 'CATALOG' ? 'C' :
                               bricklinkItem.itemType === 'INSTRUCTION' ? 'I' :
                               'P'; // Default to PART if unknown
        
        const catalogData = {
          id: String(id),
          itemNo: bricklinkItem.itemNo,
          itemName: bricklinkItem.itemName,
          itemType: bricklinkItem.itemType,
          categoryId: bricklinkItem.categoryId,
          categoryName: null,
          colorId: null,
          colorName: null,
          colorRgb: null,
          quantity: 0,
          newOrUsed: 'N',
          unitPrice: '0.00',
          myCost: null,
          description: `BrickLink Catalog Item - ${bricklinkItem.itemName}`,
          remarks: `Year Released: ${bricklinkItem.yearReleased || 'Unknown'}`,
          myWeight: bricklinkItem.weight ? String(bricklinkItem.weight) : null,
          isBrickLinkCatalog: true, // Flag to indicate this is from catalog
          bricklinkUrl: `https://www.bricklink.com/v2/catalog/catalogitem.page?${itemTypePrefix}=${bricklinkItem.itemNo}`,
          // Include pricing data from BrickLink for Price-o-Matic display
          priceOMagic: {
            stockAvgPrice: bricklinkItem.stockAvgPrice,
            stockMinPrice: bricklinkItem.stockMinPrice,
            stockMaxPrice: bricklinkItem.stockMaxPrice,
            stockTotalLots: bricklinkItem.stockTotalLots,
            soldAvgPrice: bricklinkItem.soldAvgPrice,
            soldMinPrice: bricklinkItem.soldMinPrice,
            soldMaxPrice: bricklinkItem.soldMaxPrice,
            soldTotalLots: bricklinkItem.soldTotalLots,
            suggestedPrice: bricklinkItem.suggestedPrice,
            itemName: bricklinkItem.itemName,
            imageUrl: bricklinkItem.imageUrl,
            thumbnailUrl: bricklinkItem.thumbnailUrl,
          },
        };
        
        setDetailModal({
          open: true,
          data: { 
            type: 'inventory', 
            data: { ...catalogData, loadingPriceOMagic: false },
            initialTab,
          }
        });
      }
      return;
    }

    // Fetch real data from API in background
    if (type === 'order') {
      try {
        const response = await fetch(`/api/orders/${id}`);
        if (response.ok) {
          const orderData = await response.json();
          setDetailModal({
            open: true,
            data: { type: 'order', data: orderData }
          });
        } else {
          console.error('Failed to fetch order:', response.statusText);
          // Fallback to generic mock data if API fails
          const orderNumber = String(id).replace(/^(ord-|ss-|bl-|bo-)/, '');
          setDetailModal({
            open: true,
            data: { 
              type: 'order', 
              data: {
                orderId: String(id),
                orderNumber: orderNumber,
                platform: 'ShipStation' as const,
                status: 'Paid' as const,
                customer: {
                  name: 'Customer',
                  email: 'customer@example.com',
                  address: '123 Main St',
                  city: 'City',
                  state: 'ST',
                  zip: '12345',
                  country: 'US',
                },
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
    } else if (type === 'inventory') {
      try {
        const response = await fetch(`/api/inventory/${id}`);
        if (response.ok) {
          const inventoryData = await response.json();
          
          // Update modal with inventory data immediately
          setDetailModal({
            open: true,
            data: { 
              type: 'inventory', 
              data: { ...inventoryData, loadingPriceOMagic: true },
              initialTab,
            }
          });
          
          // Fetch Price-o-Matic data in background
          const params = new URLSearchParams();
          if (inventoryData.colorId) {
            params.append('color_id', inventoryData.colorId.toString());
          }
          if (inventoryData.newOrUsed) {
            params.append('new_or_used', inventoryData.newOrUsed);
          }
          const priceGuideUrl = `/api/inventory/price-guide/${inventoryData.itemNo}/${inventoryData.itemType}${
            params.toString() ? `?${params.toString()}` : ''
          }`;
          
          const priceResponse = await fetch(priceGuideUrl);
          
          let priceOMagicData = null;
          if (priceResponse.ok) {
            priceOMagicData = await priceResponse.json();
          }
          
          const finalData = {
            ...inventoryData,
            priceOMagic: priceOMagicData,
            loadingPriceOMagic: false
          };
          
          setDetailModal({
            open: true,
            data: { 
              type: 'inventory', 
              data: finalData,
              initialTab,
            }
          });
        } else {
          console.error('Failed to fetch inventory:', response.statusText);
        }
      } catch (error) {
        console.error('Error fetching inventory:', error);
      }
    }
  };

  const renderPanelMode = () => (
    <div className="flex flex-col h-full" style={{ padding: '5px', gap: '5px' }}>

      {/* ── TOP ROW: Your Plan tile (left) + Ops Central (right) ── */}
      <div className="flex overflow-hidden" style={{ flex: '0 0 37%', gap: '5px' }}>

        {/* Your Plan — standalone tile, same width as one Ops Central lane */}
        <div className="flex flex-col rounded-lg overflow-hidden" style={{ flex: 1, border: '1px solid hsla(270,60%,55%,0.35)' }}>
          <div className="shrink-0 flex items-center px-3 py-1.5 border-b" style={{ background: 'linear-gradient(to right, hsla(270,60%,55%,0.25), hsla(270,60%,55%,0.08))', borderColor: 'hsla(270,60%,55%,0.35)' }}>
            <span className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: 'hsl(270,60%,75%)', textShadow: '0 0 8px hsla(270,60%,55%,0.7)' }}>Your Plan</span>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0" style={{ background: 'radial-gradient(ellipse at top, hsla(270,60%,55%,0.12) 0%, transparent 55%), linear-gradient(to bottom, hsla(270,60%,55%,0.15), hsla(270,60%,55%,0.03) 100%)' }}>
            <div className="p-2">
              <SystemPulse
                setupItems={systemPulseSetupItems}
                billingStatus={billingStatus}
                rateLimit={blRateLimit}
                blApiCallLimit={appSettingsHome?.blApiCallLimit}
                onOpenSettings={(section) => { setSettingsInitialSection(section); setSettingsOpen(true); }}
              />
            </div>
          </div>
        </div>

        {/* Ops Central — 3x the width of Your Plan (matches Product:right-group ratio below) */}
        <div className="flex flex-col min-w-0 rounded-lg overflow-hidden" style={{ flex: 3, border: '1px solid hsla(0,85%,55%,0.35)' }}>
          <div className="shrink-0 flex items-center px-3 py-1.5 border-b" style={{ background: 'linear-gradient(to right, hsla(0,85%,55%,0.25), hsla(0,85%,55%,0.08))', borderColor: 'hsla(0,85%,55%,0.35)' }}>
            <span className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: 'hsl(0,85%,72%)', textShadow: '0 0 8px hsla(0,85%,55%,0.7)' }}>Ops Central</span>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0" style={{ background: 'radial-gradient(ellipse at top, hsla(0,85%,55%,0.15) 0%, transparent 55%), linear-gradient(to bottom, hsla(0,85%,55%,0.18), hsla(0,85%,55%,0.04) 100%)' }}>
            <GeneralDashboard
              panelMode
              onItemClick={handleDashboardItemClick}
              onOpenFulfillment={() => setActiveOrdersDrawer('fulfillment')}
              onOpenBrickanalyzer={() => setActiveInventoryDrawer('brickanalyzer')}
              onOpenPriceomatic={() => setActiveInventoryDrawer('priceomatic')}
              onOpenSettings={(section) => { setSettingsInitialSection(section); setSettingsOpen(true); }}
            />
          </div>
        </div>

      </div>

      {/* ── BOTTOM: Product full-height left | date picker + 3 dashboards right ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden" style={{ gap: '5px' }}>

        {/* Product / Inventory — full height, top-flush */}
        <div className="flex flex-col rounded-md overflow-hidden" style={{ flex: 1, minWidth: '160px', border: '1px solid hsla(220,85%,55%,0.35)' }}>
          <div className="shrink-0 flex items-center px-3 py-1.5 border-b" style={{ background: 'linear-gradient(to right, hsla(220,85%,55%,0.28), hsla(220,85%,55%,0.08))', borderColor: 'hsla(220,85%,55%,0.35)' }}>
            <span className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: 'hsl(220,85%,75%)', textShadow: '0 0 8px hsla(220,85%,55%,0.7)' }}>Product</span>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0" style={{ background: 'radial-gradient(ellipse at top, hsla(220,85%,55%,0.15) 0%, transparent 55%), linear-gradient(to bottom, hsla(220,85%,55%,0.18), hsla(220,85%,55%,0.04) 100%)' }}>
            <InventoryDashboard
              panelMode
              onItemClick={handleDashboardItemClick}
              activeDrawer={activeInventoryDrawer}
              onDrawerChange={setActiveInventoryDrawer}
              onOpenSettings={(section) => { setSettingsInitialSection(section ?? null); setSettingsOpen(true); }}
            />
          </div>
        </div>

        {/* ─── GROUP: Date Picker + Orders · Marketing · Sales ─── */}
        <div className="flex flex-col min-h-0 rounded-lg overflow-hidden" style={{ flex: 3, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.02)' }}>

          {/* Date picker strip — centered above the 3 dashboards */}
          <div className="shrink-0 flex items-center justify-center py-2 border-b" style={{ background: 'linear-gradient(to right, rgba(255,255,255,0.06), rgba(255,255,255,0.02))', borderColor: 'rgba(255,255,255,0.08)' }}>
            <DateRangeSelector value={dateRange} onChange={setDateRange} />
          </div>

          {/* Orders · Marketing · Sales columns — fill remaining height */}
          <div className="flex flex-1 min-h-0 overflow-x-auto overflow-y-hidden" style={{ gap: '4px', padding: '4px' }}>

            {/* Orders */}
            <div className="flex flex-col rounded-md overflow-hidden" style={{ flex: 1, minWidth: '160px', border: '1px solid hsla(25,95%,55%,0.35)' }}>
              <div className="shrink-0 flex items-center px-3 py-1.5 border-b" style={{ background: 'linear-gradient(to right, hsla(25,95%,55%,0.25), hsla(25,95%,55%,0.08))', borderColor: 'hsla(25,95%,55%,0.35)' }}>
                <span className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: 'hsl(25,95%,72%)', textShadow: '0 0 8px hsla(25,95%,55%,0.7)' }}>Orders</span>
              </div>
              <div className="flex-1 overflow-y-auto min-h-0" style={{ background: 'radial-gradient(ellipse at top, hsla(25,95%,55%,0.15) 0%, transparent 55%), linear-gradient(to bottom, hsla(25,95%,55%,0.18), hsla(25,95%,55%,0.04) 100%)' }}>
                <OrdersDashboard
                  panelMode
                  dateRange={dateRange}
                  onItemClick={handleDashboardItemClick}
                  activeDrawer={activeOrdersDrawer}
                  onDrawerChange={setActiveOrdersDrawer}
                  onOpenSettings={(section) => { setSettingsInitialSection(section ?? null); setSettingsOpen(true); }}
                />
              </div>
            </div>

            {/* Marketing */}
            <div className="flex flex-col rounded-md overflow-hidden" style={{ flex: 1, minWidth: '160px', border: '1px solid hsla(48,95%,55%,0.35)' }}>
              <div className="shrink-0 flex items-center px-3 py-1.5 border-b" style={{ background: 'linear-gradient(to right, hsla(48,95%,55%,0.25), hsla(48,95%,55%,0.08))', borderColor: 'hsla(48,95%,55%,0.35)' }}>
                <span className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: 'hsl(48,95%,65%)', textShadow: '0 0 8px hsla(48,95%,55%,0.7)' }}>Marketing</span>
              </div>
              <div className="flex-1 overflow-y-auto min-h-0" style={{ background: 'radial-gradient(ellipse at top, hsla(48,95%,55%,0.15) 0%, transparent 55%), linear-gradient(to bottom, hsla(48,95%,55%,0.18), hsla(48,95%,55%,0.04) 100%)' }}>
                <MarketingDashboard
                  panelMode
                  dateRange={dateRange}
                  onItemClick={handleDashboardItemClick}
                  activeDrawer={activeMarketingDrawer}
                  onDrawerChange={setActiveMarketingDrawer}
                />
              </div>
            </div>

            {/* Sales */}
            <div className="flex flex-col rounded-md overflow-hidden" style={{ flex: 1, minWidth: '160px', border: '1px solid hsla(140,70%,50%,0.35)' }}>
              <div className="shrink-0 flex items-center px-3 py-1.5 border-b" style={{ background: 'linear-gradient(to right, hsla(140,70%,50%,0.25), hsla(140,70%,50%,0.08))', borderColor: 'hsla(140,70%,50%,0.35)' }}>
                <span className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: 'hsl(140,70%,65%)', textShadow: '0 0 8px hsla(140,70%,50%,0.7)' }}>Sales</span>
              </div>
              <div className="flex-1 overflow-y-auto min-h-0" style={{ background: 'radial-gradient(ellipse at top, hsla(140,70%,50%,0.15) 0%, transparent 55%), linear-gradient(to bottom, hsla(140,70%,50%,0.18), hsla(140,70%,50%,0.04) 100%)' }}>
                <SalesDashboard
                  panelMode
                  period={salesPeriod}
                  dateRange={dateRange}
                  onItemClick={handleDashboardItemClick}
                />
              </div>
            </div>

          </div>
        </div>

      </div>
    </div>
  );

  const renderDashboard = () => {
    switch (activeDashboard) {
      case 'inventory':
        return <InventoryDashboard onItemClick={handleDashboardItemClick} activeDrawer={activeInventoryDrawer} onDrawerChange={setActiveInventoryDrawer} onOpenSettings={(section) => { setSettingsInitialSection(section ?? null); setSettingsOpen(true); }} />;
      case 'orders':
        return <OrdersDashboard dateRange={dateRange} onItemClick={handleDashboardItemClick} activeDrawer={activeOrdersDrawer} onDrawerChange={setActiveOrdersDrawer} onOpenSettings={(section) => { setSettingsInitialSection(section ?? null); setSettingsOpen(true); }} />;
      case 'sales':
        return <SalesDashboard period={salesPeriod} dateRange={dateRange} onItemClick={handleDashboardItemClick} />;
      case 'marketing':
        return <MarketingDashboard dateRange={dateRange} onItemClick={handleDashboardItemClick} activeDrawer={activeMarketingDrawer} onDrawerChange={setActiveMarketingDrawer} />;
      default:
        return <GeneralDashboard onItemClick={handleDashboardItemClick} onOpenFulfillment={() => { setActiveDashboard('orders'); setActiveOrdersDrawer('fulfillment'); }} onOpenBrickanalyzer={() => { setActiveDashboard('inventory'); setActiveInventoryDrawer('brickanalyzer'); }} onOpenPriceomatic={() => { setActiveDashboard('inventory'); setActiveInventoryDrawer('priceomatic'); }} onOpenSettings={(section) => { setSettingsInitialSection(section); setSettingsOpen(true); }} />;
    }
  };

  const getChatContext = () => {
    switch (activeDashboard) {
      case 'inventory':
        return 'Product';
      case 'orders':
        return 'Orders';
      case 'sales':
        return 'Sales';
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
      case 'orders':
        return 'orange';
      case 'sales':
        return 'green';
      case 'marketing':
        return 'yellow';
      default:
        return 'red';
    }
  };


  const handlePromptAction = (prompt: string) => {
    if (activeDashboard === 'sales') {
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

  const handleElfieClick = async () => {
    // Start Elfie animation - fly down, pull drawer, then zigzag to upper-right
    setShowElfie(true);
    setElfieClosing(false);
    setElfieResting(false);
    
    // Open drawer immediately
    setChatOpen(true);
    
    // Fetch recent forum news (last 7 days, limit 5 posts)
    try {
      const response = await fetch('/api/forum/recent?days=7&limit=5');
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.count > 0) {
          setForumNews({
            count: data.count,
            posts: data.posts.map((post: any) => ({
              title: post.title,
              username: post.username,
              postedAt: post.postedAt,
              threadUrl: post.threadUrl,
            })),
          });
        } else {
          // Clear forum news if no recent posts
          setForumNews(null);
        }
      } else {
        // Clear forum news on failed fetch
        setForumNews(null);
      }
    } catch (error) {
      console.error('Error fetching forum news:', error);
      // Clear forum news on error
      setForumNews(null);
    }
  };

  const handleChatClose = () => {
    // Close drawer first
    setChatOpen(false);
    setElfieResting(false);
    
    // Clear forum news to avoid stale alerts on next open
    setForumNews(null);
    
    // Elfie is already visible, just trigger closing animation
    setElfieClosing(true);
    
    // Hide Elfie after retreat completes
    setTimeout(() => {
      setShowElfie(false);
      setElfieClosing(false);
    }, 500);
  };

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
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
        />
      </div>
      
      {/* Elfie Character Animation */}
      {showElfie && (
        <ElfieCharacter 
          isClosing={elfieClosing}
          isResting={elfieResting}
          isThinking={elfieThinking}
          onAnimationComplete={() => {
            if (!elfieClosing) {
              // Opening animation complete, keep Elfie in resting state
              setElfieResting(true);
            }
          }}
        />
      )}
      
      {/* Sticky Dashboard Nav — hidden in panel mode */}
      {!isPanelMode && (
        <div className="sticky top-14 md:top-20 lg:top-24 z-40 bg-gradient-to-r from-purple-950/40 via-blue-950/30 to-purple-950/40 backdrop-blur-sm">
          <DashboardNav active={activeDashboard} onSelect={setActiveDashboard} />
        </div>
      )}

      {/* Date Range Selector - Show for sales, marketing, and orders (tabbed mode only) */}
      {!isPanelMode && (activeDashboard === 'sales' || activeDashboard === 'marketing' || activeDashboard === 'orders') && (
        <div className="sticky top-24 md:top-[8.5rem] lg:top-40 z-30 px-3 md:px-8 lg:px-10 py-2 md:py-4 lg:py-5 bg-gradient-to-r from-pink-950/30 via-fuchsia-950/20 to-pink-950/30 border-b border-pink-800/30 backdrop-blur-sm">
          <DateRangeSelector value={dateRange} onChange={setDateRange} />
        </div>
      )}
      
      {/* Dashboard area — panel mode: all columns; tabbed mode: single active dashboard */}
      <div className={isPanelMode ? 'flex-1 overflow-hidden' : 'flex-1 overflow-y-auto'}>
        {isPanelMode ? renderPanelMode() : (
          <div className={`h-full ${
            activeDashboard === 'dashboard' ? 'bg-gradient-to-b from-lego-red/20 to-lego-red/5' :
            activeDashboard === 'inventory' ? 'bg-gradient-to-b from-lego-blue/20 to-lego-blue/5' :
            activeDashboard === 'orders' ? 'bg-gradient-to-b from-lego-orange/20 to-lego-orange/5' :
            activeDashboard === 'sales' ? 'bg-gradient-to-b from-lego-green/20 to-lego-green/5' :
            'bg-gradient-to-b from-lego-yellow/20 to-lego-yellow/5'
          }`}>
            {renderDashboard()}
          </div>
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
              onThinkingChange={setElfieThinking}
              forumNews={forumNews}
            />
          </div>
        </SheetContent>
      </Sheet>
      
      {/* Onboarding wizard — shown to org owners who haven't completed setup */}
      {!user?.isAdmin && user?.orgRole === 'owner' && org && !org.onboardingCompleted && (
        <OnboardingWizard
          org={org}
          onComplete={() => queryClient.invalidateQueries({ queryKey: ['/api/org'] })}
        />
      )}

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} initialSection={settingsInitialSection ?? undefined} />
      
      {/* Detail modal - positioned lower-left in landscape mode */}
      <div className={detailModal.open ? 'landscape:fixed landscape:bottom-4 landscape:left-4 landscape:w-[45%] landscape:max-h-[60vh]' : ''}>
        <DetailModal 
          open={detailModal.open} 
          onClose={() => setDetailModal({ open: false, data: null })} 
          detail={detailModal.data}
          onOrderSelect={handleOrderSelect}
          onBrickLinkClick={setBrickLinkUrl}
        />
      </div>

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
    </div>
  );
}
