import { useState } from "react";
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

export default function Home() {
  const [activeDashboard, setActiveDashboard] = useState<DashboardType>('dashboard');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [salesPeriod, setSalesPeriod] = useState<'mtd' | 'ytd' | '1y' | '5y'>('ytd');
  const [chatExpanded, setChatExpanded] = useState(false);
  const [detailModal, setDetailModal] = useState<{ open: boolean; data: DetailData | null }>({
    open: false,
    data: null,
  });

  const handleInventoryItemClick = (item: any) => {
    // Map database fields to InventoryDetail expected format
    setDetailModal({
      open: true,
      data: {
        type: 'inventory',
        data: {
          partNumber: item.itemNo,
          name: `${item.itemType} - ${item.itemNo}`,
          category: item.categoryName || 'Unknown',
          color: item.colorName || 'Unknown',
          quantity: item.quantity,
          condition: item.newOrUsed === 'N' ? 'New' : 'Used',
          costPerUnit: 0, // Not available in current schema
          pricePerUnit: parseFloat(item.unitPrice || '0'),
          weight: 0, // Not available in current schema
          dateAdded: new Date(item.updatedAt).toISOString(),
          bricklinkUrl: `https://www.bricklink.com/v2/catalog/catalogitem.page?P=${item.itemNo}`,
        },
      },
    });
  };

  const renderDashboard = () => {
    switch (activeDashboard) {
      case 'inventory':
        return <InventoryDashboard onItemClick={handleInventoryItemClick} />;
      case 'orders':
        return <OrdersDashboard />;
      case 'sales':
        return <SalesDashboard period={salesPeriod} />;
      case 'marketing':
        return <MarketingDashboard />;
      default:
        return <GeneralDashboard />;
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

  const getPrompts = (): string[] => {
    switch (activeDashboard) {
      case 'inventory':
        return ['Just Listed', 'Price-O-Matic'];
      case 'orders':
        return ['Awaiting Shipment', 'Shipped', 'Cancelled'];
      case 'sales':
        return ['MTD', 'YTD', '1 Year', '5 Years'];
      case 'marketing':
        return ['Campaign Stats', 'Conversion Rate'];
      default:
        return ['Overview', 'Top Products', 'Recent Activity'];
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

  const handleItemClick = (type: 'inventory' | 'order' | 'sales' | 'marketing', id: string) => {
    // Generate mock detail data based on type and id
    let detailData: any = {};

    if (type === 'inventory') {
      // Mock inventory detail data
      const colors = ['Black', 'Red', 'Blue'];
      const colorData = id.split('-')[1];
      detailData = {
        partNumber: '3201',
        name: 'Brick 2 x 4',
        category: 'Brick',
        color: colorData.charAt(0).toUpperCase() + colorData.slice(1),
        quantity: colorData === 'black' ? 45 : colorData === 'red' ? 23 : 12,
        condition: 'New' as const,
        costPerUnit: 0.15,
        pricePerUnit: 0.35,
        weight: 0.08,
        dateAdded: '2024-01-15',
        bricklinkUrl: 'https://www.bricklink.com/v2/catalog/catalogitem.page?P=3201',
      };
    } else if (type === 'order') {
      // Get order from mock database
      detailData = mockOrderDatabase[id];
    } else if (type === 'sales') {
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

  const handleOrderSelect = (orderId: string) => {
    const orderData = mockOrderDatabase[orderId];
    if (orderData) {
      // Find all orders from the same customer
      const customerEmail = orderData.customer.email;
      const customerOrders = Object.values(mockOrderDatabase)
        .filter((order: any) => 
          order.customer.email === customerEmail && order.orderId !== orderId
        )
        .map((order: any) => ({
          orderId: order.orderId,
          orderNumber: order.orderNumber,
          orderDate: order.orderDate,
          total: order.total,
          status: order.status,
        }))
        .sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());

      // Update order data with all customer orders
      const enrichedOrderData = {
        ...orderData,
        isRepeatCustomer: customerOrders.length > 0,
        previousOrders: customerOrders,
      };

      setDetailModal({
        open: true,
        data: { type: 'order', data: enrichedOrderData },
      });
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <Header onSettingsClick={() => setSettingsOpen(true)} />
      <DashboardNav active={activeDashboard} onSelect={setActiveDashboard} />
      
      <div className="flex-1 flex flex-col overflow-hidden relative">
        <div className={`transition-all duration-300 overflow-y-auto border-b-2 ${
          chatExpanded ? 'h-0' : 'h-[35%]'
        } ${
          activeDashboard === 'dashboard' ? 'bg-gradient-to-b from-lego-red/20 to-lego-red/5 border-lego-red/30' :
          activeDashboard === 'inventory' ? 'bg-gradient-to-b from-lego-blue/20 to-lego-blue/5 border-lego-blue/30' :
          activeDashboard === 'orders' ? 'bg-gradient-to-b from-lego-orange/20 to-lego-orange/5 border-lego-orange/30' :
          activeDashboard === 'sales' ? 'bg-gradient-to-b from-lego-green/20 to-lego-green/5 border-lego-green/30' :
          'bg-gradient-to-b from-lego-yellow/20 to-lego-yellow/5 border-lego-yellow/30'
        }`}>
          {renderDashboard()}
        </div>
        
        <div className={`transition-all duration-300 overflow-hidden ${chatExpanded ? 'flex-1' : 'flex-1'}`}>
          <ChatInterface 
            dashboardContext={getChatContext()} 
            themeColor={getThemeColor()} 
            prompts={getPrompts()} 
            onPromptAction={handlePromptAction}
            onItemClick={handleItemClick}
            isExpanded={chatExpanded}
            onToggleExpand={() => setChatExpanded(!chatExpanded)}
          />
        </div>
      </div>
      
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <DetailModal 
        open={detailModal.open} 
        onClose={() => setDetailModal({ open: false, data: null })} 
        detail={detailModal.data}
        onOrderSelect={handleOrderSelect}
      />
    </div>
  );
}
