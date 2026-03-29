import { useState, useCallback, useRef, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import * as XLSX from "xlsx";
import {
  Upload, FileUp, X, CheckCircle2, AlertTriangle,
  Package, Layers, ChevronDown, ChevronUp, Loader2,
  ArrowUpDown, ArrowUp, ArrowDown
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

// ── Types ────────────────────────────────────────────────────────────────────

export interface AcqItem {
  itemNo: string;
  colorId: number;
  colorName?: string;
  condition: string;
  quantity: number;
  price?: number;
}

interface AcqCommonItem {
  itemNo: string;
  colorId: number;
  colorName: string | null;
  itemName: string | null;
  condition: string;
  sellerQty: number;
  sellerPrice: number | null;
  orgQty: number;
  orgPrice: number | null;
  marketAvgNew: number | null;
  marketAvgUsed: number | null;
}

interface AcqNewItem {
  itemNo: string;
  colorId: number;
  colorName: string | null;
  itemName: string | null;
  condition: string;
  sellerQty: number;
  sellerPrice: number | null;
  marketAvgNew: number | null;
  marketAvgUsed: number | null;
}

interface AcqSummary {
  totalSellerLots: number;
  totalSellerQty: number;
  totalSellerValue: number | null;
  commonLots: number;
  commonSellerQty: number;
  commonSellerValue: number | null;
  commonOrgListValue: number | null;
  newLots: number;
  newSellerQty: number;
  newSellerValue: number | null;
  newEstMarketValue: number | null;
}

interface AcqResult {
  summary: AcqSummary;
  common: AcqCommonItem[];
  newItems: AcqNewItem[];
}

// ── File Parsing ─────────────────────────────────────────────────────────────

function parseBSX(content: string): AcqItem[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, "text/xml");
  const items: AcqItem[] = [];
  doc.querySelectorAll("Item").forEach(el => {
    const itemNo = el.querySelector("ItemID")?.textContent?.trim() || "";
    const colorId = parseInt(el.querySelector("ColorID")?.textContent?.trim() || "0", 10);
    const qty = parseInt(el.querySelector("Qty")?.textContent?.trim() || "0", 10);
    const price = parseFloat(el.querySelector("Price")?.textContent?.trim() || "0");
    const cond = (el.querySelector("Condition")?.textContent?.trim() || "U").toUpperCase();
    if (itemNo && qty > 0) {
      items.push({ itemNo, colorId: isNaN(colorId) ? 0 : colorId, condition: cond === "N" ? "N" : "U", quantity: qty, price: isNaN(price) ? undefined : price });
    }
  });
  return items;
}

function parseBLXML(content: string): AcqItem[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, "text/xml");
  const items: AcqItem[] = [];
  doc.querySelectorAll("ITEM").forEach(el => {
    const itemNo = el.querySelector("ITEMID")?.textContent?.trim() || "";
    const colorId = parseInt(el.querySelector("COLOR")?.textContent?.trim() || "0", 10);
    const qty = parseInt(
      (el.querySelector("MINQTY") || el.querySelector("QTY"))?.textContent?.trim() || "0",
      10
    );
    const price = parseFloat(el.querySelector("PRICE")?.textContent?.trim() || "0");
    const cond = (el.querySelector("CONDITION")?.textContent?.trim() || "U").toUpperCase();
    if (itemNo && qty > 0) {
      items.push({ itemNo, colorId: isNaN(colorId) ? 0 : colorId, condition: cond === "N" ? "N" : "U", quantity: qty, price: isNaN(price) ? undefined : price });
    }
  });
  return items;
}

