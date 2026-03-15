import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, ArrowRight, Building2, Link, CreditCard, Sparkles, Smartphone, Share2, PlusSquare, ClipboardPaste, ExternalLink, Loader2, FileText, ChevronDown, ChevronUp } from "lucide-react";
import { parseBricklinkPaste, getPasteStatus, type PasteStatus } from "@/lib/bricklink-paste";
import type { Organization } from "@shared/schema";
import { useInstallPrompt } from "@/hooks/use-install-prompt";

interface Props {
  org: Organization;
  onComplete: () => void;
}

const STEPS = [
  { id: 1, label: "Company", icon: Building2 },
  { id: 2, label: "BrickLink", icon: Link },
  { id: 3, label: "Payments", icon: CreditCard },
];

export default function OnboardingWizard({ org, onComplete }: Props) {
  const [step, setStep] = useState(1);
  const { status: installStatus, promptInstall } = useInstallPrompt();

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

  // Step 3 — Payments
  const [paypalClientId, setPaypalClientId] = useState("");
  const [paypalClientSecret, setPaypalClientSecret] = useState("");
  const [stripeSecretKey, setStripeSecretKey] = useState("");

  const saveOrgMutation = useMutation({
    mutationFn: (data: Record<string, any>) => apiRequest("PATCH", "/api/org", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/org"] }),
  });

  const saveSettingsMutation = useMutation({
    mutationFn: (data: Record<string, any>) => apiRequest("POST", "/api/settings", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/settings"] }),
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

  const handleStep3 = async (skip = false) => {
    if (!skip && (paypalClientId || paypalClientSecret || stripeSecretKey)) {
      await saveSettingsMutation.mutateAsync({
        paypalClientId: paypalClientId || null,
        paypalClientSecret: paypalClientSecret || null,
        stripeSecretKey: stripeSecretKey || null,
      });
    }
    setStep(4);
  };

  const handleFinish = async () => {
    await saveOrgMutation.mutateAsync({ onboardingCompleted: true });
    onComplete();
  };

  const isSaving = saveOrgMutation.isPending || saveSettingsMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-lg">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-3">
            <Sparkles className="w-5 h-5 text-lego-yellow" />
            <span className="text-sm font-semibold uppercase tracking-widest text-gray-400">Setup Wizard</span>
          </div>
          {step < 4 ? (
            <h1 className="text-2xl font-bold text-white">Let's get you set up</h1>
          ) : (
            <h1 className="text-2xl font-bold text-white">You're ready to go</h1>
          )}
        </div>

        {/* Step indicator */}
        {step < 4 && (
          <div className="flex items-center justify-center gap-0 mb-8">
            {STEPS.map((s, i) => (
              <div key={s.id} className="flex items-center">
                <div className={`flex flex-col items-center gap-1`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition-colors ${
                    step > s.id
                      ? "bg-green-500 border-green-500"
                      : step === s.id
                      ? "bg-gray-800 border-lego-blue"
                      : "bg-gray-900 border-gray-700"
                  }`}>
                    {step > s.id ? (
                      <CheckCircle2 className="w-4 h-4 text-white" />
                    ) : (
                      <s.icon className={`w-3.5 h-3.5 ${step === s.id ? "text-lego-blue" : "text-gray-600"}`} />
                    )}
                  </div>
                  <span className={`text-[10px] font-medium uppercase tracking-wide ${step === s.id ? "text-gray-300" : step > s.id ? "text-green-400" : "text-gray-600"}`}>
                    {s.label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`w-16 h-px mx-2 mb-4 transition-colors ${step > s.id ? "bg-green-500/50" : "bg-gray-700"}`} />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Step content */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-5">

          {/* Step 1: Company Info */}
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
                    <p>Last updated: March 2026</p>
                    <p><strong className="text-gray-300">1. Acceptance.</strong> By creating an account or using E.L.F.I.E. (the "Service"), you agree to these Terms. If you do not agree, do not use the Service.</p>
                    <p><strong className="text-gray-300">2. Description.</strong> E.L.F.I.E. is a SaaS platform for LEGO and BrickLink inventory management, pricing intelligence, and AI-assisted operations.</p>
                    <p><strong className="text-gray-300">3. Accounts.</strong> You must provide accurate information when registering. You are responsible for all activity under your account and for keeping credentials secure.</p>
                    <p><strong className="text-gray-300">4. Acceptable Use.</strong> You agree not to: (a) violate any laws; (b) infringe on intellectual property rights; (c) interfere with or disrupt the Service; (d) attempt to gain unauthorized access; (e) use the Service to build a competing product; (f) bulk-export or redistribute marketplace data beyond internal use.</p>
                    <p><strong className="text-gray-300">5. Data & Privacy.</strong> We collect and process data necessary to provide the Service. Your inventory, order, and business data remains yours. We do not sell your data to third parties. AI-processed content may be sent to third-party AI providers (OpenAI) for processing under their data policies.</p>
                    <p><strong className="text-gray-300">6. Third-Party Integrations.</strong> The Service connects to BrickLink, BrickOwl, Rebrickable, Stripe, and OpenAI. Your use of these integrations is subject to their respective terms. You are responsible for ensuring your API credentials are valid and authorized.</p>
                    <p><strong className="text-gray-300">7. Subscription & Billing.</strong> Paid plans are billed monthly or annually via Stripe. You may cancel at any time; access continues through the end of the billing period. Refunds are handled per our refund policy.</p>
                    <p><strong className="text-gray-300">8. AI Disclaimer.</strong> AI-generated content (pricing suggestions, chat responses, part identification) is provided "as-is" for reference. Always verify AI outputs before acting on them. We are not liable for decisions made based on AI suggestions.</p>
                    <p><strong className="text-gray-300">9. Catalog Images.</strong> Part images sourced from BrickLink and Rebrickable are licensed for internal inventory management only. They may not be redistributed or used on public-facing websites.</p>
                    <p><strong className="text-gray-300">10. Limitation of Liability.</strong> The Service is provided "as-is" without warranties. To the maximum extent permitted by law, we are not liable for any indirect, incidental, or consequential damages arising from your use of the Service.</p>
                    <p><strong className="text-gray-300">11. Termination.</strong> We may suspend or terminate accounts that violate these Terms. You may delete your account at any time through Settings.</p>
                    <p><strong className="text-gray-300">12. Changes.</strong> We may update these Terms from time to time. Continued use after changes constitutes acceptance of the updated Terms.</p>
                    <p><strong className="text-gray-300">13. Contact.</strong> Questions about these Terms can be directed through the in-app support system.</p>
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

          {/* Step 2: BrickLink */}
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
                  {blPasteStatus === "partial" && !blOcrProcessing && <p className="text-[10px] text-yellow-400">Some credentials found but not all 4. You can fill in the missing fields manually below.</p>}
                  {blPasteStatus === "fail" && !blOcrProcessing && <p className="text-[10px] text-red-400">Could not find BrickLink credentials in the pasted content. Make sure you copied the full page or try a clearer screenshot.</p>}
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

          {/* Step 3: Payments */}
          {step === 3 && (
            <>
              <div>
                <h2 className="text-lg font-semibold text-white mb-1">Connect payment platforms</h2>
                <p className="text-sm text-gray-400">Used to automatically match refunds and fees to orders. Both are optional — you can add them later in Settings.</p>
              </div>
              <div className="space-y-4">
                <div className="space-y-2 pb-4 border-b border-gray-800">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">PayPal</p>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-gray-500">Client ID</Label>
                    <Input value={paypalClientId} onChange={(e) => setPaypalClientId(e.target.value)} placeholder="PayPal Client ID" className="bg-gray-800 border-gray-700 text-white text-sm" data-testid="input-onboard-paypal-id" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-gray-500">Client Secret</Label>
                    <Input type="password" value={paypalClientSecret} onChange={(e) => setPaypalClientSecret(e.target.value)} placeholder="PayPal Client Secret" className="bg-gray-800 border-gray-700 text-white text-sm" data-testid="input-onboard-paypal-secret" />
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Stripe</p>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-gray-500">Secret Key</Label>
                    <Input type="password" value={stripeSecretKey} onChange={(e) => setStripeSecretKey(e.target.value)} placeholder="sk_live_... or sk_test_..." className="bg-gray-800 border-gray-700 text-white text-sm" data-testid="input-onboard-stripe-key" />
                  </div>
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

          {/* Step 4: Done */}
          {step === 4 && (
            <>
              <div className="text-center py-4">
                <div className="w-16 h-16 rounded-full bg-green-500/10 border-2 border-green-500/30 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="w-8 h-8 text-green-400" />
                </div>
                <h2 className="text-lg font-semibold text-white mb-2">Setup complete</h2>
                <p className="text-sm text-gray-400 max-w-sm mx-auto">
                  Your account is configured. The dashboard will show any remaining setup items as action items so you can finish up at your own pace.
                </p>
              </div>

              {/* Add to Home Screen prompt */}
              {installStatus !== 'installed' && installStatus !== 'unsupported' && (
                <div className="app-card p-3 mb-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <Smartphone className="w-4 h-4 text-blue-400 flex-shrink-0" />
                    <p className="text-xs font-medium text-gray-300">Add E.L.F.I.E. to your home screen</p>
                  </div>
                  {installStatus === 'promptable' ? (
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[11px] text-gray-500">Get one-tap access from any device.</p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => { await promptInstall(); }}
                        data-testid="button-onboard-install"
                      >
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

        {step < 4 && (
          <p className="text-center text-[11px] text-gray-600 mt-4">
            All credentials are stored securely and can be updated any time in Settings.
          </p>
        )}
      </div>
    </div>
  );
}
