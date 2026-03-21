import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, ArrowRight, Building2, Link, Smartphone, Share2, PlusSquare, ClipboardPaste, ExternalLink, Loader2, Archive, Layers, MapPin, Upload, FileText, ChevronRight, AlertCircle, Package, Globe, CreditCard, Lock, BadgeCheck, X, TrendingUp, Target, ThumbsUp, Crosshair, ShoppingCart, Users, ChevronDown, BarChart2, Zap } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { TOS_SECTIONS, TOS_LAST_UPDATED } from "@/lib/constants";
import { parseBricklinkPaste, getPasteStatus, type PasteStatus } from "@/lib/bricklink-paste";
import type { Organization } from "@shared/schema";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import elfieRobot from "@assets/PlanetBrick_good_robot_1760672362080.png";

interface Props {
  org: Organization;
  onComplete: () => void;
  onDismiss?: () => void;
}

const STEPS = [
  { id: 1, label: "Company", icon: Building2 },
  { id: 2, label: "Strategy", icon: Target },
  { id: 3, label: "BrickLink", icon: Link },
  { id: 4, label: "Warehouse", icon: Archive },
  { id: 5, label: "BrickOwl", icon: Globe },
  { id: 6, label: "Subscribe", icon: CreditCard },
];

const DEPTH_OPTIONS = [
  { value: 1, label: "Bins Only", description: "Simple — just label your bins", example: "Bin-01, Bin-02…", icon: Archive },
  { value: 2, label: "Shelves + Bins", description: "Group bins onto shelves", example: "Shelf A → Bin A-01…", icon: Layers },
  { value: 3, label: "Full Warehouse", description: "Aisles, shelves, and bins", example: "Aisle 1 → Shelf A → Bin A-01", icon: MapPin },
];

const STEP_MESSAGES: Record<number, string> = {
  1: "Hi! I'm E.L.F.I.E. — your warehouse operations assistant. Let's start with your company info. This shows up on your packing slips and account profile.",
  2: "This is optional, but the more you tell me about your vision, the smarter my suggestions become. Feel free to skip — you can fill this in anytime from the IE Strategies settings.",
  3: "BrickLink is the engine that drives everything. Connect your API keys and I'll automatically sync your inventory, orders, and pricing — all in one place.",
  4: "Now let's map out your storage. Choose how your warehouse is laid out — once I know the structure, I can guide you to any part the moment an order comes in.",
  5: "Do you sell on BrickOwl too? I can keep both stores in sync automatically. This is completely optional — you can add it any time from Settings.",
  6: "You're on the free plan. When you're ready, pick a paid plan below — if it includes a trial, you won't be charged until it ends.",
  7: "You're all set! Come find me in the sidebar whenever you need help managing inventory, filling orders, or just want to know what's going on.",
};

