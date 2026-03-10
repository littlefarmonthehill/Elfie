import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {  
  Sparkles,
  RefreshCw,
  ChevronDown,
  ArrowUp,
  ArrowDown,
  DollarSign,
  Orbit,
  Rocket,
  Satellite,
  Info,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PomSpotLookup } from "@/components/PomSpotLookup";

const DEEP_SPACE_LS_KEY = 'pom_deep_space_keys';
const DEEP_SPACE_ITEMS_LS_KEY = 'pom_deep_space_items';
const FUTURE_MISSIONS_LS_KEY = 'pom_future_missions_keys';
const FUTURE_MISSIONS_ITEMS_LS_KEY = 'pom_future_missions_items';

// Short swipe = move one zone. Long swipe = jump two zones (skip Future Missions).
const SHORT_SWIPE = 80;
const LONG_SWIPE = 160;
const MAX_OFFSET = 220;

interface StoredGroupInfo {
  key: string;
  itemNo: string;
  itemName: string | null;
  colorId: number | null;
  colorName: string | null;
}

function lsLoadDeepSpace(): Set<string> {
  try {
    const raw = localStorage.getItem(DEEP_SPACE_LS_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch {}
  return new Set();
}
function lsSaveDeepSpace(keys: Set<string>) {
  localStorage.setItem(DEEP_SPACE_LS_KEY, JSON.stringify(Array.from(keys)));
}
function lsLoadDeepSpaceItems(): Map<string, StoredGroupInfo> {
  try {
    const raw = localStorage.getItem(DEEP_SPACE_ITEMS_LS_KEY);
    if (raw) { const arr: StoredGroupInfo[] = JSON.parse(raw); return new Map(arr.map(i => [i.key, i])); }
  } catch {}
  return new Map();
}
function lsSaveDeepSpaceItems(items: Map<string, StoredGroupInfo>) {
  localStorage.setItem(DEEP_SPACE_ITEMS_LS_KEY, JSON.stringify(Array.from(items.values())));
}
function lsLoadFutureMissions(): Set<string> {
  try {
    const raw = localStorage.getItem(FUTURE_MISSIONS_LS_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch {}
  return new Set();
}
function lsSaveFutureMissions(keys: Set<string>) {
  localStorage.setItem(FUTURE_MISSIONS_LS_KEY, JSON.stringify(Array.from(keys)));
}
function lsLoadFutureMissionsItems(): Map<string, StoredGroupInfo> {
  try {
    const raw = localStorage.getItem(FUTURE_MISSIONS_ITEMS_LS_KEY);
    if (raw) { const arr: StoredGroupInfo[] = JSON.parse(raw); return new Map(arr.map(i => [i.key, i])); }
  } catch {}
  return new Map();
}
function lsSaveFutureMissionsItems(items: Map<string, StoredGroupInfo>) {
  localStorage.setItem(FUTURE_MISSIONS_ITEMS_LS_KEY, JSON.stringify(Array.from(items.values())));
}

interface SyncStatus {
  id: string;
  lastSyncStatus: string;
  lastSyncTime: string | null;
  recordsUpdated: number;
  errorMessage?: string | null;
  callsLast24h?: number;
}

interface PricingInsight {
  inventoryId: number;
  itemNo: string;
  itemName: string | null;
  itemType: string;
  colorId: number | null;
  colorName: string | null;
  newOrUsed: string;
  currentPrice: string;
  myCost?: string | null;
  suggestedPrice: string;
  marketPrice?: string;
  floorApplied?: 'cost' | 'min' | 'none';
  stockAvgPrice: string;
  soldMaxPrice?: string | null;
  marketPeakSoldPrice?: string | null;
  opportunityScore: number | null;
  variance: number;
  quantity: number;
  lastFetched: string;
  category: 'too_high' | 'too_low' | 'good';
}

interface InsightsData {
  tooHigh: PricingInsight[];
  tooLow: PricingInsight[];
  wellPriced: PricingInsight[];
  summary: {
    total: number;
    tooHigh: number;
    tooLow: number;
    wellPriced: number;
  };
}

interface GroupedInsight {
  key: string;
  itemNo: string;
  itemName: string | null;
  colorId: number | null;
  colorName: string | null;
  marketPeakSoldPrice: number | null;
  newLot: PricingInsight | null;
  usedLot: PricingInsight | null;
  newScore: number;
  usedScore: number;
}

interface PriceOMaticDashboardProps {
  onItemClick?: (type: 'inventory' | 'order', id: number) => void;
}

type ZoneFilter = 'in_orbit' | 'future_missions' | 'deep_space';

// Describes what action a swipe will trigger and how to render the reveal area
interface SwipeIntent {
  zone: ZoneFilter;
  label: string;
  color: string;       // text color
  bg: string;          // gradient background
  icon: React.ReactNode;
}

function getSwipeIntent(orbitFilter: ZoneFilter, swipeDelta: number): SwipeIntent | null {
  const abs = Math.abs(swipeDelta);
  if (abs < SHORT_SWIPE) return null;

  if (orbitFilter === 'in_orbit' && swipeDelta > 0) {
    // Right swipe from In Orbit
    if (abs >= LONG_SWIPE) {
      return {
        zone: 'deep_space',
        label: 'Deep Space',
        color: 'text-indigo-300',
        bg: 'linear-gradient(to right, rgba(99,40,220,0.45), rgba(79,70,229,0.25))',
        icon: <Rocket className="w-4 h-4 text-indigo-300 flex-shrink-0" />,
      };
    }
    return {
      zone: 'future_missions',
      label: 'Future Missions',
      color: 'text-amber-300',
      bg: 'linear-gradient(to right, rgba(180,100,0,0.45), rgba(217,119,6,0.20))',
      icon: <Satellite className="w-4 h-4 text-amber-300 flex-shrink-0" />,
    };
  }

  if (orbitFilter === 'future_missions') {
    if (swipeDelta < 0) {
      // Left → In Orbit
      return {
        zone: 'in_orbit',
        label: 'In Orbit',
        color: 'text-emerald-300',
        bg: 'linear-gradient(to left, rgba(16,100,50,0.45), rgba(16,185,129,0.20))',
        icon: <Orbit className="w-4 h-4 text-emerald-300 flex-shrink-0" />,
      };
    }
    // Right → Deep Space
    return {
      zone: 'deep_space',
      label: 'Deep Space',
      color: 'text-indigo-300',
      bg: 'linear-gradient(to right, rgba(99,40,220,0.45), rgba(79,70,229,0.25))',
      icon: <Rocket className="w-4 h-4 text-indigo-300 flex-shrink-0" />,
    };
  }

  if (orbitFilter === 'deep_space' && swipeDelta < 0) {
    // Left swipe from Deep Space
    if (abs >= LONG_SWIPE) {
      return {
        zone: 'in_orbit',
        label: 'In Orbit',
        color: 'text-emerald-300',
        bg: 'linear-gradient(to left, rgba(16,100,50,0.45), rgba(16,185,129,0.20))',
        icon: <Orbit className="w-4 h-4 text-emerald-300 flex-shrink-0" />,
      };
    }
    return {
      zone: 'future_missions',
      label: 'Future Missions',
      color: 'text-amber-300',
      bg: 'linear-gradient(to left, rgba(180,100,0,0.45), rgba(217,119,6,0.20))',
      icon: <Satellite className="w-4 h-4 text-amber-300 flex-shrink-0" />,
    };
  }

  return null;
}

function SwipeableTile({
  group,
  orbitFilter,
  onMoveToZone,
  children,
}: {
  group: GroupedInsight;
  orbitFilter: ZoneFilter;
  onMoveToZone: (group: GroupedInsight, targetZone: ZoneFilter) => void;
  children: React.ReactNode;
}) {
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const tileRef = useRef<HTMLDivElement>(null);
  const [swipeDelta, setSwipeDelta] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const [launched, setLaunched] = useState(false);
  const [launchDir, setLaunchDir] = useState<1 | -1>(1);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    setSwiping(false);
    setSwipeDelta(0);
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (!swiping && Math.abs(dy) > Math.abs(dx)) return;

    const allowRight = orbitFilter === 'in_orbit' || orbitFilter === 'future_missions';
    const allowLeft  = orbitFilter === 'deep_space' || orbitFilter === 'future_missions';

    if (dx > 0 && allowRight) {
      setSwiping(true);
      setSwipeDelta(Math.min(dx, MAX_OFFSET));
      e.preventDefault();
    } else if (dx < 0 && allowLeft) {
      setSwiping(true);
      setSwipeDelta(Math.max(dx, -MAX_OFFSET));
      e.preventDefault();
    }
  }, [swiping, orbitFilter]);

  const onTouchEnd = useCallback(() => {
    const intent = getSwipeIntent(orbitFilter, swipeDelta);
    if (intent) {
      const dir = swipeDelta > 0 ? 1 : -1;
      setLaunchDir(dir);
      setLaunched(true);
      setTimeout(() => {
        onMoveToZone(group, intent.zone);
        setLaunched(false);
        setSwipeDelta(0);
        setSwiping(false);
      }, 260);
    } else {
      setSwipeDelta(0);
      setSwiping(false);
    }
    touchStartX.current = null;
    touchStartY.current = null;
  }, [swipeDelta, orbitFilter, group, onMoveToZone]);

  const absSwipeDelta = Math.abs(swipeDelta);
  const translateX = launched ? launchDir * 340 : swipeDelta;
  const opacity = launched ? 0 : 1 - (absSwipeDelta / 280);
  const intent = getSwipeIntent(orbitFilter, swipeDelta);
  const showLabel = absSwipeDelta >= SHORT_SWIPE * 0.65;

  // Detect threshold crossing for flash effect
  const isLong = absSwipeDelta >= LONG_SWIPE;
  const isMidZone = absSwipeDelta >= SHORT_SWIPE && !isLong;

  return (
    <div className="relative overflow-hidden rounded-lg">
      {/* Reveal background — color changes dynamically based on intent */}
      <div
        className={`absolute inset-0 rounded-lg flex items-center px-4 gap-2 transition-all duration-150 ${
          swipeDelta < 0 ? 'justify-end' : ''
        }`}
        style={{ background: intent?.bg ?? 'transparent' }}
      >
        {intent && showLabel && (
          <>
            {intent.icon}
            <div className="flex flex-col">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${intent.color}`}>
                {intent.label}
              </span>
              {/* Threshold hint: tell the user what a longer swipe would do */}
              {isMidZone && orbitFilter === 'in_orbit' && (
                <span className="text-[8px] text-amber-500/70 tracking-wide">keep swiping for Deep Space</span>
              )}
              {isMidZone && orbitFilter === 'deep_space' && (
                <span className="text-[8px] text-amber-500/70 tracking-wide">keep swiping for In Orbit</span>
              )}
            </div>
            {/* Long-swipe zone indicator — a faint bar at the LONG threshold */}
            {(orbitFilter === 'in_orbit' || orbitFilter === 'deep_space') && (
              <div
                className="absolute top-1 bottom-1 w-[2px] bg-white/10 rounded"
                style={{
                  [swipeDelta > 0 ? 'left' : 'right']: `${LONG_SWIPE}px`,
                }}
              />
            )}
          </>
        )}
      </div>

      {/* Tile content */}
      <div
        ref={tileRef}
        style={{
          transform: `translateX(${translateX}px)`,
          opacity,
          transition: swiping ? 'none' : 'transform 0.26s ease, opacity 0.26s ease',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {children}
      </div>
    </div>
  );
}

export default function PriceOMaticDashboard({ onItemClick }: PriceOMaticDashboardProps) {
  const { toast } = useToast();
  const [itemsToShow, setItemsToShow] = useState(25);
  const [refreshingItems, setRefreshingItems] = useState<Set<number>>(new Set());
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [pricingData, setPricingData] = useState<Map<string, { n: string | null; u: string | null }>>(new Map());
  const [pricingLoading, setPricingLoading] = useState<Set<string>>(new Set());

  // --- Deep Space state ---
  const [deepSpaceKeys, setDeepSpaceKeys] = useState<Set<string>>(lsLoadDeepSpace);
  const [deepSpaceItems, setDeepSpaceItems] = useState<Map<string, StoredGroupInfo>>(lsLoadDeepSpaceItems);

  // --- Future Missions state ---
  const [futureMissionsKeys, setFutureMissionsKeys] = useState<Set<string>>(lsLoadFutureMissions);
  const [futureMissionsItems, setFutureMissionsItems] = useState<Map<string, StoredGroupInfo>>(lsLoadFutureMissionsItems);

  const [orbitFilter, setOrbitFilter] = useState<ZoneFilter>('in_orbit');
  const [scoreFilter, setScoreFilter] = useState<'all' | 'underpriced' | 'priced_right' | 'overpriced'>('all');

  // --- Server sync: Deep Space ---
  const { data: deepSpaceData } = useQuery<{ success: boolean; keys: string[]; items?: StoredGroupInfo[] }>({
    queryKey: ['/api/priceomatic/deep-space'],
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const saveDeepSpaceToServer = useCallback((items: StoredGroupInfo[]) => {
    apiRequest('PUT', '/api/priceomatic/deep-space', { items }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!deepSpaceData) return;
    const serverKeys = deepSpaceData.keys ?? [];
    const serverItems = deepSpaceData.items ?? [];
    const localKeys = Array.from(lsLoadDeepSpace());
    const localItems = lsLoadDeepSpaceItems();
    if (serverKeys.length > 0) {
      const serverSet = new Set(serverKeys);
      const serverItemsMap = new Map(serverItems.map(i => [i.key, i]));
      setDeepSpaceKeys(serverSet);
      setDeepSpaceItems(serverItemsMap);
      lsSaveDeepSpace(serverSet);
      lsSaveDeepSpaceItems(serverItemsMap);
    } else if (localKeys.length > 0) {
      const migratedItems = localKeys.map(k => localItems.get(k) ?? { key: k, itemNo: k.split('_')[0], itemName: null, colorId: null, colorName: null });
      apiRequest('PUT', '/api/priceomatic/deep-space', { items: migratedItems }).catch(() => {});
    }
  }, [deepSpaceData]);

  // --- Server sync: Future Missions ---
  const { data: futureMissionsData } = useQuery<{ success: boolean; keys: string[]; items?: StoredGroupInfo[] }>({
    queryKey: ['/api/priceomatic/future-missions'],
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const saveFutureMissionsToServer = useCallback((items: StoredGroupInfo[]) => {
    apiRequest('PUT', '/api/priceomatic/future-missions', { items }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!futureMissionsData) return;
    const serverKeys = futureMissionsData.keys ?? [];
    const serverItems = futureMissionsData.items ?? [];
    if (serverKeys.length > 0) {
      const serverSet = new Set(serverKeys);
      const serverItemsMap = new Map(serverItems.map(i => [i.key, i]));
      setFutureMissionsKeys(serverSet);
      setFutureMissionsItems(serverItemsMap);
      lsSaveFutureMissions(serverSet);
      lsSaveFutureMissionsItems(serverItemsMap);
    }
  }, [futureMissionsData]);

  // --- Zone movement callbacks ---
  const onMoveToZone = useCallback((group: GroupedInsight, targetZone: ZoneFilter) => {
    const stored: StoredGroupInfo = { key: group.key, itemNo: group.itemNo, itemName: group.itemName, colorId: group.colorId, colorName: group.colorName };

    // Remove from all zones first
    const newDeepKeys = new Set(lsLoadDeepSpace());
    const newDeepItems = lsLoadDeepSpaceItems();
    const newFutureKeys = new Set(lsLoadFutureMissions());
    const newFutureItems = lsLoadFutureMissionsItems();

    newDeepKeys.delete(group.key);
    newDeepItems.delete(group.key);
    newFutureKeys.delete(group.key);
    newFutureItems.delete(group.key);

    if (targetZone === 'deep_space') {
      newDeepKeys.add(group.key);
      newDeepItems.set(group.key, stored);
    } else if (targetZone === 'future_missions') {
      newFutureKeys.add(group.key);
      newFutureItems.set(group.key, stored);
    }
    // in_orbit: already removed from both, nothing to add

    setDeepSpaceKeys(new Set(newDeepKeys));
    setDeepSpaceItems(new Map(newDeepItems));
    setFutureMissionsKeys(new Set(newFutureKeys));
    setFutureMissionsItems(new Map(newFutureItems));

    lsSaveDeepSpace(newDeepKeys);
    lsSaveDeepSpaceItems(newDeepItems);
    lsSaveFutureMissions(newFutureKeys);
    lsSaveFutureMissionsItems(newFutureItems);

    saveDeepSpaceToServer(Array.from(newDeepItems.values()));
    saveFutureMissionsToServer(Array.from(newFutureItems.values()));
  }, [saveDeepSpaceToServer, saveFutureMissionsToServer]);

  const fetchPricingMutation = useMutation({
    mutationFn: async (group: GroupedInsight) => {
      const lots = [
        group.newLot ? { lot: group.newLot, condition: 'n' as const } : null,
        group.usedLot ? { lot: group.usedLot, condition: 'u' as const } : null,
      ].filter(Boolean) as { lot: PricingInsight; condition: 'n' | 'u' }[];

      const results: { n: string | null; u: string | null } = { n: null, u: null };
      await Promise.all(lots.map(async ({ lot, condition }) => {
        const data = await apiRequest("POST", "/api/priceomatic/fetch-pricing", {
          itemNo: lot.itemNo,
          itemType: lot.itemType,
          colorId: lot.colorId,
          newOrUsed: lot.newOrUsed,
        });
        results[condition] = data.suggestedPrice ?? null;
      }));
      return { key: group.key, results };
    },
    onMutate: (group) => {
      setPricingLoading(prev => new Set([...prev, group.key]));
    },
    onSettled: (_data, _err, group) => {
      setPricingLoading(prev => { const next = new Set(prev); next.delete(group.key); return next; });
    },
    onSuccess: ({ key, results }) => {
      setPricingData(prev => new Map(prev).set(key, results));
    },
    onError: () => {
      toast({ title: "Pricing failed", description: "Could not fetch suggested price from BrickLink", variant: "destructive" });
    },
  });

  const refreshItemMutation = useMutation({
    mutationFn: async (item: { itemNo: string; itemType: string; colorId: number | null; newOrUsed: string; inventoryId: number }) => {
      const params = new URLSearchParams({
        partNo: item.itemNo,
        itemType: item.itemType,
        newOrUsed: item.newOrUsed,
        forceRefresh: 'true',
      });
      if (item.colorId != null) params.set('colorId', item.colorId.toString());
      return await apiRequest("GET", `/api/pom/spot-lookup?${params}`);
    },
    onMutate: (item) => {
      setRefreshingItems(prev => new Set([...prev, item.inventoryId]));
    },
    onSettled: (_data, _err, item) => {
      setRefreshingItems(prev => { const next = new Set(prev); next.delete(item.inventoryId); return next; });
    },
    onSuccess: () => {
      queryClient.refetchQueries({ queryKey: ['/api/priceomatic/insights'] });
      toast({ title: "Refreshed", description: "Price data updated from BrickLink" });
    },
    onError: () => {
      toast({ title: "Refresh failed", description: "Could not reach BrickLink", variant: "destructive" });
    },
  });

  const { data: insights, isLoading: insightsLoading } = useQuery<{ success: boolean; data: InsightsData }>({
    queryKey: ['/api/priceomatic/insights'],
    refetchOnMount: 'always',
    staleTime: 0,
    refetchInterval: false,
  });

  const { data: settingsData } = useQuery<any>({
    queryKey: ['/api/settings'],
  });

  const insightsData = insights?.data;
  const pomUnderpricedScore: number = settingsData?.pomUnderpricedScore ?? 1.5;
  const pomOverpricedScore: number = settingsData?.pomOverpricedScore ?? 0.8;

  const formatCurrency = (value: string | number | null | undefined) => {
    if (value == null) return '—';
    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(num)) return '—';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 3,
    }).format(num);
  };

  const scoreColor = (score: number | null) => {
    if (score === null) return 'text-gray-600';
    if (score >= 2.0) return 'text-emerald-400';
    if (score >= 1.5) return 'text-orange-400';
    if (score >= 1.0) return 'text-yellow-500';
    return 'text-gray-500';
  };

  const getAllGroups = (): GroupedInsight[] => {
    if (!insightsData) return [];
    const allItems = [...insightsData.tooHigh, ...insightsData.tooLow, ...insightsData.wellPriced];
    const map = new Map<string, GroupedInsight>();
    for (const item of allItems) {
      const key = `${item.itemNo}_${item.colorId ?? 'null'}`;
      if (!map.has(key)) {
        map.set(key, {
          key, itemNo: item.itemNo, itemName: item.itemName, colorId: item.colorId, colorName: item.colorName,
          marketPeakSoldPrice: item.marketPeakSoldPrice != null ? parseFloat(String(item.marketPeakSoldPrice)) : null,
          newLot: null, usedLot: null, newScore: 0, usedScore: 0,
        });
      }
      const g = map.get(key)!;
      if (item.newOrUsed === 'N') { g.newLot = item; g.newScore = item.opportunityScore ?? 0; }
      else { g.usedLot = item; g.usedScore = item.opportunityScore ?? 0; }
    }
    return Array.from(map.values()).sort((a, b) => {
      const aScore = Math.max(a.newScore, a.usedScore);
      const bScore = Math.max(b.newScore, b.usedScore);
      return sortDir === 'desc' ? bScore - aScore : aScore - bScore;
    });
  };

  const makeFallbackGroup = (item: StoredGroupInfo): GroupedInsight => ({
    key: item.key, itemNo: item.itemNo, itemName: item.itemName, colorId: item.colorId, colorName: item.colorName,
    marketPeakSoldPrice: null, newLot: null, usedLot: null, newScore: 0, usedScore: 0,
  });

  const allGroups = getAllGroups().filter(g => (g.newLot?.quantity ?? 0) + (g.usedLot?.quantity ?? 0) > 0);
  const allGroupKeySet = new Set(allGroups.map(g => g.key));

  const inOrbitGroups = allGroups.filter(g => !deepSpaceKeys.has(g.key) && !futureMissionsKeys.has(g.key));

  const futureMissionsFromAnalysis = allGroups.filter(g => futureMissionsKeys.has(g.key));
  const futureMissionsFallbacks: GroupedInsight[] = Array.from(futureMissionsItems.values())
    .filter(item => futureMissionsKeys.has(item.key) && !allGroupKeySet.has(item.key))
    .map(makeFallbackGroup);
  const futureMissionsGroups = [...futureMissionsFromAnalysis, ...futureMissionsFallbacks];

  const deepSpaceFromAnalysis = allGroups.filter(g => deepSpaceKeys.has(g.key));
  const deepSpaceFallbacks: GroupedInsight[] = Array.from(deepSpaceItems.values())
    .filter(item => deepSpaceKeys.has(item.key) && !allGroupKeySet.has(item.key))
    .map(makeFallbackGroup);
  const deepSpaceGroups = [...deepSpaceFromAnalysis, ...deepSpaceFallbacks];

  const classifyGroup = (g: GroupedInsight): 'underpriced' | 'overpriced' | 'priced_right' => {
    const maxScore = Math.max(g.newScore, g.usedScore);
    if (maxScore <= 0) return 'priced_right';
    if (maxScore >= pomUnderpricedScore) return 'underpriced';
    if (maxScore <= pomOverpricedScore) return 'overpriced';
    return 'priced_right';
  };

  const scoreFilteredOrbitGroups = scoreFilter === 'all'
    ? inOrbitGroups
    : inOrbitGroups.filter(g => classifyGroup(g) === scoreFilter);

  const underpricedCount = inOrbitGroups.filter(g => classifyGroup(g) === 'underpriced').length;
  const overPricedCount = inOrbitGroups.filter(g => classifyGroup(g) === 'overpriced').length;
  const pricedRightCount = inOrbitGroups.filter(g => classifyGroup(g) === 'priced_right').length;

  const selectedGroups = orbitFilter === 'in_orbit'
    ? scoreFilteredOrbitGroups
    : orbitFilter === 'future_missions'
    ? futureMissionsGroups
    : deepSpaceGroups;

  useEffect(() => { setItemsToShow(25); }, [sortDir, orbitFilter, scoreFilter]);

  const ScoreSortButton = () => (
    <button
      onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
      className="flex items-center gap-0.5 text-[9px] uppercase tracking-wider rounded px-1.5 py-0.5 bg-purple-500/20 text-purple-300 whitespace-nowrap w-[52px]"
      data-testid="button-sort-score"
    >
      Score
      {sortDir === 'desc' ? <ArrowDown className="w-2.5 h-2.5 ml-0.5" /> : <ArrowUp className="w-2.5 h-2.5 ml-0.5" />}
    </button>
  );

  return (
    <div className="space-y-4">

      {/* Spot Price Lookup */}
      <PomSpotLookup formatCurrency={formatCurrency} />

      {/* Item list */}
      <div className="space-y-1.5">

        {/* Zone filter tabs — compact segmented control */}
        <div className="flex items-center gap-2 px-1 pb-1">
          <div className="flex items-stretch rounded-md border border-gray-700/60 bg-gray-900/50 overflow-hidden flex-1 text-[9px] font-semibold uppercase tracking-wider">
            <button
              onClick={() => setOrbitFilter('in_orbit')}
              className={`flex items-center justify-center gap-1 flex-1 px-2 py-1.5 transition-colors ${
                orbitFilter === 'in_orbit'
                  ? 'bg-blue-500/20 text-blue-300'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
              data-testid="filter-in-orbit"
            >
              <Orbit className="w-2.5 h-2.5 flex-shrink-0" />
              <span>Orbit</span>
              <span className="opacity-50 font-normal">({inOrbitGroups.length})</span>
            </button>
            <div className="w-px self-stretch bg-gray-700/60" />
            <button
              onClick={() => setOrbitFilter('future_missions')}
              className={`flex items-center justify-center gap-1 flex-1 px-2 py-1.5 transition-colors ${
                orbitFilter === 'future_missions'
                  ? 'bg-amber-500/20 text-amber-300'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
              data-testid="filter-future-missions"
            >
              <Satellite className="w-2.5 h-2.5 flex-shrink-0" />
              <span>Missions</span>
              <span className="opacity-50 font-normal">({futureMissionsGroups.length})</span>
            </button>
            <div className="w-px self-stretch bg-gray-700/60" />
            <button
              onClick={() => setOrbitFilter('deep_space')}
              className={`flex items-center justify-center gap-1 flex-1 px-2 py-1.5 transition-colors ${
                orbitFilter === 'deep_space'
                  ? 'bg-indigo-500/20 text-indigo-300'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
              data-testid="filter-deep-space"
            >
              <Rocket className="w-2.5 h-2.5 flex-shrink-0" />
              <span>Deep Space</span>
              <span className="opacity-50 font-normal">({deepSpaceGroups.length})</span>
            </button>
          </div>

          {/* Swipe info tooltip */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="text-gray-600 hover:text-gray-400 transition-colors flex-shrink-0" data-testid="button-swipe-info">
                <Info className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[10px] space-y-0.5 max-w-[180px]">
              {orbitFilter === 'in_orbit' && <>
                <p><span className="text-amber-300">Short swipe right</span> → Missions</p>
                <p><span className="text-indigo-300">Long swipe right</span> → Deep Space</p>
              </>}
              {orbitFilter === 'future_missions' && <>
                <p><span className="text-emerald-300">Swipe left</span> → In Orbit</p>
                <p><span className="text-indigo-300">Swipe right</span> → Deep Space</p>
              </>}
              {orbitFilter === 'deep_space' && <>
                <p><span className="text-amber-300">Short swipe left</span> → Missions</p>
                <p><span className="text-emerald-300">Long swipe left</span> → In Orbit</p>
              </>}
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Score filter — compact inline strip, only for In Orbit */}
        {orbitFilter === 'in_orbit' && (
          <div className="flex items-center gap-0.5 px-1">
            {([
              { key: 'all',          label: 'All',         count: inOrbitGroups.length, active: 'bg-gray-700/50 text-gray-200',                              inactive: 'text-gray-600 hover:text-gray-400' },
              { key: 'underpriced',  label: 'Underpriced', count: underpricedCount,      active: 'bg-emerald-500/15 text-emerald-300',                        inactive: 'text-gray-600 hover:text-gray-400' },
              { key: 'priced_right', label: 'Right',       count: pricedRightCount,      active: 'bg-blue-500/15 text-blue-300',                              inactive: 'text-gray-600 hover:text-gray-400' },
              { key: 'overpriced',   label: 'Overpriced',  count: overPricedCount,       active: 'bg-orange-500/15 text-orange-300',                          inactive: 'text-gray-600 hover:text-gray-400' },
            ] as const).map(({ key, label, count, active, inactive }) => (
              <button
                key={key}
                onClick={() => setScoreFilter(key)}
                className={`flex items-center gap-0.5 text-[8px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded transition-colors ${scoreFilter === key ? active : inactive}`}
                data-testid={`filter-score-${key}`}
              >
                {label}
                <span className="opacity-60">({count})</span>
              </button>
            ))}
          </div>
        )}

        {/* Main list */}
        {(orbitFilter === 'deep_space' || orbitFilter === 'future_missions' || insightsData) ? (
          selectedGroups.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              {orbitFilter === 'deep_space' ? (
                <div className="space-y-1">
                  <Rocket className="w-8 h-8 text-indigo-700 mx-auto" />
                  <p className="text-xs text-gray-600">Nothing in deep space yet</p>
                  <p className="text-[10px] text-gray-700">Long swipe right on a tile to archive it here</p>
                </div>
              ) : orbitFilter === 'future_missions' ? (
                <div className="space-y-1">
                  <Satellite className="w-8 h-8 text-amber-700 mx-auto" />
                  <p className="text-xs text-gray-600">No items queued for future review</p>
                  <p className="text-[10px] text-gray-700">Short swipe right on an In Orbit tile to queue it here</p>
                </div>
              ) : (
                <p className="text-xs">No items found</p>
              )}
            </div>
          ) : (
            <>
              {/* Column headers */}
              <div className="flex items-center gap-1 px-2 pb-0.5">
                <ScoreSortButton />
                <div className="flex-1 min-w-0" />
                <span className="text-[9px] uppercase tracking-wider text-gray-400 w-14 text-right flex-shrink-0">N Cur</span>
                <span className="text-[9px] uppercase tracking-wider text-gray-400 w-[52px] text-right flex-shrink-0">N Score</span>
                <span className="text-[9px] uppercase tracking-wider text-gray-400 w-14 text-right flex-shrink-0">U Cur</span>
                <span className="text-[9px] uppercase tracking-wider text-gray-400 w-[52px] text-right flex-shrink-0">U Score</span>
                <span className="w-5 flex-shrink-0" />
              </div>

              {selectedGroups.slice(0, itemsToShow).map((group) => {
                const primaryLot = group.newLot ?? group.usedLot;
                return (
                  <SwipeableTile
                    key={group.key}
                    group={group}
                    orbitFilter={orbitFilter}
                    onMoveToZone={onMoveToZone}
                  >
                    <div
                      className="group relative bg-gradient-to-br from-blue-950/50 via-slate-800/70 to-blue-900/30 border border-blue-700/25 rounded-lg px-2 py-1.5 cursor-pointer shadow-[0_2px_8px_rgba(15,40,100,0.35),inset_0_1px_0_rgba(147,197,253,0.07)] hover:shadow-[0_4px_14px_rgba(15,40,100,0.5),inset_0_1px_0_rgba(147,197,253,0.12)] hover:border-blue-600/40 transition-shadow duration-150"
                      data-testid={`item-group-${group.key}`}
                      onClick={() => {
                        if (primaryLot) onItemClick?.('inventory', primaryLot.inventoryId);
                      }}
                    >
                      {/* Row 1: Part number + Item name + buttons */}
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-mono text-[10px] text-blue-200/80 flex-shrink-0">{group.itemNo}</span>
                        <p className="text-xs text-slate-300 truncate flex-1 min-w-0">{group.itemName || 'Unknown Item'}</p>
                        {primaryLot && (
                          <div className="invisible group-hover:visible flex items-center gap-0.5 flex-shrink-0">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    fetchPricingMutation.mutate(group);
                                  }}
                                  disabled={pricingLoading.has(group.key)}
                                  className="text-gray-600 hover:text-purple-400 disabled:text-gray-700 transition-colors"
                                  data-testid={`button-price-group-${group.key}`}
                                >
                                  <DollarSign className={`w-2.5 h-2.5 ${pricingLoading.has(group.key) ? 'animate-pulse text-purple-400' : ''}`} />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="text-xs">
                                Get suggested price (2 API calls)
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const lots = [group.newLot, group.usedLot].filter(Boolean) as PricingInsight[];
                                    lots.forEach(lot => refreshItemMutation.mutate({
                                      inventoryId: lot.inventoryId,
                                      itemNo: lot.itemNo,
                                      itemType: lot.itemType,
                                      colorId: lot.colorId,
                                      newOrUsed: lot.newOrUsed,
                                    }));
                                  }}
                                  disabled={[group.newLot, group.usedLot].some(l => l && refreshingItems.has(l.inventoryId))}
                                  className="text-gray-600 hover:text-gray-400 disabled:text-gray-700 transition-colors"
                                  data-testid={`button-refresh-group-${group.key}`}
                                >
                                  <RefreshCw className={`w-2.5 h-2.5 ${[group.newLot, group.usedLot].some(l => l && refreshingItems.has(l.inventoryId)) ? 'animate-spin text-purple-400' : ''}`} />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="text-xs">
                                Refresh score data (2 API calls per condition)
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        )}
                      </div>

                      {/* Row 2: Qty · Color · Peak */}
                      <div className="flex items-center gap-1.5 mt-0.5 min-w-0 overflow-hidden">
                        <span className="text-[10px] font-mono text-slate-400 flex-shrink-0">
                          ×{(group.newLot?.quantity ?? 0) + (group.usedLot?.quantity ?? 0)}
                        </span>
                        <span className="text-[10px] text-slate-400 truncate min-w-0" style={{ maxWidth: '7rem' }}>{group.colorName || '—'}</span>
                        {group.marketPeakSoldPrice != null && (
                          <span className="text-[9px] text-blue-400/70 flex-shrink-0 whitespace-nowrap">
                            · peak {formatCurrency(group.marketPeakSoldPrice)}
                          </span>
                        )}
                      </div>

                      {/* Row 3: Score | N Cur | N Score | U Cur | U Score */}
                      <div className="flex items-center gap-1 mt-0.5 min-w-0">
                        {(() => {
                          const maxScore = Math.max(group.newScore ?? 0, group.usedScore ?? 0);
                          const hasScore = (group.newLot?.opportunityScore != null) || (group.usedLot?.opportunityScore != null);
                          return (
                            <span className={`text-[11px] font-mono font-bold flex-shrink-0 w-[52px] ${hasScore ? scoreColor(maxScore) : 'text-slate-600'}`}>
                              {hasScore ? `${maxScore}×` : '—'}
                            </span>
                          );
                        })()}
                        <div className="flex-1 min-w-0" />

                        <div
                          className="flex flex-col items-end w-14 flex-shrink-0 cursor-pointer"
                          onClick={(e) => { if (group.newLot) { e.stopPropagation(); onItemClick?.('inventory', group.newLot.inventoryId); } }}
                        >
                          {group.newLot ? (
                            <>
                              <span className="text-[10px] font-mono text-slate-300 leading-tight">{formatCurrency(group.newLot.currentPrice)}</span>
                              {pricingData.get(group.key)?.n && (
                                <span className="text-[9px] font-mono text-purple-400 leading-tight">{formatCurrency(pricingData.get(group.key)!.n)}</span>
                              )}
                            </>
                          ) : (
                            <span className="text-[10px] text-slate-700">—</span>
                          )}
                        </div>

                        <span className={`text-[10px] font-mono font-bold text-right flex-shrink-0 w-[52px] ${group.newLot ? scoreColor(group.newLot.opportunityScore) : 'text-slate-700'}`}>
                          {group.newLot?.opportunityScore != null ? `${group.newLot.opportunityScore}×` : '—'}
                        </span>

                        <div
                          className="flex flex-col items-end w-14 flex-shrink-0 cursor-pointer"
                          onClick={(e) => { if (group.usedLot) { e.stopPropagation(); onItemClick?.('inventory', group.usedLot.inventoryId); } }}
                        >
                          {group.usedLot ? (
                            <>
                              <span className="text-[10px] font-mono text-slate-300 leading-tight">{formatCurrency(group.usedLot.currentPrice)}</span>
                              {pricingData.get(group.key)?.u && (
                                <span className="text-[9px] font-mono text-purple-400 leading-tight">{formatCurrency(pricingData.get(group.key)!.u)}</span>
                              )}
                            </>
                          ) : (
                            <span className="text-[10px] text-slate-700">—</span>
                          )}
                        </div>

                        <span className={`text-[10px] font-mono font-bold text-right flex-shrink-0 w-[52px] ${group.usedLot ? scoreColor(group.usedLot.opportunityScore) : 'text-slate-700'}`}>
                          {group.usedLot?.opportunityScore != null ? `${group.usedLot.opportunityScore}×` : '—'}
                        </span>

                        <span className="w-5 flex-shrink-0" />
                      </div>
                    </div>
                  </SwipeableTile>
                );
              })}

              {selectedGroups.length > itemsToShow && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setItemsToShow(prev => prev + 25)}
                  className="w-full gap-2"
                  data-testid="button-show-more"
                >
                  <ChevronDown className="w-4 h-4" />
                  Show 25 more ({selectedGroups.length - itemsToShow} remaining)
                </Button>
              )}
            </>
          )
        ) : !insightsLoading ? (
          <div className="text-center py-12">
            <Sparkles className="w-10 h-10 text-purple-400 mx-auto mb-3" />
            <h3 className="text-sm font-bold text-white mb-1">No Data Yet</h3>
            <p className="text-xs text-gray-400 mb-3">Run your first sync to analyze pricing</p>
            <p className="text-xs text-gray-500">Use the refresh button in the header to run your first sync.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
