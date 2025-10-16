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
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">
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
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">
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

                <div className="text-xs text-muted-foreground bg-muted/30 p-3 rounded">
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
                              #{result.order.orderNumber}
                            </span>
                          </div>
                        </div>
                        <div className="text-right">
                          {result.comparison ? (
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
                        {/* Order Header */}
                        <AccordionItem value="header">
                          <AccordionTrigger className="text-sm font-medium">Order Header</AccordionTrigger>
                          <AccordionContent>
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b">
                                    <th className="text-left py-2 font-medium text-muted-foreground">Field</th>
                                    <th className="text-left py-2 font-medium text-muted-foreground">ShipStation</th>
                                    <th className="text-left py-2 font-medium text-muted-foreground">Field</th>
                                    <th className="text-left py-2 font-medium text-muted-foreground">{result.platform}</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y">
                                  <tr>
                                    <td className="py-2">Order Number</td>
                                    <td className="py-2 font-mono">{result.comparison?.orderNumber || '-'}</td>
                                    <td className="py-2">Order Number</td>
                                    <td className="py-2 font-mono">{result.order.orderNumber}</td>
                                  </tr>
                                  <tr>
                                    <td className="py-2">Customer</td>
                                    <td className="py-2">{result.comparison?.customerUsername || '-'}</td>
                                    <td className="py-2">Customer</td>
                                    <td className="py-2">{result.order.customerUsername}</td>
                                  </tr>
                                  <tr>
                                    <td className="py-2">Email</td>
                                    <td className="py-2">{result.comparison?.customerEmail || '-'}</td>
                                    <td className="py-2">Email</td>
                                    <td className="py-2">{result.order.customerEmail || '-'}</td>
                                  </tr>
                                  <tr>
                                    <td className="py-2">Order Date</td>
                                    <td className="py-2">{result.comparison?.orderDate ? new Date(result.comparison.orderDate).toLocaleDateString() : '-'}</td>
                                    <td className="py-2">Order Date</td>
                                    <td className="py-2">{new Date(result.order.orderDate).toLocaleDateString()}</td>
                                  </tr>
                                  <tr>
                                    <td className="py-2">Status</td>
                                    <td className="py-2 capitalize">{result.comparison?.orderStatus?.replace(/_/g, ' ') || '-'}</td>
                                    <td className="py-2">Status</td>
                                    <td className="py-2 capitalize">{result.order.orderStatus.replace(/_/g, ' ')}</td>
                                  </tr>
                                  <tr>
                                    <td className="py-2">Total</td>
                                    <td className="py-2">${result.comparison?.orderTotal || '0'}</td>
                                    <td className="py-2">Total</td>
                                    <td className="py-2">${result.order.orderTotal}</td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          </AccordionContent>
                        </AccordionItem>

                        {/* Order Detail */}
                        <AccordionItem value="detail">
                          <AccordionTrigger className="text-sm font-medium">Order Detail</AccordionTrigger>
                          <AccordionContent>
                            <div className="space-y-4">
                              {/* Shipping Address Comparison */}
                              <div>
                                <p className="text-xs font-medium text-muted-foreground mb-2">Shipping Address</p>
                                <div className="overflow-x-auto">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="border-b">
                                        <th className="text-left py-2 font-medium text-muted-foreground">Field</th>
                                        <th className="text-left py-2 font-medium text-muted-foreground">ShipStation</th>
                                        <th className="text-left py-2 font-medium text-muted-foreground">Field</th>
                                        <th className="text-left py-2 font-medium text-muted-foreground">{result.platform}</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                      <tr>
                                        <td className="py-2">Name</td>
                                        <td className="py-2">{result.comparison?.shipTo?.name || '-'}</td>
                                        <td className="py-2">Name</td>
                                        <td className="py-2">{result.order.shippingAddress?.name || '-'}</td>
                                      </tr>
                                      <tr>
                                        <td className="py-2">Street 1</td>
                                        <td className="py-2">{result.comparison?.shipTo?.street1 || '-'}</td>
                                        <td className="py-2">Street 1</td>
                                        <td className="py-2">{result.order.shippingAddress?.street1 || '-'}</td>
                                      </tr>
                                      <tr>
                                        <td className="py-2">Street 2</td>
                                        <td className="py-2">{result.comparison?.shipTo?.street2 || '-'}</td>
                                        <td className="py-2">Street 2</td>
                                        <td className="py-2">{result.order.shippingAddress?.street2 || '-'}</td>
                                      </tr>
                                      <tr>
                                        <td className="py-2">City</td>
                                        <td className="py-2">{result.comparison?.shipTo?.city || '-'}</td>
                                        <td className="py-2">City</td>
                                        <td className="py-2">{result.order.shippingAddress?.city || '-'}</td>
                                      </tr>
                                      <tr>
                                        <td className="py-2">State</td>
                                        <td className="py-2">{result.comparison?.shipTo?.state || '-'}</td>
                                        <td className="py-2">State</td>
                                        <td className="py-2">{result.order.shippingAddress?.state || '-'}</td>
                                      </tr>
                                      <tr>
                                        <td className="py-2">Postal Code</td>
                                        <td className="py-2">{result.comparison?.shipTo?.postalCode || '-'}</td>
                                        <td className="py-2">Postal Code</td>
                                        <td className="py-2">{result.order.shippingAddress?.postalCode || '-'}</td>
                                      </tr>
                                      <tr>
                                        <td className="py-2">Country</td>
                                        <td className="py-2">{result.comparison?.shipTo?.country || '-'}</td>
                                        <td className="py-2">Country</td>
                                        <td className="py-2">{result.order.shippingAddress?.country || '-'}</td>
                                      </tr>
                                    </tbody>
                                  </table>
                                </div>
                              </div>

                              {/* Line Items */}
                              <div>
                                <p className="text-xs font-medium text-muted-foreground mb-2">Line Items ({result.items.length})</p>
                                <div className="space-y-2">
                                  {result.items.map((item: any, itemIdx: number) => (
                                    <div key={itemIdx} className="bg-muted/30 rounded p-3">
                                      <div className="flex items-start justify-between gap-2 mb-2">
                                        <div className="flex-1">
                                          <p className="text-xs font-medium">{item.name}</p>
                                          <div className="flex items-center gap-2 mt-1">
                                            {item.sku && (
                                              <Badge variant="outline" className="text-[10px]">
                                                SKU: {item.sku}
                                              </Badge>
                                            )}
                                            <span className="text-[10px] text-muted-foreground">
                                              Qty: {item.quantity} • ${item.unitPrice}
                                            </span>
                                          </div>
                                        </div>
                                      </div>
                                      {item.warehouseBin && (
                                        <div className="flex items-center gap-2 text-xs text-green-600">
                                          <MapPin className="h-3 w-3" />
                                          <span className="font-medium">
                                            {item.warehouseBin.aisleName} › {item.warehouseBin.shelfName} › {item.warehouseBin.binName}
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>

                              {/* Issues */}
                              {result.issues && result.issues.length > 0 && (
                                <div className="bg-orange-500/10 border border-orange-500/30 rounded p-3">
                                  <p className="text-xs font-medium text-orange-600 mb-2">Issues Detected</p>
                                  <ul className="text-xs space-y-1">
                                    {result.issues.map((issue: string, i: number) => (
                                      <li key={i} className="text-orange-700">• {issue}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
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
