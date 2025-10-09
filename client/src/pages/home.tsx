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

export default function Home() {
  const [activeDashboard, setActiveDashboard] = useState<DashboardType>('dashboard');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const renderDashboard = () => {
    switch (activeDashboard) {
      case 'inventory':
        return <InventoryDashboard />;
      case 'orders':
        return <OrdersDashboard />;
      case 'sales':
        return <SalesDashboard />;
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
          <ChatInterface dashboardContext={getChatContext()} themeColor={getThemeColor()} prompts={getPrompts()} />
        </div>
      </div>
      
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
