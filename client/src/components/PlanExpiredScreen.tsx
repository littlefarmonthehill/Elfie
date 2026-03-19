import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, Lock, BadgeCheck, TrendingUp, LogOut } from "lucide-react";
import elfieRobot from "@assets/PlanetBrick_good_robot_1760672362080.png";

interface Plan {
  id: number;
  name: string;
  basePrice: number;
  salesPercentage: number;
  freeSalesThreshold: number;
  status: string;
  sunsetAt: string | null;
  isDefault?: boolean;
  trialDurationDays?: number;
}

interface PlanExpiredScreenProps {
  sunsetAt: string;
  planName: string;
  reason?: 'trial' | 'sunset';
}

export default function PlanExpiredScreen({ sunsetAt, planName, reason = 'sunset' }: PlanExpiredScreenProps) {
  const { toast } = useToast();
  const [selectedPlan, setSelectedPlan] = useState<number | null>(null);

  const { data: availablePlans = [], isLoading: plansLoading } = useQuery<Plan[]>({
    queryKey: ['/api/plans'],
  });

  const checkoutMutation = useMutation({
    mutationFn: async ({ planId }: { planId: number }) => {
      const res = await apiRequest("POST", "/api/billing/checkout", { planId, context: "plan_expired" });
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

  const logoutMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/logout'),
    onSuccess: () => { window.location.href = '/'; },
    onError: () => { window.location.href = '/'; },
  });

  const selectedPlanData = availablePlans.find(p => p.id === selectedPlan) ?? null;
  const selectedIsDefault = selectedPlanData?.isDefault ?? false;

  const expiredDate = new Date(sunsetAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg space-y-6">

        {/* Header with E.L.F.I.E. */}
        <div className="flex items-end gap-4">
          <img
            src={elfieRobot}
            alt="E.L.F.I.E."
            className="w-20 h-20 object-contain flex-shrink-0 drop-shadow-lg"
          />
          <div className="relative flex-1 pb-1">
            <span
              className="absolute left-0 bottom-5 -translate-x-full w-0 h-0"
              style={{
                borderTop: "6px solid transparent",
                borderBottom: "6px solid transparent",
                borderRight: "8px solid rgb(55 65 81)",
              }}
            />
            <span
              className="absolute left-0 bottom-5 -translate-x-[calc(100%-1px)] w-0 h-0"
              style={{
                borderTop: "5px solid transparent",
                borderBottom: "5px solid transparent",
                borderRight: "7px solid rgb(17 24 39)",
              }}
            />
            <div className="bg-gray-900 border border-gray-700 rounded-xl rounded-bl-none px-4 py-3">
              <p className="text-sm text-gray-200 leading-snug">
                {reason === 'trial'
                  ? <>Your free trial ended on {expiredDate}. Pick a plan below and I'll have you back up and running in seconds.</>
                  : <>Your <span className="text-white font-medium">{planName}</span> plan ended on {expiredDate}. To keep using E.L.F.I.E., pick a new plan below and I'll have you back up and running in seconds.</>
                }
              </p>
            </div>
          </div>
        </div>

        {/* Expired notice */}
        <div className="flex items-start gap-3 rounded-lg border border-red-800/40 bg-red-950/20 px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-300">
              {reason === 'trial' ? `Free trial ended on ${expiredDate}` : `Plan expired on ${expiredDate}`}
            </p>
            <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
              Your account is currently read-only. Inventory sync, order management, and other live features will resume as soon as you subscribe.
            </p>
          </div>
        </div>

        {/* Plan cards */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Choose a plan</h2>

          {plansLoading ? (
            <div className="flex items-center justify-center py-10 gap-2 text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Loading plans…</span>
            </div>
          ) : availablePlans.length === 0 ? (
            <div className="rounded-lg border border-gray-700 bg-gray-800/40 px-4 py-6 text-center">
              <p className="text-sm text-gray-400">No plans are currently available.</p>
              <p className="text-xs text-gray-500 mt-1">Please contact support to restore your access.</p>
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
                    data-testid={`button-expired-plan-${plan.id}`}
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
        </div>

        {/* Trust signals */}
        <div className="flex items-center justify-center gap-5 text-[10px] text-gray-600">
          {!selectedIsDefault && <span className="flex items-center gap-1"><Lock className="w-2.5 h-2.5" />Secured by Stripe</span>}
          <span className="flex items-center gap-1"><BadgeCheck className="w-2.5 h-2.5" />Cancel anytime</span>
          <span className="flex items-center gap-1"><CheckCircle2 className="w-2.5 h-2.5" />No setup fees</span>
        </div>

        {/* Action row */}
        <div className="flex items-center justify-between gap-3 pt-1">
          <button
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-400 transition-colors disabled:opacity-50"
            data-testid="button-expired-logout"
          >
            <LogOut className="w-3 h-3" />
            {logoutMutation.isPending ? 'Signing out…' : 'Sign out'}
          </button>
          <Button
            onClick={() => selectedPlan !== null && checkoutMutation.mutate({ planId: selectedPlan })}
            disabled={selectedPlan === null || checkoutMutation.isPending || availablePlans.length === 0}
            data-testid="button-expired-subscribe"
          >
            {checkoutMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />{selectedIsDefault ? 'Activating…' : 'Redirecting to Stripe…'}</>
            ) : selectedPlan !== null ? (
              selectedIsDefault
                ? <>Start for free<ArrowRight className="w-4 h-4 ml-1" /></>
                : <>Subscribe & restore access<ArrowRight className="w-4 h-4 ml-1" /></>
            ) : (
              'Select a plan to continue'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
