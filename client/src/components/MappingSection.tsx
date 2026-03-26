import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Package, Link2 } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface StatusMapping {
  normalizedStatus: string;
  displayName: string;
  brickLink?: string[];
  brickOwl?: number[];
  ebay?: string[];
  amazon?: string[];
  inventoryImpact: "reduce" | "restore" | "none";
  description: string;
}

interface SkuLink {
  blInvId: number;
  orgId: string;
  channel: string;
  channelLotId: string;
  syncedAt: string;
  itemNo: string | null;
  itemType: string | null;
  colorId: number | null;
  description: string | null;
}

// ── BO status label lookup ─────────────────────────────────────────────────────

const BO_STATUS_LABELS: Record<number, string> = {
  0: "Pending",
  1: "Payment Submitted",
  2: "Payment Received",
  3: "Processing",
  4: "Processed",
  5: "Shipped",
  6: "Received",
  7: "On Hold",
  8: "Cancelled",
};

// ── Status badge styling ───────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  awaiting_payment:   "bg-gray-700 text-gray-300",
  awaiting_shipment:  "bg-blue-900/60 text-blue-300",
  shipped:            "bg-green-900/60 text-green-300",
  delivered:          "bg-emerald-900/60 text-emerald-300",
  cancelled:          "bg-red-900/60 text-red-300",
  on_hold:            "bg-amber-900/60 text-amber-300",
  returned:           "bg-purple-900/60 text-purple-300",
};

const IMPACT_COLORS: Record<string, string> = {
  reduce:  "text-red-400",
  restore: "text-green-400",
  none:    "text-gray-500",
};

const IMPACT_LABELS: Record<string, string> = {
  reduce:  "Deduct",
  restore: "Restore",
  none:    "None",
};

// ── Status tab ────────────────────────────────────────────────────────────────

