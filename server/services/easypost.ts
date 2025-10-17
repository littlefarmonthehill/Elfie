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
} from './shipping-vendor';

const EASYPOST_API_URL = 'https://api.easypost.com/v2';

export class EasyPostShippingVendor implements IShippingVendor {
  private apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('EasyPost API key is required');
    }
    this.apiKey = apiKey;
  }

  private async request(endpoint: string, method: string = 'GET', body?: any): Promise<any> {
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
    const payload = {
      shipment: {
        to_address: {
          name: request.toAddress.name,
          company: request.toAddress.company,
          street1: request.toAddress.street1,
          street2: request.toAddress.street2,
          city: request.toAddress.city,
          state: request.toAddress.state,
          zip: request.toAddress.zip,
          country: request.toAddress.country,
          phone: request.toAddress.phone,
          email: request.toAddress.email,
        },
        from_address: {
          name: request.fromAddress.name,
          company: request.fromAddress.company,
          street1: request.fromAddress.street1,
          street2: request.fromAddress.street2,
          city: request.fromAddress.city,
          state: request.fromAddress.state,
          zip: request.fromAddress.zip,
          country: request.fromAddress.country,
          phone: request.fromAddress.phone,
          email: request.fromAddress.email,
        },
        parcel: {
          length: request.parcel.length.toString(),
          width: request.parcel.width.toString(),
          height: request.parcel.height.toString(),
          weight: request.parcel.weight.toString(),
        },
        reference: request.reference,
      },
    };

    const response = await this.request('/shipments', 'POST', payload);

    console.log('📦 EasyPost raw response:', {
      shipmentId: response.id,
      ratesCount: response.rates?.length || 0,
      hasRates: !!response.rates,
      sampleRate: response.rates?.[0]
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
      metadata: response,
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
      labelUrl: response.postage_label?.label_url,
      labelFormat: response.postage_label?.label_file_type || 'PNG',
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

      if (response.verifications?.delivery?.success) {
        return {
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
        return {
          valid: false,
          errors: response.verifications?.delivery?.errors?.map((e: any) => e.message) || ['Address verification failed'],
        };
      }
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
export async function getShippingVendor(apiKey?: string): Promise<IShippingVendor> {
  // If no API key provided, try to get from settings
  if (!apiKey) {
    const { db } = await import('../db');
    const { appSettings } = await import('@shared/schema');
    
    const [settings] = await db.select().from(appSettings).limit(1);
    
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
    throw new Error('EasyPost API key not configured. Please add it in Settings.');
  }

  return new EasyPostShippingVendor(apiKey);
}
