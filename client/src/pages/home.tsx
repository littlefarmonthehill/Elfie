import { useState, useEffect, useRef } from "react";
import { Package, ClipboardList, RefreshCw, ExternalLink, X, EyeOff, LogOut, ArrowLeft, RotateCw, AlertCircle, Mail, Sparkles, ListChecks, ScanSearch, Truck, PackageCheck, SlidersHorizontal, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAdminScaling } from "@/hooks/useAdminScaling";
import { useAuth } from "@/hooks/useAuth";
import OnboardingWizard from "@/components/OnboardingWizard";
import EmployeeWelcome, { hasCompletedEmployeeWelcome } from "@/components/EmployeeWelcome";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Organization } from "@shared/schema";
import Header from "@/components/Header";
import DashboardNav, { DashboardType } from "@/components/DashboardNav";
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
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1024);
  const [activeDashboard, setActiveDashboard] = useState<DashboardType>(() =>
    typeof window !== 'undefined' && window.innerWidth >= 1024 ? 'inventory' : 'dashboard'
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [employeeWelcomeDone, setEmployeeWelcomeDone] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<'general' | 'platforms' | 'ai' | 'automation' | 'data' | 'users' | 'priceomatic' | null>(null);
  const [settingsPricingExample, setSettingsPricingExample] = useState<PricingInsight | undefined>(undefined);
  const [settingsScoringExample, setSettingsScoringExample] = useState<PricingInsight | undefined>(undefined);
  const [salesPeriod, setSalesPeriod] = useState<'mtd' | 'ytd' | '1y' | '5y'>('ytd');
  const [dateRange, setDateRange] = useState<DateRangeValue>('mtd');
  const [chatOpen, setChatOpen] = useState(false);
  const [supportNotification, setSupportNotification] = useState(false);
  const [navHidden, setNavHidden] = useState(false);
  useEffect(() => {
    const check = () => {
      const nowDesktop = window.innerWidth >= 1024;
      setIsDesktop(nowDesktop);
      if (nowDesktop && activeDashboard === 'dashboard') {
        setActiveDashboard('inventory');
      }
    };
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [activeDashboard]);

  const [marketIntel, setMarketIntel] = useState<{
    forum: { count: number; posts: Array<{ title: string; excerpt: string; username: string; postedAt: string; threadUrl: string }> };
    news: { count: number; articles: Array<{ title: string; snippet: string; url: string; source: string; query: string; fetchedAt: string }> };
  } | null>(null);
  const [activeInventoryDrawer, setActiveInventoryDrawer] = useState<'priceomatic' | 'platformsync' | 'brickanalyzer' | null>(null);
  const [activeOrdersDrawer, setActiveOrdersDrawer] = useState<'fulfillment' | 'shipped' | null>(null);
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


  // Calculate total discrepancies across all platforms
  const totalDiscrepancies = syncStatus?.targets?.reduce((total: number, platform: any) => {
    return total + 
      (platform.discrepancies?.missingLots || 0) +
      (platform.discrepancies?.priceDifferences || 0) +
      (platform.discrepancies?.quantityDifferences || 0);
  }, 0) || 0;

  const handleDashboardItemClick = async (type: 'order' | 'inventory', id: number | string, initialTab?: string): Promise<boolean> => {
    // Check if this is a BrickLink catalog item (used by Brickspotter heatmap badges)
    const isBrickLinkCatalog = String(id).startsWith('bricklink-');

    // Handle BrickLink catalog items (used by Brickspotter heatmap badges)
    // Strategy: try real inventory first (full drawer), fall back to scan-data catalog view
    if (isBrickLinkCatalog && type === 'inventory') {
      const raw = String(id).replace('bricklink-', '');
      const colorMatch = raw.match(/__c(\d+)$/);
      const itemNo = colorMatch ? raw.slice(0, raw.length - colorMatch[0].length) : raw;
      const colorId = colorMatch ? colorMatch[1] : null;

      // 1. Try inventory search with exact color first
      try {
        if (colorId) {
          const searchParams = new URLSearchParams({ itemNo, colorId, limit: '50' });
          const searchRes = await fetch(`/api/inventory/search?${searchParams}`);
          if (searchRes.ok) {
            const lots = await searchRes.json();
            if (Array.isArray(lots) && lots.length > 0) {
              return handleDashboardItemClick('inventory', lots[0].id, initialTab);
            }
          }
        }
        // 2. Try part-only fallback (color mismatch / minifigs / stickers)
        const fallbackParams = new URLSearchParams({ itemNo, limit: '50' });
        const fallbackRes = await fetch(`/api/inventory/search?${fallbackParams}`);
        if (fallbackRes.ok) {
          const lots = await fallbackRes.json();
          if (Array.isArray(lots) && lots.length > 0) {
            return handleDashboardItemClick('inventory', lots[0].id, initialTab);
          }
        }
      } catch { /* ignore, fall through to catalog view */ }

      // 3. Not in inventory — fetch real BrickLink catalog data + price guide from server
      //    (uses 6-month price_guide_cache so BL API calls are rare after first hit)
      const itemType = sessionStorage.getItem(`bl-itemtype-${itemNo}`) ?? 'PART';

      // Show loading state immediately so the drawer opens without delay
      setDetailModal({
        open: true,
        data: { type: 'inventory', data: { id: String(id), loading: true } as any, initialTab }
      });

      try {
        const params = new URLSearchParams({ ...(colorId ? { colorId } : {}) });
        const catalogRes = await fetch(`/api/catalog/lookup/${encodeURIComponent(itemType)}/${encodeURIComponent(itemNo)}?${params}`);
        if (catalogRes.ok) {
          const catalogData = await catalogRes.json();
          setDetailModal({
            open: true,
            data: { type: 'inventory', data: { ...catalogData, loadingPriceOMagic: false }, initialTab }
          });
          return true;
        }
      } catch { /* fall through */ }

      // Server fetch failed — close modal
      setDetailModal({ open: false, data: null });
      return false;
    }

    // Open modal immediately with loading state for real inventory/order IDs
    setDetailModal({
      open: true,
      data: { type, data: { id, loading: true } as any, initialTab }
    });

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
    return true;
  };

  const renderDynamicDashboard = () => {
    switch (activeDashboard) {
      case 'inventory':
        return <InventoryDashboard onItemClick={handleDashboardItemClick} activeDrawer={activeInventoryDrawer} onDrawerChange={setActiveInventoryDrawer} onOpenSettings={(section) => { setSettingsInitialSection(section ?? null); setSettingsOpen(true); }} />;
      case 'orders':
        return <OrdersDashboard dateRange={dateRange} onItemClick={handleDashboardItemClick} activeDrawer={activeOrdersDrawer} onDrawerChange={setActiveOrdersDrawer} onOpenSettings={(section) => { setSettingsInitialSection(section ?? null); setSettingsOpen(true); }} />;
      case 'sales':
        return <SalesDashboard period={salesPeriod} dateRange={dateRange} onItemClick={handleDashboardItemClick} activeDrawer={activeSalesDrawer} onDrawerChange={setActiveSalesDrawer} />;
      case 'marketing':
        return <MarketingDashboard dateRange={dateRange} onItemClick={handleDashboardItemClick} activeDrawer={activeMarketingDrawer} onDrawerChange={setActiveMarketingDrawer} />;
      default:
        return <InventoryDashboard onItemClick={handleDashboardItemClick} activeDrawer={activeInventoryDrawer} onDrawerChange={setActiveInventoryDrawer} onOpenSettings={(section) => { setSettingsInitialSection(section ?? null); setSettingsOpen(true); }} />;
    }
  };

  const renderMobileDashboard = () => {
    if (activeDashboard === 'dashboard') {
      return <GeneralDashboard onItemClick={handleDashboardItemClick} onOpenFulfillment={() => { setActiveDashboard('orders'); setActiveOrdersDrawer('fulfillment'); }} onOpenBrickanalyzer={() => { setActiveDashboard('inventory'); setActiveInventoryDrawer('brickanalyzer'); }} onOpenPriceomatic={() => { setActiveDashboard('inventory'); setActiveInventoryDrawer('priceomatic'); }} onOpenBilling={() => setBillingOpen(true)} onOpenSettings={(section) => { setSettingsInitialSection(section); setSettingsOpen(true); }} onNavigate={(tab) => setActiveDashboard(tab as DashboardType)} />;
    }
    return renderDynamicDashboard();
  };

  const closeActiveDrawer = () => {
    setActiveInventoryDrawer(null);
    setActiveOrdersDrawer(null);
    setActiveMarketingDrawer(null);
    setActiveSalesDrawer(null);
    setBillingOpen(false);
  };

  const openSettings = (section?: string, pricingExample?: PricingInsight, scoringExample?: PricingInsight) => {
    setSettingsInitialSection(section as any);
    setSettingsPricingExample(pricingExample);
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
        <ToolDrawer icon={ScanSearch} iconColor="text-lego-yellow" title="Brick Spotter 3000" onClose={closeActiveDrawer}>
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
          <FulfillmentTool />
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
      case 'orders':
        return 'Orders';
      case 'sales':
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
        />
      </div>
      
      
      {/* Dashboard area */}
      <div className="flex-1 overflow-hidden bg-[#04080F]">
        {/* MOBILE layout (< lg): single column, same as before */}
        <div className="lg:hidden h-full overflow-y-auto">
          <div className={cn("h-full p-2 md:p-4 transition-[padding] duration-300", !navHidden && "pb-20 md:pb-24")}>
            <div className={`h-full rounded-lg border overflow-hidden ${
              activeDashboard === 'dashboard' ? 'border-lego-red/30 bg-gradient-to-br from-lego-red/15 via-gray-950/80 to-lego-red/5' :
              activeDashboard === 'inventory' ? 'border-lego-blue/30 bg-gradient-to-br from-lego-blue/15 via-gray-950/80 to-lego-blue/5' :
              activeDashboard === 'orders' ? 'border-lego-orange/30 bg-gradient-to-br from-lego-orange/15 via-gray-950/80 to-lego-orange/5' :
              activeDashboard === 'sales' ? 'border-lego-green/30 bg-gradient-to-br from-lego-green/15 via-gray-950/80 to-lego-green/5' :
              'border-lego-yellow/30 bg-gradient-to-br from-lego-yellow/15 via-gray-950/80 to-lego-yellow/5'
            }`}>
              <div className="h-full overflow-y-auto">
                {renderMobileDashboard()}
              </div>
            </div>
          </div>
        </div>

        {/* DESKTOP layout (lg+): Your Plan (left) | Dynamic Board (center 2x) | Ops Central (right) */}
        <div className="hidden lg:flex h-full p-4 gap-4">
          <div className="flex h-full w-full rounded-2xl border border-white/8 bg-gradient-to-br from-gray-900/60 via-gray-950/80 to-gray-900/60 shadow-[0_0_40px_rgba(0,0,0,0.5)] overflow-hidden">
            {/* Left column — Your Plan */}
            <div className="w-[345px] xl:w-[400px] flex-shrink-0 h-full overflow-y-auto border-r border-white/5">
              <GeneralDashboard
                onItemClick={handleDashboardItemClick}
                onOpenFulfillment={() => { setActiveDashboard('orders'); setActiveOrdersDrawer('fulfillment'); }}
                onOpenBrickanalyzer={() => { setActiveDashboard('inventory'); setActiveInventoryDrawer('brickanalyzer'); }}
                onOpenPriceomatic={() => { setActiveDashboard('inventory'); setActiveInventoryDrawer('priceomatic'); }}
                onOpenBilling={() => setBillingOpen(true)}
                onOpenSettings={(section) => { setSettingsInitialSection(section); setSettingsOpen(true); }}
                onNavigate={(tab) => setActiveDashboard(tab as DashboardType)}
                section="plan"
              />
            </div>

            {/* Center column — dynamic dashboard with drawer overlay */}
            <div className="flex-1 h-full relative min-w-0 flex flex-col">
              <div className="flex-1 overflow-hidden min-h-0">
                <div className={`h-full overflow-y-auto ${
                  activeDashboard === 'inventory' ? 'bg-gradient-to-br from-lego-blue/10 via-transparent to-lego-blue/5' :
                  activeDashboard === 'orders' ? 'bg-gradient-to-br from-lego-orange/10 via-transparent to-lego-orange/5' :
                  activeDashboard === 'sales' ? 'bg-gradient-to-br from-lego-green/10 via-transparent to-lego-green/5' :
                  'bg-gradient-to-br from-lego-yellow/10 via-transparent to-lego-yellow/5'
                }`}>
                  <div style={{ transformOrigin: 'top left', transform: 'scale(0.88)', width: '113.6%' }}>
                    {renderDynamicDashboard()}
                  </div>
                </div>
              </div>

              {/* Drawer overlay — covers entire dynamic board */}
              {(activeInventoryDrawer || activeOrdersDrawer || activeMarketingDrawer || activeSalesDrawer || billingOpen || detailModal.open) && (
                <div className="absolute inset-0 z-20 flex flex-col">
                  <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-[fadeIn_200ms_ease-out]" onClick={() => { closeActiveDrawer(); setDetailModal({ open: false, data: null }); }} />
                  <div className="relative flex-1 bg-gray-950/95 border border-white/10 rounded-lg m-3 overflow-y-auto shadow-2xl animate-[slideUp_250ms_ease-out]">
                    {detailModal.open ? (
                      <DetailModal
                        open={detailModal.open}
                        onClose={() => setDetailModal({ open: false, data: null })}
                        detail={detailModal.data}
                        onOrderSelect={handleOrderSelect}
                        onBrickLinkClick={setBrickLinkUrl}
                        onOpenSettings={(section) => { setDetailModal({ open: false, data: null }); openSettings(section); }}
                        inline
                      />
                    ) : renderActiveDrawer()}
                  </div>
                </div>
              )}
            </div>

            {/* Right column — Ops Central cards */}
            <div className="w-[400px] xl:w-[450px] flex-shrink-0 h-full overflow-y-auto border-l border-white/5 p-3">
              <GeneralDashboard
                onItemClick={handleDashboardItemClick}
                onOpenFulfillment={() => { setActiveDashboard('orders'); setActiveOrdersDrawer('fulfillment'); }}
                onOpenBrickanalyzer={() => { setActiveDashboard('inventory'); setActiveInventoryDrawer('brickanalyzer'); }}
                onOpenPriceomatic={() => { setActiveDashboard('inventory'); setActiveInventoryDrawer('priceomatic'); }}
                onOpenBilling={() => setBillingOpen(true)}
                onOpenSettings={(section) => { setSettingsInitialSection(section); setSettingsOpen(true); }}
                onNavigate={(tab) => setActiveDashboard(tab as DashboardType)}
                section="ops"
              />
            </div>
          </div>
        </div>
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
      
      {!user?.isAdmin && user?.orgRole === 'owner' && org && !org.onboardingCompleted && (
        <OnboardingWizard
          org={org}
          onComplete={() => queryClient.invalidateQueries({ queryKey: ['/api/org'] })}
        />
      )}

      {user && user.orgRole !== 'owner' && !user.isAdmin && org && !employeeWelcomeDone && !hasCompletedEmployeeWelcome(user.id) && (
        <EmployeeWelcome
          user={user}
          orgName={org.name}
          onComplete={() => setEmployeeWelcomeDone(true)}
        />
      )}

      <SettingsModal open={settingsOpen} onClose={() => { setSettingsOpen(false); setSettingsPricingExample(undefined); setSettingsScoringExample(undefined); }} initialSection={settingsInitialSection ?? undefined} pricingExample={settingsPricingExample} scoringExample={settingsScoringExample} />
      
      {/* Detail modal — Vaul drawer on mobile only; desktop uses inline overlay in center column */}
      {!isDesktop && (
        <DetailModal 
          open={detailModal.open} 
          onClose={() => setDetailModal({ open: false, data: null })} 
          detail={detailModal.data}
          onOrderSelect={handleOrderSelect}
          onBrickLinkClick={setBrickLinkUrl}
          onOpenSettings={(section) => { setDetailModal({ open: false, data: null }); openSettings(section); }}
        />
      )}

      {/* Tool drawers — Vaul drawer on mobile only; desktop uses inline overlay in center column */}
      {!isDesktop && (
        <Drawer open={!!(activeInventoryDrawer || activeOrdersDrawer || activeMarketingDrawer || activeSalesDrawer)} onOpenChange={(open) => { if (!open) closeActiveDrawer(); }}>
          <DrawerContent className="bg-gray-950 border-gray-800 h-[92vh] flex flex-col rounded-t-2xl">
            <DrawerHeader className="p-0 flex-shrink-0">
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 rounded-full bg-gray-600" />
              </div>
              <div className="flex items-center gap-2 px-4 pt-2 pb-2 border-b border-gray-800">
                <DrawerTitle className="flex items-center gap-2 text-sm font-semibold text-gray-100 flex-1">
                  {activeInventoryDrawer === 'priceomatic' && <><Sparkles className="w-4 h-4 text-purple-400 flex-shrink-0" /> Price-o-Matic</>}
                  {activeInventoryDrawer === 'platformsync' && <><ListChecks className="w-4 h-4 text-green-400 flex-shrink-0" /> List-o-Matic</>}
                  {activeInventoryDrawer === 'brickanalyzer' && <><ScanSearch className="w-4 h-4 text-lego-yellow flex-shrink-0" /> Brick Spotter 3000</>}
                  {activeOrdersDrawer === 'fulfillment' && <><Truck className="w-4 h-4 text-orange-400 flex-shrink-0" /> Fulfillment & Shipping</>}
                  {activeOrdersDrawer === 'shipped' && <><PackageCheck className="w-4 h-4 text-green-400 flex-shrink-0" /> Shipped Orders</>}
                  {activeMarketingDrawer && <><Mail className="w-4 h-4 text-yellow-400 flex-shrink-0" /> Marketing</>}
                  {activeSalesDrawer && <><Package className="w-4 h-4 text-green-400 flex-shrink-0" /> Insights</>}
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
              {activeOrdersDrawer === 'fulfillment' && <FulfillmentTool />}
              {activeOrdersDrawer === 'shipped' && <ShippedOrdersTool onItemClick={(type, id) => { closeActiveDrawer(); handleDashboardItemClick(type, id); }} />}
              {activeMarketingDrawer && <MarketingDashboard dateRange={dateRange} onItemClick={handleDashboardItemClick} activeDrawer={activeMarketingDrawer} onDrawerChange={setActiveMarketingDrawer} renderDrawerOnly />}
              {activeSalesDrawer && <SalesDashboard period={salesPeriod} dateRange={dateRange} onItemClick={handleDashboardItemClick} activeDrawer={activeSalesDrawer} onDrawerChange={setActiveSalesDrawer} renderDrawerOnly />}
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

      {/* Bottom Nav — mobile/tablet only */}
      <div className="lg:hidden">
        <DashboardNav
          active={activeDashboard}
          onSelect={(d) => { closeActiveDrawer(); setActiveDashboard(d); }}
          hideOpsCentral={isDesktop}
          onHiddenChange={setNavHidden}
        />
      </div>
    </div>
  );
}