function detectXMLFormat(content: string): 'bsx' | 'blxml' | null {
  const upper = content.slice(0, 500).toLowerCase();
  if (upper.includes("brickstockxml") || upper.includes("brickstore")) return 'bsx';
  if (upper.includes("<inventory>") || upper.includes("<item>")) return 'blxml';
  if (upper.includes("<itemid>") || upper.includes("<colorid>")) return 'bsx';
  return null;
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseCSVRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && !inQuote) { inQuote = true; continue; }
    if (c === '"' && inQuote) {
      if (text[i + 1] === '"') { cell += '"'; i++; continue; }
      inQuote = false; continue;
    }
    if (!inQuote && c === ',') { row.push(cell); cell = ""; continue; }
    if (!inQuote && (c === '\n' || c === '\r')) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = "";
      if (row.some(x => x.trim())) rows.push(row);
      row = [];
      continue;
    }
    cell += c;
  }
  row.push(cell);
  if (row.some(x => x.trim())) rows.push(row);
  return rows;
}

function parseCSV(content: string): AcqItem[] {
  const rows = parseCSVRows(content);
  if (rows.length < 2) return [];
  const headers = rows[0].map(normalizeHeader);

  const col = (keys: string[]): number => {
    for (const k of keys) {
      const i = headers.indexOf(k);
      if (i !== -1) return i;
    }
    return -1;
  };

  const itemNoIdx = col(['itemno', 'itemid', 'partnumber', 'partno', 'part']);
  // Strictly-numeric color ID columns (preferred):
  const colorIdIdx = col(['colorid', 'blcolorid', 'colorcode', 'blcolor', 'colornum']);
  // Text color name columns (fallback — may contain "White", "Red", etc. or also a number):
  const colorNameIdx = col(['colorname', 'colourname', 'color', 'colour', 'colordesc']);
  const qtyIdx = col(['qty', 'quantity', 'minqty', 'count']);
  const condIdx = col(['condition', 'newused', 'cond', 'newOrUsed', 'neworused', 'newused']);
  const priceIdx = col(['price', 'unitprice', 'myprice']);

  if (itemNoIdx === -1 || qtyIdx === -1) return [];

  const items: AcqItem[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const itemNo = r[itemNoIdx]?.trim() || "";
    const qty = parseInt(r[qtyIdx]?.trim() || "0", 10);
    if (!itemNo || qty <= 0) continue;

    // Resolve color: try the numeric-ID column first, then fall back to the name column.
    // If the fallback column is also numeric (some CSVs put a number under "Color"), use it as an ID.
    // If it's text, keep colorId=0 and store the name so the backend can resolve it.
    let colorId = 0;
    let colorName: string | undefined;
    if (colorIdIdx !== -1) {
      const raw = r[colorIdIdx]?.trim() || "";
      const n = parseInt(raw, 10);
      if (!isNaN(n) && n > 0) colorId = n;
    }
    if (colorId === 0 && colorNameIdx !== -1) {
      const raw = r[colorNameIdx]?.trim() || "";
      const n = parseInt(raw, 10);
      if (!isNaN(n) && n > 0) {
        colorId = n; // column header is "Color" but value is numeric — treat as ID
      } else if (raw) {
        colorName = raw; // text like "White" — send to backend for resolution
      }
    }

    let condition = "U";
    if (condIdx !== -1) {
      const raw = (r[condIdx]?.trim() || "U").toUpperCase();
      condition = raw === "N" || raw === "NEW" ? "N" : "U";
    }

    let price: number | undefined;
    if (priceIdx !== -1) {
      const raw = r[priceIdx]?.trim().replace(/[^0-9.]/g, "") || "";
      const n = parseFloat(raw);
      if (!isNaN(n)) price = n;
    }

    items.push({ itemNo, colorId, colorName, condition, quantity: qty, price });
  }
  return items;
}

function parseXLSX(buffer: ArrayBuffer): AcqItem[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const csvStr = XLSX.utils.sheet_to_csv(sheet);
  return parseCSV(csvStr);
}

/**
 * Merge duplicate rows that share the same itemNo + colorId + condition + price.
 * Different prices for the same part = intentional split listings, not duplicates.
 * Quantities are summed for rows that match on all four fields.
 * Returns the consolidated list plus the original row count before merging.
 */
