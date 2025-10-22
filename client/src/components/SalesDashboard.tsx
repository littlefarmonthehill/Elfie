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
  const [compareMode, setCompareMode] = useState(false); // Start with comparison disabled
  const [comparisonType, setComparisonType] = useState<'year' | 'platform'>('year'); // Toggle between year/platform
  const [selectedCompareYears, setSelectedCompareYears] = useState<number[]>([currentYear - 1, currentYear - 2]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  
  // Helper function to safely parse dates with fallback
  const safeParseDate = (dateString: string): Date => {
    try {
      const date = parseISO(dateString);
      if (!isNaN(date.getTime())) return date;
      return new Date(dateString);
    } catch {
      return new Date(dateString);
    }
  };
  
  // Helper function to parse order totals that may have currency formatting
  const parseOrderTotal = (orderTotal: string | null | undefined): number => {
    if (!orderTotal) return 0;
    // Remove currency symbols, thousands separators, and other non-numeric chars except digits, minus, and decimal
    const cleaned = orderTotal.replace(/[^0-9.-]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  };
  
  // Build query URL with date range parameter
  const buildQueryUrl = (baseUrl: string) => {
    return `${baseUrl}?range=${dateRange}`;
  };

  const { data: orders = [], isLoading } = useQuery<Order[]>({
    queryKey: ['/api/orders', dateRange],
    queryFn: async () => {
      const url = buildQueryUrl('/api/orders');
      console.log(`[SalesDashboard] Fetching orders with dateRange="${dateRange}", URL: ${url}`);
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch orders');
      const data = await response.json();
      console.log(`[SalesDashboard] Received ${data.length} orders for dateRange="${dateRange}"`);
      return data;
    },
    staleTime: 30000, // Cache for 30 seconds
  });

  // Get available years from orders
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    orders.forEach(order => {
      const year = getYear(safeParseDate(order.orderDate));
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
        const orderDate = safeParseDate(order.orderDate);
        return orderDate >= startOfCurrentMonth;
      });
    }

    if (dateRange === 'lastmonth') {
      // Last Month: entire previous calendar month
      const startOfLastMonth = startOfMonth(subMonths(new Date(), 1));
      const startOfCurrentMonth = startOfMonth(new Date());
      return orders.filter(order => {
        const orderDate = safeParseDate(order.orderDate);
        return orderDate >= startOfLastMonth && orderDate < startOfCurrentMonth;
      });
    }

    const monthsToShow = dateRange === '2years' ? 24 :
                        dateRange === '1year' ? 12 :
                        dateRange === '6months' ? 6 : 3;
    
    // Start from the beginning of the month (N-1) months ago
    // This ensures we get exactly N months: current month + (N-1) prior months
    const cutoffDate = startOfMonth(subMonths(new Date(), monthsToShow - 1));
    
    return orders.filter(order => {
      const orderDate = safeParseDate(order.orderDate);
      return orderDate >= cutoffDate;
    });
  };

  const filteredOrders = getFilteredOrders();

  // Get available platforms from FILTERED orders (only show platforms with data in selected date range)
  const availablePlatforms = useMemo(() => {
    const platforms = new Set<string>();
    filteredOrders.forEach(order => {
      const platform = order.marketplace || 'Unknown';
      platforms.add(platform);
    });
    return Array.from(platforms).sort();
  }, [filteredOrders]);

  // Filter selected platforms to only include platforms with actual data
  const validPlatforms = useMemo(() => {
    return selectedPlatforms.filter(p => availablePlatforms.includes(p));
  }, [selectedPlatforms, availablePlatforms]);

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
        const total = parseOrderTotal(order.orderTotal);
        if (total > 0) {
          const orderDay = startOfDay(safeParseDate(order.orderDate));
          const dayData = days.find(d => d.day.getTime() === orderDay.getTime());
          if (dayData) {
            dayData.sales += total;
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
      // Filter out invalid dates to prevent NaN/Invalid Date issues
      const orderDates = filteredOrders
        .map(o => {
          // Try parseISO first, then fallback to new Date()
          try {
            const date = safeParseDate(o.orderDate);
            return !isNaN(date.getTime()) ? date : new Date(o.orderDate);
          } catch {
            return new Date(o.orderDate);
          }
        })
        .filter(d => !isNaN(d.getTime())); // Remove invalid dates
      
      if (orderDates.length === 0) {
        // No valid dates - this shouldn't happen, but log it
        console.error('SalesDashboard: No valid order dates found in "all" timeframe', {
          totalOrders: filteredOrders.length,
          sampleDates: filteredOrders.slice(0, 3).map(o => o.orderDate)
        });
        return [];
      }
      
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
      const total = parseOrderTotal(order.orderTotal);
      if (total > 0) {
        // Use fallback date parser to handle various date formats
        let orderDate: Date;
        try {
          orderDate = safeParseDate(order.orderDate);
          if (isNaN(orderDate.getTime())) {
            orderDate = new Date(order.orderDate);
          }
        } catch {
          orderDate = new Date(order.orderDate);
        }
        
        // Skip if still invalid
        if (isNaN(orderDate.getTime())) {
          console.warn('Invalid order date:', order.orderDate, 'for order:', order.id);
          return;
        }
        
        const orderMonth = startOfMonth(orderDate);
        const monthData = months.find(m => m.month.getTime() === orderMonth.getTime());
        if (monthData) {
          monthData.sales += total;
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
        const orderDate = safeParseDate(order.orderDate);
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
      const total = parseOrderTotal(order.orderTotal);
      if (total <= 0) return;
      
      const orderDate = safeParseDate(order.orderDate);
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
          monthData[`${year}`] = currentValue + total;
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

  // Platform comparison data generation - respects date range filter
  const getPlatformComparisonData = () => {
    const platforms = validPlatforms;
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    // Determine the date range boundaries
    let startDate: Date, endDate: Date;
    const now = new Date();
    
    if (dateRange === 'mtd') {
      startDate = startOfMonth(now);
      endDate = now;
    } else if (dateRange === '3months') {
      startDate = startOfMonth(subMonths(now, 2));
      endDate = now;
    } else if (dateRange === '6months') {
      startDate = startOfMonth(subMonths(now, 5));
      endDate = now;
    } else if (dateRange === '1year') {
      startDate = startOfMonth(subMonths(now, 11));
      endDate = now;
    } else if (dateRange === '2years') {
      startDate = startOfMonth(subMonths(now, 23));
      endDate = now;
    } else {
      // 'all' - get oldest order date
      const oldestOrder = orders.reduce((oldest, order) => {
        const orderDate = safeParseDate(order.orderDate);
        return !oldest || orderDate < oldest ? orderDate : oldest;
      }, null as Date | null);
      startDate = oldestOrder || subYears(now, 10);
      endDate = now;
    }
    
    // Create data structure for months within the date range
    const comparisonData: Array<{
      month: string;
      monthIndex: number;
      bucketDate: Date;
      [key: string]: string | number | Date;
    }> = [];
    
    // Generate month buckets from startDate to endDate
    let currentDate = startOfMonth(startDate);
    const endMonth = startOfMonth(endDate);
    
    // Initialize bucket with all platforms
    const initialBucketData: Record<string, number> = {};
    platforms.forEach(platform => {
      initialBucketData[platform] = 0;
    });
    
    while (currentDate <= endMonth) {
      const monthIndex = currentDate.getMonth();
      const monthYear = currentDate.getFullYear();
      const monthLabel = dateRange === 'mtd' 
        ? monthNames[monthIndex]
        : `${monthNames[monthIndex]} ${monthYear.toString().slice(-2)}`;
      
      comparisonData.push({
        month: monthLabel,
        monthIndex,
        bucketDate: new Date(currentDate), // Store full date for accurate matching
        ...initialBucketData,
      });
      
      currentDate = subMonths(currentDate, -1); // Add 1 month
    }

    // Aggregate orders by platform and month
    filteredOrders.forEach(order => {
      const total = parseOrderTotal(order.orderTotal);
      if (total <= 0) return;
      
      const platform = order.marketplace || 'Unknown';
      if (!platforms.includes(platform)) return;
      
      const orderDate = safeParseDate(order.orderDate);
      const orderMonth = startOfMonth(orderDate);
      
      const bucketIndex = comparisonData.findIndex(bucket => {
        const bucketDateObj = bucket.bucketDate as Date;
        return bucketDateObj.getTime() === orderMonth.getTime();
      });
      
      if (bucketIndex !== -1) {
        const monthData = comparisonData[bucketIndex];
        const currentValue = monthData[platform] as number || 0;
        monthData[platform] = currentValue + total;
      }
    });

    // Round values and return
    return comparisonData.map(d => {
      const roundedData: Record<string, any> = {
        month: d.month,
        monthIndex: d.monthIndex,
        bucketDate: d.bucketDate,
      };
      platforms.forEach(platform => {
        roundedData[platform] = Math.round((d[platform] as number) || 0);
      });
      return roundedData;
    });
  };

  // Get top revenue orders
  const topRevenueOrders = filteredOrders
    .filter(order => parseOrderTotal(order.orderTotal) > 0)
    .sort((a, b) => parseOrderTotal(b.orderTotal) - parseOrderTotal(a.orderTotal))
    .slice(0, 5);

  // Get recent high-value sales
  const recentHighValueSales = filteredOrders
    .filter(order => parseOrderTotal(order.orderTotal) >= 100)
    .sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime())
    .slice(0, 5);

  // Calculate total revenue and average
  const totalRevenue = filteredOrders.reduce((sum, order) => 
    sum + parseOrderTotal(order.orderTotal), 0
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

  const comparisonData = compareMode 
    ? (comparisonType === 'year' ? getYearComparisonData() : getPlatformComparisonData())
    : [];
  const comparisonYears = [currentYear, ...validCompareYears];
  
  // Platform colors - matching PlatformPerformance component
  const PLATFORM_COLORS: Record<string, string> = {
    'BrickLink': '#FF8C00',
    'eBay': '#E53238',
    'Amazon': '#FF9900',
    'Etsy': '#F1641E',
    'Facebook': '#1877F2',
    'Unknown': '#6B7280',
    'Other': '#9CA3AF',
  };
  
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
      {/* Comparison Controls */}
      <div className="bg-gray-900/50 border border-lego-green/20 rounded-lg p-2 space-y-2">
        {/* Row 1: Compare toggle and Year/Platform mode buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCompareMode(!compareMode)}
            className={`flex items-center gap-1.5 text-[10px] md:text-sm font-bold py-1 px-2 rounded transition-all ${
              compareMode
                ? 'bg-lego-orange text-white border border-lego-orange'
                : 'bg-gray-900 text-gray-400 border border-gray-700 hover-elevate'
            }`}
            data-testid="button-compare-toggle"
          >
            <GitCompare className="w-3 h-3" />
            <span>Compare</span>
          </button>
          
          {/* Mode Toggle - Year vs Platform */}
          {compareMode && (
            <div className="flex gap-1">
              <button
                onClick={() => setComparisonType('year')}
                className={`text-[10px] md:text-sm px-2 py-1 rounded transition-all ${
                  comparisonType === 'year'
                    ? 'bg-purple-600 text-white border border-purple-500'
                    : 'bg-gray-800 text-gray-400 border border-gray-700 hover-elevate'
                }`}
                data-testid="button-compare-year"
              >
                Years
              </button>
              <button
                onClick={() => setComparisonType('platform')}
                className={`text-[10px] md:text-sm px-2 py-1 rounded transition-all ${
                  comparisonType === 'platform'
                    ? 'bg-purple-600 text-white border border-purple-500'
                    : 'bg-gray-800 text-gray-400 border border-gray-700 hover-elevate'
                }`}
                data-testid="button-compare-platform"
              >
                Platforms
              </button>
            </div>
          )}
        </div>
        
        {/* Row 2: Year Selection (full width for easier mobile tapping) */}
        {compareMode && comparisonType === 'year' && availableYears.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto">
            <span className="text-[9px] md:text-xs text-gray-500 flex-shrink-0">vs</span>
            <div className="flex gap-2 flex-nowrap">
              {(() => {
                const nonCurrentYears = availableYears.filter(y => y !== currentYear);
                // Sort years: selected first (descending), then unselected (descending)
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
                      className={`text-[9px] md:text-xs font-bold py-1 px-2 rounded transition-all flex-shrink-0 ${
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
        
        {/* Row 2: Platform Selection (full width for easier mobile tapping) */}
        {compareMode && comparisonType === 'platform' && availablePlatforms.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto">
            <span className="text-[9px] md:text-xs text-gray-500 flex-shrink-0">select</span>
            <div className="flex gap-2 flex-nowrap">
              {(() => {
                // Sort platforms: selected first (alphabetical), then unselected (alphabetical)
                const selectedItems = [...validPlatforms].sort((a, b) => a.localeCompare(b));
                const unselectedItems = availablePlatforms
                  .filter(p => !validPlatforms.includes(p))
                  .sort((a, b) => a.localeCompare(b));
                const sortedPlatforms = [...selectedItems, ...unselectedItems];
                
                return sortedPlatforms.map(platform => {
                  const isSelected = selectedPlatforms.includes(platform);
                  return (
                    <button
                      key={platform}
                      onClick={() => {
                        if (isSelected) {
                          setSelectedPlatforms(selectedPlatforms.filter(p => p !== platform));
                        } else {
                          setSelectedPlatforms([...selectedPlatforms, platform].sort((a, b) => a.localeCompare(b)));
                        }
                      }}
                      aria-pressed={isSelected}
                      className={`text-[9px] md:text-xs font-bold py-1 px-2 rounded transition-all flex-shrink-0 ${
                        isSelected
                          ? 'bg-blue-600 text-white border border-blue-500'
                          : 'bg-gray-800 text-gray-400 border border-gray-700 hover-elevate'
                      }`}
                      data-testid={`platform-toggle-${platform.toLowerCase().replace(/\s+/g, '-')}`}
                    >
                      {platform}
                    </button>
                  );
                });
              })()}
            </div>
          </div>
        )}
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
        ) : comparisonType === 'year' ? (
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
                    dot={{ fill: yearColors[year], r: 1 }}
                    name={year.toString()}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </>
        ) : (
          <>
            <div className="mb-1 text-xs text-gray-400">
              <span className="text-lego-green font-semibold">Platform Comparison</span>
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
                {validPlatforms.map(platform => (
                  <Line 
                    key={platform}
                    type="monotone" 
                    dataKey={platform} 
                    stroke={PLATFORM_COLORS[platform] || PLATFORM_COLORS['Other']} 
                    strokeWidth={2} 
                    dot={{ fill: PLATFORM_COLORS[platform] || PLATFORM_COLORS['Other'], r: 1 }}
                    name={platform}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </>
        )}
      </div>

      {/* Comparison Metrics */}
      {compareMode && comparisonType === 'year' && validCompareYears.length > 0 && (
        <div className="bg-gray-900/50 border border-purple-500/20 rounded-lg p-3" data-testid="section-yoy-metrics">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-purple-400" />
            <h3 className="text-xs md:text-base lg:text-lg font-semibold text-purple-400 uppercase tracking-wide">Year-over-Year Growth</h3>
          </div>
          <div className={`grid gap-2 ${validCompareYears.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {(() => {
              // Calculate total revenue for each year using the same date range filter
              const yearTotals = comparisonYears.reduce((acc, year) => {
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
                    <div className="text-[9px] md:text-xs text-gray-500 mb-1">
                      {currentYear} vs {compareYear}
                    </div>
                    <div className={`text-sm font-mono font-bold ${growth >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {growth >= 0 ? '+' : ''}{growth.toFixed(1)}%
                    </div>
                    <div className="text-[9px] md:text-xs text-gray-400 mt-1">
                      ${Math.round(yearTotals[currentYear]).toLocaleString()} vs ${Math.round(yearTotals[compareYear]).toLocaleString()}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}

      {/* Platform Comparison Metrics */}
      {compareMode && comparisonType === 'platform' && validPlatforms.length > 0 && (
        <div className="bg-gray-900/50 border border-purple-500/20 rounded-lg p-3" data-testid="section-platform-metrics">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-purple-400" />
            <h3 className="text-xs md:text-base lg:text-lg font-semibold text-purple-400 uppercase tracking-wide">Platform Performance</h3>
          </div>
          <div className={`grid gap-2 ${validPlatforms.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {(() => {
              // Calculate total revenue for each platform using the same date range filter
              const platformTotals = validPlatforms.reduce((acc, platform) => {
                const total = comparisonData.reduce((sum, monthData) => {
                  const value = monthData[platform] as number || 0;
                  return sum + value;
                }, 0);
                acc[platform] = total;
                return acc;
              }, {} as Record<string, number>);

              const totalRevenue = Object.values(platformTotals).reduce((sum, val) => sum + val, 0);

              return validPlatforms.map(platform => {
                const revenue = platformTotals[platform];
                const percentage = totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0;

                return (
                  <div key={platform} className="bg-gray-800/50 rounded p-2">
                    <div className="flex items-center gap-1 mb-1">
                      <div 
                        className="w-2 h-2 rounded-full" 
                        style={{ backgroundColor: PLATFORM_COLORS[platform] || PLATFORM_COLORS['Other'] }}
                      />
                      <div className="text-[9px] md:text-xs text-gray-500">
                        {platform}
                      </div>
                    </div>
                    <div className="text-sm font-mono font-bold text-white">
                      ${Math.round(revenue).toLocaleString()}
                    </div>
                    <div className="text-[9px] md:text-xs text-gray-400 mt-1">
                      {percentage.toFixed(1)}% of total
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
          <TrendingUp className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-green-400" />
          <h3 className="text-xs md:text-base lg:text-lg font-semibold text-green-400 uppercase tracking-wide">Highlights - Top Revenue Orders</h3>
        </div>
        <div className="space-y-1.5">
          {topRevenueOrders.length > 0 ? (
            topRevenueOrders.map((order) => (
              <div 
                key={order.id} 
                onClick={() => onItemClick?.('order', order.id)}
                className="flex justify-between items-center hover-elevate rounded px-2 py-1 cursor-pointer"
                data-testid={`top-revenue-${order.id}`}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <DollarSign className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-green-400 flex-shrink-0" />
                  <span className="text-gray-200 font-mono text-xs md:text-base lg:text-lg font-medium">#{order.orderNumber}</span>
                  <span className="text-gray-400 text-[11px] md:text-sm lg:text-base">{order.customerUsername}</span>
                </div>
                <span className="text-lego-green font-mono font-medium text-xs md:text-base lg:text-lg ml-2 flex-shrink-0">${parseOrderTotal(order.orderTotal).toFixed(2)}</span>
              </div>
            ))
          ) : (
            <div className="text-[11px] text-gray-500 italic">No revenue data available</div>
          )}
        </div>
      </div>

      {/* Recent Activity - High Value Sales */}
      <div className="bg-gray-900/50 border border-blue-500/20 rounded-lg p-3" data-testid="section-recent-high-value">
        <div className="flex items-center gap-2 mb-2">
          <Target className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-blue-400" />
          <h3 className="text-xs md:text-base lg:text-lg font-semibold text-blue-400 uppercase tracking-wide">Recent Activity - High Value Sales ($100+)</h3>
        </div>
        <div className="space-y-1.5">
          {recentHighValueSales.length > 0 ? (
            recentHighValueSales.map((order) => (
              <div 
                key={order.id} 
                onClick={() => onItemClick?.('order', order.id)}
                className="flex justify-between items-center hover-elevate rounded px-2 py-1 cursor-pointer"
                data-testid={`high-value-sale-${order.id}`}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />
                  <span className="text-gray-200 font-mono text-xs md:text-base lg:text-lg font-medium">#{order.orderNumber}</span>
                  <span className="text-gray-400 text-[11px] md:text-sm lg:text-base">{order.customerUsername}</span>
                  <span className="text-gray-400 text-[11px] md:text-sm lg:text-base">{new Date(order.orderDate).toLocaleDateString()}</span>
                </div>
                <span className="text-lego-green font-mono font-medium text-xs md:text-base lg:text-lg ml-2 flex-shrink-0">${parseOrderTotal(order.orderTotal).toFixed(2)}</span>
              </div>
            ))
          ) : (
            <div className="text-[11px] text-gray-500 italic">No high value sales</div>
          )}
        </div>
      </div>

      {/* Action Items - Sales Metrics */}
      <div className="bg-gray-900/50 border border-yellow-500/20 rounded-lg p-3" data-testid="section-sales-metrics">
        <div className="flex items-center gap-2 mb-2">
          <Target className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-yellow-400" />
          <h3 className="text-xs md:text-base lg:text-lg font-semibold text-yellow-400 uppercase tracking-wide">Key Metrics</h3>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center">
            <div className="text-[9px] md:text-sm lg:text-base text-gray-500">Total Orders</div>
            <div className="text-xs md:text-base lg:text-lg text-gray-300 font-mono">{filteredOrders.length}</div>
          </div>
          <div className="text-center">
            <div className="text-[9px] md:text-sm lg:text-base text-gray-500">Avg Order Value</div>
            <div className="text-xs md:text-base lg:text-lg text-lego-green font-mono">${averageOrderValue.toFixed(2)}</div>
          </div>
          <div className="text-center">
            <div className="text-[9px] md:text-sm lg:text-base text-gray-500">Total Revenue</div>
            <div className="text-xs md:text-base lg:text-lg text-lego-green font-mono">${Math.round(totalRevenue).toLocaleString()}</div>
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
