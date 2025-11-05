import planetLogo from "@assets/PlanetBrick_dotcom_with_planet_and_robot_400_1760672362080.png";

type PackingSlipOrder = {
  orderNumber: string;
  orderDate: string;
  shipDate: string | null;
  customerUsername: string | null;
  marketplace: string | null;
  shipTo: {
    name?: string;
    company?: string;
    street1?: string;
    street2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
  items: Array<{
    inventoryId: string | null;
    bricklinkPartNumber: string | null;
    name: string;
    quantity: number;
    colorName: string | null;
    condition: string | null;
  }>;
};

interface PackingSlipProps {
  orders: PackingSlipOrder[];
}

// Split items across pages (max 30 items per full page)
function paginateItems(items: any[], itemsPerPage: number = 30) {
  const pages = [];
  for (let i = 0; i < items.length; i += itemsPerPage) {
    pages.push(items.slice(i, i + itemsPerPage));
  }
  return pages;
}

export default function PackingSlip({ orders }: PackingSlipProps) {
  return (
    <div className="print-container">
      {orders.flatMap((order) => {
        const pages = paginateItems(order.items);
        return pages.map((pageItems, pageIndex) => (
          <div 
            key={`${order.orderNumber}-page-${pageIndex}`}
            className="packing-slip"
          >
            {/* Header with Logo */}
            <div className="slip-header">
              <img 
                src={planetLogo} 
                alt="PlanetBrick" 
                className="slip-logo"
              />
              <div className="slip-title">
                <h1>PACKING SLIP</h1>
              </div>
            </div>

            {/* Order Info */}
            <div className="slip-section">
              <div className="slip-info-row">
                <div>
                  <span className="slip-label">Order:</span>
                  <span className="slip-value">{order.orderNumber}</span>
                </div>
                <div>
                  <span className="slip-label">Ship Date:</span>
                  <span className="slip-value">
                    {order.shipDate ? new Date(order.shipDate).toLocaleDateString() : 'Pending'}
                  </span>
                </div>
              </div>
              {pages.length > 1 && (
                <div className="slip-page-info">
                  Page {pageIndex + 1} of {pages.length}
                </div>
              )}
            </div>

            {/* Ship To Address */}
            <div className="slip-section">
              <div className="slip-label-header">SHIP TO:</div>
              <div className="slip-address">
                {order.shipTo.name && <div>{order.shipTo.name}</div>}
                {order.shipTo.company && <div>{order.shipTo.company}</div>}
                {order.shipTo.street1 && <div>{order.shipTo.street1}</div>}
                {order.shipTo.street2 && <div>{order.shipTo.street2}</div>}
                <div>
                  {order.shipTo.city && `${order.shipTo.city}, `}
                  {order.shipTo.state && `${order.shipTo.state} `}
                  {order.shipTo.postalCode}
                </div>
                {order.shipTo.country && <div>{order.shipTo.country}</div>}
              </div>
            </div>

            {/* Items List */}
            <div className="slip-section slip-items">
              <div className="slip-label-header">ITEMS:</div>
              <div className="slip-items-list">
                {pageItems.map((item, idx) => (
                  <div key={idx} className="slip-item">
                    <div className="slip-item-line1">
                      <span className="slip-sku">{item.inventoryId || '-'}</span>
                      <span className="slip-part-name">
                        {item.bricklinkPartNumber || '-'}: {item.name}
                      </span>
                      <span className="slip-qty">Qty: {item.quantity}</span>
                    </div>
                    <div className="slip-item-line2">
                      {item.colorName && <span>{item.colorName}</span>}
                      {item.colorName && item.condition && <span> • </span>}
                      {item.condition && <span>{item.condition}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="slip-footer">
              <div>Thank you for your order!</div>
              <div className="slip-company">PlanetBrick.com</div>
              <div className="slip-company-address">PO Box 202, Lanesboro, MN 55949</div>
            </div>
          </div>
        ));
      })}

      <style>{`
        @media print {
          @page {
            size: 8.5in 11in;
            margin: 0.5in;
          }
          
          html, body {
            background: white !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          
          /* Hide everything except packing slips */
          body > *:not(#root) {
            display: none !important;
          }
          
          #root > *:not([role="dialog"]) {
            display: none !important;
          }
          
          [role="dialog"] > *:not(.print-container) {
            display: none !important;
          }
          
          /* Force display and proper styling */
          .print-container {
            display: block !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          
          .packing-slip {
            page-break-after: always !important;
            page-break-inside: avoid !important;
            width: 7.5in !important;
            min-height: 10in !important;
            padding: 0.5in !important;
            background: white !important;
            color: black !important;
            margin: 0 auto !important;
          }
          
          .packing-slip:last-child {
            page-break-after: avoid !important;
          }
          
          /* Ensure proper text colors */
          .packing-slip * {
            color: black !important;
          }
          
          .slip-header {
            border-bottom: 2px solid #000 !important;
          }
          
          .slip-footer {
            border-top: 1px solid #ddd !important;
          }
          
          .slip-item {
            border-bottom: 1px solid #ddd !important;
          }
          
          .slip-item:last-child {
            border-bottom: none !important;
          }
        }

        .packing-slip {
          width: 7.5in;
          min-height: 10in;
          padding: 0.5in;
          background: white;
          color: black;
          font-family: Arial, sans-serif;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          border: 1px solid #ddd;
          margin-bottom: 0.5in;
        }

        .slip-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 0.15in;
          padding-bottom: 0.1in;
          border-bottom: 2px solid #000;
        }

        .slip-logo {
          height: 0.4in;
          width: auto;
        }

        .slip-title h1 {
          margin: 0;
          font-size: 16pt;
          font-weight: bold;
        }

        .slip-section {
          margin-bottom: 0.12in;
        }

        .slip-info-row {
          display: flex;
          justify-content: space-between;
          font-size: 10pt;
        }

        .slip-page-info {
          text-align: center;
          font-size: 9pt;
          color: #666;
          margin-top: 0.04in;
        }

        .slip-label {
          font-weight: bold;
          margin-right: 0.1in;
        }

        .slip-value {
          font-family: 'Courier New', monospace;
        }

        .slip-label-header {
          font-weight: bold;
          font-size: 10pt;
          margin-bottom: 0.05in;
        }

        .slip-address {
          font-size: 9pt;
          line-height: 1.3;
        }

        .slip-items {
          flex: 1;
          display: flex;
          flex-direction: column;
        }

        .slip-items-list {
          flex: 1;
          overflow: hidden;
        }

        .slip-item {
          margin-bottom: 0.08in;
          padding-bottom: 0.06in;
          border-bottom: 1px solid #ddd;
        }

        .slip-item:last-child {
          border-bottom: none;
        }

        .slip-item-line1 {
          display: flex;
          align-items: baseline;
          gap: 0.08in;
          font-size: 8pt;
          margin-bottom: 0.03in;
        }

        .slip-sku {
          font-family: 'Courier New', monospace;
          font-weight: bold;
          min-width: 0.6in;
          font-size: 8pt;
        }

        .slip-part-name {
          flex: 1;
          font-size: 8pt;
        }

        .slip-qty {
          font-weight: bold;
          white-space: nowrap;
          font-size: 8pt;
        }

        .slip-item-line2 {
          font-size: 7pt;
          color: #666;
          padding-left: 0.68in;
        }

        .slip-footer {
          margin-top: auto;
          padding-top: 0.1in;
          border-top: 1px solid #ddd;
          text-align: center;
          font-size: 8pt;
          line-height: 1.4;
        }

        .slip-company {
          font-weight: bold;
          font-size: 9pt;
          margin-top: 0.03in;
        }

        .slip-company-address {
          color: #666;
        }
      `}</style>
    </div>
  );
}