function ElfieSpeechBubble({ step, large = false }: { step: number; large?: boolean }) {
  return (
    <div className={`flex items-end gap-3 ${large ? "mb-2" : "mb-6"}`}>
      <img
        src={elfieRobot}
        alt="E.L.F.I.E."
        className={`object-contain flex-shrink-0 drop-shadow-lg ${large ? "w-28 h-28" : "w-16 h-16"}`}
      />
      <div className="relative flex-1">
        {/* Speech bubble tail — left-pointing triangle */}
        <span
          className="absolute left-0 bottom-4 -translate-x-full w-0 h-0"
          style={{
            borderTop: "6px solid transparent",
            borderBottom: "6px solid transparent",
            borderRight: "8px solid rgb(55 65 81)", // gray-700
          }}
        />
        <span
          className="absolute left-0 bottom-4 -translate-x-[calc(100%-1px)] w-0 h-0"
          style={{
            borderTop: "5px solid transparent",
            borderBottom: "5px solid transparent",
            borderRight: "7px solid rgb(17 24 39)", // gray-900
          }}
        />
        <div className="bg-gray-900 border border-gray-700 rounded-xl rounded-bl-none px-4 py-3">
          <p className={`text-gray-200 leading-snug ${large ? "text-base" : "text-sm"}`}>
            {STEP_MESSAGES[step]}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function OnboardingWizard({ org, onComplete, onDismiss }: Props) {
  const [step, setStep] = useState(1);
  const { toast } = useToast();
  const { status: installStatus, promptInstall } = useInstallPrompt();

  const { data: availablePlans = [], isLoading: plansLoading } = useQuery<Array<{
    id: number; name: string; basePrice: number; salesPercentage: number;
    freeSalesThreshold: number; status: string; sunsetAt: string | null; isDefault?: boolean;
    trialDurationDays?: number;
  }>>({ queryKey: ['/api/plans'] });

  // Step 1 — Company Info
  const [name, setName] = useState(org.name || "");
  const [address, setAddress] = useState(org.address || "");
  const [phone, setPhone] = useState(org.phone || "");
  const [website, setWebsite] = useState(org.website || "");
  const [tosAccepted, setTosAccepted] = useState(!!org.tosAcceptedAt);
  const [showTos, setShowTos] = useState(false);

  // Step 2 — BrickLink
  const [blKey, setBlKey] = useState("");
  const [blSecret, setBlSecret] = useState("");
  const [blToken, setBlToken] = useState("");
  const [blTokenSecret, setBlTokenSecret] = useState("");
  const [blPasteText, setBlPasteText] = useState("");
  const [blPasteStatus, setBlPasteStatus] = useState<PasteStatus>("idle");
  const [blParsedTokens, setBlParsedTokens] = useState<{ tokenValue: string; tokenSecret: string }[]>([]);
  const [blOcrProcessing, setBlOcrProcessing] = useState(false);

  // Step 3 — Warehouse
  const [selectedDepth, setSelectedDepth] = useState<number | null>(null);

  // Step 4 — BrickOwl
  const [boApiKey, setBoApiKey] = useState("");
  const [channelSyncMode, setChannelSyncMode] = useState<'analysis' | 'full_control' | 'matched_sync'>('analysis');
  const [showBoAdvanced, setShowBoAdvanced] = useState(false);
  // Field config — defaults match server defaultSyncFields
  const [boSyncPrice, setBoSyncPrice] = useState(true);
  const [boSyncRemarks, setBoSyncRemarks] = useState(true);
  const [boSyncDescription, setBoSyncDescription] = useState(true);
  const [boSyncTierPrice, setBoSyncTierPrice] = useState(true);
  const [boSyncSalePercent, setBoSyncSalePercent] = useState(false);
  const [boSyncBulkQty, setBoSyncBulkQty] = useState(true);
  const [boSyncMyCost, setBoSyncMyCost] = useState(false);
  const [boSyncLotWeight, setBoSyncLotWeight] = useState(true);
  const [analysisResult, setAnalysisResult] = useState<null | {
    matchedLots: number; unmatchedLots: number; wouldUpdate: number; wouldCreate: number;
    byField: Record<string, number>;
  }>(null);

  // Step 2 — IE Strategies
  const [ieStratVision, setIeStratVision] = useState("");
  const [ieStratSuccess, setIeStratSuccess] = useState("");
  const [ieStratPricing, setIeStratPricing] = useState("");
  const [ieStratInventory, setIeStratInventory] = useState("");
  const [ieStratOrders, setIeStratOrders] = useState("");
  const [ieStratCustomer, setIeStratCustomer] = useState("");
  const [ieStratMarket, setIeStratMarket] = useState("");

  // Step 6 — Subscribe
  const [selectedPlan, setSelectedPlan] = useState<number | null>(null);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [csvResult, setCsvResult] = useState<{ created: { aisles: number; shelves: number; bins: number; skipped: number }; errors: string[] } | null>(null);
  const [showLotAssign, setShowLotAssign] = useState(false);
  const [lotCsvText, setLotCsvText] = useState("");
  const [lotResult, setLotResult] = useState<{ stats: { assigned: number; skipped: number; notFound: number }; errors: string[] } | null>(null);

  const saveOrgMutation = useMutation({
    mutationFn: (data: Record<string, any>) => apiRequest("PATCH", "/api/org", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/org"] }),
  });

  const saveSettingsMutation = useMutation({
    mutationFn: (data: Record<string, any>) => apiRequest("POST", "/api/settings", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/settings"] }),
  });

  const saveDepthMutation = useMutation({
    mutationFn: (depth: number) => apiRequest("PATCH", "/api/warehouse/settings", { depth }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/warehouse/settings"] }),
  });

  const importCsvMutation = useMutation({
    mutationFn: (csvText: string) => apiRequest("POST", "/api/warehouse/import/csv", { csvText }),
    onSuccess: async (res: any) => {
      const data = await res.json();
      setCsvResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse/bins"] });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse/shelves"] });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse/aisles"] });
    },
  });

  const importLotsMutation = useMutation({
    mutationFn: (text: string) => apiRequest("POST", "/api/warehouse/import/lot-assignments", { csvText: text }),
    onSuccess: async (res: any) => {
      const data = await res.json();
      setLotResult(data);
    },
  });

  const saveIeStratMutation = useMutation({
    mutationFn: (data: Record<string, any>) => apiRequest("PUT", "/api/ie-strategies", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/ie-strategies"] }),
  });

  const checkoutMutation = useMutation({
    mutationFn: async ({ planId }: { planId: number }) => {
      const res = await apiRequest("POST", "/api/billing/checkout", { planId, context: "onboarding" });
      return res.json();
    },
    onSuccess: (data: { url?: string; success?: boolean; redirect?: string }) => {
      if (data?.url) {
        window.location.href = data.url;
      } else if (data?.success) {
        window.location.href = data.redirect || '/';
      } else {
        toast({ title: "Checkout error", description: "No redirect URL returned. Please try again.", variant: "destructive" });
      }
    },
    onError: (err: any) => {
      toast({ title: "Checkout failed", description: err?.message || "Unable to start checkout. Please try again.", variant: "destructive" });
    },
  });

  const selectedIsDefault = availablePlans.find(p => p.id === selectedPlan)?.isDefault ?? false;

  const handleStep1 = async () => {
    const data: Record<string, any> = { name: name.trim() || org.name, address, phone, website };
    if (tosAccepted && !org.tosAcceptedAt) {
      data.tosAcceptedAt = new Date().toISOString();
    }
    await saveOrgMutation.mutateAsync(data);
    setStep(2);
  };

  const handleStep2 = async (skip = false) => {
    const hasContent = ieStratVision || ieStratSuccess || ieStratPricing || ieStratInventory || ieStratOrders || ieStratCustomer || ieStratMarket;
    if (!skip && hasContent) {
      await saveIeStratMutation.mutateAsync({
        visionMission: ieStratVision || null,
        successFactors: ieStratSuccess || null,
        pricingStrategy: ieStratPricing || null,
        inventoryStrategy: ieStratInventory || null,
        ordersStrategy: ieStratOrders || null,
        customerStrategy: ieStratCustomer || null,
        marketStrategy: ieStratMarket || null,
      });
    }
    setStep(3);
  };

  const handleStep3 = async (skip = false) => {
    if (!skip && (blKey || blSecret || blToken || blTokenSecret)) {
      await saveSettingsMutation.mutateAsync({
        bricklinkConsumerKey: blKey || null,
        bricklinkConsumerSecret: blSecret || null,
        bricklinkTokenValue: blToken || null,
        bricklinkTokenSecret: blTokenSecret || null,
      });
    }
    setStep(4);
  };

  const handleStep4 = async () => {
    if (selectedDepth !== null) {
      await saveDepthMutation.mutateAsync(selectedDepth);
    }
    setStep(5);
  };

  const analysisMutation = useMutation({
    mutationFn: async () => {
      // Save the API key first so the sync engine can authenticate
      if (boApiKey.trim()) {
        await apiRequest('POST', '/api/settings', { brickowlApiKey: boApiKey.trim() });
      }
      // Run preview with the current local field config (before saving to config table)
      return apiRequest('POST', '/api/channel-sync/preview', {
        syncFields: {
          price: boSyncPrice, remarks: boSyncRemarks, description: boSyncDescription,
          tierPrice: boSyncTierPrice, salePercent: boSyncSalePercent,
          bulkQty: boSyncBulkQty, myCost: boSyncMyCost, lotWeight: boSyncLotWeight,
        },
      });
    },
    onSuccess: (data: any) => {
      if (data?.preview) setAnalysisResult(data.preview);
    },
    onError: (err: any) => {
      toast({
        title: 'Analysis failed',
        description: err?.message?.includes('API key') || err?.message?.includes('401')
          ? 'Invalid API key — check your BrickOwl credentials and try again.'
          : 'Could not reach BrickOwl. Verify your API key and try again.',
        variant: 'destructive',
      });
    },
  });

  const handleStep5 = async (skip = false) => {
    if (!skip && boApiKey.trim()) {
      await saveSettingsMutation.mutateAsync({
        brickowlApiKey: boApiKey.trim(),
        channelSyncMode,
      });
      // Save field config preferences to their own table
      await apiRequest('PATCH', '/api/channel-sync/config', {
        syncPrice: boSyncPrice, syncRemarks: boSyncRemarks, syncDescription: boSyncDescription,
        syncTierPrice: boSyncTierPrice, syncSalePercent: boSyncSalePercent,
        syncBulkQty: boSyncBulkQty, syncMyCost: boSyncMyCost, syncLotWeight: boSyncLotWeight,
      });
    }
    setStep(6);
  };

  const handleStep6Skip = () => setStep(7);

  const handleFinish = async () => {
    await saveOrgMutation.mutateAsync({ onboardingCompleted: true });
    onComplete();
  };

  const isSaving = saveOrgMutation.isPending || saveSettingsMutation.isPending || saveDepthMutation.isPending || saveIeStratMutation.isPending || analysisMutation.isPending;
  const csvDepthHint = selectedDepth ?? 3;

  return (
    <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-lg py-8">

        {/* Dismiss button */}
        {onDismiss && step < 7 && (
          <div className="flex justify-end mb-2">
            <button
              onClick={onDismiss}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
              data-testid="button-onboard-dismiss"
              title="Close and finish later"
            >
              <X className="w-3.5 h-3.5" />
              <span>Finish later</span>
            </button>
          </div>
        )}

        {/* ELFIE speech bubble — steps 1–6 */}
        {step < 7 && <ElfieSpeechBubble step={step} />}

        {/* Step indicator */}
        {step < 7 && (
          <div className="flex items-center justify-center gap-0 mb-6 overflow-x-auto pb-1">
            {STEPS.map((s, i) => (
              <div key={s.id} className="flex items-center flex-shrink-0">
                <div className="flex flex-col items-center gap-1">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center border-2 transition-colors ${
                    step > s.id
                      ? "bg-green-500 border-green-500"
                      : step === s.id
                      ? "bg-gray-800 border-lego-blue"
                      : "bg-gray-900 border-gray-700"
                  }`}>
                    {step > s.id ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                    ) : (
                      <s.icon className={`w-3 h-3 ${step === s.id ? "text-lego-blue" : "text-gray-600"}`} />
                    )}
                  </div>
                  <span className={`hidden sm:block text-[10px] font-medium uppercase tracking-wide whitespace-nowrap ${step === s.id ? "text-gray-300" : step > s.id ? "text-green-400" : "text-gray-600"}`}>
                    {s.label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`w-8 h-px mx-1.5 mb-0 sm:mb-4 flex-shrink-0 transition-colors ${step > s.id ? "bg-green-500/50" : "bg-gray-700"}`} />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Step content card */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-5">

          {/* ── Step 1: Company Info ── */}
          {step === 1 && (
            <>
              <div>
                <h2 className="text-lg font-semibold text-white mb-1">Company information</h2>
                <p className="text-sm text-gray-400">This appears on packing slips and your account profile.</p>
              </div>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="onboard-name" className="text-xs text-gray-400">Company Name</Label>
                  <Input
                    id="onboard-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your store name"
                    className="bg-gray-800 border-gray-700 text-white"
                    data-testid="input-onboard-name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="onboard-address" className="text-xs text-gray-400">Business Address</Label>
                  <Textarea
                    id="onboard-address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder={"123 Brick Lane\nCity, State 00000\nCountry"}
                    className="bg-gray-800 border-gray-700 text-white text-xs resize-none"
                    rows={3}
                    data-testid="input-onboard-address"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="onboard-phone" className="text-xs text-gray-400">Phone <span className="text-gray-600">(optional)</span></Label>
                    <Input
                      id="onboard-phone"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+1 (555) 000-0000"
                      className="bg-gray-800 border-gray-700 text-white text-sm"
                      data-testid="input-onboard-phone"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="onboard-website" className="text-xs text-gray-400">Website <span className="text-gray-600">(optional)</span></Label>
                    <Input
                      id="onboard-website"
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                      placeholder="https://yourstore.com"
                      className="bg-gray-800 border-gray-700 text-white text-sm"
                      data-testid="input-onboard-website"
                    />
                  </div>
                </div>
              </div>

              {/* Terms of Service */}
              <div className="border-t border-gray-800 pt-4 mt-2 space-y-3">
                <label className="flex items-start gap-2.5 cursor-pointer group" data-testid="label-tos-accept">
                  <input
                    type="checkbox"
                    checked={tosAccepted}
                    onChange={(e) => setTosAccepted(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500/30 cursor-pointer"
                    data-testid="checkbox-tos-accept"
                  />
                  <span className="text-xs text-gray-400 leading-relaxed">
                    I agree to the{" "}
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); setShowTos(!showTos); }}
                      className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
                      data-testid="button-view-tos"
                    >
                      Terms of Service
                    </button>
                  </span>
                </label>
                {showTos && (
                  <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 max-h-48 overflow-y-auto text-[11px] text-gray-400 leading-relaxed space-y-3" data-testid="tos-content-onboarding">
                    <p className="text-xs font-semibold text-gray-300">E.L.F.I.E. Terms of Service</p>
                    <p>Last updated: {TOS_LAST_UPDATED}</p>
                    {TOS_SECTIONS.map(s => (
                      <p key={s.num}><strong className="text-gray-300">{s.num}. {s.title}.</strong> {s.text}</p>
                    ))}
                  </div>
                )}
              </div>

              <div className="pt-2 flex justify-end">
                <Button onClick={handleStep1} disabled={isSaving || !name.trim() || !tosAccepted} data-testid="button-onboard-next-1">
                  {isSaving ? "Saving…" : "Continue"}
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </>
          )}

          {/* ── Step 2: IE Strategy ── */}
          {step === 2 && (
            <>
              <div>
                <h2 className="text-lg font-semibold text-white mb-1">Business strategy <span className="text-xs font-normal text-gray-500 ml-1">optional</span></h2>
                <p className="text-sm text-gray-400">Help me understand your goals so I can frame signals and suggestions around what actually matters to you. Everything here is optional — skip anything you're not ready for.</p>
              </div>

              <div className="space-y-4">
                {/* Vision & Mission */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <Crosshair className="w-3.5 h-3.5 text-blue-400" />
                    <Label className="text-xs font-medium text-gray-300">Vision &amp; Mission <span className="text-gray-600 font-normal">— All agents</span></Label>
                  </div>
                  <Textarea
                    value={ieStratVision}
                    onChange={(e) => setIeStratVision(e.target.value)}
                    placeholder="Who are you, and why does this store exist? E.g. 'Trusted seller of rare space sets — fast, accurate, no hassle.'"
                    className="bg-gray-800 border-gray-700 text-white text-xs resize-none"
                    rows={3}
                    data-testid="textarea-onboard-vision"
                  />
                </div>

                {/* Defining Success */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <ThumbsUp className="w-3.5 h-3.5 text-green-400" />
                    <Label className="text-xs font-medium text-gray-300">Defining Success <span className="text-gray-600 font-normal">— All agents</span></Label>
                  </div>
                  <p className="text-[10px] text-gray-600 leading-relaxed">Picture 12 months from now — what's different? Describe it in vivid, sensory terms: how you feel, what customers say, what the numbers look like.</p>
                  <Textarea
                    value={ieStratSuccess}
                    onChange={(e) => setIeStratSuccess(e.target.value)}
                    placeholder="E.g. 'Orders ship same day. Inbox is quiet. Customers leave 5-star reviews mentioning speed without prompting…'"
                    className="bg-gray-800 border-gray-700 text-white text-xs resize-none"
                    rows={3}
                    data-testid="textarea-onboard-success"
                  />
                </div>

                {/* Per-agent strategy accordion */}
                <div className="border-t border-gray-800 pt-3 space-y-3">
                  <p className="text-[10px] text-gray-600 uppercase tracking-wide font-medium">Agent-specific directives <span className="normal-case">(optional)</span></p>

                  {[
                    { icon: TrendingUp, color: "text-purple-400", label: "Pricing Agent", placeholder: "How aggressive or conservative should pricing be? Any rules on repricing?", value: ieStratPricing, setter: setIeStratPricing, testId: "textarea-onboard-strat-pricing" },
                    { icon: Package, color: "text-yellow-400", label: "Inventory Agent", placeholder: "What matters most — dead stock alerts, low-stock warnings, lot hygiene?", value: ieStratInventory, setter: setIeStratInventory, testId: "textarea-onboard-strat-inventory" },
                    { icon: ShoppingCart, color: "text-blue-400", label: "Orders Agent", placeholder: "Fulfilment priorities — speed, accuracy, bundling? Any order-level rules?", value: ieStratOrders, setter: setIeStratOrders, testId: "textarea-onboard-strat-orders" },
                    { icon: Users, color: "text-pink-400", label: "Customer Agent", placeholder: "How to handle repeat buyers, problem orders, or VIP customers?", value: ieStratCustomer, setter: setIeStratCustomer, testId: "textarea-onboard-strat-customer" },
                    { icon: Globe, color: "text-teal-400", label: "Market Agent", placeholder: "What market signals matter most — BrickLink trends, rare finds, forum buzz?", value: ieStratMarket, setter: setIeStratMarket, testId: "textarea-onboard-strat-market" },
                  ].map(({ icon: Icon, color, label, placeholder, value, setter, testId }) => (
                    <div key={label} className="space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <Icon className={`w-3.5 h-3.5 ${color}`} />
                        <Label className="text-xs text-gray-400">{label}</Label>
                      </div>
                      <Textarea
                        value={value}
                        onChange={(e) => setter(e.target.value)}
                        placeholder={placeholder}
                        className="bg-gray-800 border-gray-700 text-white text-xs resize-none"
                        rows={2}
                        data-testid={testId}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-2 flex justify-between items-center gap-3 flex-wrap">
                <Button variant="ghost" onClick={() => handleStep2(true)} className="text-gray-500" data-testid="button-onboard-skip-2">
                  Skip for now
                </Button>
                <Button onClick={() => handleStep2(false)} disabled={isSaving} data-testid="button-onboard-next-2">
                  {isSaving ? "Saving…" : "Continue"}
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </>
          )}

          {/* ── Step 3: BrickLink ── */}
          {step === 3 && (

            <>
              <div>
                <h2 className="text-lg font-semibold text-white mb-1">Connect BrickLink</h2>
                <p className="text-sm text-gray-400">BrickLink is your inventory source of truth. Data flows one way — into this platform. You can skip this and add credentials later in Settings.</p>
              </div>

              <div className="space-y-3">
                <div className="bg-blue-950/30 border border-blue-500/20 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <ClipboardPaste className="w-3.5 h-3.5 text-blue-400" />
                      <span className="text-xs font-medium text-blue-300">Quick setup — paste from BrickLink</span>
                    </div>
                    <a href="https://www.bricklink.com/v2/api/register_consumer.page" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300" data-testid="link-bl-api-page">
                      Open BrickLink API page <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </div>
                  <p className="text-[10px] text-gray-500 leading-relaxed">Sign in to BrickLink, open the API page above, select all the text on that page, copy it, and paste it here. You can also paste a screenshot of the API page.</p>
                  <Textarea
                    placeholder={blOcrProcessing ? "Reading screenshot..." : "Paste text or screenshot here..."}
                    value={blPasteText}
                    disabled={blOcrProcessing}
                    onChange={(e) => {
                      const val = e.target.value;
                      setBlPasteText(val);
                      if (!val.trim()) { setBlPasteStatus("idle"); return; }
                      const parsed = parseBricklinkPaste(val);
                      if (!parsed) {
                        setBlPasteText("");
                        setBlPasteStatus("fail");
                        return;
                      }
                      setBlPasteText("");
                      if (parsed.consumerKey) setBlKey(parsed.consumerKey);
                      if (parsed.consumerSecret) setBlSecret(parsed.consumerSecret);
                      if (parsed.tokens.length === 1) {
                        setBlToken(parsed.tokens[0].tokenValue);
                        setBlTokenSecret(parsed.tokens[0].tokenSecret);
                        setBlParsedTokens([]);
                      } else if (parsed.tokens.length > 1) {
                        setBlParsedTokens(parsed.tokens);
                      }
                      setBlPasteStatus(getPasteStatus(parsed));
                    }}
                    onPaste={async (e) => {
                      const items = e.clipboardData?.items;
                      if (!items) return;
                      for (let i = 0; i < items.length; i++) {
                        if (items[i].type.startsWith('image/')) {
                          e.preventDefault();
                          const file = items[i].getAsFile();
                          if (!file) return;
                          setBlOcrProcessing(true);
                          setBlPasteStatus("idle");
                          setBlPasteText("");
                          try {
                            const reader = new FileReader();
                            const base64 = await new Promise<string>((resolve, reject) => {
                              reader.onload = () => resolve(reader.result as string);
                              reader.onerror = reject;
                              reader.readAsDataURL(file);
                            });
                            const resp = await fetch('/api/ocr/bricklink-credentials', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              credentials: 'include',
                              body: JSON.stringify({ image: base64 }),
                            });
                            const data = await resp.json();
                            if (data.error || (!data.consumerKey && !data.consumerSecret && !data.tokenValue && !data.tokenSecret)) {
                              setBlPasteStatus("fail");
                            } else {
                              if (data.consumerKey) setBlKey(data.consumerKey);
                              if (data.consumerSecret) setBlSecret(data.consumerSecret);
                              if (data.tokenValue) setBlToken(data.tokenValue);
                              if (data.tokenSecret) setBlTokenSecret(data.tokenSecret);
                              const hasAll = data.consumerKey && data.consumerSecret && data.tokenValue && data.tokenSecret;
                              setBlPasteStatus(hasAll ? "success" : "partial");
                            }
                          } catch {
                            setBlPasteStatus("fail");
                          } finally {
                            setBlOcrProcessing(false);
                          }
                          return;
                        }
                      }
                    }}
                    className="bg-gray-800 border-gray-700 text-white text-xs min-h-[60px] max-h-[100px]"
                    data-testid="textarea-bl-paste"
                  />
                  {blOcrProcessing && <p className="text-[10px] text-blue-400 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" />Reading credentials from screenshot...</p>}
                  {blPasteStatus === "success" && !blOcrProcessing && <p className="text-[10px] text-green-400">All 4 credentials extracted successfully.</p>}
                  {blPasteStatus === "partial" && !blOcrProcessing && <p className="text-[10px] text-yellow-400">Some credentials found — fill in the rest below.</p>}
                  {blPasteStatus === "fail" && !blOcrProcessing && <p className="text-[10px] text-red-400">Could not find BrickLink credentials. Try copying the full page or pasting a clearer screenshot.</p>}
                  {blPasteStatus === "multi" && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] text-yellow-400">Multiple access tokens found — select which one to use:</p>
                      {blParsedTokens.map((t, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => { setBlToken(t.tokenValue); setBlTokenSecret(t.tokenSecret); setBlPasteStatus("success"); setBlParsedTokens([]); }}
                          className={`w-full text-left px-2.5 py-1.5 rounded text-[10px] border transition-colors ${blToken === t.tokenValue ? "bg-blue-600/20 border-blue-500/40 text-blue-300" : "bg-gray-800/50 border-gray-700/50 text-gray-400 hover:bg-gray-700/40"}`}
                          data-testid={`button-bl-token-${i}`}
                        >
                          Token {i + 1}: {t.tokenValue.slice(0, 8)}...{t.tokenValue.slice(-4)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-700/50" /></div>
                  <div className="relative flex justify-center"><span className="bg-gray-900 px-2 text-[10px] text-gray-600">or enter manually</span></div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-gray-400">Consumer Key</Label>
                  <Input value={blKey} onChange={(e) => setBlKey(e.target.value)} placeholder="Consumer Key" className="bg-gray-800 border-gray-700 text-white text-sm" data-testid="input-onboard-bl-key" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-gray-400">Consumer Secret</Label>
                  <Input type="password" value={blSecret} onChange={(e) => setBlSecret(e.target.value)} placeholder="Consumer Secret" className="bg-gray-800 border-gray-700 text-white text-sm" data-testid="input-onboard-bl-secret" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-gray-400">Token Value</Label>
                  <Input value={blToken} onChange={(e) => setBlToken(e.target.value)} placeholder="Token Value" className="bg-gray-800 border-gray-700 text-white text-sm" data-testid="input-onboard-bl-token" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-gray-400">Token Secret</Label>
                  <Input type="password" value={blTokenSecret} onChange={(e) => setBlTokenSecret(e.target.value)} placeholder="Token Secret" className="bg-gray-800 border-gray-700 text-white text-sm" data-testid="input-onboard-bl-token-secret" />
                </div>
              </div>
              <div className="pt-2 flex justify-between">
                <Button variant="ghost" onClick={() => handleStep3(true)} className="text-gray-500" data-testid="button-onboard-skip-3">
                  Skip for now
                </Button>
                <Button onClick={() => handleStep3(false)} disabled={isSaving} data-testid="button-onboard-next-3">
                  {isSaving ? "Saving…" : "Continue"}
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </>
          )}

          {/* ── Step 4: Warehouse Setup ── */}
          {step === 4 && (
            <>
              <div>
                <h2 className="text-lg font-semibold text-white mb-1">Warehouse setup</h2>
                <p className="text-sm text-gray-400">Tell us how your physical storage is organized. You can always change this later — your bin assignments are never lost when you upgrade levels.</p>
              </div>

              <div className="space-y-2">
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">How is your storage organized?</p>
                {DEPTH_OPTIONS.map(opt => {
                  const Icon = opt.icon;
                  const isSelected = selectedDepth === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setSelectedDepth(opt.value)}
                      className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-colors hover-elevate ${
                        isSelected
                          ? "border-yellow-500/60 bg-yellow-500/10"
                          : "border-gray-700 bg-gray-800/40 hover:border-gray-600"
                      }`}
                      data-testid={`button-depth-${opt.value}`}
                    >
                      <div className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 ${isSelected ? "bg-yellow-500/20" : "bg-gray-700/50"}`}>
                        <Icon className={`w-4 h-4 ${isSelected ? "text-yellow-400" : "text-gray-400"}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-semibold ${isSelected ? "text-white" : "text-gray-300"}`}>{opt.label}</span>
                          {isSelected && <span className="text-[10px] text-yellow-400 font-medium">Selected</span>}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">{opt.description}</p>
                        <p className="text-[10px] text-gray-600 mt-0.5 font-mono">{opt.example}</p>
                      </div>
                      <ChevronRight className={`w-4 h-4 mt-0.5 shrink-0 ${isSelected ? "text-yellow-400" : "text-gray-600"}`} />
                    </button>
                  );
                })}
              </div>

              {/* CSV Import section */}
              {selectedDepth !== null && (
                <div className="border-t border-gray-800 pt-4">
                  {!showCsvImport ? (
                    <button
                      onClick={() => setShowCsvImport(true)}
                      className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-200 transition-colors group w-full"
                      data-testid="button-onboard-show-csv"
                    >
                      <Upload className="w-3.5 h-3.5 text-gray-500 group-hover:text-gray-300" />
                      <span>I have a spreadsheet or list of my bins — import it now</span>
                      <ChevronRight className="w-3.5 h-3.5 ml-auto text-gray-600 group-hover:text-gray-400" />
                    </button>
                  ) : csvResult ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-green-400 text-xs font-semibold">
                        <CheckCircle2 className="h-4 w-4" />
                        Structure imported
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500">
                        {selectedDepth >= 3 && <span>Aisles created: <span className="font-semibold text-gray-300">{csvResult.created.aisles}</span></span>}
                        {selectedDepth >= 2 && <span>Shelves created: <span className="font-semibold text-gray-300">{csvResult.created.shelves}</span></span>}
                        <span>Bins created: <span className="font-semibold text-gray-300">{csvResult.created.bins}</span></span>
                        {csvResult.created.skipped > 0 && <span>Rows skipped: <span className="font-semibold text-gray-300">{csvResult.created.skipped}</span></span>}
                      </div>
                      {csvResult.errors.length > 0 && (
                        <div className="flex items-start gap-1.5 text-[10px] text-red-400">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                          <span>{csvResult.errors.length} row{csvResult.errors.length !== 1 ? 's' : ''} had errors. Fix these in the Warehouse tab after setup.</span>
                        </div>
                      )}

                      {/* Lot assignment follow-up */}
                      {!showLotAssign && !lotResult && (
                        <button
                          onClick={() => setShowLotAssign(true)}
                          className="w-full flex items-center gap-2.5 text-left rounded-md border border-dashed border-gray-700 hover:border-gray-500 bg-gray-800/40 hover:bg-gray-800/70 px-3 py-2.5 transition-colors group"
                          data-testid="button-onboard-lot-assign"
                        >
                          <Package className="w-3.5 h-3.5 text-gray-500 group-hover:text-gray-300 shrink-0" />
                          <span className="text-xs text-gray-400 group-hover:text-gray-200">Assign your inventory lots to bins now (optional)</span>
                          <ChevronRight className="w-3.5 h-3.5 ml-auto text-gray-600 group-hover:text-gray-400" />
                        </button>
                      )}

                      {showLotAssign && !lotResult && (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-medium text-gray-300 flex items-center gap-1.5">
                              <Package className="h-3.5 w-3.5 text-gray-400" />
                              Assign lots to bins
                            </p>
                            <button onClick={() => setShowLotAssign(false)} className="text-[10px] text-gray-600 hover:text-gray-400">
                              Skip
                            </button>
                          </div>
                          <div className="bg-gray-800/60 rounded-md p-2.5 space-y-1">
                            <p className="text-[10px] text-gray-500">Required: <code className="text-green-400">part_number</code> and <code className="text-green-400">bin</code>. Optional: <code className="text-green-400">color_id</code> <code className="text-green-400">condition</code> <code className="text-green-400">qty</code></p>
                            <pre className="text-[10px] font-mono text-green-400/80 leading-relaxed">{`part_number,bin\n3001,BIN-A1\n3002,BIN-A2`}</pre>
                          </div>
                          <textarea
                            value={lotCsvText}
                            onChange={e => setLotCsvText(e.target.value)}
                            rows={5}
                            placeholder="part_number,bin&#10;3001,BIN-A1&#10;..."
                            className="w-full rounded-md border border-gray-700 bg-gray-900 text-[11px] font-mono text-gray-300 p-2 resize-y focus:outline-none focus:border-gray-500"
                            data-testid="textarea-lot-assign-csv"
                          />
                          <button
                            onClick={() => importLotsMutation.mutate(lotCsvText)}
                            disabled={importLotsMutation.isPending || lotCsvText.trim().split('\n').filter(Boolean).length < 2}
                            className="w-full flex items-center justify-center gap-2 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium py-1.5 transition-colors"
                            data-testid="button-lot-assign-submit"
                          >
                            {importLotsMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            Import Lot Assignments
                          </button>
                        </div>
                      )}

                      {lotResult && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-green-400 text-xs font-semibold">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Lots assigned
                          </div>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500">
                            <span>Assigned: <span className="font-semibold text-gray-300">{lotResult.stats.assigned}</span></span>
                            {lotResult.stats.skipped > 0 && <span>Already assigned: <span className="font-semibold text-gray-300">{lotResult.stats.skipped}</span></span>}
                            {lotResult.stats.notFound > 0 && <span className="text-yellow-500">Not found: <span className="font-semibold">{lotResult.stats.notFound}</span></span>}
                          </div>
                          {lotResult.errors.length > 0 && (
                            <div className="flex items-start gap-1.5 text-[10px] text-red-400">
                              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                              <span>{lotResult.errors.length} row{lotResult.errors.length !== 1 ? 's' : ''} had errors. Fix these in the Warehouse tab.</span>
                            </div>
                          )}
                        </div>
                      )}

                      <button
                        onClick={() => { setCsvResult(null); setCsvText(""); setLotResult(null); setLotCsvText(""); setShowLotAssign(false); }}
                        className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
                      >
                        Import another structure file
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-gray-300 flex items-center gap-1.5">
                          <FileText className="h-3.5 w-3.5 text-gray-400" />
                          Import your bin list
                        </p>
                        <button onClick={() => setShowCsvImport(false)} className="text-[10px] text-gray-600 hover:text-gray-400">
                          Cancel
                        </button>
                      </div>
                      <div className="bg-gray-800/60 rounded-md p-2.5 space-y-1">
                        <p className="text-[10px] text-gray-500">
                          {csvDepthHint === 1 && <>One column: <code className="text-green-400">bin</code></>}
                          {csvDepthHint === 2 && <>Two columns: <code className="text-green-400">shelf</code> and <code className="text-green-400">bin</code></>}
                          {csvDepthHint === 3 && <>Three columns: <code className="text-green-400">aisle</code>, <code className="text-green-400">shelf</code>, and <code className="text-green-400">bin</code></>}
                          {" "}— column order doesn't matter, names are case-insensitive.
                        </p>
                        <pre className="text-[10px] font-mono text-green-400/80 leading-relaxed">
                          {csvDepthHint === 1 && `bin\nBIN-01\nBIN-02\nBIN-03`}
                          {csvDepthHint === 2 && `shelf,bin\nShelf-A,BIN-A1\nShelf-A,BIN-A2\nShelf-B,BIN-B1`}
                          {csvDepthHint === 3 && `aisle,shelf,bin\nA,Shelf-A1,BIN-A1-01\nA,Shelf-A1,BIN-A1-02\nB,Shelf-B1,BIN-B1-01`}
                        </pre>
                      </div>
                      <textarea
                        value={csvText}
                        onChange={e => setCsvText(e.target.value)}
                        rows={6}
                        placeholder="Paste your CSV here…"
                        className="w-full rounded-md border border-gray-700 bg-gray-800 text-xs font-mono text-white p-2 resize-y focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                        data-testid="textarea-onboard-csv"
                      />
                      <p className="text-[10px] text-gray-600">
                        {csvText.split('\n').filter(l => l.trim()).length > 1
                          ? `${csvText.split('\n').filter(l => l.trim()).length - 1} data rows detected`
                          : 'Paste your CSV above'}
                      </p>
                      <Button
                        size="sm"
                        className="w-full"
                        disabled={importCsvMutation.isPending || csvText.trim().split('\n').filter(Boolean).length < 2}
                        onClick={() => importCsvMutation.mutate(csvText)}
                        data-testid="button-onboard-csv-import"
                      >
                        {importCsvMutation.isPending
                          ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Importing…</>
                          : <><Upload className="h-3.5 w-3.5 mr-1.5" />Import</>
                        }
                      </Button>
                    </div>
                  )}
                </div>
              )}

              <div className="pt-2 flex justify-end">
                <Button
                  onClick={handleStep4}
                  disabled={isSaving || selectedDepth === null}
                  data-testid="button-onboard-next-4"
                >
                  {isSaving ? "Saving…" : "Continue"}
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </>
          )}

          {/* ── Step 5: BrickOwl ── */}
          {step === 5 && (
            <>
              <div>
                <h2 className="text-lg font-semibold text-white mb-1">BrickOwl channel</h2>
                <p className="text-sm text-gray-400">
                  If you have a BrickOwl store, connect it here. I'll keep both stores in sync
                  so your quantities and prices stay consistent automatically.
                </p>
              </div>

              {/* API Key */}
              <div className="space-y-1.5">
                <Label htmlFor="onboard-bo-key" className="text-xs text-gray-400">BrickOwl API Key <span className="text-gray-600">(optional)</span></Label>
                <Input
                  id="onboard-bo-key"
                  type="password"
                  value={boApiKey}
                  onChange={(e) => { setBoApiKey(e.target.value); setAnalysisResult(null); }}
                  placeholder="Paste your BrickOwl API key…"
                  className="bg-gray-800 border-gray-700 text-white"
                  data-testid="input-onboard-bo-key"
                />
                <p className="text-[10px] text-gray-600">
                  Find this under My Account → Settings → API on BrickOwl.
                </p>
              </div>

              {boApiKey.trim() && (
                <>
                  {/* Sync mode */}
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-gray-300">How should I manage your BrickOwl store?</p>
                    <div className="grid grid-cols-1 gap-1.5">
                      {([
                        {
                          value: 'analysis' as const,
                          label: 'Analysis Only',
                          sub: 'Read-only — compare channels, no edits made',
                          body: 'Safe starting point. I compare both stores and report differences without touching anything. Upgrade to an active mode whenever you\'re ready.',
                          testId: 'button-onboard-bo-analysis',
                        },
                        {
                          value: 'full_control' as const,
                          label: 'Full Control',
                          sub: 'Create new lots + sync all fields on existing matched lots',
                          body: 'I\'ll create BrickOwl listings for any BrickLink item that doesn\'t exist there yet, and keep all matched lots fully in sync. Best for stores you don\'t manage manually.',
                          testId: 'button-onboard-bo-full',
                        },
                        {
                          value: 'matched_sync' as const,
                          label: 'Matched Sync',
                          sub: 'Sync all fields on matched lots only — never create new ones',
                          body: 'Syncs every matched lot but skips anything without a match. Best for stores where you prefer to create new listings manually.',
                          testId: 'button-onboard-bo-matched',
                        },
                      ]).map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => setChannelSyncMode(opt.value)}
                          className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${channelSyncMode === opt.value ? 'border-blue-500/60 bg-blue-500/10' : 'border-gray-700 bg-gray-800/40 hover:border-gray-600'}`}
                          data-testid={opt.testId}
                        >
                          <div className={`mt-0.5 w-3.5 h-3.5 rounded-full border-2 shrink-0 ${channelSyncMode === opt.value ? 'border-blue-400 bg-blue-400' : 'border-gray-500'}`} />
                          <div>
                            <span className="text-sm font-semibold text-gray-200">{opt.label}</span>
                            <p className="text-xs text-gray-500 mt-0.5">{opt.sub}</p>
                            <p className="text-[10px] text-gray-600 mt-1 leading-relaxed">{opt.body}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Advanced options — collapsible */}
                  <div>
                    <button
                      onClick={() => setShowBoAdvanced(v => !v)}
                      className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors py-1"
                      data-testid="button-onboard-bo-advanced-toggle"
                    >
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showBoAdvanced ? 'rotate-180' : ''}`} />
                      Advanced: field sync options
                    </button>

                    {showBoAdvanced && (
                      <div className="mt-2 rounded-lg border border-gray-700/60 bg-gray-800/30 divide-y divide-gray-700/40 overflow-hidden">
                        {/* Qty — always on */}
                        <div className="flex items-center justify-between gap-3 px-3 py-2.5 opacity-50">
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-gray-200">Quantity</p>
                            <p className="text-[10px] text-gray-500 mt-0.5 leading-tight">Always synced — cannot be disabled</p>
                          </div>
                          <Switch checked disabled />
                        </div>

                        {/* Base Price */}
                        <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-gray-200">Base Price</p>
                            <p className="text-[10px] text-gray-500 mt-0.5 leading-tight">Syncs the listing price from BrickLink to existing lots. Always included when creating new items in Full Control.</p>
                          </div>
                          <Switch checked={boSyncPrice} onCheckedChange={setBoSyncPrice} data-testid="switch-onboard-bo-price" />
                        </div>

                        {([
                          { key: 'remarks',     label: 'Remarks',          desc: 'Internal notes (BrickLink Remarks → BrickOwl personal note)',              checked: boSyncRemarks,     set: setBoSyncRemarks },
                          { key: 'description', label: 'Description',      desc: 'Public description (BrickLink Description → BrickOwl public note)',         checked: boSyncDescription, set: setBoSyncDescription },
                          { key: 'tierPrice',   label: 'Tier Pricing',     desc: 'Bulk discount tiers from BrickLink',                                        checked: boSyncTierPrice,   set: setBoSyncTierPrice },
                          { key: 'salePercent', label: 'Sale %',           desc: 'BrickLink sale rate → BrickOwl sale %. Disable if you manage BO sales separately.', checked: boSyncSalePercent, set: setBoSyncSalePercent },
                          { key: 'bulkQty',     label: 'Min. Quantity',    desc: 'Minimum order quantity (BrickLink Bulk → BrickOwl bulk_qty)',               checked: boSyncBulkQty,     set: setBoSyncBulkQty },
                          { key: 'myCost',      label: 'Cost Price',       desc: 'Your cost price (BrickLink My Cost → BrickOwl my_cost). Private data, opt-in.', checked: boSyncMyCost, set: setBoSyncMyCost },
                          { key: 'lotWeight',   label: 'Custom Lot Weight',desc: 'Custom weight per lot (BrickLink My Weight → BrickOwl lot_weight)',        checked: boSyncLotWeight,   set: setBoSyncLotWeight },
                        ] as const).map(({ key, label, desc, checked, set }) => (
                          <div key={key} className="flex items-center justify-between gap-3 px-3 py-2.5">
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-gray-200">{label}</p>
                              <p className="text-[10px] text-gray-500 mt-0.5 leading-tight">{desc}</p>
                            </div>
                            <Switch checked={checked} onCheckedChange={set} data-testid={`switch-onboard-bo-${key}`} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Run Analysis */}
                  <div className="space-y-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={analysisMutation.isPending}
                      onClick={() => analysisMutation.mutate()}
                      className="text-blue-400 border border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10"
                      data-testid="button-onboard-bo-run-analysis"
                    >
                      {analysisMutation.isPending ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                      ) : (
                        <BarChart2 className="w-3.5 h-3.5 mr-1.5" />
                      )}
                      {analysisMutation.isPending ? 'Scanning both stores…' : 'Run Analysis'}
                    </Button>
                    {analysisMutation.isPending && (
                      <p className="text-[10px] text-gray-600">This reads your BrickLink and BrickOwl inventories — may take 30–60 s for large stores.</p>
                    )}
                  </div>

                  {/* Analysis result panel */}
                  {analysisResult && (
                    <div className="rounded-lg border border-gray-700/60 bg-gray-800/30 p-3 space-y-3">
                      <div className="flex items-center gap-1.5">
                        <BarChart2 className="w-3.5 h-3.5 text-blue-400" />
                        <p className="text-xs font-semibold text-gray-200">Analysis Results</p>
                        <span className="ml-auto text-[10px] text-gray-600">read-only scan</span>
                      </div>

                      {/* Summary stats */}
                      <div className="grid grid-cols-2 gap-2">
                        {([
                          { label: 'Matched lots',  value: analysisResult.matchedLots,   color: 'text-gray-200' },
                          { label: 'Unmatched',      value: analysisResult.unmatchedLots, color: 'text-amber-400' },
                          { label: 'Would update',   value: analysisResult.wouldUpdate,   color: 'text-blue-400'  },
                          { label: 'Would create',   value: analysisResult.wouldCreate,   color: 'text-green-400' },
                        ] as const).map(({ label, value, color }) => (
                          <div key={label} className="rounded-md bg-gray-900/50 border border-gray-700/40 px-3 py-2">
                            <p className={`text-lg font-mono font-bold ${color}`}>{value.toLocaleString()}</p>
                            <p className="text-[10px] text-gray-500 mt-0.5">{label}</p>
                          </div>
                        ))}
                      </div>

                      {/* Field breakdown */}
                      {(() => {
                        const fieldLabels: Record<string, string> = {
                          qty: 'Quantity', price: 'Base Price', remarks: 'Remarks',
                          description: 'Description', tierPrice: 'Tier Pricing',
                          salePercent: 'Sale %', forSale: 'For Sale status',
                          bulkQty: 'Min. Quantity', myCost: 'Cost Price', lotWeight: 'Lot Weight',
                        };
                        const entries = Object.entries(analysisResult.byField).filter(([, v]) => v > 0);
                        if (entries.length === 0) return null;
                        return (
                          <div>
                            <p className="text-[10px] font-medium text-gray-500 mb-1.5">Changes by field:</p>
                            <div className="space-y-0.5">
                              {entries.map(([key, count]) => (
                                <div key={key} className="flex items-center justify-between text-[11px]">
                                  <span className="text-gray-400">{fieldLabels[key] ?? key}</span>
                                  <span className="font-mono text-gray-300">{count.toLocaleString()} lots</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Nudge to switch mode if still on analysis */}
                      {channelSyncMode === 'analysis' && (analysisResult.wouldUpdate > 0 || analysisResult.wouldCreate > 0) && (
                        <div className="flex items-start gap-2 rounded-md bg-amber-500/10 border border-amber-500/25 px-3 py-2">
                          <Zap className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                          <p className="text-[10px] text-amber-300 leading-relaxed">
                            Ready to go live? Switch to <strong>Matched Sync</strong> or <strong>Full Control</strong> above to start pushing these changes to BrickOwl.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              <div className="pt-2 flex justify-between">
                <Button variant="ghost" onClick={() => handleStep5(true)} className="text-gray-500" data-testid="button-onboard-skip-5">
                  Skip — I don't use BrickOwl
                </Button>
                <Button
                  onClick={() => handleStep5(false)}
                  disabled={isSaving}
                  data-testid="button-onboard-next-5"
                >
                  {isSaving ? "Saving…" : boApiKey.trim() ? "Connect & continue" : "Continue"}
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </>
          )}

          {/* ── Step 6: Subscribe ── */}
          {step === 6 && (
            <>
              <div>
                <h2 className="text-lg font-semibold text-white mb-1">Choose your plan</h2>
                <p className="text-sm text-gray-400">
                  You're on the free plan. Subscribe whenever you're ready to unlock the full platform.
                </p>
              </div>

              {/* Plan cards — loaded from DB */}
              {plansLoading ? (
                <div className="flex items-center justify-center py-8 gap-2 text-gray-500">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Loading plans…</span>
                </div>
              ) : availablePlans.length === 0 ? (
                <div className="text-center py-6 text-gray-500 text-sm">
                  No plans are currently available. You can subscribe later from the <span className="text-gray-300 font-medium">My Plan</span> section.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {availablePlans.map((plan) => {
                    const monthlyDollars = (plan.basePrice / 100).toFixed(2);
                    const thresholdDollars = Math.round(plan.freeSalesThreshold / 100).toLocaleString();
                    const isSelected = selectedPlan === plan.id;
                    const trialDays = plan.trialDurationDays ?? 0;
                    return (
                      <button
                        key={plan.id}
                        onClick={() => setSelectedPlan(plan.id)}
                        className={`relative flex flex-col text-left rounded-lg border p-4 transition-colors ${isSelected ? 'border-blue-500/60 bg-blue-500/10' : 'border-gray-700 bg-gray-800/40 hover:border-gray-600'}`}
                        data-testid={`button-plan-${plan.id}`}
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-white">{plan.name}</span>
                            {trialDays > 0 && (
                              <span className="text-[9px] bg-green-500/15 text-green-400 border border-green-500/25 rounded px-1.5 py-0.5">{trialDays}-day free trial</span>
                            )}
                          </div>
                          {isSelected && <CheckCircle2 className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />}
                        </div>
                        <div className="mb-1">
                          <span className="text-2xl font-bold text-white">${monthlyDollars}</span>
                          <span className="text-xs text-gray-500">/mo base</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                          <TrendingUp className="w-3 h-3 text-purple-400 shrink-0" />
                          <span>+{plan.salesPercentage}% on sales over ${thresholdDollars}/mo</span>
                        </div>
                        {trialDays > 0 && (
                          <p className="text-[10px] text-green-400/70 mt-2">First {trialDays} days free — no charge until your trial ends. Cancel anytime.</p>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Trust signals */}
              <div className="flex items-center justify-center gap-5 text-[10px] text-gray-600">
                {!selectedIsDefault && <span className="flex items-center gap-1"><Lock className="w-2.5 h-2.5" />Secured by Stripe</span>}
                <span className="flex items-center gap-1"><BadgeCheck className="w-2.5 h-2.5" />Cancel anytime</span>
                <span className="flex items-center gap-1"><CheckCircle2 className="w-2.5 h-2.5" />No setup fees</span>
              </div>

              {/* Action buttons */}
              <div className="pt-1 flex justify-between items-center gap-3 flex-wrap">
                <Button variant="ghost" onClick={handleStep6Skip} className="text-gray-500" data-testid="button-onboard-skip-6">
                  I'll subscribe later
                </Button>
                <Button
                  onClick={() => selectedPlan !== null && checkoutMutation.mutate({ planId: selectedPlan })}
                  disabled={selectedPlan === null || checkoutMutation.isPending}
                  data-testid="button-onboard-subscribe"
                >
                  {checkoutMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />{selectedIsDefault ? 'Activating…' : 'Redirecting to Stripe…'}</>
                  ) : selectedPlan !== null ? (
                    selectedIsDefault
                      ? <>Start for free<ArrowRight className="w-4 h-4 ml-1" /></>
                      : <>Subscribe<ArrowRight className="w-4 h-4 ml-1" /></>
                  ) : (
                    'Select a plan above'
                  )}
                </Button>
              </div>

              {/* Legal disclosure — only for paid plans */}
              {selectedPlan !== null && !selectedIsDefault && (
                <p className="text-center text-[10px] text-gray-600 leading-relaxed">
                  By subscribing, you authorize E.L.F.I.E. to charge the selected plan rate after any applicable trial period. You can cancel at any time.
                </p>
              )}
            </>
          )}

          {/* ── Step 7: Done ── */}
          {step === 7 && (
            <>
              {/* ELFIE centered + speech bubble */}
              <div className="flex flex-col items-center gap-4 py-2">
                <img
                  src={elfieRobot}
                  alt="E.L.F.I.E."
                  className="w-32 h-32 object-contain drop-shadow-2xl"
                />
                <div className="bg-gray-800 border border-gray-700 rounded-xl px-5 py-4 text-center max-w-sm">
                  <p className="text-base text-gray-200 leading-snug">{STEP_MESSAGES[7]}</p>
                </div>
                <div className="flex items-center gap-2 text-green-400">
                  <CheckCircle2 className="w-5 h-5" />
                  <span className="text-base font-semibold">You're all set up!</span>
                </div>
              </div>

              {/* Add to Home Screen prompt */}
              {installStatus !== 'installed' && installStatus !== 'unsupported' && (
                <div className="app-card p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Smartphone className="w-4 h-4 text-blue-400 flex-shrink-0" />
                    <p className="text-xs font-medium text-gray-300">Add E.L.F.I.E. to your home screen</p>
                  </div>
                  {installStatus === 'promptable' ? (
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[11px] text-gray-500">Get one-tap access from any device.</p>
                      <Button size="sm" variant="outline" onClick={async () => { await promptInstall(); }} data-testid="button-onboard-install">
                        Add now
                      </Button>
                    </div>
                  ) : installStatus === 'ios' ? (
                    <ol className="space-y-1 pl-1">
                      <li className="flex items-start gap-2 text-[11px] text-gray-400">
                        <span className="flex-shrink-0 w-4 h-4 rounded-full bg-gray-700 flex items-center justify-center text-[9px] font-bold text-gray-300 mt-0.5">1</span>
                        <span>Tap <Share2 className="inline w-3 h-3 mb-0.5" /> Share at the bottom of Safari</span>
                      </li>
                      <li className="flex items-start gap-2 text-[11px] text-gray-400">
                        <span className="flex-shrink-0 w-4 h-4 rounded-full bg-gray-700 flex items-center justify-center text-[9px] font-bold text-gray-300 mt-0.5">2</span>
                        <span>Tap <PlusSquare className="inline w-3 h-3 mb-0.5" /> <strong className="text-gray-300">Add to Home Screen</strong>, then <strong className="text-gray-300">Add</strong></span>
                      </li>
                    </ol>
                  ) : null}
                </div>
              )}

              <div className="flex justify-center pt-2">
                <Button onClick={handleFinish} disabled={isSaving} size="lg" data-testid="button-onboard-finish">
                  {isSaving ? "Finishing…" : "Go to dashboard"}
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </>
          )}
        </div>

        {step < 7 && step !== 6 && (
          <p className="text-center text-[11px] text-gray-600 mt-4">
            All settings can be updated any time in the Warehouse or Settings tabs.
          </p>
        )}
      </div>
    </div>
  );
}
