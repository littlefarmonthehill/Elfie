import { useState } from "react";
import { Printer } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { QRCodeSVG } from "qrcode.react";
import QRCode from "qrcode";
import jsPDF from "jspdf";
import { apiRequest } from "@/lib/queryClient";
import { hiddenPrint } from "./PackingSlip";
import { partImageSources } from "@/lib/part-image";

// ── Lot label item shape (superset used by both List-o-Matic and InventoryDetail) ──
export interface LotLabelPrintItem {
  id: number;
  itemNo: string;
  itemName: string | null;
  colorName: string | null;
  newOrUsed: string | null;
  quantity?: number | null;
  itemType?: string | null;
  colorId?: number | null;
  imageUrl?: string | null;
  remarks?: string | null;
  description?: string | null;
  aisleName?: string | null;
  locationLabel?: string | null;
}

// ── Templates ────────────────────────────────────────────────────────────────
export type LotLabelKey =
  | 'avery5160' | 'avery5163' | 'avery5164'
  | 'brotherDK1201' | 'brotherDK2210' | 'brotherDK1209';

export interface LotLabelTemplate {
  name: string;
  desc: string;
  w: string; h: string;
  perSheet: number; cols: number;
  pageMarginV: string; pageMarginH: string;
  colGap: string; rowGap: string;
  qrPx: number;
  previewH: string; previewQr: number;
  mode: 'sheet' | 'brother';
  group: string;
}

export const LOT_LABEL_TEMPLATES: Record<LotLabelKey, LotLabelTemplate> = {
  avery5160: {
    name: 'Avery 5160 / 8160', desc: '1" × 2⅝" · 30 per sheet',
    w: '2.625in', h: '1in', cols: 3, perSheet: 30,
    pageMarginV: '0.5in', pageMarginH: '0.1875in', colGap: '0.125in', rowGap: '0in',
    qrPx: 48, previewH: 'h-10', previewQr: 32, mode: 'sheet', group: 'Sheet labels (Avery)',
  },
  avery5163: {
    name: 'Avery 5163 / 8163', desc: '2" × 4" · 10 per sheet',
    w: '4in', h: '2in', cols: 2, perSheet: 10,
    pageMarginV: '0.5in', pageMarginH: '0.15625in', colGap: '0.1875in', rowGap: '0in',
    qrPx: 88, previewH: 'h-16', previewQr: 52, mode: 'sheet', group: 'Sheet labels (Avery)',
  },
  avery5164: {
    name: 'Avery 5164 / 8164', desc: '3⅓" × 4" · 6 per sheet',
    w: '4in', h: '3.333in', cols: 2, perSheet: 6,
    pageMarginV: '0.5in', pageMarginH: '0.15625in', colGap: '0.1875in', rowGap: '0in',
    qrPx: 140, previewH: 'h-24', previewQr: 72, mode: 'sheet', group: 'Sheet labels (Avery)',
  },
  brotherDK1201: {
    name: 'Brother DK-1201', desc: '1⅛" × 3½" standard address',
    w: '3.5in', h: '1.125in', cols: 1, perSheet: 1,
    pageMarginV: '0.06in', pageMarginH: '0.06in', colGap: '0in', rowGap: '0in',
    qrPx: 64, previewH: 'h-10', previewQr: 42, mode: 'brother', group: 'Brother QL-810W',
  },
  brotherDK2210: {
    name: 'Brother DK-2210', desc: '1⅛" wide continuous tape',
    w: '4in', h: '1.125in', cols: 1, perSheet: 1,
    pageMarginV: '0.06in', pageMarginH: '0.06in', colGap: '0in', rowGap: '0in',
    qrPx: 64, previewH: 'h-10', previewQr: 42, mode: 'brother', group: 'Brother QL-810W',
  },
  brotherDK1209: {
    name: 'Brother DK-1209', desc: '⅞" × 1⅝" small address',
    w: '1.625in', h: '0.875in', cols: 1, perSheet: 1,
    pageMarginV: '0.04in', pageMarginH: '0.04in', colGap: '0in', rowGap: '0in',
    qrPx: 44, previewH: 'h-9', previewQr: 28, mode: 'brother', group: 'Brother QL-810W',
  },
};

