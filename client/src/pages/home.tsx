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
  const [detailModal, setDetailModal] = useState<{ open: boolean; data: DetailData | null }>({
    open: false,
    data: null,
  });

  const renderDashboard = () => {
    switch (activeDashboard) {
      case 'inventory':
        return <InventoryDashboard />;
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
      // Mock order detail data
      const orderMap: { [key: string]: any } = {
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
        },
      };
      detailData = orderMap[id];
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

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <Header onSettingsClick={() => setSettingsOpen(true)} />
      <DashboardNav active={activeDashboard} onSelect={setActiveDashboard} />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className={`h-[35%] overflow-y-auto border-b-2 ${
          activeDashboard === 'dashboard' ? 'bg-gradient-to-b from-lego-red/20 to-lego-red/5 border-lego-red/30' :
          activeDashboard === 'inventory' ? 'bg-gradient-to-b from-lego-blue/20 to-lego-blue/5 border-lego-blue/30' :
          activeDashboard === 'orders' ? 'bg-gradient-to-b from-lego-orange/20 to-lego-orange/5 border-lego-orange/30' :
          activeDashboard === 'sales' ? 'bg-gradient-to-b from-lego-green/20 to-lego-green/5 border-lego-green/30' :
          'bg-gradient-to-b from-lego-yellow/20 to-lego-yellow/5 border-lego-yellow/30'
        }`}>
          {renderDashboard()}
        </div>
        
        <div className="flex-1 overflow-hidden">
          <ChatInterface 
            dashboardContext={getChatContext()} 
            themeColor={getThemeColor()} 
            prompts={getPrompts()} 
            onPromptAction={handlePromptAction}
            onItemClick={handleItemClick}
          />
        </div>
      </div>
      
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <DetailModal 
        open={detailModal.open} 
        onClose={() => setDetailModal({ open: false, data: null })} 
        detail={detailModal.data} 
      />
    </div>
  );
}
