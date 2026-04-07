/**
 * EasyPost Shipping Vendor Implementation
 * 
 * Implements the IShippingVendor interface using EasyPost's API.
 * Documentation: https://docs.easypost.com/
 */

import {
  IShippingVendor,
  Address,
  Parcel,
  ShippingRate,
  ShipmentLabel,
  CreateShipmentRequest,
  BuyLabelRequest,
  CustomsInfo,
  TaxIdentifier,
} from './shipping-vendor';
import { normalizeAddress } from './address-normalizer';

const EASYPOST_API_URL = 'https://api.easypost.com/v2';

// ---------------------------------------------------------------------------
// Rate limiter — EasyPost test mode is very restrictive.
// Allow max 4 calls per 2s window; queue excess calls rather than dropping.
// ---------------------------------------------------------------------------
const RATE_WINDOW_MS = 2000;
const RATE_MAX_CALLS = 4;
const callTimestamps: number[] = [];

async function waitForRateSlot(): Promise<void> {
  return new Promise(resolve => {
    const attempt = () => {
      const now = Date.now();
      // Remove timestamps outside the window
      while (callTimestamps.length && callTimestamps[0] < now - RATE_WINDOW_MS) {
        callTimestamps.shift();
      }
      if (callTimestamps.length < RATE_MAX_CALLS) {
        callTimestamps.push(now);
        resolve();
      } else {
        // Wait until the oldest call in window expires
        const waitMs = (callTimestamps[0] + RATE_WINDOW_MS) - now + 10;
        setTimeout(attempt, waitMs);
      }
    };
    attempt();
  });
}

// ---------------------------------------------------------------------------
// Shipment-creation concurrency gate.
// EasyPost rate-limits by account; serializing POST /shipments prevents a
// burst of concurrent calls from triggering 429s and compounding retries.
// ---------------------------------------------------------------------------
let _shipmentQueueTail: Promise<void> = Promise.resolve();

function enqueueShipment<T>(fn: () => Promise<T>): Promise<T> {
  const result = _shipmentQueueTail.then(() => fn());
  // The gate advances regardless of whether fn succeeds or fails.
  _shipmentQueueTail = result.then(() => {}, () => {});
  return result;
}

// ---------------------------------------------------------------------------
// Address validation cache — same address shouldn't hit EasyPost twice in 1h
// ---------------------------------------------------------------------------
const ADDRESS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const addressCache = new Map<string, { result: any; expiresAt: number }>();

function addressCacheKey(address: any): string {
  return JSON.stringify([
    (address.street1 || '').toLowerCase().trim(),
    (address.street2 || '').toLowerCase().trim(),
    (address.city || '').toLowerCase().trim(),
    (address.state || '').toLowerCase().trim(),
    (address.zip || '').toLowerCase().trim(),
    (address.country || '').toLowerCase().trim(),
  ]);
}