function StatusTab() {
  const { data: mappings, isLoading } = useQuery<Record<string, StatusMapping>>({
    queryKey: ["/api/admin/mappings/status"],
  });

  if (isLoading) {
    return (
      <div className="p-4 space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-12 rounded-md bg-gray-800 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!mappings) return null;

  const entries = Object.entries(mappings);

  return (
    <div className="p-4 space-y-4">
      <p className="text-xs text-gray-400 leading-relaxed">
        These mappings define how each channel's native order statuses translate to
        ELFIE's internal statuses, and what happens to inventory at each transition.
        This is read-only — changes require a code deployment.
      </p>

      {/* Header row */}
      <div className="sm-card overflow-hidden">
        <div className="grid grid-cols-[180px_1fr_1fr_90px] gap-0 border-b border-gray-700 bg-gray-800/60 px-4 py-2">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Internal Status</span>
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">BrickLink</span>
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">BrickOwl</span>
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide text-right">Inventory</span>
        </div>

        {entries.map(([key, m], idx) => (
          <div
            key={key}
            className={`grid grid-cols-[180px_1fr_1fr_90px] gap-0 px-4 py-3 ${
              idx < entries.length - 1 ? "border-b border-gray-700/60" : ""
            }`}
          >
            {/* Internal status */}
            <div className="flex flex-col gap-1">
              <span className={`inline-flex items-center self-start rounded px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_COLORS[key] ?? "bg-gray-700 text-gray-300"}`}>
                {m.displayName}
              </span>
              <span className="text-[10px] text-gray-500 leading-tight">{m.description}</span>
            </div>

            {/* BrickLink statuses */}
            <div className="flex flex-wrap gap-1 pt-0.5 pr-2">
              {m.brickLink && m.brickLink.length > 0 ? (
                m.brickLink.map(s => (
                  <span key={s} className="rounded bg-gray-700/80 px-1.5 py-0.5 text-[10px] font-mono text-gray-300">
                    {s}
                  </span>
                ))
              ) : (
                <span className="text-[10px] text-gray-600">—</span>
              )}
            </div>

            {/* BrickOwl statuses */}
            <div className="flex flex-col gap-0.5 pt-0.5 pr-2">
              {m.brickOwl && m.brickOwl.length > 0 ? (
                m.brickOwl.map(id => (
                  <span key={id} className="text-[10px] text-gray-300">
                    <span className="font-mono text-gray-500 mr-1">{id}</span>
                    {BO_STATUS_LABELS[id] ?? "Unknown"}
                  </span>
                ))
              ) : (
                <span className="text-[10px] text-gray-600">—</span>
              )}
            </div>

            {/* Inventory impact */}
            <div className="text-right pt-0.5">
              <span className={`text-xs font-semibold ${IMPACT_COLORS[m.inventoryImpact]}`}>
                {IMPACT_LABELS[m.inventoryImpact]}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 px-1">
        {(["reduce", "restore", "none"] as const).map(impact => (
          <div key={impact} className="flex items-center gap-1.5">
            <span className={`text-xs font-semibold ${IMPACT_COLORS[impact]}`}>{IMPACT_LABELS[impact]}</span>
            <span className="text-xs text-gray-500">
              {impact === "reduce" ? "— inventory decremented when order reaches this status" :
               impact === "restore" ? "— inventory restored if previously deducted" :
               "— no inventory change"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── SKU Links tab ─────────────────────────────────────────────────────────────

const CHANNEL_LABELS: Record<string, string> = {
  brickowl: "BrickOwl",
  amazon:   "Amazon",
  ebay:     "eBay",
};

function SkuLinksTab() {
  const [search, setSearch] = useState("");

  const { data: links, isLoading } = useQuery<SkuLink[]>({
    queryKey: ["/api/admin/mappings/sku-links"],
  });

  if (isLoading) {
    return (
      <div className="p-4 space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-10 rounded-md bg-gray-800 animate-pulse" />
        ))}
      </div>
    );
  }

  const filtered = (links ?? []).filter(l => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      String(l.blInvId).includes(q) ||
      (l.itemNo?.toLowerCase().includes(q) ?? false) ||
      l.channelLotId.toLowerCase().includes(q) ||
      l.channel.toLowerCase().includes(q) ||
      (l.description?.toLowerCase().includes(q) ?? false)
    );
  });

  // Group by channel for display
  const channels = Array.from(new Set(filtered.map(l => l.channel))).sort();

  return (
    <div className="p-4 space-y-4">
      <p className="text-xs text-gray-400 leading-relaxed">
        Cross-channel lot ID mappings — links your BrickLink inventory IDs to
        corresponding lot IDs on other platforms. Built automatically during
        inventory sync.
      </p>

      {/* Search */}
      <div className="relative">
        <input
          type="text"
          placeholder="Search by BL ID, item number, channel lot ID…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded-md bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-gray-500"
          data-testid="input-sku-link-search"
        />
      </div>

      {(links ?? []).length === 0 ? (
        <div className="sm-card px-4 py-8 text-center">
          <Link2 className="h-8 w-8 text-gray-600 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No channel lot links found.</p>
          <p className="text-xs text-gray-500 mt-1">
            Links are created automatically when inventory is synced to a channel.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="sm-card px-4 py-6 text-center">
          <p className="text-sm text-gray-400">No results for "{search}"</p>
        </div>
      ) : (
        channels.map(channel => {
          const channelLinks = filtered.filter(l => l.channel === channel);
          return (
            <div key={channel} className="space-y-1">
              <p className="sm-group-label px-1">{CHANNEL_LABELS[channel] ?? channel}</p>
              <div className="sm-card overflow-hidden">
                <div className="grid grid-cols-[100px_120px_1fr_1fr] gap-0 border-b border-gray-700 bg-gray-800/60 px-4 py-2">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">BL Inv ID</span>
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Item No</span>
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Description</span>
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{CHANNEL_LABELS[channel] ?? channel} Lot ID</span>
                </div>
                {channelLinks.map((link, idx) => (
                  <div
                    key={`${link.blInvId}-${link.channel}`}
                    className={`grid grid-cols-[100px_120px_1fr_1fr] gap-0 px-4 py-2.5 items-center ${
                      idx < channelLinks.length - 1 ? "border-b border-gray-700/50" : ""
                    }`}
                  >
                    <span className="text-xs font-mono text-gray-300" data-testid={`text-bl-inv-id-${link.blInvId}`}>
                      {link.blInvId}
                    </span>
                    <span className="text-xs font-mono text-gray-300">
                      {link.itemNo ?? <span className="text-gray-600">—</span>}
                    </span>
                    <span className="text-xs text-gray-400 truncate pr-2">
                      {link.description || <span className="text-gray-600">—</span>}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Package className="h-3 w-3 text-gray-600 shrink-0" />
                      <span className="text-xs font-mono text-gray-300" data-testid={`text-channel-lot-id-${link.blInvId}`}>
                        {link.channelLotId}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}

      {filtered.length > 0 && (
        <p className="text-xs text-gray-500 px-1">
          {filtered.length} link{filtered.length !== 1 ? "s" : ""}{search ? " matching" : ""}
          {channels.length > 1 ? ` across ${channels.length} channels` : ""}
        </p>
      )}
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────────

type MappingTab = "status" | "skus";

const TABS: { id: MappingTab; label: string }[] = [
  { id: "status", label: "Order Statuses" },
  { id: "skus",   label: "SKUs" },
];

export function MappingSection() {
  const [activeTab, setActiveTab] = useState<MappingTab>("status");

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="tool-tab-bar px-4">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`tool-tab ${activeTab === tab.id ? "border-violet-500 text-violet-300" : "tool-tab-off"}`}
            data-testid={`button-mapping-tab-${tab.id}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "status" && <StatusTab />}
        {activeTab === "skus"   && <SkuLinksTab />}
      </div>
    </div>
  );
}
