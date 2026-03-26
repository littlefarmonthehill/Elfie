/**
 * Shipping Vendor Abstraction Layer
 * 
 * This interface defines the contract that all shipping vendors must implement.
 * This allows us to easily swap between different shipping providers (EasyPost, Pirateship, etc.)
 * without changing the rest of the application.
 */

export interface Address {
  name: string;
  company?: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone?: string;
  email?: string;
}

export interface Parcel {
  length: number; // inches
  width: number; // inches
  height: number; // inches
  weight: number; // ounces
  weightUnits?: string; // 'oz' | 'lb' | 'g' | 'kg' (defaults to oz if omitted)
  predefinedPackage?: string; // EasyPost predefined package name (e.g. 'FlatRateEnvelope')
}

export interface ShippingRate {
  id: string;
  carrier: string;
  service: string;
  rate: number; // USD
  deliveryDays?: number;
  deliveryDate?: string;
  deliveryDateGuaranteed?: boolean;
}

export interface ShipmentLabel {
  shipmentId: string;
  trackingNumber: string;
  labelUrl: string;
  labelFormat: string;
  carrier: string;
  service: string;
  cost: number;
  currency: string;
  metadata: any; // Vendor-specific data
}

export interface CustomsItem {
  description: string;
  quantity: number;
  weight: number;      // ounces
  value: number;       // USD declared value
  hsTariffNumber: string;
  originCountry: string;
}

export interface CustomsInfo {
  contentsType: 'merchandise' | 'gift' | 'sample' | 'documents' | 'returned_goods' | 'humanitarian_donation' | 'other';
  contentsExplanation?: string;
  eelPfc: string;                // e.g. "NOEEI 30.37(a)" for exports under $2,500
  customsCertify: boolean;
  customsSigner: string;
  nonDeliveryOption: 'return' | 'abandon';
  restrictionType: 'none' | 'other';
  items: CustomsItem[];
}

export interface TaxIdentifier {
  issuingCountry: string;  // ISO 2-letter country code or "EU"
  taxIdType: string;       // "IOSS", "VAT", etc.
  taxId: string;
}

export interface CreateShipmentRequest {
  toAddress: Address;
  fromAddress: Address;
  parcel: Parcel;
  reference?: string; // Order number or reference
  customsInfo?: CustomsInfo;
  taxIdentifiers?: TaxIdentifier[];
}

export interface BuyLabelRequest {
  shipmentId: string;
  rateId: string;
  insurance?: number; // USD
}

export interface IShippingVendor {
  /**
   * Create a shipment and get available rates
   */
  createShipment(request: CreateShipmentRequest): Promise<{
    shipmentId: string;
    rates: ShippingRate[];
    metadata: any;
  }>;

  /**
   * Purchase a shipping label for a specific rate
   */
  buyLabel(request: BuyLabelRequest): Promise<ShipmentLabel>;

  /**
   * Void/refund a shipping label
   */
  voidLabel(shipmentId: string): Promise<{
    success: boolean;
    refundAmount?: number;
    message?: string;
  }>;

  /**
   * Get available shipping services
   */
  listServices(): Promise<Array<{
    carrier: string;
    service: string;
    description: string;
  }>>;

  /**
   * Validate an address
   */
  validateAddress?(address: Address): Promise<{
    valid: boolean;
    suggested?: Address;
    errors?: string[];
  }>;
}
