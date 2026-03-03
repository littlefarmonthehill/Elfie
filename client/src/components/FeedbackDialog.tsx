import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, CheckCircle2, RotateCcw, Bug, Zap, Star } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

type FeedbackType = "defect" | "enhancement" | "feature";

interface RefinedFeedback {
  title: string;
  refinedDescription: string;
  acceptanceCriteria: string;
}

interface FeedbackDialogProps {
  open: boolean;
  onClose: () => void;
}

const TYPE_CONFIG: Record<FeedbackType, { label: string; icon: any; color: string; bg: string; border: string }> = {
  defect: {
    label: "Defect",
    icon: Bug,
    color: "text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/40",
  },
  enhancement: {
    label: "Enhancement",
    icon: Zap,
    color: "text-yellow-400",
    bg: "bg-yellow-500/10",
    border: "border-yellow-500/40",
  },
  feature: {
    label: "New Feature",
    icon: Star,
    color: "text-purple-400",
    bg: "bg-purple-500/10",
    border: "border-purple-500/40",
  },
};

export function FeedbackDialog({ open, onClose }: FeedbackDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<"input" | "refining" | "review" | "done">("input");
  const [type, setType] = useState<FeedbackType>("enhancement");
  const [rawDescription, setRawDescription] = useState("");
  const [refined, setRefined] = useState<RefinedFeedback | null>(null);

  const refineMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/feedback/refine", { type, rawDescription }).then((r) => r.json()),
    onSuccess: (data: RefinedFeedback) => {
      setRefined(data);
      setStep("review");
    },
    onError: (err: any) => {
      setStep("input");
      const msg = err?.message ?? "";
      const isAuth = msg.includes("401") || msg.toLowerCase().includes("unauthorized");
      toast({
        title: isAuth ? "Not logged in" : "E.L.F.I.E. refinement failed",
        description: isAuth
          ? "Please log in to use this feature."
          : (msg || "Please try again."),
        variant: "destructive",
      });
    },
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/feedback", {
        type,
        title: refined!.title,
        rawDescription,
        refinedDescription: refined!.refinedDescription,
        acceptanceCriteria: refined!.acceptanceCriteria,
        status: "new",
        sourcePage: window.location.pathname,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/feedback"] });
      setStep("done");
    },
    onError: () => {
      toast({ title: "Failed to save feedback", variant: "destructive" });
    },
  });

  function handleRefine() {
    if (!rawDescription.trim()) return;
    setStep("refining");
    refineMutation.mutate();
  }

  function handleReset() {
    setStep("input");
    setRawDescription("");
    setRefined(null);
  }

  function handleClose() {
    setStep("input");
    setRawDescription("");
    setRefined(null);
    onClose();
  }

  const cfg = TYPE_CONFIG[type];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg bg-gray-900 border-gray-700">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="w-4 h-4 text-purple-400" />
            Submit App Feedback to E.L.F.I.E.
          </DialogTitle>
        </DialogHeader>

        {/* Step: Input */}
        {(step === "input" || step === "refining") && (
          <div className="space-y-4 pt-1">
            {/* Type selector */}
            <div>
              <p className="text-xs text-gray-400 mb-2">What kind of feedback is this?</p>
              <div className="flex gap-2">
                {(Object.keys(TYPE_CONFIG) as FeedbackType[]).map((t) => {
                  const c = TYPE_CONFIG[t];
                  const Icon = c.icon;
                  const active = type === t;
                  return (
                    <button
                      key={t}
                      onClick={() => setType(t)}
                      data-testid={`button-feedback-type-${t}`}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium transition-colors ${
                        active ? `${c.bg} ${c.border} ${c.color}` : "bg-gray-800 border-gray-600 text-gray-400 hover:border-gray-500"
                      }`}
                    >
                      <Icon className="w-3 h-3" />
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Description */}
            <div>
              <p className="text-xs text-gray-400 mb-2">Describe what you need in plain language:</p>
              <Textarea
                value={rawDescription}
                onChange={(e) => setRawDescription(e.target.value)}
                placeholder={
                  type === "defect"
                    ? "e.g. When I click the sync button nothing happens and I have to reload the page..."
                    : type === "enhancement"
                    ? "e.g. I'd like the order list to show the profit margin next to each order..."
                    : "e.g. I want a way to print a packing slip that shows the bin location of each item..."
                }
                className="bg-gray-800 border-gray-600 text-gray-200 placeholder:text-gray-600 min-h-[110px] resize-none text-sm"
                data-testid="textarea-feedback-raw"
                disabled={step === "refining"}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={handleClose} data-testid="button-feedback-cancel">
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleRefine}
                disabled={!rawDescription.trim() || step === "refining"}
                className="bg-purple-600 hover:bg-purple-500 text-white"
                data-testid="button-feedback-refine"
              >
                {step === "refining" ? (
                  <>
                    <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                    E.L.F.I.E. is thinking...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3 h-3 mr-1.5" />
                    Refine with E.L.F.I.E.
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Step: Review */}
        {step === "review" && refined && (
          <div className="space-y-4 pt-1">
            <p className="text-xs text-gray-400">
              E.L.F.I.E. refined your feedback. Does this accurately describe what you need?
            </p>

            <div className={`rounded-md border p-3 space-y-3 ${cfg.bg} ${cfg.border}`}>
              <div className="flex items-center gap-2">
                <Badge className={`text-[10px] ${cfg.bg} ${cfg.color} border ${cfg.border}`}>{cfg.label}</Badge>
                <p className="text-sm font-semibold text-gray-100">{refined.title}</p>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Description</p>
                <p className="text-xs text-gray-300 leading-relaxed">{refined.refinedDescription}</p>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Acceptance Criteria</p>
                <ul className="space-y-1">
                  {refined.acceptanceCriteria
                    .split("\n")
                    .filter((l) => l.trim())
                    .map((line, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-gray-300">
                        <span className="text-gray-500 mt-0.5 shrink-0">•</span>
                        {line.replace(/^[-•*]\s*/, "")}
                      </li>
                    ))}
                </ul>
              </div>
            </div>

            <div className="flex justify-between gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                data-testid="button-feedback-redescribe"
              >
                <RotateCcw className="w-3 h-3 mr-1.5" />
                Re-describe
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={handleClose}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                  className="bg-green-700 hover:bg-green-600 text-white"
                  data-testid="button-feedback-confirm"
                >
                  {saveMutation.isPending ? (
                    <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-3 h-3 mr-1.5" />
                  )}
                  Looks good — add to backlog
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Step: Done */}
        {step === "done" && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <CheckCircle2 className="w-10 h-10 text-green-400" />
            <div>
              <p className="text-sm font-semibold text-gray-200">Feedback added to backlog!</p>
              <p className="text-xs text-gray-400 mt-1">
                You can view and copy it from Settings → Feedback.
              </p>
            </div>
            <Button size="sm" onClick={handleClose} data-testid="button-feedback-done">
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
