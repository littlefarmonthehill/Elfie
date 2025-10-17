import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerClose } from "@/components/ui/drawer";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { X, PlayCircle, CheckCircle, AlertTriangle, Package, MapPin, CheckCircle2, XCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface OrderSyncTesterProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function OrderSyncTester({ open, onOpenChange }: OrderSyncTesterProps) {
  const [platform, setPlatform] = useState<string>("both");
  const [limit, setLimit] = useState<number>(5);
  const [testResults, setTestResults] = useState<any>(null);

  const runTestMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/orders/dry-run-test", { platform, limit });
      return response.json();
    },
    onSuccess: (data) => {
      setTestResults(data);
    },
  });

  const handleRunTest = () => {
    setTestResults(null);
    runTestMutation.mutate();
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90vh]">
        <DrawerHeader className="border-b">
          <div className="flex items-center justify-between">
            <DrawerTitle className="text-lg font-bold">Order Sync Tester</DrawerTitle>
            <DrawerClose asChild>
              <Button variant="ghost" size="icon" data-testid="button-close-ordersync">
                <X className="h-4 w-4" />
              </Button>
            </DrawerClose>
          </div>
        </DrawerHeader>

        <div className="overflow-y-auto p-4">
          <div className="max-w-6xl mx-auto space-y-4">
            {/* Configuration */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Test Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs md:text-sm lg:text-base font-medium text-muted-foreground mb-1 block">
                      Platform
                    </label>
                    <Select value={platform} onValueChange={setPlatform}>
                      <SelectTrigger data-testid="select-platform">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bricklink">BrickLink Only</SelectItem>
                        <SelectItem value="brickowl">BrickOwl Only</SelectItem>
                        <SelectItem value="both">Both Platforms</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="text-xs md:text-sm lg:text-base font-medium text-muted-foreground mb-1 block">
                      Orders to Test
                    </label>
                    <Select value={limit.toString()} onValueChange={(v) => setLimit(parseInt(v))}>
                      <SelectTrigger data-testid="select-limit">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="3">3 Orders</SelectItem>
                        <SelectItem value="5">5 Orders</SelectItem>
                        <SelectItem value="10">10 Orders</SelectItem>
                        <SelectItem value="20">20 Orders</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-end">
                    <Button
                      onClick={handleRunTest}
                      disabled={runTestMutation.isPending}
                      className="w-full"
                      data-testid="button-run-test"
                    >
                      <PlayCircle className="h-4 w-4 mr-2" />
                      {runTestMutation.isPending ? "Running Test..." : "Run Test"}
                    </Button>
                  </div>
                </div>

                <div className="text-xs md:text-sm lg:text-base text-muted-foreground bg-muted/30 p-3 rounded">
                  <p className="font-medium mb-1">Dry-Run Testing Mode</p>
                  <p>
                    This test fetches historical orders from BrickLink/BrickOwl APIs and compares them
                    with existing ShipStation orders. No data is written to the database. Use this to
                    validate the mapping logic before enabling live synchronization.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Error Display */}
            {runTestMutation.isError && (
              <Card className="border-destructive">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
                    <div>
                      <p className="font-medium text-destructive">Test Failed</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {(runTestMutation.error as any)?.message || "An error occurred during testing"}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Results */}
            {testResults?.results && testResults.results.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold">Test Results</h3>
                  <Badge variant="outline">
                    {testResults.results.length} Order{testResults.results.length !== 1 ? "s" : ""} Analyzed
                  </Badge>
                </div>

                {testResults.results.map((result: any, idx: number) => (
                  <Card key={idx} className="border-l-4 border-l-primary">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge className="bg-purple-600 hover:bg-purple-700">
                              {result.platform}
                            </Badge>
                            <span className="font-mono text-sm font-bold">
                              #{result.shipstationOrder?.orderNumber || result.platformOrder?.orderNumber || 'N/A'}
                            </span>
                          </div>
                        </div>
                        <div className="text-right">
                          {result.shipstationOrder ? (
                            <div className="flex items-center gap-2 text-green-600">
                              <CheckCircle className="h-4 w-4" />
                              <span className="text-xs font-medium">In ShipStation</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 text-orange-600">
                              <AlertTriangle className="h-4 w-4" />
                              <span className="text-xs font-medium">Not in ShipStation</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <Accordion type="multiple" className="w-full">
                        {/* Order Header - Order Level Fields */}
                        <AccordionItem value="header">
                          <AccordionTrigger className="text-sm font-medium">Order Header</AccordionTrigger>
                          <AccordionContent>
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b">
                                    <th className="text-left py-2 font-medium text-muted-foreground w-1/3">Field</th>
                                    <th className="text-left py-2 font-medium text-muted-foreground w-1/3">ShipStation</th>
                                    <th className="text-left py-2 font-medium text-muted-foreground w-1/3">{result.platform}</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y">
                                  <tr>
                                    <td className="py-2">Order Number</td>
                                    <td className="py-2 font-mono">{result.shipstationOrder?.orderNumber || '-'}</td>
                                    <td className="py-2 font-mono">{result.platformOrder?.orderNumber || '-'}</td>
                                  </tr>
                                  <tr>
                                    <td className="py-2">Customer</td>
                                    <td className="py-2">{result.shipstationOrder?.customerUsername || '-'}</td>
                                    <td className="py-2">{result.platformOrder?.customerUsername || '-'}</td>
                                  </tr>
                                  <tr>
                                    <td className="py-2">Email</td>
                                    <td className="py-2">{result.shipstationOrder?.customerEmail || '-'}</td>
                                    <td className="py-2">{result.platformOrder?.customerEmail || '-'}</td>
                                  </tr>
                                  <tr>
                                    <td className="py-2">Order Date</td>
                                    <td className="py-2">{result.shipstationOrder?.orderDate ? new Date(result.shipstationOrder.orderDate).toLocaleDateString() : '-'}</td>
                                    <td className="py-2">{result.platformOrder?.orderDate ? new Date(result.platformOrder.orderDate).toLocaleDateString() : '-'}</td>
                                  </tr>
                                  <tr>
                                    <td className="py-2">Status</td>
                                    <td className="py-2 capitalize">{result.shipstationOrder?.orderStatus?.replace(/_/g, ' ') || '-'}</td>
                                    <td className="py-2 capitalize">{result.platformOrder?.orderStatus?.replace(/_/g, ' ') || '-'}</td>
                                  </tr>
                                  <tr>
                                    <td className="py-2">Total</td>
                                    <td className="py-2">${result.shipstationOrder?.orderTotal || '0'}</td>
                                    <td className="py-2">${result.platformOrder?.orderTotal || '0'}</td>
                                  </tr>
                                  <tr>
                                    <td className="py-2">Ship Name</td>
                                    <td className="py-2">{result.shipstationOrder?.shipTo?.name || '-'}</td>
                                    <td className="py-2">{result.platformOrder?.shippingAddress?.name || '-'}</td>
                                  </tr>
                                  <tr>
                                    <td className="py-2">Ship Address</td>
                                    <td className="py-2">
                                      {result.shipstationOrder?.shipTo ? (
                                        <>
                                          {result.shipstationOrder.shipTo.street1}
                                          {result.shipstationOrder.shipTo.street2 && `, ${result.shipstationOrder.shipTo.street2}`}
                                          <br />
                                          {result.shipstationOrder.shipTo.city}, {result.shipstationOrder.shipTo.state} {result.shipstationOrder.shipTo.postalCode}
                                          <br />
                                          {result.shipstationOrder.shipTo.country}
                                        </>
                                      ) : '-'}
                                    </td>
                                    <td className="py-2">
                                      {result.platformOrder?.shippingAddress ? (
                                        <>
                                          {result.platformOrder.shippingAddress.street1}
                                          {result.platformOrder.shippingAddress.street2 && `, ${result.platformOrder.shippingAddress.street2}`}
                                          <br />
                                          {result.platformOrder.shippingAddress.city}, {result.platformOrder.shippingAddress.state} {result.platformOrder.shippingAddress.postalCode}
                                          <br />
                                          {result.platformOrder.shippingAddress.country}
                                        </>
                                      ) : '-'}
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          </AccordionContent>
                        </AccordionItem>

                        {/* Order Detail - Line Items */}
                        <AccordionItem value="detail">
                          <AccordionTrigger className="text-sm font-medium">
                            Order Detail (SS: {result.shipstationItems?.length || 0} items, {result.platform}: {result.platformItems?.length || 0} items)
                          </AccordionTrigger>
                          <AccordionContent>
                            {/* ShipStation Items */}
                            <div className="mb-6">
                              <h4 className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                                <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded">
                                  ShipStation Items ({result.shipstationItems?.length || 0})
                                </span>
                              </h4>
                              {result.shipstationItems && result.shipstationItems.length > 0 ? (
                                <div className="overflow-x-auto">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="border-b">
                                        <th className="text-left py-2 font-medium text-muted-foreground">Item Name</th>
                                        <th className="text-left py-2 font-medium text-muted-foreground">SKU</th>
                                        <th className="text-left py-2 font-medium text-muted-foreground">Qty</th>
                                        <th className="text-left py-2 font-medium text-muted-foreground">Price</th>
                                        <th className="text-left py-2 font-medium text-muted-foreground">Total</th>
                                        <th className="text-left py-2 font-medium text-muted-foreground">Warehouse Bin</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                      {result.shipstationItems.map((item: any, itemIdx: number) => (
                                        <tr key={itemIdx}>
                                          <td className="py-2">{item.name}</td>
                                          <td className="py-2 font-mono text-[10px]">{item.sku || '-'}</td>
                                          <td className="py-2">{item.quantity}</td>
                                          <td className="py-2">${item.unitPrice}</td>
                                          <td className="py-2">${(item.quantity * item.unitPrice).toFixed(2)}</td>
                                          <td className="py-2">
                                            {item.warehouseBin ? (
                                              <span className="text-green-600 text-[10px]">
                                                {item.warehouseBin.aisleName} › {item.warehouseBin.shelfName} › {item.warehouseBin.binName}
                                              </span>
                                            ) : (
                                              <span className="text-orange-600 text-[10px]">Not assigned</span>
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <p className="text-xs text-muted-foreground py-4">No items found in ShipStation</p>
                              )}
                            </div>

                            {/* Platform Items */}
                            <div>
                              <h4 className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                                <span className="bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 px-2 py-0.5 rounded">
                                  {result.platform} Items ({result.platformItems?.length || 0})
                                </span>
                              </h4>
                              {result.platformItems && result.platformItems.length > 0 ? (
                                <div className="overflow-x-auto">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="border-b">
                                        <th className="text-left py-2 font-medium text-muted-foreground">Item Name</th>
                                        <th className="text-left py-2 font-medium text-muted-foreground">SKU</th>
                                        <th className="text-left py-2 font-medium text-muted-foreground">Qty</th>
                                        <th className="text-left py-2 font-medium text-muted-foreground">Price</th>
                                        <th className="text-left py-2 font-medium text-muted-foreground">Total</th>
                                        <th className="text-left py-2 font-medium text-muted-foreground">Warehouse Bin</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                      {result.platformItems.map((item: any, itemIdx: number) => (
                                        <tr key={itemIdx}>
                                          <td className="py-2">{item.name}</td>
                                          <td className="py-2 font-mono text-[10px]">{item.sku || '-'}</td>
                                          <td className="py-2">{item.quantity}</td>
                                          <td className="py-2">${item.unitPrice}</td>
                                          <td className="py-2">${(item.quantity * item.unitPrice).toFixed(2)}</td>
                                          <td className="py-2">
                                            {item.warehouseBin ? (
                                              <span className="text-green-600 text-[10px]">
                                                {item.warehouseBin.aisleName} › {item.warehouseBin.shelfName} › {item.warehouseBin.binName}
                                              </span>
                                            ) : (
                                              <span className="text-orange-600 text-[10px]">Not assigned</span>
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <p className="text-xs text-muted-foreground py-4">
                                  No items returned from {result.platform} API (items may only be available for pending orders)
                                </p>
                              )}
                            </div>
                            
                            {/* Issues */}
                            {result.issues && result.issues.length > 0 && (
                              <div className="bg-orange-500/10 border border-orange-500/30 rounded p-3 mt-4">
                                <p className="text-xs font-medium text-orange-600 mb-2">Issues Detected</p>
                                <ul className="text-xs space-y-1">
                                  {result.issues.map((issue: string, i: number) => (
                                    <li key={i} className="text-orange-700">• {issue}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* No Results */}
            {testResults?.results && testResults.results.length === 0 && (
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center py-8">
                    <Package className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-50" />
                    <p className="text-sm text-muted-foreground">
                      No orders found for the selected platform and limit
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
