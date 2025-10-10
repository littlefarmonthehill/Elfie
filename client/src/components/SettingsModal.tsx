import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { AppSettings } from "@shared/schema";
import { X, Download, Trash2, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

interface SyncProgress {
  active: boolean;
  type: 'inventory' | 'orders' | null;
  stage: string;
  progress: number;
  apiCalls: number;
  recordsAdded: number;
  recordsUpdated: number;
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [clearDataDialog, setClearDataDialog] = useState<'inventory' | 'orders' | null>(null);
  const [syncEnabled, setSyncEnabled] = useState({
    bricklinkInventory: false,
    shipstationOrders: false,
  });
  const [syncProgress, setSyncProgress] = useState<SyncProgress>({
    active: false,
    type: null,
    stage: '',
    progress: 0,
    apiCalls: 0,
    recordsAdded: 0,
    recordsUpdated: 0,
  });

  // AI Settings
  const [aiEnabled, setAiEnabled] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [selectedModel, setSelectedModel] = useState("openai/gpt-4o-mini");
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  // BrickLink Settings
  const [bricklinkConsumerKey, setBricklinkConsumerKey] = useState("");
  const [bricklinkConsumerSecret, setBricklinkConsumerSecret] = useState("");
  const [bricklinkTokenValue, setBricklinkTokenValue] = useState("");
  const [bricklinkTokenSecret, setBricklinkTokenSecret] = useState("");

  const { data: settings } = useQuery<AppSettings>({
    queryKey: ['/api/settings'],
    enabled: open,
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

  useEffect(() => {
    if (settings) {
      setAiEnabled(settings.aiEnabled);
      setApiKey(settings.openrouterApiKey || "");
      setSelectedModel(settings.selectedModel || "openai/gpt-4o-mini");
      setBricklinkConsumerKey(settings.bricklinkConsumerKey || "");
      setBricklinkConsumerSecret(settings.bricklinkConsumerSecret || "");
      setBricklinkTokenValue(settings.bricklinkTokenValue || "");
      setBricklinkTokenSecret(settings.bricklinkTokenSecret || "");
    }
  }, [settings]);

  const fetchModels = async (key: string) => {
    if (!key) return;
    setLoadingModels(true);
    try {
      const response = await fetch('/api/openrouter/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: key }),
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

  // Rate limit state
  const { data: rateLimit } = useQuery<{
    allowed: boolean;
    callsLast24h: number;
    warning?: string;
    blocked?: boolean;
  }>({
    queryKey: ['/api/bricklink/rate-limit'],
    enabled: open,
    refetchInterval: 30000, // Refresh every 30 seconds when modal is open
  });

  const handleExport = (type: 'inventory' | 'orders', format: 'csv' | 'xml') => {
    // TODO: Implement export functionality
    console.log(`Exporting ${type} as ${format}`);
  };

  const handleClearData = (type: 'inventory' | 'orders') => {
    // TODO: Implement clear data functionality
    console.log(`Clearing ${type} data`);
    setClearDataDialog(null);
  };

  const handleSyncInventory = async () => {
    // Check rate limit before syncing
    if (rateLimit?.blocked) {
      return;
    }
    
    setSyncProgress({
      active: true,
      type: 'inventory',
      stage: 'Syncing Categories...',
      progress: 10,
      apiCalls: 0,
      recordsAdded: 0,
      recordsUpdated: 0,
    });

    await new Promise(resolve => setTimeout(resolve, 500));
    setSyncProgress(prev => ({
      ...prev,
      stage: 'Syncing Colors...',
      progress: 40,
    }));

    await new Promise(resolve => setTimeout(resolve, 500));
    setSyncProgress(prev => ({
      ...prev,
      stage: 'Syncing Inventory...',
      progress: 70,
    }));

    try {
      const response = await fetch('/api/sync/bricklink/inventory', {
        method: 'POST',
      });

      const result = await response.json();

      if (result.success) {
        const totalAdded = result.data.categoriesAdded + result.data.colorsAdded + result.data.inventoryAdded;
        const totalUpdated = result.data.categoriesUpdated + result.data.colorsUpdated + result.data.inventoryUpdated;
        
        setSyncProgress({
          active: true,
          type: 'inventory',
          stage: result.data.rateLimitWarning ? `Complete! ${result.data.rateLimitWarning}` : 'Complete!',
          progress: 100,
          apiCalls: result.data.totalApiCalls,
          recordsAdded: totalAdded,
          recordsUpdated: totalUpdated,
        });

        // Invalidate inventory and rate limit queries to refresh dashboard and limits
        queryClient.invalidateQueries({ queryKey: ['/api/inventory'] });
        queryClient.invalidateQueries({ queryKey: ['/api/inventory/stats'] });
        queryClient.invalidateQueries({ queryKey: ['/api/bricklink/rate-limit'] });
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('Sync failed:', error);
      setSyncProgress(prev => ({
        ...prev,
        stage: 'Failed - Check console',
        progress: 0,
      }));
    }

    // Reset after showing summary
    await new Promise(resolve => setTimeout(resolve, 2000));
    setSyncProgress({
      active: false,
      type: null,
      stage: '',
      progress: 0,
      apiCalls: 0,
      recordsAdded: 0,
      recordsUpdated: 0,
    });
  };

  const handleSyncOrders = async () => {
    setSyncProgress({
      active: true,
      type: 'orders',
      stage: 'Syncing ShipStation Orders...',
      progress: 50,
      apiCalls: 0,
      recordsAdded: 0,
      recordsUpdated: 0,
    });

    try {
      const response = await fetch('/api/sync/shipstation/orders', {
        method: 'POST',
      });

      const result = await response.json();

      if (result.success) {
        setSyncProgress({
          active: true,
          type: 'orders',
          stage: 'Complete!',
          progress: 100,
          apiCalls: result.data.totalApiCalls,
          recordsAdded: result.data.ordersAdded + result.data.orderDetailsAdded,
          recordsUpdated: result.data.ordersUpdated,
        });
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('Sync failed:', error);
      setSyncProgress(prev => ({
        ...prev,
        stage: 'Failed - Check console',
        progress: 0,
      }));
    }

    // Reset after showing summary
    await new Promise(resolve => setTimeout(resolve, 2000));
    setSyncProgress({
      active: false,
      type: null,
      stage: '',
      progress: 0,
      apiCalls: 0,
      recordsAdded: 0,
      recordsUpdated: 0,
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[700px] max-h-[85vh] overflow-y-auto bg-gray-900 border-gray-700">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">Settings</DialogTitle>
          </DialogHeader>
          
          <Tabs defaultValue="general" className="w-full">
            <TabsList className="grid w-full grid-cols-5 bg-gray-800">
              <TabsTrigger value="general" className="text-xs" data-testid="tab-general">General</TabsTrigger>
              <TabsTrigger value="platforms" className="text-xs" data-testid="tab-platforms">Platforms</TabsTrigger>
              <TabsTrigger value="sync" className="text-xs" data-testid="tab-sync">Data & Sync</TabsTrigger>
              <TabsTrigger value="ai" className="text-xs" data-testid="tab-ai">AI</TabsTrigger>
              <TabsTrigger value="data" className="text-xs" data-testid="tab-data">Backup & Clear</TabsTrigger>
            </TabsList>

            {/* General Settings */}
            <TabsContent value="general" className="space-y-4 mt-4">
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-gray-300">General Settings</h3>
                <div className="space-y-2">
                  <Label htmlFor="timezone" className="text-xs text-gray-400">Time Zone</Label>
                  <Select defaultValue="america/chicago">
                    <SelectTrigger className="text-xs" data-testid="select-timezone">
                      <SelectValue placeholder="Select timezone" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="america/new_york">Eastern Time (ET)</SelectItem>
                      <SelectItem value="america/chicago">Central Time (CT)</SelectItem>
                      <SelectItem value="america/denver">Mountain Time (MT)</SelectItem>
                      <SelectItem value="america/los_angeles">Pacific Time (PT)</SelectItem>
                      <SelectItem value="europe/london">London (GMT)</SelectItem>
                      <SelectItem value="europe/paris">Paris (CET)</SelectItem>
                      <SelectItem value="asia/tokyo">Tokyo (JST)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </TabsContent>

            {/* Platform Connections */}
            <TabsContent value="platforms" className="space-y-4 mt-4">
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium text-gray-300 mb-3">BrickLink</h3>
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="bricklink-key" className="text-xs text-gray-400">Consumer Key</Label>
                      <Input
                        id="bricklink-key"
                        placeholder="Enter BrickLink Consumer Key"
                        className="text-xs"
                        value={bricklinkConsumerKey}
                        onChange={(e) => setBricklinkConsumerKey(e.target.value)}
                        onBlur={() => {
                          updateSettingsMutation.mutate({
                            bricklinkConsumerKey: bricklinkConsumerKey || null,
                            bricklinkConsumerSecret: bricklinkConsumerSecret || null,
                            bricklinkTokenValue: bricklinkTokenValue || null,
                            bricklinkTokenSecret: bricklinkTokenSecret || null,
                          });
                        }}
                        data-testid="input-bricklink-key"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bricklink-secret" className="text-xs text-gray-400">Consumer Secret</Label>
                      <Input
                        id="bricklink-secret"
                        type="password"
                        placeholder="Enter BrickLink Consumer Secret"
                        className="text-xs"
                        value={bricklinkConsumerSecret}
                        onChange={(e) => setBricklinkConsumerSecret(e.target.value)}
                        onBlur={() => {
                          updateSettingsMutation.mutate({
                            bricklinkConsumerKey: bricklinkConsumerKey || null,
                            bricklinkConsumerSecret: bricklinkConsumerSecret || null,
                            bricklinkTokenValue: bricklinkTokenValue || null,
                            bricklinkTokenSecret: bricklinkTokenSecret || null,
                          });
                        }}
                        data-testid="input-bricklink-secret"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bricklink-token" className="text-xs text-gray-400">Token Value</Label>
                      <Input
                        id="bricklink-token"
                        placeholder="Enter BrickLink Token Value"
                        className="text-xs"
                        value={bricklinkTokenValue}
                        onChange={(e) => setBricklinkTokenValue(e.target.value)}
                        onBlur={() => {
                          updateSettingsMutation.mutate({
                            bricklinkConsumerKey: bricklinkConsumerKey || null,
                            bricklinkConsumerSecret: bricklinkConsumerSecret || null,
                            bricklinkTokenValue: bricklinkTokenValue || null,
                            bricklinkTokenSecret: bricklinkTokenSecret || null,
                          });
                        }}
                        data-testid="input-bricklink-token"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bricklink-token-secret" className="text-xs text-gray-400">Token Secret</Label>
                      <Input
                        id="bricklink-token-secret"
                        type="password"
                        placeholder="Enter BrickLink Token Secret"
                        className="text-xs"
                        value={bricklinkTokenSecret}
                        onChange={(e) => setBricklinkTokenSecret(e.target.value)}
                        onBlur={() => {
                          updateSettingsMutation.mutate({
                            bricklinkConsumerKey: bricklinkConsumerKey || null,
                            bricklinkConsumerSecret: bricklinkConsumerSecret || null,
                            bricklinkTokenValue: bricklinkTokenValue || null,
                            bricklinkTokenSecret: bricklinkTokenSecret || null,
                          });
                        }}
                        data-testid="input-bricklink-token-secret"
                      />
                    </div>
                  </div>
                </div>

                <Separator className="bg-gray-700" />

                <div>
                  <h3 className="text-sm font-medium text-gray-300 mb-3">BrickOwl</h3>
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="brickowl-key" className="text-xs text-gray-400">API Key</Label>
                      <Input
                        id="brickowl-key"
                        type="password"
                        placeholder="Enter BrickOwl API Key"
                        className="text-xs"
                        data-testid="input-brickowl-key"
                      />
                    </div>
                  </div>
                </div>

                <Separator className="bg-gray-700" />

                <div>
                  <h3 className="text-sm font-medium text-gray-300 mb-3">ShipStation</h3>
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="shipstation-key" className="text-xs text-gray-400">API Key</Label>
                      <Input
                        id="shipstation-key"
                        placeholder="Enter ShipStation API Key"
                        className="text-xs"
                        data-testid="input-shipstation-key"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="shipstation-secret" className="text-xs text-gray-400">API Secret</Label>
                      <Input
                        id="shipstation-secret"
                        type="password"
                        placeholder="Enter ShipStation API Secret"
                        className="text-xs"
                        data-testid="input-shipstation-secret"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Data & Sync */}
            <TabsContent value="sync" className="space-y-4 mt-4">
              <div className="space-y-4">
                {/* Sync Progress */}
                {syncProgress.active && (
                  <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-medium text-purple-300">{syncProgress.stage}</h3>
                      <RefreshCw className="h-4 w-4 text-purple-400 animate-spin" />
                    </div>
                    <Progress value={syncProgress.progress} className="mb-3" />
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div className="bg-gray-800 rounded px-2 py-1">
                        <span className="text-gray-400">API Calls:</span>
                        <span className="text-purple-300 font-semibold ml-1">{syncProgress.apiCalls}</span>
                      </div>
                      <div className="bg-gray-800 rounded px-2 py-1">
                        <span className="text-gray-400">Added:</span>
                        <span className="text-green-400 font-semibold ml-1">{syncProgress.recordsAdded}</span>
                      </div>
                      <div className="bg-gray-800 rounded px-2 py-1">
                        <span className="text-gray-400">Updated:</span>
                        <span className="text-blue-400 font-semibold ml-1">{syncProgress.recordsUpdated}</span>
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <h3 className="text-sm font-medium text-gray-300 mb-3">Manual Sync</h3>
                  
                  {/* Rate Limit Status */}
                  {rateLimit && (
                    <div className={`mb-3 p-2 rounded-lg border ${
                      rateLimit.blocked 
                        ? 'bg-red-500/10 border-red-500/30' 
                        : rateLimit.warning 
                        ? 'bg-yellow-500/10 border-yellow-500/30' 
                        : 'bg-blue-500/10 border-blue-500/30'
                    }`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold text-gray-300">
                          BrickLink API Usage: {rateLimit.callsLast24h.toLocaleString()}/5,000 (24h)
                        </span>
                      </div>
                      {rateLimit.warning && (
                        <p className={`text-xs ${
                          rateLimit.blocked ? 'text-red-400' : 'text-yellow-400'
                        }`}>
                          {rateLimit.warning}
                        </p>
                      )}
                    </div>
                  )}
                  
                  <div className="space-y-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full justify-start text-xs" 
                      onClick={handleSyncInventory}
                      disabled={syncProgress.active || rateLimit?.blocked}
                      data-testid="button-sync-bricklink-inventory"
                    >
                      <RefreshCw className={`h-3 w-3 mr-2 ${syncProgress.active && syncProgress.type === 'inventory' ? 'animate-spin' : ''}`} />
                      Sync BrickLink Inventory (Categories, Colors, Items)
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full justify-start text-xs" 
                      onClick={handleSyncOrders}
                      disabled={syncProgress.active}
                      data-testid="button-sync-shipstation-orders"
                    >
                      <RefreshCw className={`h-3 w-3 mr-2 ${syncProgress.active && syncProgress.type === 'orders' ? 'animate-spin' : ''}`} />
                      Sync ShipStation Orders
                    </Button>
                  </div>
                </div>

                <Separator className="bg-gray-700" />

                <div>
                  <h3 className="text-sm font-medium text-gray-300 mb-3">Automatic Sync</h3>
                  <p className="text-xs text-gray-400 mb-3">Enable automatic syncing at regular intervals</p>
                  
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label className="text-xs text-gray-300">BrickLink Inventory</Label>
                        <p className="text-xs text-gray-500">Sync every 6 hours (Categories, Colors, Items)</p>
                      </div>
                      <Switch
                        checked={syncEnabled.bricklinkInventory}
                        onCheckedChange={(checked) => setSyncEnabled({ ...syncEnabled, bricklinkInventory: checked })}
                        data-testid="switch-sync-bricklink-inventory"
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label className="text-xs text-gray-300">ShipStation Orders</Label>
                        <p className="text-xs text-gray-500">Sync every hour</p>
                      </div>
                      <Switch
                        checked={syncEnabled.shipstationOrders}
                        onCheckedChange={(checked) => setSyncEnabled({ ...syncEnabled, shipstationOrders: checked })}
                        data-testid="switch-sync-shipstation-orders"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* AI Settings */}
            <TabsContent value="ai" className="space-y-4 mt-4">
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium text-gray-300 mb-3">E.L.F.I.E. Configuration</h3>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label className="text-xs text-gray-300">Enable AI Assistant</Label>
                        <p className="text-xs text-gray-500">Turn E.L.F.I.E. on or off</p>
                      </div>
                      <Switch
                        checked={aiEnabled}
                        onCheckedChange={(checked) => {
                          setAiEnabled(checked);
                          updateSettingsMutation.mutate({ 
                            aiEnabled: checked,
                            openrouterApiKey: apiKey || null,
                            selectedModel: selectedModel || null,
                          });
                        }}
                        data-testid="switch-ai-enabled"
                      />
                    </div>

                    <Separator className="bg-gray-700" />

                    <div className="space-y-2">
                      <Label htmlFor="openrouter-api-key" className="text-xs text-gray-400">OpenRouter API Key</Label>
                      <Input
                        id="openrouter-api-key"
                        type="password"
                        placeholder="sk-or-v1-..."
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        onBlur={() => {
                          updateSettingsMutation.mutate({
                            aiEnabled,
                            openrouterApiKey: apiKey || null,
                            selectedModel: selectedModel || null,
                          });
                          if (apiKey) {
                            fetchModels(apiKey);
                          }
                        }}
                        className="text-xs font-mono"
                        data-testid="input-openrouter-api-key"
                      />
                      <p className="text-xs text-gray-500">
                        Your API key is stored securely. Get one from{" "}
                        <a 
                          href="https://openrouter.ai/keys" 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-purple-400 hover:text-purple-300"
                        >
                          OpenRouter
                        </a>
                      </p>
                    </div>

                    {apiKey && availableModels.length > 0 && (
                      <div className="space-y-2">
                        <Label htmlFor="ai-model" className="text-xs text-gray-400">Model</Label>
                        <Select 
                          value={selectedModel} 
                          onValueChange={(value) => {
                            setSelectedModel(value);
                            updateSettingsMutation.mutate({
                              aiEnabled,
                              openrouterApiKey: apiKey || null,
                              selectedModel: value,
                            });
                          }}
                        >
                          <SelectTrigger className="text-xs" data-testid="select-ai-model">
                            <SelectValue placeholder="Select a model" />
                          </SelectTrigger>
                          <SelectContent>
                            {availableModels.map((model) => (
                              <SelectItem key={model.id} value={model.id}>
                                {model.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {loadingModels && (
                      <p className="text-xs text-gray-400">Loading models...</p>
                    )}

                    <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3">
                      <p className="text-xs text-purple-300">
                        <strong>Using OpenRouter:</strong> Access multiple AI models through a unified API
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Backup & Clear Data */}
            <TabsContent value="data" className="space-y-4 mt-4">
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium text-gray-300 mb-3">Backup Data</h3>
                  <p className="text-xs text-gray-400 mb-3">Export your data for backup or migration</p>
                  
                  <div className="space-y-3">
                    <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
                      <h4 className="text-xs font-medium text-gray-300 mb-2">Inventory Data</h4>
                      <div className="flex gap-2">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="text-xs flex-1"
                          onClick={() => handleExport('inventory', 'csv')}
                          data-testid="button-export-inventory-csv"
                        >
                          <Download className="h-3 w-3 mr-1" />
                          Export CSV
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="text-xs flex-1"
                          onClick={() => handleExport('inventory', 'xml')}
                          data-testid="button-export-inventory-xml"
                        >
                          <Download className="h-3 w-3 mr-1" />
                          Export XML
                        </Button>
                      </div>
                    </div>

                    <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
                      <h4 className="text-xs font-medium text-gray-300 mb-2">Order Data</h4>
                      <div className="flex gap-2">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="text-xs flex-1"
                          onClick={() => handleExport('orders', 'csv')}
                          data-testid="button-export-orders-csv"
                        >
                          <Download className="h-3 w-3 mr-1" />
                          Export CSV
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="text-xs flex-1"
                          onClick={() => handleExport('orders', 'xml')}
                          data-testid="button-export-orders-xml"
                        >
                          <Download className="h-3 w-3 mr-1" />
                          Export XML
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                <Separator className="bg-gray-700" />

                <div>
                  <h3 className="text-sm font-medium text-gray-300 mb-3">Clear Data</h3>
                  <p className="text-xs text-gray-400 mb-3">Permanently delete data from the system</p>
                  
                  <div className="space-y-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full justify-start text-xs text-red-400 hover:text-red-300 border-red-900/50 hover:border-red-800"
                      onClick={() => setClearDataDialog('inventory')}
                      data-testid="button-clear-inventory"
                    >
                      <Trash2 className="h-3 w-3 mr-2" />
                      Clear All Inventory Data
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full justify-start text-xs text-red-400 hover:text-red-300 border-red-900/50 hover:border-red-800"
                      onClick={() => setClearDataDialog('orders')}
                      data-testid="button-clear-orders"
                    >
                      <Trash2 className="h-3 w-3 mr-2" />
                      Clear All Order Data
                    </Button>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
          
          <div className="flex justify-end gap-2 pt-4 border-t border-gray-700">
            <Button variant="outline" size="sm" onClick={onClose} data-testid="button-cancel">
              Cancel
            </Button>
            <Button size="sm" onClick={onClose} data-testid="button-save">
              Save Settings
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Clear Data Confirmation Dialog */}
      <AlertDialog open={clearDataDialog !== null} onOpenChange={() => setClearDataDialog(null)}>
        <AlertDialogContent className="bg-gray-900 border-gray-700">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">Clear {clearDataDialog === 'inventory' ? 'Inventory' : 'Order'} Data?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-gray-400">
              This action cannot be undone. This will permanently delete all {clearDataDialog === 'inventory' ? 'inventory' : 'order'} data from the database.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs" data-testid="button-cancel-clear">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="text-xs bg-red-600 hover:bg-red-700"
              onClick={() => clearDataDialog && handleClearData(clearDataDialog)}
              data-testid="button-confirm-clear"
            >
              Clear Data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
