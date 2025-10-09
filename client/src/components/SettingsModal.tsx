import { useState } from "react";
import { X, Download, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [clearDataDialog, setClearDataDialog] = useState<'inventory' | 'orders' | null>(null);
  const [syncEnabled, setSyncEnabled] = useState({
    bricklinkInventory: false,
    bricklinkOrders: false,
    brickowlOrders: false,
    shipstationOrders: false,
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
                        data-testid="input-bricklink-secret"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bricklink-token" className="text-xs text-gray-400">Token Value</Label>
                      <Input
                        id="bricklink-token"
                        placeholder="Enter BrickLink Token Value"
                        className="text-xs"
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
                <div>
                  <h3 className="text-sm font-medium text-gray-300 mb-3">Manual Sync</h3>
                  <div className="space-y-2">
                    <Button variant="outline" size="sm" className="w-full justify-start text-xs" data-testid="button-sync-bricklink-inventory">
                      Sync BrickLink Inventory
                    </Button>
                    <Button variant="outline" size="sm" className="w-full justify-start text-xs" data-testid="button-sync-bricklink-orders">
                      Sync BrickLink Orders
                    </Button>
                    <Button variant="outline" size="sm" className="w-full justify-start text-xs" data-testid="button-sync-brickowl-orders">
                      Sync BrickOwl Orders
                    </Button>
                    <Button variant="outline" size="sm" className="w-full justify-start text-xs" data-testid="button-sync-shipstation-orders">
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
                        <p className="text-xs text-gray-500">Sync every 6 hours</p>
                      </div>
                      <Switch
                        checked={syncEnabled.bricklinkInventory}
                        onCheckedChange={(checked) => setSyncEnabled({ ...syncEnabled, bricklinkInventory: checked })}
                        data-testid="switch-sync-bricklink-inventory"
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label className="text-xs text-gray-300">BrickLink Orders</Label>
                        <p className="text-xs text-gray-500">Sync every hour</p>
                      </div>
                      <Switch
                        checked={syncEnabled.bricklinkOrders}
                        onCheckedChange={(checked) => setSyncEnabled({ ...syncEnabled, bricklinkOrders: checked })}
                        data-testid="switch-sync-bricklink-orders"
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label className="text-xs text-gray-300">BrickOwl Orders</Label>
                        <p className="text-xs text-gray-500">Sync every hour</p>
                      </div>
                      <Switch
                        checked={syncEnabled.brickowlOrders}
                        onCheckedChange={(checked) => setSyncEnabled({ ...syncEnabled, brickowlOrders: checked })}
                        data-testid="switch-sync-brickowl-orders"
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
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="ai-model" className="text-xs text-gray-400">AI Model</Label>
                      <Select defaultValue="gpt-4">
                        <SelectTrigger className="text-xs" data-testid="select-ai-model">
                          <SelectValue placeholder="Select AI model" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="gpt-4">GPT-4</SelectItem>
                          <SelectItem value="gpt-4-turbo">GPT-4 Turbo</SelectItem>
                          <SelectItem value="gpt-3.5-turbo">GPT-3.5 Turbo</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="ai-temperature" className="text-xs text-gray-400">Temperature (Creativity)</Label>
                      <Select defaultValue="0.7">
                        <SelectTrigger className="text-xs" data-testid="select-ai-temperature">
                          <SelectValue placeholder="Select temperature" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0.3">Low (0.3) - Precise</SelectItem>
                          <SelectItem value="0.7">Medium (0.7) - Balanced</SelectItem>
                          <SelectItem value="1.0">High (1.0) - Creative</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="ai-context" className="text-xs text-gray-400">Business Context</Label>
                      <textarea
                        id="ai-context"
                        placeholder="Add business context to help E.L.F.I.E. provide better insights..."
                        className="w-full min-h-[100px] rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-gray-100 placeholder:text-gray-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-600"
                        data-testid="textarea-ai-context"
                      />
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
