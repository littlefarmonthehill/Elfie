import { useState, useEffect, useRef } from "react";
import { Package, ClipboardList, RefreshCw, ExternalLink, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAdminScaling } from "@/hooks/useAdminScaling";
import Header from "@/components/Header";
import DashboardNav, { DashboardType } from "@/components/DashboardNav";
import SettingsModal from "@/components/SettingsModal";
import InventoryDashboard from "@/components/InventoryDashboard";
import SalesDashboard from "@/components/SalesDashboard";
import MarketingDashboard from "@/components/MarketingDashboard";
import GeneralDashboard from "@/components/GeneralDashboard";
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
  const [activeDashboard, setActiveDashboard] = useState<DashboardType>('dashboard');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<'general' | 'platforms' | 'ai' | 'automation' | 'priceomatic' | 'data' | 'users'>('general');
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
  const [detailModal, setDetailModal] = useState<{ open: boolean; data: DetailData | null }>({
    open: false,
    data: null,
  });
  const [brickLinkUrl, setBrickLinkUrl] = useState<string | null>(null);

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
        console.log('🔗 Retrieved BrickLink catalog item from storage:', bricklinkItem);
        
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

  const renderDashboard = () => {
    switch (activeDashboard) {
      case 'inventory':
        return <InventoryDashboard onItemClick={handleDashboardItemClick} activeDrawer={activeInventoryDrawer} onDrawerChange={setActiveInventoryDrawer} onOpenSettings={(section) => { setSettingsInitialSection(section ?? 'listomatc'); setSettingsOpen(true); }} />;
      case 'orders':
        return <OrdersDashboard onItemClick={handleDashboardItemClick} activeDrawer={activeOrdersDrawer} onDrawerChange={setActiveOrdersDrawer} />;
      case 'sales':
        return <SalesDashboard period={salesPeriod} dateRange={dateRange} onItemClick={handleDashboardItemClick} />;
      case 'marketing':
        return <MarketingDashboard dateRange={dateRange} onItemClick={handleDashboardItemClick} />;
      default:
        return <GeneralDashboard onItemClick={handleDashboardItemClick} onOpenFulfillment={() => { setActiveDashboard('orders'); setActiveOrdersDrawer('fulfillment'); }} onOpenBrickanalyzer={() => { setActiveDashboard('inventory'); setActiveInventoryDrawer('brickanalyzer'); }} />;
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
      
      {/* Sticky Dashboard Nav with soft gradient background */}
      <div className="sticky top-14 md:top-20 lg:top-24 z-40 bg-gradient-to-r from-purple-950/40 via-blue-950/30 to-purple-950/40 backdrop-blur-sm">
        <DashboardNav active={activeDashboard} onSelect={setActiveDashboard} />
      </div>
      

      {/* Tools Selector - Only show for inventory */}
      {activeDashboard === 'inventory' && (
        <div className="sticky top-24 md:top-[8.5rem] lg:top-40 z-30 px-3 md:px-8 lg:px-10 py-2 md:py-4 lg:py-5 bg-gradient-to-r from-cyan-950/30 via-teal-950/20 to-cyan-950/30 border-b border-cyan-800/30 backdrop-blur-sm">
          <div className="flex items-center gap-1 md:gap-3 lg:gap-4">
            <button
              onClick={() => setActiveInventoryDrawer('priceomatic')}
              className="text-[10px] md:text-base lg:text-lg font-bold py-1 md:py-2 lg:py-2.5 px-1.5 md:px-4 lg:px-5 rounded transition-all bg-gray-900 text-gray-400 border border-gray-700 hover-elevate"
              data-testid="button-priceomatic"
            >
              Price-O-Matic
            </button>
            <button
              onClick={() => setActiveInventoryDrawer('platformsync')}
              className="text-[10px] md:text-base lg:text-lg font-bold py-1 md:py-2 lg:py-2.5 px-1.5 md:px-4 lg:px-5 rounded transition-all bg-gray-900 text-gray-400 border border-gray-700 hover-elevate"
              data-testid="button-platformsync"
            >
              List O Matic
            </button>
            <button
              onClick={() => setActiveInventoryDrawer('warehouse')}
              className="text-[10px] md:text-base lg:text-lg font-bold py-1 md:py-2 lg:py-2.5 px-1.5 md:px-4 lg:px-5 rounded transition-all bg-gray-900 text-gray-400 border border-gray-700 hover-elevate"
              data-testid="button-warehouse"
            >
              Warehouse
            </button>
            <button
              onClick={() => setActiveInventoryDrawer('brickanalyzer')}
              className="text-[10px] md:text-base lg:text-lg font-bold py-1 md:py-2 lg:py-2.5 px-1.5 md:px-4 lg:px-5 rounded transition-all bg-gray-900 text-gray-400 border border-gray-700 hover-elevate"
              data-testid="button-brickanalyzer"
            >
              Brick Spotter 3000
            </button>
          </div>
        </div>
      )}

      {/* Tools Selector - Only show for orders */}
      {activeDashboard === 'orders' && (
        <div className="sticky top-24 md:top-[8.5rem] lg:top-40 z-30 px-3 md:px-8 lg:px-10 py-2 md:py-4 lg:py-5 bg-gradient-to-r from-orange-950/30 via-amber-950/20 to-orange-950/30 border-b border-orange-800/30 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-1.5 md:gap-4 lg:gap-5">
            <div className="flex items-center gap-1.5 md:gap-4 lg:gap-5">
              <div className="flex gap-1 md:gap-3 lg:gap-4">
                <button
                  onClick={() => setActiveOrdersDrawer('fulfillment')}
                  className="relative text-[10px] md:text-base lg:text-lg font-bold py-1 md:py-2 lg:py-2.5 px-1.5 md:px-4 lg:px-5 rounded transition-all bg-gray-900 text-gray-400 border border-gray-700 hover-elevate"
                  data-testid="button-fulfillment"
                >
                  Fulfillment and Shipping
                  {fulfillmentStats && fulfillmentStats.unfulfilled > 0 && (
                    <span className="absolute -top-1 -right-1 md:-top-2 md:-right-2 bg-green-500 text-white text-[9px] md:text-xs lg:text-sm font-bold rounded-full h-4 w-4 md:h-6 md:w-6 lg:h-7 lg:w-7 flex items-center justify-center">
                      {fulfillmentStats.unfulfilled}
                    </span>
                  )}
                  {picklistStats && picklistStats.toPull > 0 && (
                    <span className="absolute -top-1 -left-1 md:-top-2 md:-left-2 bg-orange-500 text-white text-[9px] md:text-xs lg:text-sm font-bold rounded-full h-4 w-4 md:h-6 md:w-6 lg:h-7 lg:w-7 flex items-center justify-center">
                      {picklistStats.toPull}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setActiveOrdersDrawer('shipped')}
                  className="text-[10px] md:text-base lg:text-lg font-bold py-1 md:py-2 lg:py-2.5 px-1.5 md:px-4 lg:px-5 rounded transition-all bg-gray-900 text-gray-400 border border-gray-700 hover-elevate"
                  data-testid="button-shipped"
                >
                  Shipped
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Date Range Selector - Only show for sales and marketing */}
      {(activeDashboard === 'sales' || activeDashboard === 'marketing') && (
        <div className="sticky top-24 md:top-[8.5rem] lg:top-40 z-30 px-3 md:px-8 lg:px-10 py-2 md:py-4 lg:py-5 bg-gradient-to-r from-pink-950/30 via-fuchsia-950/20 to-pink-950/30 border-b border-pink-800/30 backdrop-blur-sm">
          <DateRangeSelector value={dateRange} onChange={setDateRange} />
        </div>
      )}
      
      {/* Dashboard - Full height now that chat is in drawer */}
      <div className="flex-1 overflow-y-auto">
        <div className={`h-full ${
          activeDashboard === 'dashboard' ? 'bg-gradient-to-b from-lego-red/20 to-lego-red/5' :
          activeDashboard === 'inventory' ? 'bg-gradient-to-b from-lego-blue/20 to-lego-blue/5' :
          activeDashboard === 'orders' ? 'bg-gradient-to-b from-lego-orange/20 to-lego-orange/5' :
          activeDashboard === 'sales' ? 'bg-gradient-to-b from-lego-green/20 to-lego-green/5' :
          'bg-gradient-to-b from-lego-yellow/20 to-lego-yellow/5'
        }`}>
          {renderDashboard()}
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
              onThinkingChange={setElfieThinking}
              forumNews={forumNews}
            />
          </div>
        </SheetContent>
      </Sheet>
      
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} initialSection={settingsInitialSection} />
      
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
        <DialogContent className="max-w-4xl h-[80vh] p-0" aria-describedby="bricklink-description">
          <DialogHeader className="p-4 border-b">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-base flex items-center gap-2">
                <ExternalLink className="h-4 w-4" />
                BrickLink
              </DialogTitle>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setBrickLinkUrl(null)}
                data-testid="button-close-bricklink"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <p id="bricklink-description" className="sr-only">
              BrickLink catalog page displaying item information
            </p>
          </DialogHeader>
          {brickLinkUrl && (
            <iframe
              src={brickLinkUrl}
              className="w-full h-full"
              title="BrickLink"
              sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
              data-testid="iframe-bricklink"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
