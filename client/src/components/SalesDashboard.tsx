import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { format, subMonths, startOfMonth, parseISO, startOfDay, getYear, subYears, addYears } from "date-fns";
import { TrendingUp, DollarSign, Target, GitCompare } from "lucide-react";
import { DateRangeValue } from "./DateRangeSelector";
import PlatformPerformance from "./PlatformPerformance";
import PlatformOrdersDrawer from "./PlatformOrdersDrawer";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type TimePeriod = 'mtd' | 'ytd' | '1y' | '5y';

interface SalesDashboardProps {
  period: TimePeriod;
  dateRange?: DateRangeValue;
  onItemClick?: (type: 'order' | 'inventory', id: number | string) => void;
}

interface Order {
  id: string;
  orderNumber: string;
  marketplace: string | null;
  orderDate: string;
  orderStatus: string;
  orderTotal: string;
  customerUsername: string;
}

export default function SalesDashboard({ period, dateRange = 'mtd', onItemClick }: SalesDashboardProps) {
  const [platformDrawer, setPlatformDrawer] = useState<{ open: boolean; platform: string }>({
    open: false,
    platform: '',
  });
  
  const currentYear = new Date().getFullYear();
  const [compareMode, setCompareMode] = useState(false);
  const [selectedCompareYears, setSelectedCompareYears] = useState<number[]>([currentYear - 1, currentYear - 2]);
  
  const { data: orders = [], isLoading } = useQuery<Order[]>({
    queryKey: ['/api/orders'],
  });

  // Get available years from orders
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    orders.forEach(order => {
      const year = getYear(parseISO(order.orderDate));
      years.add(year);
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [orders]);

  // Filter selected years to only include years with actual data
  // This ensures UI, chart, and metrics only show years from availableYears
  const validCompareYears = useMemo(() => {
    const nonCurrentYears = availableYears.filter(y => y !== currentYear);
    return selectedCompareYears.filter(y => nonCurrentYears.includes(y));
  }, [selectedCompareYears, availableYears, currentYear]);

  const handlePlatformClick = (platform: string) => {
    setPlatformDrawer({ open: true, platform });
  };

  const handlePlatformOrderClick = (orderId: string) => {
    // Keep platform drawer open, just open order detail as nested drawer
    onItemClick?.('order', orderId);
  };

  // Filter orders based on date range
  const getFilteredOrders = () => {
    if (dateRange === 'all') {
      return orders;
    }

    if (dateRange === 'mtd') {
      // Month-to-Date: from start of current month to today
      const startOfCurrentMonth = startOfMonth(new Date());
      return orders.filter(order => {
        const orderDate = parseISO(order.orderDate);
        return orderDate >= startOfCurrentMonth;
      });
    }

    const monthsToShow = dateRange === '2years' ? 24 :
                        dateRange === '1year' ? 12 :
                        dateRange === '6months' ? 6 : 3;
    
    // Start from the beginning of the month (N-1) months ago
    // This ensures we get exactly N months: current month + (N-1) prior months
    const cutoffDate = startOfMonth(subMonths(new Date(), monthsToShow - 1));
    
    return orders.filter(order => {
      const orderDate = parseISO(order.orderDate);
      return orderDate >= cutoffDate;
    });
  };

  const filteredOrders = getFilteredOrders();

  // Filter orders for selected platform
  const platformOrders = filteredOrders.filter(
    order => (order.marketplace || 'Unknown') === platformDrawer.platform
  );

  // Calculate sales data by month - adjust based on date range
  const getSalesData = () => {
    if (filteredOrders.length === 0) {
      return [];
    }

    // For MTD, show daily data for current month
    if (dateRange === 'mtd') {
      const today = new Date();
      const startOfCurrentMonth = startOfMonth(today);
      const daysInMonth = today.getDate(); // Number of days from start to today
      
      const days = Array.from({ length: daysInMonth }, (_, i) => {
        const dayDate = new Date(startOfCurrentMonth);
        dayDate.setDate(i + 1);
        return {
          date: format(dayDate, 'MMM d'),
          day: startOfDay(dayDate),
          sales: 0,
        };
      });

      // Aggregate orders into days
      filteredOrders.forEach(order => {
        if (order.orderTotal && !isNaN(Number(order.orderTotal))) {
          const orderDay = startOfDay(parseISO(order.orderDate));
          const dayData = days.find(d => d.day.getTime() === orderDay.getTime());
          if (dayData) {
            dayData.sales += Number(order.orderTotal);
          }
        }
      });

      return days.map(({ date, sales }) => ({
        date,
        sales: Math.round(sales),
      }));
    }

    let months: Array<{ date: string; month: Date; sales: number }>;
    
    if (dateRange === 'all') {
      // For 'all time', use the actual earliest to latest order dates
      const orderDates = filteredOrders.map(o => parseISO(o.orderDate));
      const earliestOrderDate = new Date(Math.min(...orderDates.map(d => d.getTime())));
      const latestOrderDate = new Date(Math.max(...orderDates.map(d => d.getTime())));
      
      // Start from the earliest order's month
      const startMonth = startOfMonth(earliestOrderDate);
      const endMonth = startOfMonth(latestOrderDate);
      
      // Calculate months between earliest and latest
      const monthDiff = (endMonth.getFullYear() - startMonth.getFullYear()) * 12 + 
                        (endMonth.getMonth() - startMonth.getMonth()) + 1;
      
      // Limit to most recent 120 months (10 years) if history is very long
      const monthsToShow = Math.min(monthDiff, 120);
      const adjustedStartMonth = monthsToShow < monthDiff 
        ? new Date(endMonth.getFullYear(), endMonth.getMonth() - monthsToShow + 1, 1)
        : startMonth;
      
      // Generate months from adjusted start to latest
      months = Array.from({ length: monthsToShow }, (_, i) => {
        const monthDate = new Date(adjustedStartMonth);
        monthDate.setMonth(adjustedStartMonth.getMonth() + i);
        return {
          date: format(monthDate, 'MMM yy'),
          month: startOfMonth(monthDate),
          sales: 0,
        };
      });
    } else {
      // For specific date ranges, use predefined periods from current date
      const monthsToShow = dateRange === '2years' ? 24 :
                          dateRange === '1year' ? 12 :
                          dateRange === '6months' ? 6 : 3;
      
      months = Array.from({ length: monthsToShow }, (_, i) => {
        const date = subMonths(new Date(), monthsToShow - 1 - i);
        return {
          date: format(date, 'MMM yy'),
          month: startOfMonth(date),
          sales: 0,
        };
      });
    }

    // Aggregate orders into months
    filteredOrders.forEach(order => {
      if (order.orderTotal && !isNaN(Number(order.orderTotal))) {
        const orderMonth = startOfMonth(parseISO(order.orderDate));
        const monthData = months.find(m => m.month.getTime() === orderMonth.getTime());
        if (monthData) {
          monthData.sales += Number(order.orderTotal);
        }
      }
    });

    return months.map(({ date, sales }) => ({
      date,
      sales: Math.round(sales),
    }));
  };

  // Year comparison data generation - respects date range filter
  const getYearComparisonData = () => {
    const years = [currentYear, ...validCompareYears];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    // Determine the date range boundaries for comparison
    let startDate: Date, endDate: Date;
    const now = new Date();
    
    if (dateRange === 'mtd') {
      startDate = startOfMonth(now);
      endDate = now;
    } else if (dateRange === '3months') {
      // 3 months = current month + 2 prior months
      startDate = startOfMonth(subMonths(now, 2));
      endDate = now;
    } else if (dateRange === '6months') {
      // 6 months = current month + 5 prior months
      startDate = startOfMonth(subMonths(now, 5));
      endDate = now;
    } else if (dateRange === '1year') {
      // 12 months = current month + 11 prior months
      startDate = startOfMonth(subMonths(now, 11));
      endDate = now;
    } else if (dateRange === '2years') {
      // 24 months = current month + 23 prior months
      startDate = startOfMonth(subMonths(now, 23));
      endDate = now;
    } else {
      // 'all' - get oldest order date
      const oldestOrder = orders.reduce((oldest, order) => {
        const orderDate = parseISO(order.orderDate);
        return !oldest || orderDate < oldest ? orderDate : oldest;
      }, null as Date | null);
      startDate = oldestOrder || subYears(now, 10);
      endDate = now;
    }
    
    // Create data structure only for months within the date range
    const comparisonData: Array<{
      month: string;
      monthIndex: number;
      bucketDate: Date;  // Full date for accurate matching
      [key: string]: string | number | Date;
    }> = [];
    
    // Generate month buckets from startDate to endDate
    let currentDate = startOfMonth(startDate);
    const endMonth = startOfMonth(endDate);
    
    // Initialize bucket with all years
    const initialBucketData: Record<string, number> = { [`${currentYear}`]: 0 };
    validCompareYears.forEach(year => {
      initialBucketData[`${year}`] = 0;
    });
    
    while (currentDate <= endMonth) {
      const monthIndex = currentDate.getMonth();
      const monthYear = currentDate.getFullYear();
      const monthLabel = dateRange === 'mtd' 
        ? monthNames[monthIndex]  // Just month name for MTD
        : `${monthNames[monthIndex]} ${monthYear.toString().slice(-2)}`; // Month + year for longer ranges
      
      comparisonData.push({
        month: monthLabel,
        monthIndex,
        bucketDate: new Date(currentDate),  // Store full date for matching
        ...initialBucketData,
      });
      
      currentDate = subMonths(currentDate, -1); // Add 1 month
    }

    // Aggregate orders by year and month, respecting the same date range window
    orders.forEach(order => {
      if (!order.orderTotal || isNaN(Number(order.orderTotal))) return;
      
      const orderDate = parseISO(order.orderDate);
      const year = getYear(orderDate);
      
      // Only process orders from the comparison years
      if (!years.includes(year)) return;
      
      // Apply same date range filter logic for each year
      // For example, if we're looking at Oct 1-13 this year, only include Oct 1-13 for previous years
      const yearDiff = currentYear - year;
      const compareStartDate = subYears(startDate, yearDiff);
      const compareEndDate = subYears(endDate, yearDiff);
      
      if (orderDate >= compareStartDate && orderDate <= compareEndDate) {
        // Find the bucket for this order's month by matching the year-adjusted month
        const orderMonth = startOfMonth(orderDate);
        // Shift the order date to current year's timeline for bucket matching
        // For older years, we need to ADD years to bring them forward to current year timeline
        const adjustedMonth = addYears(orderMonth, yearDiff);
        
        const bucketIndex = comparisonData.findIndex(bucket => {
          const bucketDateObj = bucket.bucketDate as Date;
          return bucketDateObj.getTime() === adjustedMonth.getTime();
        });
        
        if (bucketIndex !== -1) {
          const monthData = comparisonData[bucketIndex];
          const currentValue = monthData[`${year}`] as number || 0;
          monthData[`${year}`] = currentValue + Number(order.orderTotal);
        }
      }
    });

    // Round values and return
    return comparisonData.map(d => {
      const roundedData: Record<string, any> = {
        month: d.month,
        monthIndex: d.monthIndex,
        bucketDate: d.bucketDate,
        [`${currentYear}`]: Math.round((d[`${currentYear}`] as number) || 0),
      };
      selectedCompareYears.forEach(year => {
        roundedData[`${year}`] = Math.round((d[`${year}`] as number) || 0);
      });
      return roundedData;
    });
  };

  // Get top revenue orders
  const topRevenueOrders = filteredOrders
    .filter(order => order.orderTotal && !isNaN(Number(order.orderTotal)))
    .sort((a, b) => Number(b.orderTotal) - Number(a.orderTotal))
    .slice(0, 5);

  // Get recent high-value sales
  const recentHighValueSales = filteredOrders
    .filter(order => order.orderTotal && Number(order.orderTotal) >= 100)
    .sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime())
    .slice(0, 5);

  // Calculate total revenue and average
  const totalRevenue = filteredOrders.reduce((sum, order) => 
    sum + (order.orderTotal && !isNaN(Number(order.orderTotal)) ? Number(order.orderTotal) : 0), 0
  );
  const averageOrderValue = filteredOrders.length > 0 ? totalRevenue / filteredOrders.length : 0;

  const data = getSalesData();
  const average = data.length > 0 ? Math.round(data.reduce((sum, d) => sum + d.sales, 0) / data.length) : 0;

  if (isLoading) {
    return (
      <div className="p-2 space-y-1.5 bg-gradient-to-br from-lego-green/5 to-transparent rounded-lg border border-lego-green/10 shadow-[0_0_15px_rgba(34,197,94,0.1)]">
        <div className="bg-gray-900/50 border border-lego-green/20 rounded-lg p-2">
          <div className="text-xs text-gray-400 animate-pulse">Loading sales data...</div>
        </div>
      </div>
    );
  }

  const comparisonData = compareMode ? getYearComparisonData() : [];
  const comparisonYears = [currentYear, ...validCompareYears];
  
  // Colors for year lines in comparison chart - dynamic palette
  const colorPalette = [
    'hsl(140 70% 50%)',  // Green for current year
    'hsl(200 70% 50%)',  // Blue
    'hsl(280 70% 50%)',  // Purple
    'hsl(30 70% 50%)',   // Orange
    'hsl(340 70% 50%)',  // Pink
    'hsl(180 70% 50%)',  // Cyan
    'hsl(60 70% 50%)',   // Yellow
    'hsl(260 70% 50%)',  // Violet
  ];
  
  const yearColors: Record<number, string> = {
    [currentYear]: colorPalette[0],
  };
  validCompareYears.forEach((year, index) => {
    yearColors[year] = colorPalette[(index + 1) % colorPalette.length];
  });

  return (
    <div className="p-2 space-y-1.5 bg-gradient-to-br from-lego-green/5 to-transparent rounded-lg border border-lego-green/10 shadow-[0_0_15px_rgba(34,197,94,0.1)]">
      {/* Year Comparison Toggle */}
      <div className="bg-gray-900/50 border border-lego-green/20 rounded-lg p-2">
        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={() => setCompareMode(!compareMode)}
            className={`flex items-center gap-1.5 text-[10px] font-bold py-1 px-2 rounded transition-all ${
              compareMode
                ? 'bg-lego-orange text-white border border-lego-orange'
                : 'bg-gray-900 text-gray-400 border border-gray-700 hover-elevate'
            }`}
            data-testid="button-compare-years"
          >
            <GitCompare className="w-3 h-3" />
            <span>Compare Years</span>
          </button>
          
          {compareMode && availableYears.length > 0 && (
            <div className="flex items-center gap-1 flex-1 overflow-x-auto">
              <span className="text-[9px] text-gray-500 flex-shrink-0">vs</span>
              <div className="flex gap-1 flex-nowrap">
                {(() => {
                  const nonCurrentYears = availableYears.filter(y => y !== currentYear);
                  // Sort years: selected first (descending), then unselected (descending)
                  // validCompareYears is already filtered to only include years with data
                  const selectedYears = [...validCompareYears].sort((a, b) => b - a);
                  const unselectedYears = nonCurrentYears
                    .filter(y => !validCompareYears.includes(y))
                    .sort((a, b) => b - a);
                  const sortedYears = [...selectedYears, ...unselectedYears];
                  
                  return sortedYears.map(year => {
                    const isSelected = selectedCompareYears.includes(year);
                    return (
                      <button
                        key={year}
                        onClick={() => {
                          if (isSelected) {
                            setSelectedCompareYears(selectedCompareYears.filter(y => y !== year));
                          } else {
                            setSelectedCompareYears([...selectedCompareYears, year].sort((a, b) => b - a));
                          }
                        }}
                        aria-pressed={isSelected}
                        className={`text-[10px] px-2 py-0.5 rounded transition-all flex-shrink-0 ${
                          isSelected
                            ? 'bg-blue-600 text-white border border-blue-500'
                            : 'bg-gray-800 text-gray-400 border border-gray-700 hover-elevate'
                        }`}
                        data-testid={`year-toggle-${year}`}
                      >
                        {year}
                      </button>
                    );
                  });
                })()}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Chart */}
      <div className="bg-gray-900/50 border border-lego-green/20 rounded-lg p-2">
        {!compareMode ? (
          <>
            <div className="mb-1 text-xs text-gray-400">
              Average: <span className="text-lego-green font-mono font-semibold">${average.toLocaleString()}</span>
              <span className="ml-2 text-gray-500">Total Revenue: ${Math.round(totalRevenue).toLocaleString()}</span>
            </div>
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="date" stroke="#9CA3AF" style={{ fontSize: '10px' }} />
                <YAxis stroke="#9CA3AF" style={{ fontSize: '10px' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '6px', fontSize: '12px' }}
                  labelStyle={{ color: '#D1D5DB' }}
                />
                <Line type="monotone" dataKey="sales" stroke="hsl(140 70% 50%)" strokeWidth={2} dot={{ fill: 'hsl(140 70% 50%)', r: 1 }} />
              </LineChart>
            </ResponsiveContainer>
          </>
        ) : (
          <>
            <div className="mb-1 text-xs text-gray-400">
              <span className="text-lego-green font-semibold">Year-over-Year Comparison</span>
            </div>
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={comparisonData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="month" stroke="#9CA3AF" style={{ fontSize: '10px' }} />
                <YAxis stroke="#9CA3AF" style={{ fontSize: '10px' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '6px', fontSize: '12px' }}
                  labelStyle={{ color: '#D1D5DB' }}
                />
                <Legend wrapperStyle={{ fontSize: '10px' }} />
                {comparisonYears.map(year => (
                  <Line 
                    key={year}
                    type="monotone" 
                    dataKey={`${year}`} 
                    stroke={yearColors[year]} 
                    strokeWidth={2} 
                    dot={{ fill: yearColors[year], r: 2 }}
                    name={year.toString()}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </>
        )}
      </div>

      {/* Year-over-Year Growth Metrics */}
      {compareMode && validCompareYears.length > 0 && (
        <div className="bg-gray-900/50 border border-purple-500/20 rounded-lg p-3" data-testid="section-yoy-metrics">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-3.5 h-3.5 text-purple-400" />
            <h3 className="text-[10px] font-semibold text-purple-400 uppercase tracking-wide">Year-over-Year Growth</h3>
          </div>
          <div className={`grid gap-2 ${validCompareYears.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {(() => {
              // Calculate total revenue for each year using the same date range filter
              const yearTotals = comparisonYears.reduce((acc, year) => {
                // Sum the comparison data for this year
                const total = comparisonData.reduce((sum, monthData) => {
                  const value = monthData[`${year}`] as number || 0;
                  return sum + value;
                }, 0);
                acc[year] = total;
                return acc;
              }, {} as Record<number, number>);

              return validCompareYears.map(compareYear => {
                const growth = yearTotals[compareYear] > 0
                  ? ((yearTotals[currentYear] - yearTotals[compareYear]) / yearTotals[compareYear]) * 100
                  : 0;

                return (
                  <div key={compareYear} className="bg-gray-800/50 rounded p-2">
                    <div className="text-[9px] text-gray-500 mb-1">
                      {currentYear} vs {compareYear}
                    </div>
                    <div className={`text-sm font-mono font-bold ${growth >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {growth >= 0 ? '+' : ''}{growth.toFixed(1)}%
                    </div>
                    <div className="text-[9px] text-gray-400 mt-1">
                      ${Math.round(yearTotals[currentYear]).toLocaleString()} vs ${Math.round(yearTotals[compareYear]).toLocaleString()}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}

      {/* Highlights - Top Revenue Orders */}
      <div className="bg-gray-900/50 border border-green-500/20 rounded-lg p-3" data-testid="section-top-revenue">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="w-3.5 h-3.5 text-green-400" />
          <h3 className="text-[10px] font-semibold text-green-400 uppercase tracking-wide">Highlights - Top Revenue Orders</h3>
        </div>
        <div className="space-y-1">
          {topRevenueOrders.length > 0 ? (
            topRevenueOrders.map((order) => (
              <div 
                key={order.id} 
                onClick={() => onItemClick?.('order', order.id)}
                className="flex justify-between items-center text-[10px] hover-elevate rounded px-2 py-0.5 cursor-pointer"
                data-testid={`top-revenue-${order.id}`}
              >
                <div className="flex items-center gap-1.5">
                  <DollarSign className="w-3 h-3 text-green-400 flex-shrink-0" />
                  <span className="text-gray-300 font-mono">#{order.orderNumber}</span>
                  <span className="text-gray-500 text-[9px]">{order.customerUsername}</span>
                </div>
                <span className="text-lego-green font-mono text-xs ml-2">${Number(order.orderTotal).toFixed(2)}</span>
              </div>
            ))
          ) : (
            <div className="text-[9px] text-gray-500 italic">No revenue data available</div>
          )}
        </div>
      </div>

      {/* Recent Activity - High Value Sales */}
      <div className="bg-gray-900/50 border border-blue-500/20 rounded-lg p-3" data-testid="section-recent-high-value">
        <div className="flex items-center gap-2 mb-2">
          <Target className="w-3.5 h-3.5 text-blue-400" />
          <h3 className="text-[10px] font-semibold text-blue-400 uppercase tracking-wide">Recent Activity - High Value Sales ($100+)</h3>
        </div>
        <div className="space-y-1">
          {recentHighValueSales.length > 0 ? (
            recentHighValueSales.map((order) => (
              <div 
                key={order.id} 
                onClick={() => onItemClick?.('order', order.id)}
                className="flex justify-between items-center text-[10px] hover-elevate rounded px-2 py-0.5 cursor-pointer"
                data-testid={`high-value-sale-${order.id}`}
              >
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                  <span className="text-gray-300 font-mono">#{order.orderNumber}</span>
                  <span className="text-gray-500 text-[9px]">{order.customerUsername}</span>
                  <span className="text-gray-600 text-[9px]">{new Date(order.orderDate).toLocaleDateString()}</span>
                </div>
                <span className="text-lego-green font-mono ml-2">${Number(order.orderTotal).toFixed(2)}</span>
              </div>
            ))
          ) : (
            <div className="text-[9px] text-gray-500 italic">No high value sales</div>
          )}
        </div>
      </div>

      {/* Action Items - Sales Metrics */}
      <div className="bg-gray-900/50 border border-yellow-500/20 rounded-lg p-3" data-testid="section-sales-metrics">
        <div className="flex items-center gap-2 mb-2">
          <Target className="w-3.5 h-3.5 text-yellow-400" />
          <h3 className="text-[10px] font-semibold text-yellow-400 uppercase tracking-wide">Key Metrics</h3>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center">
            <div className="text-[9px] text-gray-500">Total Orders</div>
            <div className="text-xs text-gray-300 font-mono">{filteredOrders.length}</div>
          </div>
          <div className="text-center">
            <div className="text-[9px] text-gray-500">Avg Order Value</div>
            <div className="text-xs text-lego-green font-mono">${averageOrderValue.toFixed(2)}</div>
          </div>
          <div className="text-center">
            <div className="text-[9px] text-gray-500">Total Revenue</div>
            <div className="text-xs text-lego-green font-mono">${Math.round(totalRevenue).toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* Platform Performance */}
      <div className="bg-gray-900/50 border border-blue-500/20 rounded-lg p-3" data-testid="section-platform-performance">
        <PlatformPerformance orders={filteredOrders} onPlatformClick={handlePlatformClick} />
      </div>

      {/* Platform Orders Drawer */}
      <PlatformOrdersDrawer
        open={platformDrawer.open}
        onClose={() => setPlatformDrawer({ open: false, platform: '' })}
        platform={platformDrawer.platform}
        orders={platformOrders}
        onOrderClick={handlePlatformOrderClick}
      />
    </div>
  );
}
