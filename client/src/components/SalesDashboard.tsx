import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { CompactModeProvider } from "@/contexts/CompactMode";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { format, subMonths, subYears, addYears, startOfMonth, parseISO, startOfDay, getYear, startOfWeek } from "date-fns";
import { TrendingUp, Target, GitCompare, BarChart2, Info, ArrowRight, X, Activity } from "lucide-react";
import MetricCard from "./MetricCard";
import { DateRangeValue } from "./DateRangeSelector";
import PlatformPerformance from "./PlatformPerformance";
import PlatformOrdersDrawer from "./PlatformOrdersDrawer";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type TimePeriod = 'mtd' | 'ytd' | '1y' | '5y';

interface SalesDashboardProps {
  period: TimePeriod;
  dateRange?: DateRangeValue;
  onItemClick?: (type: 'order' | 'inventory', id: number | string) => void;
  panelMode?: boolean;
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

export default function SalesDashboard({ period, dateRange = 'mtd', onItemClick, panelMode }: SalesDashboardProps) {
  const [platformDrawer, setPlatformDrawer] = useState<{ open: boolean; platform: string; productLine?: string }>({
    open: false,
    platform: '',
    productLine: undefined,
  });
  const [platformPerfOpen, setPlatformPerfOpen] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);

  const currentYear = new Date().getFullYear();
  const [compareMode, setCompareMode] = useState(false);
  const [comparisonType, setComparisonType] = useState<'year' | 'platform'>('year');
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
    queryKey: ['/api/orders/summary', dateRange],
    queryFn: async () => {
      const url = buildQueryUrl('/api/orders/summary');
      console.log(`[SalesDashboard] Fetching orders with dateRange="${dateRange}", URL: ${url}`);
      const startTime = Date.now();
      const response = await fetch(url);
      const fetchTime = Date.now() - startTime;
      console.log(`[SalesDashboard] Response received in ${fetchTime}ms, status: ${response.status}`);
      
      if (!response.ok) {
        console.error(`[SalesDashboard] Response not OK: ${response.status} ${response.statusText}`);
        throw new Error('Failed to fetch orders');
      }
      
      const data = await response.json();
      console.log(`[SalesDashboard] Received ${data.length} orders for dateRange="${dateRange}"`, {
        isArray: Array.isArray(data),
        firstOrder: data[0]?.id,
        dataType: typeof data
      });
      return data;
    },
    staleTime: 30000,
  });

  // Fetch adjustment summary (refunds + fees + shipping) for the selected date range
  const { data: adjustmentSummary } = useQuery<{
    totalRefunds: number;
    refundedOrderCount: number;
    totalFees: number;
    bricklinkFees: number;
    stripeFees: number;
    totalShipping: number;
    shippedOrderCount: number;
    avgShippingPerOrder: number;
  }>({
    queryKey: ['/api/orders/adjustments/summary', dateRange],
    queryFn: async () => {
      const response = await fetch(`/api/orders/adjustments/summary?dateRange=${dateRange}`);
      if (!response.ok) throw new Error('Failed to fetch adjustment summary');
      return response.json();
    },
    staleTime: 60000,
  });

  // Fetch per-order refund totals for chart deduction
  const { data: refundsByOrder = {} } = useQuery<Record<string, number>>({
    queryKey: ['/api/orders/adjustments/by-order', dateRange],
    queryFn: async () => {
      const response = await fetch(`/api/orders/adjustments/by-order?dateRange=${dateRange}`);
      if (!response.ok) throw new Error('Failed to fetch per-order refunds');
      return response.json();
    },
    staleTime: 60000,
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

  // Filter orders based on date range
  const getFilteredOrders = () => {
    if (dateRange === 'all') {
      console.log(`[SalesDashboard] Filtering with dateRange="all", returning ${orders.length} orders`);
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

    if (dateRange === 'prevyear') {
      const startOfPrevYear = new Date(new Date().getFullYear() - 1, 0, 1);
      const startOfCurrentYear = new Date(new Date().getFullYear(), 0, 1);
      return orders.filter(order => {
        const orderDate = safeParseDate(order.orderDate);
        return orderDate >= startOfPrevYear && orderDate < startOfCurrentYear;
      });
    }

    const monthsToShow = dateRange === '1year' ? 12 : 3;
    
    // Start from the beginning of the month (N-1) months ago
    // This ensures we get exactly N months: current month + (N-1) prior months
    const cutoffDate = startOfMonth(subMonths(new Date(), monthsToShow - 1));
    
    return orders.filter(order => {
      const orderDate = safeParseDate(order.orderDate);
      return orderDate >= cutoffDate;
    });
  };

  const filteredOrders = getFilteredOrders();
  
  // Debug logging for revenue calculations
  console.log(`[SalesDashboard] filteredOrders.length = ${filteredOrders.length}`);
  console.log(`[SalesDashboard] Sample order totals:`, filteredOrders.slice(0, 3).map(o => o.orderTotal));

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

  const platformOrders = filteredOrders.filter(order => (order.marketplace || 'Unknown') === platformDrawer.platform);

  // Calculate sales data with intelligent granularity based on date range
  const getSalesData = () => {
    if (filteredOrders.length === 0) {
      return [];
    }

    // MTD and Last Month: show daily data
    if (dateRange === 'mtd' || dateRange === 'lastmonth') {
      let startDate: Date, endDate: Date;
      
      if (dateRange === 'mtd') {
        startDate = startOfMonth(new Date());
        endDate = new Date();
      } else {
        // Last month
        startDate = startOfMonth(subMonths(new Date(), 1));
        endDate = startOfMonth(new Date());
      }
      
      const dayCount = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      
      const days = Array.from({ length: dayCount }, (_, i) => {
        const dayDate = new Date(startDate);
        dayDate.setDate(startDate.getDate() + i);
        return {
          date: format(dayDate, 'MMM d'),
          day: startOfDay(dayDate),
          sales: 0,
        };
      });

      // Aggregate orders into days
      filteredOrders.forEach(order => {
        const gross = parseOrderTotal(order.orderTotal);
        const total = Math.max(0, gross - (refundsByOrder[order.id] || 0));
        if (gross > 0) {
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

    // 3 months: show weekly data
    if (dateRange === '3months') {
      const monthsBack = 2;
      const startDate = startOfMonth(subMonths(new Date(), monthsBack));
      const endDate = new Date();
      
      // Get start of first week
      const firstWeek = startOfWeek(startDate, { weekStartsOn: 0 }); // Sunday
      const weekCount = Math.ceil((endDate.getTime() - firstWeek.getTime()) / (1000 * 60 * 60 * 24 * 7));
      
      const weeks = Array.from({ length: weekCount }, (_, i) => {
        const weekDate = new Date(firstWeek);
        weekDate.setDate(firstWeek.getDate() + (i * 7));
        return {
          date: format(weekDate, 'MMM d'),
          week: startOfWeek(weekDate, { weekStartsOn: 0 }),
          sales: 0,
        };
      });

      // Aggregate orders into weeks
      filteredOrders.forEach(order => {
        const gross = parseOrderTotal(order.orderTotal);
        const total = Math.max(0, gross - (refundsByOrder[order.id] || 0));
        if (gross > 0) {
          const orderDate = safeParseDate(order.orderDate);
          const orderWeek = startOfWeek(orderDate, { weekStartsOn: 0 });
          const weekData = weeks.find(w => w.week.getTime() === orderWeek.getTime());
          if (weekData) {
            weekData.sales += total;
          }
        }
      });

      return weeks.map(({ date, sales }) => ({
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
      
      // Calculate year span
      const startYear = earliestOrderDate.getFullYear();
      const endYear = latestOrderDate.getFullYear();
      const yearSpan = endYear - startYear + 1;
      
      // If data spans more than 2 years, aggregate by year instead of month
      if (yearSpan > 2) {
        // Generate yearly data points
        const years = Array.from({ length: yearSpan }, (_, i) => {
          const year = startYear + i;
          return {
            date: year.toString(),
            month: new Date(year, 0, 1), // Jan 1st of each year
            sales: 0,
          };
        });
        
        // Aggregate orders by year
        filteredOrders.forEach(order => {
          const gross = parseOrderTotal(order.orderTotal);
          const total = Math.max(0, gross - (refundsByOrder[order.id] || 0));
          if (gross > 0) {
            let orderDate: Date;
            try {
              orderDate = safeParseDate(order.orderDate);
              if (isNaN(orderDate.getTime())) {
                orderDate = new Date(order.orderDate);
              }
            } catch {
              orderDate = new Date(order.orderDate);
            }
            
            if (!isNaN(orderDate.getTime())) {
              const orderYear = orderDate.getFullYear();
              const yearData = years.find(y => y.date === orderYear.toString());
              if (yearData) {
                yearData.sales += total;
              }
            }
          }
        });
        
        return years.map(({ date, sales }) => ({
          date,
          sales: Math.round(sales),
        }));
      }
      
      // For 2 years or less, show monthly data
      const startMonth = startOfMonth(earliestOrderDate);
      const endMonth = startOfMonth(latestOrderDate);
      
      // Calculate months between earliest and latest
      const monthDiff = (endMonth.getFullYear() - startMonth.getFullYear()) * 12 + 
                        (endMonth.getMonth() - startMonth.getMonth()) + 1;
      
      // Generate months from start to latest
      months = Array.from({ length: monthDiff }, (_, i) => {
        const monthDate = new Date(startMonth);
        monthDate.setMonth(startMonth.getMonth() + i);
        return {
          date: format(monthDate, 'MMM yyyy'),
          month: startOfMonth(monthDate),
          sales: 0,
        };
      });
    } else if (dateRange === 'prevyear') {
      // Previous year: all 12 months of last calendar year
      const prevYear = new Date().getFullYear() - 1;
      months = Array.from({ length: 12 }, (_, i) => {
        const monthDate = new Date(prevYear, i, 1);
        return {
          date: format(monthDate, 'MMM yyyy'),
          month: startOfMonth(monthDate),
          sales: 0,
        };
      });
    } else {
      // For 1 year: use monthly data (rolling 12 months), otherwise 3 months
      const monthsToShow = dateRange === '1year' ? 12 : 3;
      
      months = Array.from({ length: monthsToShow }, (_, i) => {
        const date = subMonths(new Date(), monthsToShow - 1 - i);
        return {
          date: format(date, 'MMM yyyy'),
          month: startOfMonth(date),
          sales: 0,
        };
      });
    }

    // Aggregate orders into months
    filteredOrders.forEach(order => {
      const gross = parseOrderTotal(order.orderTotal);
      const total = Math.max(0, gross - (refundsByOrder[order.id] || 0));
      if (gross > 0) {
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
    } else if (dateRange === '1year') {
      // 12 months = current month + 11 prior months
      startDate = startOfMonth(subMonths(now, 11));
      endDate = now;
    } else if (dateRange === 'prevyear') {
      // Previous calendar year: Jan 1 to Dec 31
      startDate = new Date(now.getFullYear() - 1, 0, 1);
      endDate = new Date(now.getFullYear() - 1, 11, 31);
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
    } else if (dateRange === '1year') {
      startDate = startOfMonth(subMonths(now, 11));
      endDate = now;
    } else if (dateRange === 'prevyear') {
      startDate = new Date(now.getFullYear() - 1, 0, 1);
      endDate = new Date(now.getFullYear() - 1, 11, 31);
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

  // Calculate total revenue and average
  const totalRevenue = filteredOrders.reduce((sum, order) => {
    const orderTotal = parseOrderTotal(order.orderTotal);
    return sum + orderTotal;
  }, 0);
  const averageOrderValue = filteredOrders.length > 0 ? totalRevenue / filteredOrders.length : 0;
  
  // Debug revenue calculation
  console.log(`[SalesDashboard] Revenue Calculation for dateRange="${dateRange}":`, {
    filteredOrdersCount: filteredOrders.length,
    totalRevenue: totalRevenue,
    averageOrderValue: averageOrderValue,
    sampleOrderTotals: filteredOrders.slice(0, 5).map(o => ({
      id: o.id,
      orderTotal: o.orderTotal,
      parsed: parseOrderTotal(o.orderTotal)
    }))
  });

  const data = getSalesData();
  const average = data.length > 0 ? Math.round(data.reduce((sum, d) => sum + d.sales, 0) / data.length) : 0;
  
  // Debug chart data
  console.log(`[SalesDashboard] Chart Data for dateRange="${dateRange}":`, {
    dataPointsCount: data.length,
    averagePerPeriod: average,
    totalInChart: data.reduce((sum, d) => sum + d.sales, 0),
    sampleData: data.slice(0, 3)
  });
  
  // Diagnostic warnings - visible on page
  const warnings: string[] = [];
  if (dateRange === 'all' && orders.length > 0 && filteredOrders.length === 0) {
    warnings.push(`⚠️ DATE FILTER ERROR: ${orders.length} orders fetched but 0 filtered for "all" range`);
  }
  if (filteredOrders.length > 0 && totalRevenue === 0) {
    warnings.push(`⚠️ REVENUE PARSING ERROR: ${filteredOrders.length} orders but $0 revenue. Sample: ${filteredOrders[0]?.orderTotal}`);
  }
  if (filteredOrders.length > 0 && data.length === 0) {
    warnings.push(`⚠️ CHART DATA ERROR: ${filteredOrders.length} orders but 0 chart data points generated`);
  }
  if (dateRange === 'all' && orders.length === 0) {
    warnings.push(`⚠️ NO ORDERS FETCHED: Backend returned 0 orders for "all" range`);
  }

  if (isLoading) {
    return (
      <div className="p-2 space-y-1.5">
        <div className="relative bg-gradient-to-b from-green-950/25 to-gray-900/85 border border-green-500/40 rounded-lg shadow-[0_0_22px_rgba(34,197,94,0.15)] overflow-hidden p-3">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-green-400/60 to-transparent" />
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
    <CompactModeProvider value={panelMode ?? false}>
    <div className="p-2 space-y-1.5 bg-gradient-to-br from-green-500/5 to-transparent rounded-lg border border-green-500/10 shadow-[0_0_15px_rgba(34,197,94,0.1)]">
      {/* Diagnostic Warnings */}
      {warnings.length > 0 && (
        <div className="bg-red-900/30 border-2 border-red-500 rounded-lg p-3" data-testid="diagnostic-warnings">
          <div className="text-red-400 font-bold text-sm mb-2">DIAGNOSTIC WARNINGS:</div>
          {warnings.map((warning, idx) => (
            <div key={idx} className="text-red-300 text-xs font-mono mb-1">{warning}</div>
          ))}
          <div className="text-red-400 text-xs mt-2">
            Debug Info: dateRange={dateRange}, orders={orders.length}, filtered={filteredOrders.length}, revenue=${totalRevenue.toFixed(2)}
          </div>
        </div>
      )}
      
      {/* ── Top Metrics ── */}
      <div className={cn("relative bg-gradient-to-b from-green-950/25 to-gray-900/85 border border-green-500/40 rounded-lg shadow-[0_0_22px_rgba(34,197,94,0.12)] overflow-hidden", panelMode ? "p-2" : "p-3")} data-testid="section-sales-overview">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-green-400/50 to-transparent" />
        <div className={cn("flex items-center gap-2", panelMode ? "mb-1" : "mb-2.5")}>
          <div className="p-1.5 rounded-md bg-green-900/60 ring-1 ring-green-500/50 shadow-[0_0_10px_rgba(34,197,94,0.25)]">
            <TrendingUp className={cn("w-3 h-3 text-green-200", !panelMode && "md:w-4 md:h-4")} />
          </div>
          <h3 className={cn("text-xs font-semibold text-green-200 uppercase tracking-wide", !panelMode && "md:text-base lg:text-lg")}>Sales</h3>
        </div>
        <div className={cn("grid grid-cols-3 gap-1.5", panelMode ? "mb-1" : "mb-2")} data-testid="section-sales-metrics">
          <MetricCard label="Orders" value={filteredOrders.length} color="green" data-testid="metric-sales-orders" />
          <MetricCard label="Gross Revenue" value={`$${Math.round(totalRevenue).toLocaleString()}`} color="green" data-testid="metric-sales-gross" />
          <MetricCard label="Avg Order" value={`$${averageOrderValue.toFixed(2)}`} color="green" data-testid="metric-sales-avg" />
        </div>
        {adjustmentSummary && (
          <div className="grid grid-cols-4 gap-1.5">
            <MetricCard label="Net Revenue" value={`$${Math.max(0, totalRevenue - adjustmentSummary.totalRefunds).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} color="green" data-testid="metric-sales-net" />
            <MetricCard label="Refunds" value={adjustmentSummary.totalRefunds > 0 ? `-$${adjustmentSummary.totalRefunds.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '$0'} color="red" data-testid="metric-sales-refunds" />
            <MetricCard label="Fees" value={adjustmentSummary.totalFees > 0 ? `-$${adjustmentSummary.totalFees.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '$0'} color="yellow" data-testid="metric-sales-fees" />
            <MetricCard label="Shipping" value={adjustmentSummary.totalShipping > 0 ? `-$${adjustmentSummary.totalShipping.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '$0'} color="yellow" data-testid="metric-sales-shipping" />
          </div>
        )}
      </div>

      {/* ── Tools Section ── */}
      <div className="relative bg-gradient-to-b from-gray-800/20 to-gray-900/85 border border-gray-600/35 rounded-lg shadow-[0_0_18px_rgba(156,163,175,0.08)] overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gray-400/50 to-transparent" />
        <div className="p-2">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-1.5 rounded-md bg-gray-800/70 ring-1 ring-gray-500/40 shadow-[0_0_8px_rgba(156,163,175,0.2)]">
              <BarChart2 className="w-3.5 h-3.5 text-gray-300" />
            </div>
            <h3 className={cn("text-xs font-semibold text-gray-200 uppercase tracking-wide", !panelMode && "md:text-base")}>Tools</h3>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setChartOpen(true)}
              data-testid="tool-sales-chart"
              className="group flex flex-col gap-1.5 rounded-lg border border-green-500/50 bg-gradient-to-br from-green-950/65 to-gray-950/80 p-3 text-left hover-elevate active-elevate-2 transition-all shadow-[0_0_14px_rgba(34,197,94,0.09)]"
            >
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-green-900/70 p-1.5 ring-1 ring-green-500/45 shadow-[0_0_10px_rgba(34,197,94,0.22)]">
                  <Activity className={cn("w-3.5 h-3.5 text-green-200", !panelMode && "md:w-5 md:h-5")} />
                </div>
                <span className={cn("text-xs font-bold text-green-100 leading-tight flex-1", !panelMode && "md:text-sm")}>Sales Chart</span>
                <ArrowRight className="w-3 h-3 text-green-500/60 group-hover:text-green-400 transition-colors" />
              </div>
              {!panelMode && <p className="text-[10px] md:text-xs text-green-300/60 leading-snug">Revenue trend &amp; year-over-year comparison</p>}
            </button>
            <button
              onClick={() => setPlatformPerfOpen(true)}
              data-testid="tool-platform-performance"
              className="group flex flex-col gap-1.5 rounded-lg border border-orange-500/50 bg-gradient-to-br from-orange-950/65 to-gray-950/80 p-3 text-left hover-elevate active-elevate-2 transition-all shadow-[0_0_14px_rgba(249,115,22,0.09)]"
            >
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-orange-900/70 p-1.5 ring-1 ring-orange-500/45 shadow-[0_0_10px_rgba(249,115,22,0.22)]">
                  <BarChart2 className={cn("w-3.5 h-3.5 text-orange-200", !panelMode && "md:w-5 md:h-5")} />
                </div>
                <span className={cn("text-xs font-bold text-orange-100 leading-tight flex-1", !panelMode && "md:text-sm")}>Platform Performance</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <span role="button" onClick={(e) => e.stopPropagation()} className="text-orange-600/60 hover:text-orange-400 transition-colors" data-testid="info-platform-performance">
                      <Info className="w-3 h-3" />
                    </span>
                  </PopoverTrigger>
                  <PopoverContent side="top" className="w-64 text-xs text-gray-300 bg-gray-900 border-gray-700 p-2.5">
                    Breakdown of sales by marketplace — order counts, revenue, and channel share for the selected date range.
                  </PopoverContent>
                </Popover>
              </div>
              {!panelMode && (
              <div className="flex flex-wrap gap-1 min-h-[1.25rem]">
                {availablePlatforms.length > 0 ? (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-300 border border-orange-600/30">
                    {availablePlatforms.length} active {availablePlatforms.length === 1 ? 'platform' : 'platforms'}
                  </span>
                ) : (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-500/15 text-orange-400 border border-orange-600/25">
                    No data
                  </span>
                )}
              </div>
              )}
              {!panelMode && (
              <div className="flex items-center justify-between">
                <span className="text-[10px] md:text-xs text-orange-300 font-medium">Open tool</span>
                <ArrowRight className="w-3 h-3 md:w-4 md:h-4 text-orange-400/70 group-hover:text-orange-200 transition-colors" />
              </div>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ── Sales Chart Drawer ── */}
      <Drawer open={chartOpen} onOpenChange={(open) => !open && setChartOpen(false)}>
        <DrawerContent className="h-[80vh]">
          <DrawerHeader className="relative">
            <DrawerTitle className="flex items-center gap-2 text-base md:text-lg">
              <Activity className="w-4 h-4 text-green-400" />
              Sales Chart
            </DrawerTitle>
            <DrawerClose className="absolute right-4 top-4" data-testid="button-close-sales-chart">
              <X className="w-4 h-4" />
            </DrawerClose>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-4 flex-1 space-y-3">
            <div className="bg-black/20 rounded-lg p-3">
              {!compareMode ? (
                <>
                  <div className="mb-1 text-xs text-gray-400">
                    Average: <span className="text-lego-green font-mono font-semibold">${average.toLocaleString()}</span>
                    <span className="ml-2 text-gray-500">Total Revenue: ${Math.round(totalRevenue).toLocaleString()}</span>
                  </div>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={data}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="date" stroke="#9CA3AF" style={{ fontSize: '10px' }} />
                      <YAxis stroke="#9CA3AF" style={{ fontSize: '10px' }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '6px', fontSize: '12px' }}
                        labelStyle={{ color: '#D1D5DB' }}
                        formatter={(value: number) => [`$${value.toLocaleString()}`, 'Net Revenue']}
                      />
                      <Line type="monotone" dataKey="sales" name="Net Revenue" stroke="hsl(140 70% 50%)" strokeWidth={2} dot={{ fill: 'hsl(140 70% 50%)', r: 1 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </>
              ) : comparisonType === 'year' ? (
                <>
                  <div className="mb-1 text-xs text-gray-400">
                    <span className="text-lego-green font-semibold">Year-over-Year Comparison</span>
                  </div>
                  <ResponsiveContainer width="100%" height={200}>
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
                  <ResponsiveContainer width="100%" height={200}>
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

            {/* Compare Controls */}
            <div className="flex flex-wrap items-center gap-2 border border-green-500/15 rounded-lg bg-black/15 px-2 py-1.5">
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

              {/* Year selector row */}
              {compareMode && comparisonType === 'year' && availableYears.length > 0 && (
                <div className="flex items-center gap-2 overflow-x-auto w-full">
                  <span className="text-[9px] md:text-xs text-gray-500 flex-shrink-0">vs</span>
                  <div className="flex gap-1.5 flex-nowrap">
                    {(() => {
                      const nonCurrentYears = availableYears.filter(y => y !== currentYear);
                      const sorted = [
                        ...[...validCompareYears].sort((a, b) => b - a),
                        ...nonCurrentYears.filter(y => !validCompareYears.includes(y)).sort((a, b) => b - a),
                      ];
                      return sorted.map(year => {
                        const isSelected = selectedCompareYears.includes(year);
                        return (
                          <button
                            key={year}
                            onClick={() => {
                              if (isSelected) setSelectedCompareYears(selectedCompareYears.filter(y => y !== year));
                              else setSelectedCompareYears([...selectedCompareYears, year].sort((a, b) => b - a));
                            }}
                            aria-pressed={isSelected}
                            className={`text-[9px] md:text-xs font-bold py-1 px-2 rounded transition-all flex-shrink-0 ${isSelected ? 'bg-blue-600 text-white border border-blue-500' : 'bg-gray-800 text-gray-400 border border-gray-700 hover-elevate'}`}
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

              {/* Platform selector row */}
              {compareMode && comparisonType === 'platform' && availablePlatforms.length > 0 && (
                <div className="flex items-center gap-2 overflow-x-auto w-full">
                  <span className="text-[9px] md:text-xs text-gray-500 flex-shrink-0">select</span>
                  <div className="flex gap-1.5 flex-nowrap">
                    {(() => {
                      const sorted = [
                        ...[...validPlatforms].sort((a, b) => a.localeCompare(b)),
                        ...availablePlatforms.filter(p => !validPlatforms.includes(p)).sort((a, b) => a.localeCompare(b)),
                      ];
                      return sorted.map(platform => {
                        const isSelected = selectedPlatforms.includes(platform);
                        return (
                          <button
                            key={platform}
                            onClick={() => {
                              if (isSelected) setSelectedPlatforms(selectedPlatforms.filter(p => p !== platform));
                              else setSelectedPlatforms([...selectedPlatforms, platform].sort((a, b) => a.localeCompare(b)));
                            }}
                            aria-pressed={isSelected}
                            className={`text-[9px] md:text-xs font-bold py-1 px-2 rounded transition-all flex-shrink-0 ${isSelected ? 'bg-blue-600 text-white border border-blue-500' : 'bg-gray-800 text-gray-400 border border-gray-700 hover-elevate'}`}
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

            {/* YoY Growth */}
            {compareMode && comparisonType === 'year' && validCompareYears.length > 0 && (
              <div className="bg-black/20 rounded-lg p-3" data-testid="section-yoy-metrics">
                <div className="flex items-center gap-2 mb-2">
                  <div className="p-1 rounded bg-purple-900/50 ring-1 ring-purple-500/40 shadow-[0_0_6px_rgba(168,85,247,0.25)]">
                    <TrendingUp className="w-3 h-3 text-purple-300" />
                  </div>
                  <h3 className="text-[10px] md:text-sm font-semibold text-purple-300 uppercase tracking-wide">Year-over-Year Growth</h3>
                </div>
                <div className={`grid gap-2 ${validCompareYears.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                  {(() => {
                    const yearTotals = comparisonYears.reduce((acc, year) => {
                      acc[year] = comparisonData.reduce((sum, m) => sum + ((m[`${year}`] as number) || 0), 0);
                      return acc;
                    }, {} as Record<number, number>);
                    return validCompareYears.map(compareYear => {
                      const growth = yearTotals[compareYear] > 0 ? ((yearTotals[currentYear] - yearTotals[compareYear]) / yearTotals[compareYear]) * 100 : 0;
                      return (
                        <div key={compareYear} className="bg-gray-800/50 rounded p-2">
                          <div className="text-[9px] md:text-xs text-gray-500 mb-1">{currentYear} vs {compareYear}</div>
                          <div className={`text-sm font-mono font-bold ${growth >= 0 ? 'text-green-400' : 'text-red-400'}`}>{growth >= 0 ? '+' : ''}{growth.toFixed(1)}%</div>
                          <div className="text-[9px] md:text-xs text-gray-400 mt-1">${Math.round(yearTotals[currentYear]).toLocaleString()} vs ${Math.round(yearTotals[compareYear]).toLocaleString()}</div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            )}

            {/* Platform Comparison Metrics */}
            {compareMode && comparisonType === 'platform' && validPlatforms.length > 0 && (
              <div className="bg-black/20 rounded-lg p-3" data-testid="section-platform-metrics">
                <div className="flex items-center gap-2 mb-2">
                  <div className="p-1 rounded bg-purple-900/50 ring-1 ring-purple-500/40 shadow-[0_0_6px_rgba(168,85,247,0.25)]">
                    <TrendingUp className="w-3 h-3 text-purple-300" />
                  </div>
                  <h3 className="text-[10px] md:text-sm font-semibold text-purple-300 uppercase tracking-wide">Platform Comparison</h3>
                </div>
                <div className={`grid gap-2 ${validPlatforms.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                  {(() => {
                    const totals = validPlatforms.reduce((acc, p) => { acc[p] = comparisonData.reduce((s, m) => s + ((m[p] as number) || 0), 0); return acc; }, {} as Record<string, number>);
                    const totalRev = Object.values(totals).reduce((s, v) => s + v, 0);
                    return validPlatforms.map(platform => (
                      <div key={platform} className="bg-gray-800/50 rounded p-2">
                        <div className="flex items-center gap-1 mb-1">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: PLATFORM_COLORS[platform] || PLATFORM_COLORS['Other'] }} />
                          <div className="text-[9px] md:text-xs text-gray-500">{platform}</div>
                        </div>
                        <div className="text-sm font-mono font-bold text-white">${Math.round(totals[platform]).toLocaleString()}</div>
                        <div className="text-[9px] md:text-xs text-gray-400 mt-1">{(totalRev > 0 ? (totals[platform] / totalRev) * 100 : 0).toFixed(1)}% of total</div>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            )}
          </div>
        </DrawerContent>
      </Drawer>

      {/* ── Platform Performance Drawer ── */}
      <Drawer open={platformPerfOpen} onOpenChange={(open) => !open && setPlatformPerfOpen(false)}>
        <DrawerContent className="h-[90vh]">
          <DrawerHeader className="relative">
            <DrawerTitle className="flex items-center gap-2 text-base md:text-lg">
              <BarChart2 className="w-5 h-5 text-orange-400" />
              Platform Performance
            </DrawerTitle>
            <DrawerClose className="absolute right-4 top-4" data-testid="button-close-platform-performance">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DrawerClose>
          </DrawerHeader>
          <div className="overflow-y-auto flex-1 px-4 pb-8">
            <PlatformPerformance
              orders={filteredOrders}
              onPlatformClick={(platform) => {
                setPlatformPerfOpen(false);
                setPlatformDrawer({ open: true, platform, productLine: undefined });
              }}
            />
          </div>
        </DrawerContent>
      </Drawer>

      {/* ── Platform Orders Drawer ── */}
      <PlatformOrdersDrawer
        open={platformDrawer.open}
        onClose={() => setPlatformDrawer({ open: false, platform: '', productLine: undefined })}
        platform={platformDrawer.platform}
        orders={platformOrders}
        onOrderClick={(orderId) => onItemClick?.('order', orderId)}
      />
    </div>
    </CompactModeProvider>
  );
}

