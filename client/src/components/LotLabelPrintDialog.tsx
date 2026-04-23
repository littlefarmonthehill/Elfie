import { useEffect, useState } from "react";
import { Tag, Printer } from "lucide-react";
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

  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem(PRESET_KEY, presetId);
  }, [presetId]);

  const preset = getLabelPreset(presetId);
  const dieCut = LABEL_PRESETS.filter(p => p.id.startsWith("dk-1"));
  const continuous = LABEL_PRESETS.filter(p => p.id.startsWith("dk-2"));

  const codeMap = buildShortCodeMap((items.map(i => i.orderNumber).filter(Boolean) as string[]));

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

  // Aspect ratio of the chosen tape for the small CSS preview cards.
  const aspect = preset.lengthMm / preset.widthMm;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-muted-foreground" />
            Print Lot Labels
          </DialogTitle>
          <DialogDescription data-testid="text-lot-label-count">
            {items.length} lot label{items.length !== 1 ? "s" : ""}. Each label includes the order short-code, part number, name, color and condition.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs mb-2 block">Brother DK label</Label>
            <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto pr-1">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Die-cut labels</p>
              {dieCut.map(p => (
                <PresetButton key={p.id} preset={p} active={presetId === p.id} onClick={() => setPresetId(p.id)} />
              ))}
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mt-1">Continuous tape</p>
              {continuous.map(p => (
                <PresetButton key={p.id} preset={p} active={presetId === p.id} onClick={() => setPresetId(p.id)} />
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs mb-2 block text-muted-foreground">
              Preview (first {Math.min(3, items.length)} of {items.length})
            </Label>
            <div className="grid grid-cols-1 gap-2 max-h-64 overflow-y-auto">
              {items.slice(0, 3).map((item, i) => (
                <LabelPreviewCard
                  key={i}
                  item={item}
                  shortCode={codeMap.get(item.orderNumber || "") || ""}
                  showImage={preset.showImage}
                  aspect={aspect}
                />
              ))}
              {items.length > 3 && (
                <div className="text-center text-xs text-muted-foreground py-1">
                  +{items.length - 3} more label{items.length - 3 !== 1 ? "s" : ""} will be printed
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
  preset: typeof LABEL_PRESETS[number];
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md border py-2 px-3 text-xs text-left transition-colors flex items-center justify-between gap-3 ${
        active ? "border-primary bg-primary/10 text-primary" : "border-border hover-elevate"
      }`}
      data-testid={`button-lot-label-preset-${preset.id}`}
    >
      <div className="font-semibold">{preset.label}</div>
      <div className={`text-[10px] font-mono shrink-0 ${active ? "text-primary/60" : "text-muted-foreground"}`}>
        {preset.widthMm}×{preset.lengthMm} mm
      </div>
    </button>
  );
}

function LabelPreviewCard({
  item,
  shortCode,
  showImage,
  aspect,
}: {
  item: LotLabelItem;
  shortCode: string;
  showImage: boolean;
  aspect: number;
}) {
  const partStr = item.partNumber || item.sku || "";
  const condStr = item.condition === "N" ? "New" : item.condition === "U" ? "Used" : item.condition || "";
  const note = (item.comment || item.remarks || "").trim();
  // Cap preview height so very wide tapes don't blow up the dialog.
  const heightPx = Math.min(72, Math.max(40, 220 / aspect));
  return (
    <div
      className="flex items-center gap-2 border border-border rounded-md bg-white dark:bg-zinc-900 p-2 overflow-hidden"
      style={{ height: `${heightPx}px` }}
    >
      {shortCode && (
        <div className="font-mono font-bold text-[10px] text-foreground shrink-0 leading-tight">
          {shortCode}
        </div>
      )}
      {showImage && (
        <div className="w-8 h-8 rounded bg-muted shrink-0 overflow-hidden flex items-center justify-center">
          <span className="text-[8px] text-muted-foreground">img</span>
        </div>
      )}
      <div className="flex-1 min-w-0 leading-tight">
        <div className="flex items-baseline gap-1.5">
          <span className="font-bold text-foreground text-xs truncate">{partStr}</span>
          <span className="text-[10px] text-muted-foreground">×{item.quantity}</span>
        </div>
        {item.itemName && (
          <p className="text-[9px] text-muted-foreground truncate">{item.itemName}</p>
        )}
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