export const LOT_LABEL_GROUPS: { groupName: string; keys: LotLabelKey[] }[] = [
  { groupName: 'Sheet labels (Avery)',  keys: ['avery5160', 'avery5163', 'avery5164'] },
  { groupName: 'Brother QL-810W',       keys: ['brotherDK1201', 'brotherDK2210', 'brotherDK1209'] },
];

const LOT_LABEL_SIZE_KEY = 'elfie.lotLabelSize.v1';
export function loadSavedLotLabelSize(): LotLabelKey {
  if (typeof window === 'undefined') return 'brotherDK1201';
  const saved = window.localStorage.getItem(LOT_LABEL_SIZE_KEY) as LotLabelKey | null;
  return saved && LOT_LABEL_TEMPLATES[saved] ? saved : 'brotherDK1201';
}
export function saveLotLabelSize(key: LotLabelKey) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(LOT_LABEL_SIZE_KEY, key); } catch { /* ignore */ }
}

// Label-optimized image loader: small white-background JPEG suitable for
// jsPDF embedding. Much smaller and faster than padded PNG dataURLs, which
// matters when generating 100+ labels in a single PDF.
function loadLabelThumbJPEG(url: string, targetPx: number): Promise<string | null> {
  return new Promise(resolve => {
    const img = new Image();
    let isCrossOrigin = false;
    try {
      if (typeof window !== 'undefined' && /^https?:\/\//i.test(url)) {
        isCrossOrigin = new URL(url).origin !== window.location.origin;
      }
    } catch { /* same-origin */ }
    if (isCrossOrigin) img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        if (!w || !h) { resolve(null); return; }
        const sz = targetPx;
        const scale = Math.min(sz / w, sz / h);
        const dw = Math.max(1, Math.round(w * scale));
        const dh = Math.max(1, Math.round(h * scale));
        const dx = Math.floor((sz - dw) / 2);
        const dy = Math.floor((sz - dh) / 2);
        const canvas = document.createElement('canvas');
        canvas.width = sz;
        canvas.height = sz;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, sz, sz);
        ctx.drawImage(img, dx, dy, dw, dh);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function loadLabelImageDeduped(opts: {
  partNumber?: string | null;
  colorId?: number | null;
  imageUrl?: string | null;
  itemType?: string | null;
  targetPx: number;
}): Promise<string | null> {
  // Intentionally omit lotId — labels are canonical per SKU+color, so we want
  // the catalog/CDN image, not a lot-scoped override. This keeps the dedupe
  // key (itemNo+colorId+itemType+imageUrl) sound: two lots of the same
  // SKU/color always resolve to the same thumbnail.
  const urls = partImageSources(opts.imageUrl, opts.partNumber, opts.colorId, opts.itemType, null);
  for (const url of urls) {
    const data = await loadLabelThumbJPEG(url, opts.targetPx);
    if (data) return data;
  }
  return null;
}

function decodeHtml(str: string): string {
  if (typeof document === 'undefined') return str;
  const txt = document.createElement('textarea');
  txt.innerHTML = str;
  return txt.value;
}
function conditionLabel(newOrUsed: string | null) {
  if (newOrUsed === 'N') return 'New';
  if (newOrUsed === 'U') return 'Used';
  return null;
}

// ── PDF builder ──────────────────────────────────────────────────────────────
// Identical layout/process used by List-o-Matic. Optionally marks each printed
// lot with a Ready-to-File hint via /api/listing-batches/mark-rtf.
export async function printLotLabelsWithTemplate(
  items: LotLabelPrintItem[],
  templateKey: LotLabelKey,
  opts: { markRtf?: boolean } = {},
): Promise<void> {
  if (items.length === 0) return;
  const tmpl = LOT_LABEL_TEMPLATES[templateKey];
  const parseIn = (s: string) => parseFloat(s);
  const pageW = parseIn(tmpl.w);
  const pageH = parseIn(tmpl.h);
  const padIn = 0.05;
  const qrIn = tmpl.qrPx / 96;
  const showImage = templateKey !== 'brotherDK1209';
  const imgIn = showImage ? qrIn : 0;
  const imgGap = showImage ? 0.06 : 0;

  // QR codes are unique per lot (LOT:<id>), so each must be generated.
  const qrCanvases = await Promise.all(items.map(async (lot) => {
    const canvas = document.createElement('canvas');
    await QRCode.toCanvas(canvas, `LOT:${lot.id}`, {
      width: tmpl.qrPx * 2,
      margin: 0,
      color: { dark: '#000000', light: '#ffffff' },
    });
    return canvas;
  }));

  // Part thumbnails repeat across labels for the same SKU+color — dedupe so
  // we only fetch + encode each unique image once. Major speedup when a print
  // batch contains many lots of the same part. Downscaled JPEG keeps the
  // final PDF small and fast for the browser to render in the print dialog.
  let partImages: (string | null)[];
  if (showImage) {
    const targetPx = Math.max(96, Math.round(tmpl.qrPx * 2));
    const cache = new Map<string, Promise<string | null>>();
    const keyFor = (lot: LotLabelPrintItem) =>
      `${lot.itemNo}|${lot.colorId ?? ''}|${lot.itemType ?? ''}|${lot.imageUrl ?? ''}`;
    partImages = await Promise.all(items.map(lot => {
      const k = keyFor(lot);
      let p = cache.get(k);
      if (!p) {
        p = loadLabelImageDeduped({
          partNumber: lot.itemNo,
          colorId: lot.colorId ?? null,
          imageUrl: lot.imageUrl ?? null,
          itemType: lot.itemType ?? null,
          targetPx,
        });
        cache.set(k, p);
      }
      return p;
    }));
  } else {
    partImages = items.map(() => null);
  }

  const doc = new jsPDF({ orientation: 'landscape', unit: 'in', format: [pageW, pageH] });

  items.forEach((lot, i) => {
    if (i > 0) doc.addPage([pageW, pageH], 'landscape');

    const name = lot.itemName ? decodeHtml(lot.itemName) : lot.itemNo;
    const cond = conditionLabel(lot.newOrUsed);
    const metaParts = [lot.colorName, cond].filter(Boolean).join(' · ');

    const sideCaptionPt = 10;
    const sideCaptionLineH = sideCaptionPt / 72;
    const sideGap = 0.03;
    const sideStackH = qrIn + sideGap + sideCaptionLineH;
    const sideTopY = Math.max(padIn, (pageH - sideStackH) / 2);

    const partLabel = `#${lot.itemNo}`;
    doc.addImage(qrCanvases[i], 'PNG', padIn, sideTopY, qrIn, qrIn);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(sideCaptionPt);
    doc.setTextColor(102, 102, 102);
    const partTextW = doc.getTextWidth(partLabel);
    const partTextX = padIn + (qrIn - partTextW) / 2;
    const captionY = sideTopY + qrIn + sideGap;
    doc.text(partLabel, partTextX, captionY, { baseline: 'top' });

    if (showImage) {
      const imgX = pageW - padIn - imgIn;
      const lotLabel = `LOT:${lot.id}`;
      const lotCaptionY = Math.max(padIn, sideTopY - sideGap - sideCaptionLineH);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(sideCaptionPt);
      doc.setTextColor(26, 95, 26);
      doc.text(lotLabel, imgX + imgIn, lotCaptionY, { baseline: 'top', align: 'right' });

      const imgData = partImages[i];
      if (imgData) {
        try { doc.addImage(imgData, 'JPEG', imgX, sideTopY, imgIn, imgIn); } catch { /* skip */ }
      } else {
        doc.setDrawColor(220, 220, 220);
        doc.setFillColor(248, 248, 248);
        doc.roundedRect(imgX, sideTopY, imgIn, imgIn, 0.03, 0.03, 'FD');
      }

      {
        const aislePt = 12;
        const aisleY = sideTopY + imgIn + sideGap;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(aislePt);
        doc.setTextColor(26, 95, 26);
        doc.text(`rtf ${lot.aisleName ?? 0}`, imgX + imgIn, aisleY, { baseline: 'top', align: 'right' });
      }
    } else {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(sideCaptionPt);
      doc.setTextColor(26, 95, 26);
      const lotLabel = `LOT:${lot.id}`;
      const lotTextW = doc.getTextWidth(lotLabel);
      doc.text(lotLabel, pageW - padIn - lotTextW, captionY, { baseline: 'top' });
    }

    const textX = padIn + qrIn + 0.08;
    const textRight = showImage ? (pageW - padIn - imgIn - imgGap) : (pageW - padIn);
    const textW = textRight - textX;

    const namePt = 11;
    const metaPt = 9;
    const lineGap = 0.04;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(namePt);
    const nameLines = doc.splitTextToSize(name, textW).slice(0, 2);
    const nameBlockH = nameLines.length * (namePt / 72) * 1.2;
    const metaLineH = metaParts ? (metaPt / 72) : 0;

    const noteText = decodeHtml((lot.remarks ?? lot.description ?? '').trim());
    const notePt = 9;
    const noteLineH = (notePt / 72) * 1.25;
    let noteWrapped: string[] = [];
    let noteBlockH = 0;
    if (noteText) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(notePt);
      noteWrapped = (doc.splitTextToSize(noteText, textW) as string[]).slice(0, 2);
      noteBlockH = noteWrapped.length * noteLineH;
    }

    const totalH =
      (metaLineH ? metaLineH + lineGap : 0) +
      nameBlockH +
      (noteBlockH ? lineGap + noteBlockH : 0);
    let cursorY = Math.max(padIn, (pageH - totalH) / 2);

    if (metaParts) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(metaPt);
      doc.setTextColor(0, 0, 0);
      doc.text(metaParts, textX, cursorY, { baseline: 'top' });
      cursorY += metaLineH + lineGap;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(namePt);
    doc.setTextColor(0, 0, 0);
    doc.text(nameLines, textX, cursorY, { baseline: 'top' });
    cursorY += nameBlockH;

    if (noteText) {
      cursorY += lineGap;
      const noteY = Math.min(cursorY, pageH - padIn - noteBlockH);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(notePt);
      doc.setTextColor(60, 50, 0);
      noteWrapped.forEach((line, idx) => {
        doc.text(line, textX, noteY + idx * noteLineH, { baseline: 'top' });
      });
      cursorY = noteY + noteBlockH;
    }
  });

  hiddenPrint(doc.output('blob'), 'lot-labels.pdf');

  if (opts.markRtf !== false) {
    const rtfPayload = items.map(l => ({
      inventoryId: l.id,
      rtfBin: l.aisleName ? String(l.aisleName) : "0",
    }));
    if (rtfPayload.length > 0) {
      try {
        await apiRequest('POST', '/api/listing-batches/mark-rtf', { items: rtfPayload });
      } catch { /* non-fatal — the label still prints */ }
    }
  }
}

// ── Shared print dialog (template picker + preview + print button) ───────────
interface DialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  items: LotLabelPrintItem[];
  markRtf?: boolean;
  title?: string;
  description?: string;
}

