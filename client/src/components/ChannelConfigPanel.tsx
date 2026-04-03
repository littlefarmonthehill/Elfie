import { ChevronDown, BarChart2, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";

export type StockroomMode = 'skip' | 'hidden' | 'active';
export type ChannelSyncMode = 'analysis' | 'full_control' | 'matched_sync';

export interface ChannelConfigValues {
  syncMode: ChannelSyncMode;
  syncPrice: boolean;
  syncRemarks: boolean;
  syncDescription: boolean;
  syncTierPrice: boolean;
  syncSalePercent: boolean;
  syncBulkQty: boolean;
  syncLotWeight: boolean;
  syncStockroomModes: Record<string, StockroomMode>;
  syncItemTypes: Record<string, boolean>;
  syncPriceFloor: string;
}

export const defaultChannelConfigValues = (channelKey: string): ChannelConfigValues => ({
  syncMode:          'analysis',
  syncPrice:         true,
  syncRemarks:       true,
  syncDescription:   true,
  syncTierPrice:     true,
  syncSalePercent:   false,
  syncBulkQty:       true,
  syncLotWeight:     true,
  syncStockroomModes: { A: 'skip', B: 'skip', C: 'skip' },
  syncItemTypes:      {},
  syncPriceFloor:     '',
});

/** Channel-specific labels/descriptions for the shared fields. */
export interface ChannelFieldMeta {
  remarkDesc:       string;
  descriptionDesc:  string;
  tierPriceDesc:    string;
  salePercentDesc:  string;
  bulkQtyDesc:      string;
  lotWeightDesc:    string;
  /** Whether this channel has BrickLink-style stockrooms (A/B/C). */
  hasStockrooms:    boolean;
  /** Label shown for the API key input. */
  apiKeyLabel:      string;
  /** Help text shown below the API key input. */
  apiKeyHelp:       string;
}

export const CHANNEL_FIELD_META: Record<string, ChannelFieldMeta> = {
  brickowl: {
    remarkDesc:      'Internal notes (BrickLink Remarks → BrickOwl personal note)',
    descriptionDesc: 'Public description (BrickLink Description → BrickOwl public note)',
    tierPriceDesc:   'Bulk discount tiers from BrickLink',
    salePercentDesc: 'BrickLink sale rate → BrickOwl sale %. Disable if you manage BrickOwl sales separately.',
    bulkQtyDesc:     'Minimum order quantity (BrickLink Bulk → BrickOwl bulk_qty)',
    lotWeightDesc:   'Custom weight per lot (BrickLink My Weight → BrickOwl lot_weight)',
    hasStockrooms:   true,
    apiKeyLabel:     'BrickOwl API Key',
    apiKeyHelp:      'Found under My Account → Settings → API on BrickOwl.',
  },
  ebay: {
    remarkDesc:      'Internal notes are not synced to eBay (eBay has no seller-only note field)',
    descriptionDesc: 'Public listing description — synced from BrickLink description to eBay listing body',
    tierPriceDesc:   'Tier pricing is not supported on eBay fixed-price listings',
    salePercentDesc: 'Sale discounts are managed on eBay directly via promotions — not synced from BrickLink',
    bulkQtyDesc:     'Minimum order quantity (BrickLink Bulk → eBay listing minimum). Leave off for individual part sales.',
    lotWeightDesc:   'Custom lot weight is not directly mapped to eBay — use BrickLink weight for shipping estimates only',
    hasStockrooms:   false,
    apiKeyLabel:     'eBay Connection',
    apiKeyHelp:      'Configure in Settings → Platform Connections → eBay.',
  },
};

/** eBay-specific channel configuration (stored in channelConfig JSONB). */
export interface EbayChannelConfig {
  ebayBlIdField:          'custom_label' | 'item_specifics';
  ebayCatalogMatch:       boolean;
  ebayListingDuration:    string;
  syncImages:             boolean;
  syncDescription:        boolean;
  ebayMarketplaceId:      string;
  ebayConditionUsed:      string;
  ebayPriceUpliftPercent: number;
  priceSyncMode:          'always' | 'initial_only';
}

export const defaultEbayChannelConfig: EbayChannelConfig = {
  ebayBlIdField:          'custom_label',
  ebayCatalogMatch:       true,
  ebayListingDuration:    'GTC',
  syncImages:             true,
  syncDescription:        true,
  ebayMarketplaceId:      'EBAY_US',
  ebayConditionUsed:      'USED_VERY_GOOD',
  ebayPriceUpliftPercent: 0,
  priceSyncMode:          'always',
};

interface AnalysisResult {
  matchedLots: number;
  unmatchedLots: number;
  wouldUpdate: number;
  wouldCreate: number;
  byField: Record<string, number>;
}

interface ChannelConfigPanelProps {
  channelKey: string;
  displayName: string;
  /** API key value — managed by parent */
  apiKey: string;
  onApiKeyChange: (v: string) => void;
  /** All sync field values — managed by parent */
  values: ChannelConfigValues;
  onChange: (next: ChannelConfigValues) => void;
  /** Whether the advanced section is expanded. */
  advancedOpen: boolean;
  onAdvancedToggle: () => void;
  /** Optional analysis mutation from parent. */
  analysisPending?: boolean;
  onRunAnalysis?: () => void;
  analysisResult?: AnalysisResult | null;
  /** Override field metadata — falls back to CHANNEL_FIELD_META[channelKey]. */
  fieldMeta?: Partial<ChannelFieldMeta>;
}

export function ChannelConfigPanel({
  channelKey,
  displayName,
  apiKey,
  onApiKeyChange,
  values,
  onChange,
  advancedOpen,
  onAdvancedToggle,
  analysisPending,
  onRunAnalysis,
  analysisResult,
  fieldMeta: fieldMetaOverride,
}: ChannelConfigPanelProps) {
  const meta: ChannelFieldMeta = {
    ...(CHANNEL_FIELD_META[channelKey] ?? CHANNEL_FIELD_META['brickowl']),
    ...fieldMetaOverride,
  };

  const set = <K extends keyof ChannelConfigValues>(key: K, val: ChannelConfigValues[K]) =>
    onChange({ ...values, [key]: val });

  const syncModeOptions: { value: ChannelSyncMode; label: string; sub: string; body: string; testId: string }[] = [
    {
      value: 'analysis',
      label: 'Analysis Only',
      sub: 'Read-only — compare channels, no edits made',
      body: `Safe starting point. I compare both stores and report differences without touching anything. Upgrade to an active mode whenever you're ready.`,
      testId: `button-channel-${channelKey}-mode-analysis`,
    },
    {
      value: 'full_control',
      label: 'Full Control',
      sub: `Create new lots + sync all fields on existing matched lots`,
      body: `I'll create ${displayName} listings for any BrickLink item that doesn't exist there yet, and keep all matched lots fully in sync. Best for stores you don't manage manually.`,
      testId: `button-channel-${channelKey}-mode-full`,
    },
    {
      value: 'matched_sync',
      label: 'Matched Sync',
      sub: 'Sync all fields on matched lots only — never create new ones',
      body: `Syncs every matched lot but skips anything without a match. Best for stores where you prefer to create new listings manually.`,
      testId: `button-channel-${channelKey}-mode-matched`,
    },
  ];

  const fieldRows: { key: keyof ChannelConfigValues; label: string; desc: string }[] = [
    { key: 'syncRemarks',     label: 'Remarks',           desc: meta.remarkDesc },
    { key: 'syncDescription', label: 'Description',       desc: meta.descriptionDesc },
    { key: 'syncTierPrice',   label: 'Tier Pricing',      desc: meta.tierPriceDesc },
    { key: 'syncSalePercent', label: 'Sale %',            desc: meta.salePercentDesc },
    { key: 'syncBulkQty',     label: 'Min. Quantity',     desc: meta.bulkQtyDesc },
    { key: 'syncLotWeight',   label: 'Custom Lot Weight', desc: meta.lotWeightDesc },
  ];

  return (
    <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4 space-y-4">
      <p className="text-xs font-semibold text-blue-300">{displayName} configuration</p>

      {/* API Key */}
      <div className="space-y-1.5">
        <label htmlFor={`channel-${channelKey}-apikey`} className="text-xs text-gray-400">{meta.apiKeyLabel}</label>
        <input
          id={`channel-${channelKey}-apikey`}
          type="password"
          value={apiKey}
          onChange={(e) => onApiKeyChange(e.target.value)}
          placeholder={`Paste your ${displayName} API key…`}
          data-testid={`input-channel-${channelKey}-apikey`}
          className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/60"
        />
        <p className="text-[10px] text-gray-600">{meta.apiKeyHelp}</p>
      </div>

      {apiKey.trim() && (
        <>
          {/* Sync mode */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-300">How should I manage your {displayName} store?</p>
            <div className="grid grid-cols-1 gap-1.5">
              {syncModeOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => set('syncMode', opt.value)}
                  className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                    values.syncMode === opt.value
                      ? 'border-blue-500/60 bg-blue-500/10'
                      : 'border-gray-700 bg-gray-800/40 hover:border-gray-600'
                  }`}
                  data-testid={opt.testId}
                >
                  <div className={`mt-0.5 w-3.5 h-3.5 rounded-full border-2 shrink-0 ${values.syncMode === opt.value ? 'border-blue-400 bg-blue-400' : 'border-gray-500'}`} />
                  <div>
                    <span className="text-sm font-semibold text-gray-200">{opt.label}</span>
                    <p className="text-xs text-gray-500 mt-0.5">{opt.sub}</p>
                    <p className="text-[10px] text-gray-600 mt-1 leading-relaxed">{opt.body}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Advanced — collapsible */}
          <div>
            <button
              type="button"
              onClick={onAdvancedToggle}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors py-1"
              data-testid={`button-channel-${channelKey}-advanced-toggle`}
            >
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
              Advanced: field sync options
            </button>

            {advancedOpen && (
              <div className="mt-2 rounded-lg border border-gray-700/60 bg-gray-800/30 divide-y divide-gray-700/40 overflow-hidden">
                {/* Quantity — always on */}
                <div className="flex items-center justify-between gap-3 px-3 py-2.5 opacity-50">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-200">Quantity</p>
                    <p className="text-[10px] text-gray-500 mt-0.5 leading-tight">Always synced — cannot be disabled</p>
                  </div>
                  <Switch checked disabled />
                </div>

                {/* Base Price */}
                <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-200">Base Price</p>
                    <p className="text-[10px] text-gray-500 mt-0.5 leading-tight">
                      Syncs the listing price from BrickLink to existing lots. Always included when creating new items in Full Control.
                    </p>
                  </div>
                  <Switch
                    checked={values.syncPrice}
                    onCheckedChange={(v) => set('syncPrice', v)}
                    data-testid={`switch-channel-${channelKey}-price`}
                  />
                </div>

                {/* Other field rows */}
                {fieldRows.map(({ key, label, desc }) => (
                  <div key={key} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-200">{label}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5 leading-tight">{desc}</p>
                    </div>
                    <Switch
                      checked={values[key] as boolean}
                      onCheckedChange={(v) => set(key, v)}
                      data-testid={`switch-channel-${channelKey}-${key}`}
                    />
                  </div>
                ))}

                {/* Item Groups */}
                <div className="px-3 pt-3 pb-1 border-t border-gray-700/40">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Item Groups</p>
                  <p className="text-[10px] text-gray-600 mt-0.5 leading-tight">
                    Choose which BrickLink item types are synced to {displayName}.
                  </p>
                </div>
                {([
                  { code: 'P', label: 'Parts' },
                  { code: 'M', label: 'Minifigs' },
                  { code: 'S', label: 'Sets' },
                  { code: 'G', label: 'Gear' },
                ] as const).map(({ code, label }) => {
                  const enabled = values.syncItemTypes[code] !== false;
                  return (
                    <div key={code} className="flex items-center justify-between gap-3 px-3 py-2">
                      <p className="text-xs font-medium text-gray-200">{label}</p>
                      <Switch
                        checked={enabled}
                        onCheckedChange={(v) => set('syncItemTypes', { ...values.syncItemTypes, [code]: v })}
                        data-testid={`switch-channel-${channelKey}-itemtype-${code}`}
                      />
                    </div>
                  );
                })}

                {/* Stockrooms — optional per channel */}
                {meta.hasStockrooms && (
                  <>
                    <div className="px-3 pt-3 pb-1 border-t border-gray-700/40">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">BrickLink Stockrooms</p>
                      <p className="text-[10px] text-gray-600 mt-0.5 leading-tight">
                        Choose how each stockroom is handled on {displayName}.
                      </p>
                    </div>
                    {(['A', 'B', 'C'] as const).map((id) => {
                      const mode = values.syncStockroomModes[id] ?? 'skip';
                      return (
                        <div key={id} className="px-3 py-2 space-y-1.5">
                          <p className="text-xs font-medium text-gray-200">Stockroom {id}</p>
                          <div className="flex gap-1">
                            {([
                              { value: 'skip'   as const, label: 'Skip',   desc: 'Ignore entirely' },
                              { value: 'hidden' as const, label: 'Hidden', desc: 'Sync, not for sale' },
                              { value: 'active' as const, label: 'Active', desc: 'Sync as live listing' },
                            ]).map((opt) => (
                              <button
                                key={opt.value}
                                type="button"
                                onClick={() => set('syncStockroomModes', { ...values.syncStockroomModes, [id]: opt.value })}
                                title={opt.desc}
                                data-testid={`button-channel-${channelKey}-stockroom-${id}-${opt.value}`}
                                className={`flex-1 rounded px-2 py-1 text-[10px] font-medium transition-colors ${
                                  mode === opt.value
                                    ? 'bg-blue-500/20 border border-blue-500/50 text-blue-300'
                                    : 'bg-gray-800 border border-gray-700 text-gray-500 hover:border-gray-600 hover:text-gray-400'
                                }`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                          <p className="text-[10px] text-gray-600 leading-tight">
                            {mode === 'skip'   && 'Lots in this stockroom are ignored — no changes made on ' + displayName + '.'}
                            {mode === 'hidden' && 'Lots are synced but marked not-for-sale on ' + displayName + '.'}
                            {mode === 'active' && 'Lots are synced as live, purchasable listings on ' + displayName + '.'}
                          </p>
                        </div>
                      );
                    })}
                  </>
                )}

                {/* Price Floor */}
                <div className="px-3 pt-3 pb-3 border-t border-gray-700/40 space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Price Floor</p>
                  <p className="text-[10px] text-gray-600 leading-tight">
                    Lots priced below this amount are skipped and any existing {displayName} listing is deactivated. Leave blank to sync everything.
                  </p>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-500">$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={values.syncPriceFloor}
                      onChange={(e) => set('syncPriceFloor', e.target.value)}
                      placeholder="0.00"
                      data-testid={`input-channel-${channelKey}-price-floor`}
                      className="w-full bg-gray-800 border border-gray-700 rounded-md pl-6 pr-3 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500/60"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Run Analysis — only shown when parent provides the handler */}
          {onRunAnalysis && (
            <div className="space-y-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={analysisPending}
                onClick={onRunAnalysis}
                className="text-blue-400 border border-blue-500/30 bg-blue-500/5"
                data-testid={`button-channel-${channelKey}-run-analysis`}
              >
                {analysisPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                ) : (
                  <BarChart2 className="w-3.5 h-3.5 mr-1.5" />
                )}
                {analysisPending ? 'Scanning both stores…' : 'Run Analysis'}
              </Button>
              {analysisPending && (
                <p className="text-[10px] text-gray-600">
                  This reads your BrickLink and {displayName} inventories — may take 30–60 s for large stores.
                </p>
              )}
            </div>
          )}

          {/* Analysis result */}
          {analysisResult && (
            <div className="rounded-lg border border-gray-700/60 bg-gray-800/30 p-3 space-y-3">
              <div className="flex items-center gap-1.5">
                <BarChart2 className="w-3.5 h-3.5 text-blue-400" />
                <p className="text-xs font-semibold text-gray-200">Analysis Results</p>
                <span className="ml-auto text-[10px] text-gray-600">read-only scan</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Matched lots',      value: analysisResult.matchedLots },
                  { label: 'Unmatched (BL only)', value: analysisResult.unmatchedLots },
                  { label: 'Would update',      value: analysisResult.wouldUpdate },
                  { label: 'Would create',      value: analysisResult.wouldCreate },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-gray-800/50 rounded-md p-2">
                    <p className="text-[10px] text-gray-500">{label}</p>
                    <p className="text-sm font-semibold text-gray-200">{value.toLocaleString()}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
