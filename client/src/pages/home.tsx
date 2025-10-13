import { useState } from "react";
import Header from "@/components/Header";
import DashboardNav, { DashboardType } from "@/components/DashboardNav";
import SettingsModal from "@/components/SettingsModal";
import InventoryDashboard from "@/components/InventoryDashboard";
import SalesDashboard from "@/components/SalesDashboard";
import MarketingDashboard from "@/components/MarketingDashboard";
import GeneralDashboard from "@/components/GeneralDashboard";
import OrdersDashboard from "@/components/OrdersDashboard";
import PriceOMaticDashboard from "@/components/PriceOMaticDashboard";
import ChatInterface from "@/components/ChatInterface";
import DetailModal, { DetailData } from "@/components/DetailModal";
import DateRangeSelector, { DateRangeValue } from "@/components/DateRangeSelector";

export default function Home() {
  const [activeDashboard, setActiveDashboard] = useState<DashboardType>('dashboard');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [salesPeriod, setSalesPeriod] = useState<'mtd' | 'ytd' | '1y' | '5y'>('ytd');
  const [dateRange, setDateRange] = useState<DateRangeValue>('mtd');
  const [chatMinimized, setChatMinimized] = useState(true);
  const [detailModal, setDetailModal] = useState<{ open: boolean; data: DetailData | null }>({
    open: false,
    data: null,
  });

  const handleDashboardItemClick = async (type: 'order' | 'inventory', id: number | string) => {
    // Check if this is a BrickLink catalog item
    const isBrickLinkCatalog = String(id).startsWith('bricklink-');
    
    // Open modal immediately with loading state
    setDetailModal({
      open: true,
      data: { type, data: { id, loading: true } as any }
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
            data: { ...catalogData, loadingPriceOMagic: false }
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
              data: { ...inventoryData, loadingPriceOMagic: true }
            }
          });
          
          // Fetch Price-o-Matic data in background
          const priceGuideUrl = `/api/inventory/price-guide/${inventoryData.itemNo}/${inventoryData.itemType}${
            inventoryData.colorId ? `?color_id=${inventoryData.colorId}` : ''
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
              data: finalData
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
        return <InventoryDashboard onItemClick={handleDashboardItemClick} />;
      case 'orders':
        return <OrdersDashboard dateRange={dateRange} onItemClick={handleDashboardItemClick} />;
      case 'sales':
        return <SalesDashboard period={salesPeriod} dateRange={dateRange} onItemClick={handleDashboardItemClick} />;
      case 'marketing':
        return <MarketingDashboard dateRange={dateRange} onItemClick={handleDashboardItemClick} />;
      case 'priceomatic':
        return <PriceOMaticDashboard onItemClick={handleDashboardItemClick} />;
      default:
        return <GeneralDashboard onItemClick={handleDashboardItemClick} />;
    }
  };

  const getChatContext = () => {
    switch (activeDashboard) {
      case 'inventory':
        return 'Inventory';
      case 'orders':
        return 'Orders';
      case 'sales':
        return 'Sales';
      case 'marketing':
        return 'Marketing';
      case 'priceomatic':
        return 'Price-o-Matic';
      default:
        return 'Business';
    }
  };

  const getThemeColor = (): 'red' | 'blue' | 'yellow' | 'green' | 'orange' | 'purple' => {
    switch (activeDashboard) {
      case 'inventory':
        return 'blue';
      case 'orders':
        return 'orange';
      case 'sales':
        return 'green';
      case 'marketing':
        return 'yellow';
      case 'priceomatic':
        return 'purple';
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

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <Header onSettingsClick={() => setSettingsOpen(true)} />
      <DashboardNav active={activeDashboard} onSelect={setActiveDashboard} />
      
      {/* Date Range Selector - Only show for orders, sales, and marketing */}
      {(activeDashboard === 'orders' || activeDashboard === 'sales' || activeDashboard === 'marketing') && (
        <div className="px-4 py-2 border-b border-gray-800">
          <DateRangeSelector value={dateRange} onChange={setDateRange} />
        </div>
      )}
      
      {/* Simple single-column layout for all devices */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className={`transition-all duration-300 overflow-y-auto border-b-2 ${
          chatMinimized ? 'flex-1' : 'h-0'
        } ${
          activeDashboard === 'dashboard' ? 'bg-gradient-to-b from-lego-red/20 to-lego-red/5 border-lego-red/30' :
          activeDashboard === 'inventory' ? 'bg-gradient-to-b from-lego-blue/20 to-lego-blue/5 border-lego-blue/30' :
          activeDashboard === 'orders' ? 'bg-gradient-to-b from-lego-orange/20 to-lego-orange/5 border-lego-orange/30' :
          activeDashboard === 'sales' ? 'bg-gradient-to-b from-lego-green/20 to-lego-green/5 border-lego-green/30' :
          activeDashboard === 'priceomatic' ? 'bg-gradient-to-b from-purple-500/20 to-purple-500/5 border-purple-500/30' :
          'bg-gradient-to-b from-lego-yellow/20 to-lego-yellow/5 border-lego-yellow/30'
        }`}>
          {renderDashboard()}
        </div>
        
        {!chatMinimized && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <ChatInterface 
              dashboardContext={getChatContext()} 
              themeColor={getThemeColor()} 
              prompts={[]} 
              onPromptAction={handlePromptAction}
              onItemClick={handleItemClick}
              isMinimized={chatMinimized}
              onToggleMinimize={() => setChatMinimized(!chatMinimized)}
            />
          </div>
        )}
      </div>
      
      {/* Fixed position chat when minimized - outside overflow container */}
      {chatMinimized && (
        <div 
          className="fixed left-0 right-0 bottom-0 z-50"
          style={{ 
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          }}
        >
          <ChatInterface 
            dashboardContext={getChatContext()} 
            themeColor={getThemeColor()} 
            prompts={[]} 
            onPromptAction={handlePromptAction}
            onItemClick={handleItemClick}
            isMinimized={chatMinimized}
            onToggleMinimize={() => setChatMinimized(!chatMinimized)}
          />
        </div>
      )}
      
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      
      {/* Detail modal - positioned lower-left in landscape mode */}
      <div className={detailModal.open ? 'landscape:fixed landscape:bottom-4 landscape:left-4 landscape:w-[45%] landscape:max-h-[60vh]' : ''}>
        <DetailModal 
          open={detailModal.open} 
          onClose={() => setDetailModal({ open: false, data: null })} 
          detail={detailModal.data}
          onOrderSelect={handleOrderSelect}
        />
      </div>
    </div>
  );
}