export default function LotLabelTemplatePrintDialog({
  open, onOpenChange, items, markRtf, title, description,
}: DialogProps) {
  const [size, setSize] = useState<LotLabelKey>(() => loadSavedLotLabelSize());
  const [printing, setPrinting] = useState(false);

  const handleSize = (k: LotLabelKey) => { setSize(k); saveLotLabelSize(k); };

  const handlePrint = async () => {
    if (items.length === 0) return;
    setPrinting(true);
    try {
      await printLotLabelsWithTemplate(items, size, { markRtf });
      onOpenChange(false);
    } finally {
      setPrinting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg z-[9999]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-4 w-4 text-muted-foreground" />
            {title ?? "Print Lot Labels"}
          </DialogTitle>
          <DialogDescription>
            {description ?? `${items.length} lot label${items.length !== 1 ? 's' : ''}. Each label includes a QR code (LOT:id), part number, name, color, and condition.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs mb-2 block">Label template</Label>
            <div className="flex flex-col gap-1.5">
              {LOT_LABEL_GROUPS.map(({ groupName, keys }) => (
                <div key={groupName}>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">{groupName}</p>
                  {keys.map(key => {
                    const t = LOT_LABEL_TEMPLATES[key];
                    const active = size === key;
                    return (
                      <button
                        key={key}
                        onClick={() => handleSize(key)}
                        className={`w-full rounded-md border py-2 px-3 text-xs text-left transition-colors flex items-center justify-between gap-3 mb-1 ${active ? 'border-primary bg-primary/10 text-primary' : 'border-border hover-elevate'}`}
                        data-testid={`button-lot-label-size-${key}`}
                      >
                        <div>
                          <div className="font-semibold">{t.name}</div>
                          <div className={`mt-0.5 ${active ? 'text-primary/70' : 'text-muted-foreground'}`}>{t.desc}</div>
                        </div>
                        <div className={`text-[10px] font-mono shrink-0 ${active ? 'text-primary/60' : 'text-muted-foreground'}`}>{t.w} × {t.h}</div>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs mb-2 block text-muted-foreground">
              Preview (first {Math.min(3, items.length)})
            </Label>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {items.slice(0, 3).map(lot => {
                const tmpl = LOT_LABEL_TEMPLATES[size];
                const qrData = `LOT:${lot.id}`;
                const cond = conditionLabel(lot.newOrUsed);
                const name = lot.itemName ? decodeHtml(lot.itemName) : lot.itemNo;
                const metaParts = [lot.colorName, cond].filter(Boolean).join(' · ');
                return (
                  <div
                    key={lot.id}
                    className={`flex items-center gap-2 border border-border rounded-md bg-white dark:bg-zinc-900 p-2 ${tmpl.previewH} overflow-hidden`}
                  >
                    <QRCodeSVG
                      value={qrData}
                      size={tmpl.previewQr}
                      bgColor="transparent"
                      fgColor="currentColor"
                      className="shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 overflow-hidden">
                        <p className="text-[9px] font-mono text-muted-foreground shrink-1 truncate">#{lot.itemNo}</p>
                        {lot.locationLabel
                          ? <p className="text-[9px] font-mono font-bold text-foreground shrink-0">{lot.locationLabel}</p>
                          : <p className="text-[9px] font-mono italic text-muted-foreground/50 shrink-0">unassigned</p>}
                      </div>
                      <p className="font-bold text-foreground truncate text-xs leading-tight">{name}</p>
                      {metaParts && <p className="text-[9px] text-muted-foreground truncate">{metaParts}</p>}
                      <p className="text-[9px] font-mono text-green-600 dark:text-green-400">LOT:{lot.id}</p>
                    </div>
                  </div>
                );
              })}
              {items.length > 3 && (
                <p className="text-center text-xs text-muted-foreground py-1">
                  +{items.length - 3} more label{items.length - 3 !== 1 ? 's' : ''} will be printed
                </p>
              )}
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              className="flex-1 gap-2"
              onClick={handlePrint}
              disabled={items.length === 0 || printing}
              data-testid="button-print-confirm"
            >
              <Printer className="h-4 w-4" />
              {printing ? "Generating..." : `Print ${items.length} Label${items.length !== 1 ? 's' : ''}`}
            </Button>
            <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid="button-print-cancel">
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
