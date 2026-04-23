import { useEffect, useState } from "react";
import { Tag, Printer, ChevronDown, ChevronUp } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  LABEL_PRESETS,
  DEFAULT_LABEL_PRESET_ID,
  getLabelPreset,
  printLotLabels,
  buildShortCodeMap,
  type LotLabelItem,
  type LabelPreset,
  type OrgBranding,
} from "./PackingSlip";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  items: LotLabelItem[];
  org?: OrgBranding;
}

const PRESET_KEY = "lotLabelPresetId";

export default function LotLabelPrintDialog({ open, onOpenChange, items, org }: Props) {
  const [presetId, setPresetId] = useState<string>(() => {
    if (typeof window === "undefined") return DEFAULT_LABEL_PRESET_ID;
    return localStorage.getItem(PRESET_KEY) || DEFAULT_LABEL_PRESET_ID;
  });
  const [printing, setPrinting] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem(PRESET_KEY, presetId);
  }, [presetId]);

  const preset = getLabelPreset(presetId);
  const visiblePresets = showAll ? LABEL_PRESETS : LABEL_PRESETS.filter(p => p.common);
  const dieCut = visiblePresets.filter(p => p.kind === "die-cut");
  const continuous = visiblePresets.filter(p => p.kind === "continuous");

  const codeMap = buildShortCodeMap(items.map(i => i.orderNumber).filter(Boolean) as string[]);

  const handlePrint = async () => {
    if (items.length === 0) return;
    setPrinting(true);
    try {
      await printLotLabels(items, org, preset);
      onOpenChange(false);
    } finally {
      setPrinting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto top-[max(1rem,env(safe-area-inset-top))] translate-y-0 sm:top-[50%] sm:translate-y-[-50%]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-muted-foreground" />
            Print Lot Labels
          </DialogTitle>
          <DialogDescription data-testid="text-lot-label-count">
            {items.length} lot label{items.length !== 1 ? "s" : ""} — Brother QL series.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs mb-2 block">Label media</Label>
            <div className="flex flex-col gap-1.5">
              {dieCut.length > 0 && (
                <>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Die-cut labels</p>
                  {dieCut.map(p => (
                    <PresetButton key={p.id} preset={p} active={presetId === p.id} onClick={() => setPresetId(p.id)} />
                  ))}
                </>
              )}
              {continuous.length > 0 && (
                <>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mt-1">Continuous tape</p>
                  {continuous.map(p => (
                    <PresetButton key={p.id} preset={p} active={presetId === p.id} onClick={() => setPresetId(p.id)} />
                  ))}
                </>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAll(s => !s)}
                className="self-start text-xs text-muted-foreground mt-1"
                data-testid="button-toggle-all-labels"
              >
                {showAll ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                {showAll ? "Show fewer sizes" : "Show all sizes"}
              </Button>
            </div>
          </div>

          <div>
            <Label className="text-xs mb-2 block text-muted-foreground">
              Preview (first {Math.min(4, items.length)} of {items.length})
            </Label>
            <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
              {items.slice(0, 4).map((item, i) => (
                <LabelPreviewCard
                  key={i}
                  item={item}
                  shortCode={codeMap.get(item.orderNumber || "") || ""}
                  showImage={preset.showImage}
                />
              ))}
              {items.length > 4 && (
                <div className="col-span-2 text-center text-xs text-muted-foreground py-1">
                  +{items.length - 4} more label{items.length - 4 !== 1 ? "s" : ""} will be printed
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              className="flex-1 gap-2"
              onClick={handlePrint}
              disabled={items.length === 0 || printing}
              data-testid="button-print-lot-labels-confirm"
            >
              <Printer className="h-4 w-4" />
              {printing
                ? "Generating..."
                : `Print ${items.length} Label${items.length !== 1 ? "s" : ""}`}
            </Button>
            <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid="button-print-lot-labels-cancel">
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PresetButton({
  preset,
  active,
  onClick,
}: {
  preset: LabelPreset;
  active: boolean;
  onClick: () => void;
}) {
  // Mirror the bin-label dialog's button style: name + small dimensions on the right.
  const dim = preset.kind === "continuous"
    ? `${preset.widthMm} mm`
    : `${preset.widthMm} × ${preset.lengthMm} mm`;
  return (
    <button
      onClick={onClick}
      className={`rounded-md border py-2 px-3 text-xs text-left transition-colors flex items-center justify-between gap-3 ${
        active ? "border-primary bg-primary/10 text-primary" : "border-border hover-elevate"
      }`}
      data-testid={`button-lot-label-preset-${preset.id}`}
    >
      <div>
        <div className="font-semibold">{preset.sku}</div>
        <div className={`mt-0.5 ${active ? "text-primary/70" : "text-muted-foreground"}`}>
          {preset.desc}
        </div>
      </div>
      <div className={`text-[10px] font-mono shrink-0 ${active ? "text-primary/60" : "text-muted-foreground"}`}>
        {dim}
      </div>
    </button>
  );
}

function LabelPreviewCard({
  item,
  shortCode,
  showImage,
}: {
  item: LotLabelItem;
  shortCode: string;
  showImage: boolean;
}) {
  const partStr = item.partNumber || item.sku || "";
  const condStr = item.condition === "N" ? "New" : item.condition === "U" ? "Used" : item.condition || "";
  const note = (item.comment || item.remarks || "").trim();
  return (
    <div className="flex items-center gap-2 border border-border rounded-md bg-white dark:bg-zinc-900 p-2 h-16 overflow-hidden">
      {shortCode && (
        <div className="font-mono font-bold text-[10px] text-foreground shrink-0 leading-tight">
          {shortCode}
        </div>
      )}
      {showImage && (
        <div className="w-7 h-7 rounded bg-muted shrink-0" />
      )}
      <div className="flex-1 min-w-0 leading-tight">
        <div className="flex items-baseline gap-1">
          <span className="font-bold text-foreground text-[11px] truncate">{partStr}</span>
          <span className="text-[9px] text-muted-foreground shrink-0">×{item.quantity}</span>
        </div>
        <p className="text-[9px] text-muted-foreground truncate">
          {[item.colorName, condStr].filter(Boolean).join(" · ")}
        </p>
        {note && (
          <p className="text-[9px] truncate text-amber-600 dark:text-amber-400">{note}</p>
        )}
      </div>
    </div>
  );
}
