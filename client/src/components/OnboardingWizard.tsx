import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, ArrowRight, Building2, Link, Smartphone, Share2, PlusSquare, ClipboardPaste, ExternalLink, Loader2, Archive, Layers, MapPin, Upload, FileText, ChevronRight, AlertCircle, Package, Globe, CreditCard, Lock, BadgeCheck, X, TrendingUp } from "lucide-react";
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
  { id: 2, label: "BrickLink", icon: Link },
  { id: 3, label: "Warehouse", icon: Archive },
  { id: 4, label: "BrickOwl", icon: Globe },
  { id: 5, label: "Subscribe", icon: CreditCard },
];

const DEPTH_OPTIONS = [
  { value: 1, label: "Bins Only", description: "Simple — just label your bins", example: "Bin-01, Bin-02…", icon: Archive },
  { value: 2, label: "Shelves + Bins", description: "Group bins onto shelves", example: "Shelf A → Bin A-01…", icon: Layers },
  { value: 3, label: "Full Warehouse", description: "Aisles, shelves, and bins", example: "Aisle 1 → Shelf A → Bin A-01", icon: MapPin },
];

const STEP_MESSAGES: Record<number, string> = {
  1: "Hi! I'm E.L.F.I.E. — your warehouse operations assistant. Let's start with your company info. This shows up on your packing slips and account profile.",
  2: "BrickLink is the engine that drives everything. Connect your API keys and I'll automatically sync your inventory, orders, and pricing — all in one place.",
  3: "Now let's map out your storage. Choose how your warehouse is laid out — once I know the structure, I can guide you to any part the moment an order comes in.",
  4: "Do you sell on BrickOwl too? I can keep both stores in sync automatically. This is completely optional — you can add it any time from Settings.",
  5: "You're currently on a free trial. When you're ready, pick a plan and subscribe — your first 14 days on a paid plan are also free, so there's nothing to lose.",
  6: "You're all set! Come find me in the sidebar whenever you need help managing inventory, filling orders, or just want to know what's going on.",
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
  const { status: installStatus, promptInstall } = useInstallPrompt();

  const { data: availablePlans = [], isLoading: plansLoading } = useQuery<Array<{
    id: number; name: string; basePrice: number; salesPercentage: number;
    freeSalesThreshold: number; isActive: boolean; isSunset: boolean;
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
  const [channelSyncMode, setChannelSyncMode] = useState<'full_control' | 'quantity_only'>('full_control');

  // Step 5 — Subscribe
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

  const checkoutMutation = useMutation({
    mutationFn: async ({ planId }: { planId: number }) => {
      await apiRequest("PATCH", "/api/org", { onboardingCompleted: true });
      const res = await apiRequest("POST", "/api/billing/checkout", { planId, context: "onboarding" });
      return res.json();
    },
    onSuccess: (data: { url?: string }) => {
      if (data?.url) window.location.href = data.url;
    },
  });

  const handleStep1 = async () => {
    const data: Record<string, any> = { name: name.trim() || org.name, address, phone, website };
    if (tosAccepted && !org.tosAcceptedAt) {
      data.tosAcceptedAt = new Date().toISOString();
    }
    await saveOrgMutation.mutateAsync(data);
    setStep(2);
  };

  const handleStep2 = async (skip = false) => {
    if (!skip && (blKey || blSecret || blToken || blTokenSecret)) {
      await saveSettingsMutation.mutateAsync({
        bricklinkConsumerKey: blKey || null,
        bricklinkConsumerSecret: blSecret || null,
        bricklinkTokenValue: blToken || null,
        bricklinkTokenSecret: blTokenSecret || null,
      });
    }
    setStep(3);
  };

  const handleStep3 = async () => {
    if (selectedDepth !== null) {
      await saveDepthMutation.mutateAsync(selectedDepth);
    }
    setStep(4);
  };

  const handleStep4 = async (skip = false) => {
    if (!skip && boApiKey.trim()) {
      await saveSettingsMutation.mutateAsync({
        brickowlApiKey: boApiKey.trim(),
        channelSyncMode,
      });
    }
    setStep(5);
  };

  const handleStep5Skip = () => setStep(6);

  const handleFinish = async () => {
    await saveOrgMutation.mutateAsync({ onboardingCompleted: true });
    onComplete();
  };

  const isSaving = saveOrgMutation.isPending || saveSettingsMutation.isPending || saveDepthMutation.isPending;
  const csvDepthHint = selectedDepth ?? 3;

  return (
    <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-lg py-8">

        {/* Dismiss button */}
        {onDismiss && step < 6 && (
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

        {/* ELFIE speech bubble — steps 1–5 */}
        {step < 6 && <ElfieSpeechBubble step={step} />}

        {/* Step indicator */}
        {step < 6 && (
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

          {/* ── Step 2: BrickLink ── */}
          {step === 2 && (
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

          {/* ── Step 3: Warehouse Setup ── */}
          {step === 3 && (
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
                  onClick={handleStep3}
                  disabled={isSaving || selectedDepth === null}
                  data-testid="button-onboard-next-3"
                >
                  {isSaving ? "Saving…" : "Continue"}
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </>
          )}

          {/* ── Step 4: BrickOwl ── */}
          {step === 4 && (
            <>
              <div>
                <h2 className="text-lg font-semibold text-white mb-1">BrickOwl channel</h2>
                <p className="text-sm text-gray-400">
                  If you have a BrickOwl store, connect it here. I'll keep both stores in sync
                  so your quantities and prices stay consistent automatically.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="onboard-bo-key" className="text-xs text-gray-400">BrickOwl API Key <span className="text-gray-600">(optional)</span></Label>
                <Input
                  id="onboard-bo-key"
                  type="password"
                  value={boApiKey}
                  onChange={(e) => setBoApiKey(e.target.value)}
                  placeholder="Paste your BrickOwl API key…"
                  className="bg-gray-800 border-gray-700 text-white"
                  data-testid="input-onboard-bo-key"
                />
                <p className="text-[10px] text-gray-600">
                  Find this under My Account → Settings → API on BrickOwl.
                </p>
              </div>

              {boApiKey.trim() && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-gray-300">How should I manage your BrickOwl store?</p>
                  <div className="grid grid-cols-1 gap-1.5">
                    <button
                      onClick={() => setChannelSyncMode('full_control')}
                      className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${channelSyncMode === 'full_control' ? 'border-blue-500/60 bg-blue-500/10' : 'border-gray-700 bg-gray-800/40 hover:border-gray-600'}`}
                      data-testid="button-onboard-bo-full"
                    >
                      <div className={`mt-0.5 w-3.5 h-3.5 rounded-full border-2 shrink-0 ${channelSyncMode === 'full_control' ? 'border-blue-400 bg-blue-400' : 'border-gray-500'}`} />
                      <div>
                        <span className="text-sm font-semibold text-gray-200">Full Control</span>
                        <p className="text-xs text-gray-500 mt-0.5">Push all items — create new lots and update existing</p>
                        <p className="text-[10px] text-gray-600 mt-1 leading-relaxed">I'll create BrickOwl listings for any BrickLink items that don't exist there yet, and keep everything in sync. Best for stores that aren't actively managed on BrickOwl.</p>
                      </div>
                    </button>
                    <button
                      onClick={() => setChannelSyncMode('quantity_only')}
                      className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${channelSyncMode === 'quantity_only' ? 'border-blue-500/60 bg-blue-500/10' : 'border-gray-700 bg-gray-800/40 hover:border-gray-600'}`}
                      data-testid="button-onboard-bo-qty"
                    >
                      <div className={`mt-0.5 w-3.5 h-3.5 rounded-full border-2 shrink-0 ${channelSyncMode === 'quantity_only' ? 'border-blue-400 bg-blue-400' : 'border-gray-500'}`} />
                      <div>
                        <span className="text-sm font-semibold text-gray-200">Quantity Only</span>
                        <p className="text-xs text-gray-500 mt-0.5">Update counts on existing lots — never create new ones</p>
                        <p className="text-[10px] text-gray-600 mt-1 leading-relaxed">I'll only update quantities and prices on lots that already exist on BrickOwl. Anything without a matching lot is skipped. Best for stores you prefer to manage manually on BrickOwl.</p>
                      </div>
                    </button>
                  </div>
                </div>
              )}

              <div className="pt-2 flex justify-between">
                <Button variant="ghost" onClick={() => handleStep4(true)} className="text-gray-500" data-testid="button-onboard-skip-4">
                  Skip — I don't use BrickOwl
                </Button>
                <Button
                  onClick={() => handleStep4(false)}
                  disabled={isSaving}
                  data-testid="button-onboard-next-4"
                >
                  {isSaving ? "Saving…" : boApiKey.trim() ? "Connect & continue" : "Continue"}
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </>
          )}

          {/* ── Step 5: Subscribe ── */}
          {step === 5 && (
            <>
              <div>
                <h2 className="text-lg font-semibold text-white mb-1">Choose your plan</h2>
                <p className="text-sm text-gray-400">
                  You're on a free trial — subscribe now to keep going after it ends.
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
                    return (
                      <button
                        key={plan.id}
                        onClick={() => setSelectedPlan(plan.id)}
                        className={`relative flex flex-col text-left rounded-lg border p-4 transition-colors ${isSelected ? 'border-blue-500/60 bg-blue-500/10' : 'border-gray-700 bg-gray-800/40 hover:border-gray-600'}`}
                        data-testid={`button-plan-${plan.id}`}
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <span className="text-sm font-semibold text-white">{plan.name}</span>
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
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Trust signals */}
              <div className="flex items-center justify-center gap-5 text-[10px] text-gray-600">
                <span className="flex items-center gap-1"><Lock className="w-2.5 h-2.5" />Secured by Stripe</span>
                <span className="flex items-center gap-1"><BadgeCheck className="w-2.5 h-2.5" />Cancel anytime</span>
                <span className="flex items-center gap-1"><CheckCircle2 className="w-2.5 h-2.5" />No setup fees</span>
              </div>

              {/* Action buttons */}
              <div className="pt-1 flex justify-between items-center gap-3 flex-wrap">
                <Button variant="ghost" onClick={handleStep5Skip} className="text-gray-500" data-testid="button-onboard-skip-5">
                  I'll subscribe later
                </Button>
                <Button
                  onClick={() => selectedPlan !== null && checkoutMutation.mutate({ planId: selectedPlan })}
                  disabled={selectedPlan === null || checkoutMutation.isPending}
                  data-testid="button-onboard-subscribe"
                >
                  {checkoutMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Redirecting to Stripe…</>
                  ) : selectedPlan !== null ? (
                    <>Subscribe<ArrowRight className="w-4 h-4 ml-1" /></>
                  ) : (
                    'Select a plan above'
                  )}
                </Button>
              </div>

              {/* Legal disclosure */}
              {selectedPlan !== null && (
                <p className="text-center text-[10px] text-gray-600 leading-relaxed">
                  By subscribing, you authorize E.L.F.I.E. to charge the selected plan rate after any applicable trial period. You can cancel at any time.
                </p>
              )}
            </>
          )}

          {/* ── Step 6: Done ── */}
          {step === 6 && (
            <>
              {/* ELFIE centered + speech bubble */}
              <div className="flex flex-col items-center gap-4 py-2">
                <img
                  src={elfieRobot}
                  alt="E.L.F.I.E."
                  className="w-32 h-32 object-contain drop-shadow-2xl"
                />
                <div className="bg-gray-800 border border-gray-700 rounded-xl px-5 py-4 text-center max-w-sm">
                  <p className="text-base text-gray-200 leading-snug">{STEP_MESSAGES[6]}</p>
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

        {step < 6 && step !== 5 && (
          <p className="text-center text-[11px] text-gray-600 mt-4">
            All settings can be updated any time in the Warehouse or Settings tabs.
          </p>
        )}
      </div>
    </div>
  );
}
