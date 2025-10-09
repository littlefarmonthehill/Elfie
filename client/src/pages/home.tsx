import { useState } from "react";
import Header from "@/components/Header";
import DashboardNav, { DashboardType } from "@/components/DashboardNav";
import SettingsModal from "@/components/SettingsModal";
import InventoryDashboard from "@/components/InventoryDashboard";
import SalesDashboard from "@/components/SalesDashboard";
import MarketingDashboard from "@/components/MarketingDashboard";
import GeneralDashboard from "@/components/GeneralDashboard";
import ChatInterface from "@/components/ChatInterface";

export default function Home() {
  const [activeDashboard, setActiveDashboard] = useState<DashboardType>('dashboard');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const renderDashboard = () => {
    switch (activeDashboard) {
      case 'inventory':
        return <InventoryDashboard />;
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
      case 'sales':
        return 'Sales';
      case 'marketing':
        return 'Marketing';
      default:
        return 'Business';
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <Header onSettingsClick={() => setSettingsOpen(true)} />
      <DashboardNav active={activeDashboard} onSelect={setActiveDashboard} />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="h-1/2 overflow-y-auto">
          {renderDashboard()}
        </div>
        
        <div className="flex-1 overflow-hidden">
          <ChatInterface dashboardContext={getChatContext()} />
        </div>
      </div>
      
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