function consolidate(items: AcqItem[]): { items: AcqItem[]; rawRows: number } {
  const rawRows = items.length;
  const map = new Map<string, AcqItem & { _pricedQty: number }>();
  for (const item of items) {
    // Include price in key: same part/color/condition at different prices = separate lots.
    const priceKey = item.price != null ? item.price.toFixed(4) : 'null';
    const key = `${item.itemNo}|${item.colorId}|${item.condition}|${priceKey}`;
    const ex = map.get(key);
    if (ex) {
      if (item.price != null && ex.price != null) {
        // Weighted average: keep running total / qty
        ex.price = (ex.price * ex._pricedQty + item.price * item.quantity) / (ex._pricedQty + item.quantity);
        ex._pricedQty += item.quantity;
      } else if (item.price != null) {
        ex.price = item.price;
        ex._pricedQty = item.quantity;
      }
      ex.quantity += item.quantity;
    } else {
      map.set(key, { ...item, _pricedQty: item.price != null ? item.quantity : 0 });
    }
  }
  const consolidated = [...map.values()].map(({ _pricedQty: _, ...rest }) => rest);
  return { items: consolidated, rawRows };
}

async function parseFile(file: File): Promise<{ items: AcqItem[]; rawRows: number }> {
  const name = file.name.toLowerCase();
  let raw: AcqItem[];

  if (name.endsWith(".bsx") || name.endsWith(".brickstore")) {
    raw = parseBSX(await file.text());
  } else if (name.endsWith(".xml")) {
    const text = await file.text();
    const fmt = detectXMLFormat(text);
    raw = fmt === 'bsx' ? parseBSX(text) : parseBLXML(text);
  } else if (name.endsWith(".csv")) {
    raw = parseCSV(await file.text());
  } else if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".ods")) {
    raw = parseXLSX(await file.arrayBuffer());
  } else {
    const text = await file.text();
    if (text.trim().startsWith("<")) {
      const fmt = detectXMLFormat(text);
      raw = fmt === 'bsx' ? parseBSX(text) : parseBLXML(text);
    } else {
      raw = parseCSV(text);
    }
  }

  return consolidate(raw);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div className={cn("rounded-lg p-3 border", color)}>
      <div className="text-xs text-gray-400 mb-0.5">{label}</div>
      <div className="text-lg font-bold text-white leading-tight">{value}</div>
      {sub && <div className="text-[10px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function fmt$(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

type SortCol = 'itemNo' | 'condition' | 'sellerQty' | 'sellerPrice' | 'orgQty' | 'orgPrice' | 'market';
type SortDir = 'asc' | 'desc';

function ItemsTable({ items, type }: { items: AcqCommonItem[] | AcqNewItem[]; type: 'common' | 'new' }) {
  const [expanded, setExpanded] = useState(false);
  const [sortCol, setSortCol] = useState<SortCol>('itemNo');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ col }: { col: SortCol }) => {
    if (sortCol !== col) return <ArrowUpDown className="w-2.5 h-2.5 ml-0.5 opacity-40 inline-block" />;
    return sortDir === 'asc'
      ? <ArrowUp className="w-2.5 h-2.5 ml-0.5 inline-block" />
      : <ArrowDown className="w-2.5 h-2.5 ml-0.5 inline-block" />;
  };

  const sorted = useMemo(() => {
    const arr = [...items];
    arr.sort((a, b) => {
      let va: string | number = 0;
      let vb: string | number = 0;
      const ca = a as AcqCommonItem;
      const cb = b as AcqCommonItem;
      switch (sortCol) {
        case 'itemNo':       va = a.itemNo;             vb = b.itemNo;             break;
        case 'condition':    va = a.condition;           vb = b.condition;          break;
        case 'sellerQty':    va = a.sellerQty;           vb = b.sellerQty;          break;
        case 'sellerPrice':  va = a.sellerPrice ?? -1;   vb = b.sellerPrice ?? -1;  break;
        case 'orgQty':       va = ca.orgQty ?? -1;       vb = cb.orgQty ?? -1;      break;
        case 'orgPrice':     va = ca.orgPrice ?? -1;     vb = cb.orgPrice ?? -1;    break;
        case 'market': {
          const ma = a.condition === 'N' ? a.marketAvgNew : a.marketAvgUsed;
          const mb = b.condition === 'N' ? b.marketAvgNew : b.marketAvgUsed;
          va = ma ?? -1; vb = mb ?? -1; break;
        }
      }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [items, sortCol, sortDir]);

  const displayed = expanded ? sorted : sorted.slice(0, 15);

  if (items.length === 0) return null;

  const Th = ({ col, align = 'right', children }: { col: SortCol; align?: 'left' | 'center' | 'right'; children: React.ReactNode }) => (
    <th
      className={cn(
        "px-2 py-1.5 font-medium cursor-pointer select-none whitespace-nowrap",
        align === 'left' ? 'text-left px-2.5' : align === 'center' ? 'text-center' : 'text-right',
        sortCol === col ? 'text-gray-200' : 'text-gray-400 hover:text-gray-300'
      )}
      onClick={() => toggleSort(col)}
      data-testid={`acq-sort-${col}`}
    >
      {children}<SortIcon col={col} />
    </th>
  );

  return (
    <div className="rounded-lg border border-gray-700/60 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-gray-700/60 bg-gray-900/60">
              <Th col="itemNo" align="left">Part / Color</Th>
              <Th col="condition" align="center">Cond</Th>
              <Th col="sellerQty">Seller Qty</Th>
              <Th col="sellerPrice">Seller Price</Th>
              {type === 'common' && <Th col="orgQty">Our Qty</Th>}
              {type === 'common' && <Th col="orgPrice">Our Price</Th>}
              <Th col="market">Market Avg</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/60">
            {displayed.map((item, i) => {
              const common = item as AcqCommonItem;
              const isNew = type === 'new';
              const market = item.condition === 'N' ? item.marketAvgNew : item.marketAvgUsed;
              const sellerTotal = item.sellerPrice != null ? item.sellerPrice * item.sellerQty : null;
              const valueDiff = sellerTotal != null && market != null
                ? (market * item.sellerQty - sellerTotal)
                : null;
              return (
                <tr key={i} className="hover:bg-gray-800/30 transition-colors">
                  <td className="px-2.5 py-1.5">
                    <div className="font-mono text-white">{item.itemNo}</div>
                    {(item.itemName || item.colorName) && (
                      <div className="text-gray-500 text-[10px] leading-tight truncate max-w-[120px]">
                        {[item.colorName, item.itemName].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <span className={cn("text-[9px] font-bold px-1 py-0.5 rounded",
                      item.condition === 'N'
                        ? "bg-blue-900/50 text-blue-300 border border-blue-700/40"
                        : "bg-amber-900/50 text-amber-300 border border-amber-700/40"
                    )}>
                      {item.condition === 'N' ? 'New' : 'Used'}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right text-gray-300">{item.sellerQty}</td>
                  <td className="px-2 py-1.5 text-right text-gray-300">{fmt$(item.sellerPrice)}</td>
                  {!isNew && <td className="px-2 py-1.5 text-right text-gray-300">{common.orgQty}</td>}
                  {!isNew && <td className="px-2 py-1.5 text-right text-gray-300">{fmt$(common.orgPrice)}</td>}
                  <td className="px-2.5 py-1.5 text-right">
                    {market != null ? (
                      <span className={cn("font-medium", valueDiff != null && valueDiff > 0 ? "text-green-400" : "text-gray-300")}>
                        {fmt$(market)}
                      </span>
                    ) : <span className="text-gray-600">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {items.length > 15 && (
        <button
          onClick={() => setExpanded(x => !x)}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[10px] text-gray-500 hover:text-gray-300 border-t border-gray-800/60 hover:bg-gray-800/20 transition-colors"
          data-testid={`btn-expand-${type}`}
        >
          {expanded ? <><ChevronUp className="w-3 h-3" /> Show less</> : <><ChevronDown className="w-3 h-3" /> Show all {items.length} items</>}
        </button>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AcquisitionEvaluator() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [parsed, setParsed] = useState<{ items: AcqItem[]; rawRows: number } | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<AcqResult | null>(null);
  const [section, setSection] = useState<'common' | 'new'>('common');

  const evaluateMutation = useMutation({
    mutationFn: async (items: AcqItem[]) => {
      return await apiRequest("POST", "/api/inventory/acquisition-evaluate", { items }) as AcqResult;
    },
    onSuccess: (data) => setResult(data),
    onError: (e: any) => {
      toast({ title: "Evaluation failed", description: e.message, variant: "destructive" });
    }
  });

  const handleFile = useCallback(async (file: File) => {
    setParseError(null);
    setResult(null);
    setParsed(null);
    setFileName(file.name);
    try {
      const { items, rawRows } = await parseFile(file);
      if (items.length === 0) {
        setParseError("No inventory items found in this file. Check that it's a valid BSX, BrickLink XML, or CSV file with item numbers and quantities.");
        return;
      }
      setParsed({ items, rawRows });
    } catch (e: any) {
      setParseError(e.message || "Failed to parse file.");
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }, [handleFile]);

  const reset = () => {
    setParsed(null);
    setResult(null);
    setFileName(null);
    setParseError(null);
  };

  const s = result?.summary;

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* File Upload Zone */}
      {!parsed && !parseError && (
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          data-testid="acq-upload-zone"
          className={cn(
            "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed cursor-pointer transition-all py-10 px-6 text-center",
            dragging
              ? "border-violet-400/70 bg-violet-900/10"
              : "border-gray-600/50 bg-gray-900/30 hover:border-violet-500/50 hover:bg-violet-900/5"
          )}
        >
          <div className="rounded-full bg-violet-900/40 p-3.5 ring-1 ring-violet-500/30">
            <Upload className="w-6 h-6 text-violet-300" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Drop the seller's inventory file here</p>
            <p className="text-xs text-gray-500 mt-1">Supports .bsx, .xml, .csv, .xlsx — or click to browse</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".bsx,.xml,.csv,.xlsx,.xls,.ods"
            className="hidden"
            onChange={onFileChange}
            data-testid="acq-file-input"
          />
        </div>
      )}

      {/* Parse error */}
      {parseError && (
        <div className="rounded-lg border border-red-500/30 bg-red-900/10 p-3 flex gap-2.5">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-red-300">Could not read file</p>
            <p className="text-xs text-gray-400 mt-0.5">{parseError}</p>
          </div>
          <Button size="icon" variant="ghost" onClick={reset} data-testid="acq-reset-error">
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* Parsed, ready to evaluate */}
      {parsed && !result && (
        <div className="rounded-xl border border-violet-500/30 bg-violet-900/10 p-4 flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-violet-900/50 p-2 ring-1 ring-violet-500/30 shrink-0">
              <FileUp className="w-5 h-5 text-violet-300" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">{fileName}</p>
              <p className="text-xs text-violet-300 mt-0.5">
                {parsed.items.length.toLocaleString()} lots &nbsp;·&nbsp; {parsed.items.reduce((a, b) => a + b.quantity, 0).toLocaleString()} pieces
                {parsed.rawRows > parsed.items.length && (
                  <span className="text-amber-400 ml-1">
                    &nbsp;·&nbsp; consolidated from {parsed.rawRows.toLocaleString()} rows
                  </span>
                )}
              </p>
            </div>
            <Button size="icon" variant="ghost" onClick={reset} data-testid="acq-reset-file">
              <X className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => evaluateMutation.mutate(parsed.items)}
              disabled={evaluateMutation.isPending}
              className="flex-1"
              data-testid="acq-run-btn"
            >
              {evaluateMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing…</>
              ) : (
                <><Package className="w-4 h-4 mr-2" /> Run Acquisition Analysis</>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Results */}
      {result && s && (
        <div className="flex flex-col gap-4">
          {/* Header / reset */}
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-semibold text-white">Analysis Complete</span>
              <span className="text-xs text-gray-500 ml-2 truncate">{fileName}</span>
            </div>
            <Button size="icon" variant="ghost" onClick={reset} data-testid="acq-reset-result">
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-2">
            <SummaryCard
              label="Seller's Inventory"
              value={s.totalSellerLots.toLocaleString()}
              sub={`${s.totalSellerQty.toLocaleString()} pcs · ${fmt$(s.totalSellerValue)} asking`}
              color="border-gray-700/60 bg-gray-900/40"
            />
            <SummaryCard
              label="Already in Your Stock"
              value={s.commonLots.toLocaleString()}
              sub={`${s.commonSellerQty.toLocaleString()} pcs · ${Math.round((s.commonLots / (s.totalSellerLots || 1)) * 100)}% overlap`}
              color="border-amber-700/40 bg-amber-900/10"
            />
            <SummaryCard
              label="New Lots You'd Add"
              value={s.newLots.toLocaleString()}
              sub={`${s.newSellerQty.toLocaleString()} pcs · ${fmt$(s.newSellerValue)} seller asking`}
              color="border-green-700/40 bg-green-900/10"
            />
            <SummaryCard
              label="Est. Market Value (New Lots)"
              value={fmt$(s.newEstMarketValue)}
              sub={s.newEstMarketValue != null && s.newSellerValue != null
                ? (s.newEstMarketValue > s.newSellerValue
                  ? `▲ $${(s.newEstMarketValue - s.newSellerValue).toFixed(2)} above seller's ask`
                  : `▼ $${(s.newSellerValue - s.newEstMarketValue).toFixed(2)} below seller's ask`)
                : "Based on BL market data"}
              color="border-violet-700/40 bg-violet-900/10"
            />
          </div>

          {/* Section tabs */}
          <div className="flex gap-1.5 border-b border-gray-700/50 pb-0">
            <button
              onClick={() => setSection('common')}
              data-testid="acq-tab-common"
              className={cn(
                "text-xs font-semibold px-3 py-1.5 border-b-2 -mb-px transition-colors",
                section === 'common'
                  ? "text-amber-300 border-amber-400"
                  : "text-gray-500 border-transparent hover:text-gray-300"
              )}
            >
              <Layers className="w-3 h-3 inline mr-1" />
              Common ({s.commonLots})
            </button>
            <button
              onClick={() => setSection('new')}
              data-testid="acq-tab-new"
              className={cn(
                "text-xs font-semibold px-3 py-1.5 border-b-2 -mb-px transition-colors",
                section === 'new'
                  ? "text-green-300 border-green-400"
                  : "text-gray-500 border-transparent hover:text-gray-300"
              )}
            >
              <Package className="w-3 h-3 inline mr-1" />
              New Additions ({s.newLots})
            </button>
          </div>

          {/* Item table */}
          {section === 'common' && (
            result.common.length > 0
              ? <ItemsTable items={result.common} type="common" />
              : <p className="text-xs text-gray-500 text-center py-4">No overlapping inventory found.</p>
          )}
          {section === 'new' && (
            result.newItems.length > 0
              ? <ItemsTable items={result.newItems} type="new" />
              : <p className="text-xs text-gray-500 text-center py-4">All seller lots already exist in your inventory.</p>
          )}
        </div>
      )}
    </div>
  );
}
