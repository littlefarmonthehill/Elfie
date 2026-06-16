import { useState } from "react";
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

const preset = getLabelPreset(DEFAULT_LABEL_PRESET_ID);

export default function LotLabelPrintDialog({ open, onOpenChange, items, org }: Props) {
  const [printing, setPrinting] = useState(false);

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
      <DialogContent className="max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto top-[max(1rem,env(safe-area-inset-top))] translate-y-0 sm:top-[50%] sm:translate-y-[-50%]">
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
            <Label className="text-xs text-muted-foreground mb-2 block">
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