export class EasyPostShippingVendor implements IShippingVendor {
  private apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('EasyPost API key is required');
    }
    this.apiKey = apiKey;
  }

  private async request(endpoint: string, method: string = 'GET', body?: any, retries = 3): Promise<any> {
    await waitForRateSlot();

    const auth = Buffer.from(`${this.apiKey}:`).toString('base64');
    
    const options: RequestInit = {
      method,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${EASYPOST_API_URL}${endpoint}`, options);

    // Retry with exponential backoff on rate-limit (429) or server error (5xx).
    // On 429, respect the Retry-After header if present; otherwise use a much
    // longer base backoff (15s/30s/60s) to avoid compounding rate limits.
    if ((response.status === 429 || response.status >= 500) && retries > 0) {
      let backoffMs: number;
      if (response.status === 429) {
        const retryAfterSec = parseFloat(response.headers.get('Retry-After') ?? '0');
        backoffMs = retryAfterSec > 0
          ? retryAfterSec * 1000 + 500          // honour server hint + small buffer
          : Math.pow(2, 4 - retries) * 15000;   // 15s, 30s, 60s
      } else {
        backoffMs = Math.pow(2, 4 - retries) * 1000; // 1s, 2s, 4s for 5xx
      }
      console.warn(`⚠️ EasyPost ${response.status} on ${endpoint} — retrying in ${backoffMs}ms (${retries} left)`);
      await new Promise(r => setTimeout(r, backoffMs));
      return this.request(endpoint, method, body, retries - 1);
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
      throw new Error(`EasyPost API error: ${error.error?.message || response.statusText}`);
    }

    return await response.json();
  }

  async createShipment(request: CreateShipmentRequest): Promise<{
    shipmentId: string;
    rates: ShippingRate[];
    metadata: any;
  }> {
    // Serialise through the concurrency gate — prevents simultaneous POST
    // /shipments calls from triggering EasyPost account-level rate limits.
    return enqueueShipment(async () => this._createShipmentImpl(request));
  }

  private async _createShipmentImpl(request: CreateShipmentRequest): Promise<{
    shipmentId: string;
    rates: ShippingRate[];
    metadata: any;
  }> {
    // Normalize destination address to carrier-safe ASCII before submission.
    // Originals are preserved in the DB / UI; only the normalized copy goes to EasyPost.
    const { normalized: toNorm, changes: addrChanges, warnings: addrWarnings } = await normalizeAddress(request.toAddress);

    // Log a structured diff whenever the address was actually modified so operators
    // can see exactly what was sent to EasyPost versus what the buyer entered.
    if (addrChanges.length > 0 || addrWarnings.length > 0) {
      const lines: string[] = [`[AddrNorm] Address auto-normalized for carrier submission (ref: ${request.reference || 'n/a'}):`];
      for (const c of addrChanges) {
        const pad = ' '.repeat(Math.max(0, 8 - c.field.length));
        lines.push(`  ${c.field}:${pad} "${c.original}"  →  "${c.normalized}"`);
      }
      for (const w of addrWarnings) {
        lines.push(`  ⚠️  ${w}`);
      }
      console.log(lines.join('\n'));
    }

    const payload = {
      shipment: {
        to_address: {
          name:    toNorm.name,
          company: toNorm.company,
          street1: toNorm.street1,
          street2: toNorm.street2,
          city:    toNorm.city,
          state:   toNorm.state,
          zip:     toNorm.zip,
          country: toNorm.country,
          phone:   toNorm.phone,
          email:   toNorm.email,
        },
        from_address: (() => {
          const isIntl = (toNorm.country || 'US').toUpperCase() !== 'US';
          const fromCountry = (request.fromAddress.country || 'US').toUpperCase();
          // USPS IMM §122.3: return address on international mail must include origin country.
          // EasyPost/USPS label templates suppress the country field from the visual FROM block
          // for US-origin shipments. Injecting it into street2 (when otherwise blank) is the
          // standard workaround to make "United States" appear as a printed address line.
          const street2Override =
            isIntl && !request.fromAddress.street2
              ? (fromCountry === 'US' ? 'United States' : request.fromAddress.country)
              : request.fromAddress.street2;
          return {
            name: request.fromAddress.name,
            company: request.fromAddress.company,
            street1: request.fromAddress.street1,
            street2: street2Override,
            city: request.fromAddress.city,
            state: request.fromAddress.state,
            zip: request.fromAddress.zip,
            country: request.fromAddress.country,
            phone: request.fromAddress.phone,
            email: request.fromAddress.email,
          };
        })(),
        parcel: {
          length: request.parcel.length.toString(),
          width: request.parcel.width.toString(),
          height: request.parcel.height.toString(),
          weight: request.parcel.weight.toString(),
          ...(request.parcel.predefinedPackage
            ? { predefined_package: request.parcel.predefinedPackage }
            : {}),
        },
        options: {
          label_format: request.labelFormat || 'PDF',
          label_size: '4x6',
          // print_custom_1 is EasyPost's "Customer Reference" field — prints visibly on USPS labels
          ...(request.reference ? { print_custom_1: request.reference } : {}),
        },
        reference: request.reference,
        // Customs info for international shipments
        ...(request.customsInfo ? {
          customs_info: {
            eel_pfc: request.customsInfo.eelPfc,
            contents_type: request.customsInfo.contentsType,
            contents_explanation: request.customsInfo.contentsExplanation,
            customs_certify: request.customsInfo.customsCertify,
            customs_signer: request.customsInfo.customsSigner,
            non_delivery_option: request.customsInfo.nonDeliveryOption,
            restriction_type: request.customsInfo.restrictionType,
            customs_items: request.customsInfo.items.map(item => ({
              description: item.description,
              quantity: item.quantity,
              weight: item.weight,
              value: item.value,
              hs_tariff_number: item.hsTariffNumber,
              code: item.hsTariffNumber,
              origin_country: item.originCountry,
            })),
          },
        } : {}),
        // Tax identifiers (IOSS, UK VAT, etc.) for marketplace-collected taxes
        ...(request.taxIdentifiers && request.taxIdentifiers.length > 0 ? {
          tax_identifiers: request.taxIdentifiers.map(ti => ({
            issuing_country: ti.issuingCountry,
            tax_id_type: ti.taxIdType,
            tax_id: ti.taxId,
          })),
        } : {}),
      },
    };

    const response = await this.request('/shipments', 'POST', payload);

    console.log('📦 EasyPost raw response:', {
      shipmentId: response.id,
      ratesCount: response.rates?.length || 0,
      hasRates: !!response.rates,
      allServices: (response.rates || []).map((r: any) => `${r.carrier}/${r.service}=$${r.rate}`)
    });

    // Map EasyPost rates to our interface
    const rates: ShippingRate[] = (response.rates || []).map((rate: any) => ({
      id: rate.id,
      carrier: rate.carrier,
      service: rate.service,
      rate: parseFloat(rate.rate),
      deliveryDays: rate.delivery_days,
      deliveryDate: rate.delivery_date,
      deliveryDateGuaranteed: rate.delivery_date_guaranteed,
    }));

    console.log('📦 Transformed rates:', { count: rates.length, rates });

    return {
      shipmentId: response.id,
      rates,
      metadata: {
        ...response,
        // Expose normalization details so callers can surface them to the operator
        addressNormalization: { changes: addrChanges, warnings: addrWarnings },
      },
    };
  }

  async buyLabel(request: BuyLabelRequest): Promise<ShipmentLabel> {
    const payload: any = {
      rate: {
        id: request.rateId,
      },
      // Disable strict address verification in test mode to allow test addresses
      verify_strict: [],
    };

    if (request.insurance) {
      payload.insurance = request.insurance.toString();
    }

    const response = await this.request(`/shipments/${request.shipmentId}/buy`, 'POST', payload);

    return {
      shipmentId: response.id,
      trackingNumber: response.tracking_code,
      labelUrl: response.postage_label?.label_pdf_url || response.postage_label?.label_url,
      labelFormat: response.postage_label?.label_file_type || 'PDF',
      carrier: response.selected_rate?.carrier,
      service: response.selected_rate?.service,
      cost: parseFloat(response.selected_rate?.rate || '0'),
      currency: response.selected_rate?.currency || 'USD',
      metadata: response,
    };
  }

  async voidLabel(shipmentId: string): Promise<{
    success: boolean;
    refundAmount?: number;
    message?: string;
  }> {
    try {
      const response = await this.request(`/shipments/${shipmentId}/refund`, 'POST');
      
      return {
        success: response.refund_status === 'submitted' || response.refund_status === 'refunded',
        refundAmount: response.selected_rate?.rate ? parseFloat(response.selected_rate.rate) : undefined,
        message: response.refund_status,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async listServices(): Promise<Array<{
    carrier: string;
    service: string;
    description: string;
  }>> {
    // EasyPost doesn't have a direct endpoint for this
    // Return common services (this would be populated from actual shipment creation)
    return [
      { carrier: 'USPS', service: 'Priority', description: 'USPS Priority Mail' },
      { carrier: 'USPS', service: 'First', description: 'USPS First Class Mail' },
      { carrier: 'USPS', service: 'Express', description: 'USPS Priority Mail Express' },
      { carrier: 'UPS', service: 'Ground', description: 'UPS Ground' },
      { carrier: 'UPS', service: 'NextDayAir', description: 'UPS Next Day Air' },
      { carrier: 'FedEx', service: 'Ground', description: 'FedEx Ground' },
      { carrier: 'FedEx', service: 'Standard Overnight', description: 'FedEx Standard Overnight' },
    ];
  }

  async validateAddress(address: Address): Promise<{
    valid: boolean;
    suggested?: Address;
    errors?: string[];
  }> {
    // Check cache first — avoid redundant EasyPost calls for the same address
    const cacheKey = addressCacheKey(address);
    const cached = addressCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      console.log('📬 Address validation cache hit');
      return cached.result;
    }

    try {
      const payload = {
        address: {
          name: address.name,
          company: address.company,
          street1: address.street1,
          street2: address.street2,
          city: address.city,
          state: address.state,
          zip: address.zip,
          country: address.country,
        },
        verify_strict: ['delivery'],
      };

      const response = await this.request('/addresses', 'POST', payload);

      let result: { valid: boolean; suggested?: Address; errors?: string[] };
      if (response.verifications?.delivery?.success) {
        result = {
          valid: true,
          suggested: {
            name: response.name,
            company: response.company,
            street1: response.street1,
            street2: response.street2,
            city: response.city,
            state: response.state,
            zip: response.zip,
            country: response.country,
            phone: response.phone,
            email: response.email,
          },
        };
      } else {
        result = {
          valid: false,
          errors: response.verifications?.delivery?.errors?.map((e: any) => e.message) || ['Address verification failed'],
        };
      }

      // Cache the result (even failures, to avoid hammering for bad addresses)
      addressCache.set(cacheKey, { result, expiresAt: Date.now() + ADDRESS_CACHE_TTL_MS });
      return result;
    } catch (error: any) {
      return {
        valid: false,
        errors: [error.message],
      };
    }
  }
}

/**
 * Factory function to get the configured shipping vendor
 */
export async function getShippingVendor(apiKey?: string, orgId?: string): Promise<IShippingVendor> {
  // If no API key provided, try to get from settings
  if (!apiKey) {
    const { db } = await import('../db');
    const { appSettings } = await import('@shared/schema');
    const { eq } = await import('drizzle-orm');
    
    if (!orgId) throw new Error('[EasyPost] orgId is required to look up shipping credentials');
    const [settings] = await db.select().from(appSettings).where(eq(appSettings.orgId, orgId)).limit(1);
    
    // Use the selected key mode from settings (defaults to 'test' for safety)
    const keyMode = settings?.easypostKeyMode || 'test';
    apiKey = keyMode === 'test'
      ? (settings?.easypostTestApiKey || undefined)
      : (settings?.easypostApiKey || undefined);
    
    console.log('🔑 EasyPost key selection:', {
      keyMode,
      hasTestKey: !!settings?.easypostTestApiKey,
      hasProductionKey: !!settings?.easypostApiKey,
      selectedKey: apiKey ? `${apiKey.substring(0, 10)}...` : 'none'
    });
  }

  if (!apiKey) {
    throw new Error(`[EasyPost] EasyPost API key is not configured for org "${orgId}". Add it in Settings > API Credentials.`);
  }

  return new EasyPostShippingVendor(apiKey);
}
