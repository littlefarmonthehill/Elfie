import planetLogo from "@assets/PlanetBrick_with_planet_1760672400950.png";

type PackingSlipOrder = {
  orderNumber: string;
  orderDate: string;
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

export default function PackingSlip({ orders }: PackingSlipProps) {
  return (
    <div className="print-container">
      {orders.map((order, index) => (
        <div 
          key={order.orderNumber}
          className="packing-slip"
          style={{
            pageBreakAfter: index < orders.length - 1 ? 'always' : 'auto'
          }}
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
            <div className="slip-info-grid">
              <div>
                <span className="slip-label">Order Number:</span>
                <span className="slip-value">{order.orderNumber}</span>
              </div>
              <div>
                <span className="slip-label">Date:</span>
                <span className="slip-value">{new Date(order.orderDate).toLocaleDateString()}</span>
              </div>
              {order.marketplace && (
                <div>
                  <span className="slip-label">Marketplace:</span>
                  <span className="slip-value">{order.marketplace}</span>
                </div>
              )}
            </div>
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

          {/* Items Table */}
          <div className="slip-section">
            <div className="slip-label-header">ITEMS:</div>
            <table className="slip-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="text-center">Qty</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item, idx) => (
                  <tr key={idx}>
                    <td>
                      <div className="slip-item-name">
                        {item.bricklinkPartNumber && `${item.bricklinkPartNumber} - `}{item.name}
                      </div>
                      <div className="slip-item-details">
                        {item.colorName && `${item.colorName} • `}
                        {item.condition && item.condition}
                      </div>
                    </td>
                    <td className="text-center slip-qty">{item.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="slip-footer">
            <div>Thank you for your order!</div>
            <div>PlanetBrick.com</div>
          </div>
        </div>
      ))}

      <style>{`
        @media print {
          @page {
            size: 4.25in 5.5in portrait;
            margin: 0.25in;
          }
          
          body {
            margin: 0;
            padding: 0;
          }
          
          .print-container {
            width: 100%;
            height: 100%;
          }
        }

        .packing-slip {
          width: 4.25in;
          height: 5.5in;
          padding: 0.25in;
          background: white;
          color: black;
          font-family: Arial, sans-serif;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
        }

        .slip-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 0.2in;
          padding-bottom: 0.1in;
          border-bottom: 2px solid #333;
        }

        .slip-logo {
          height: 0.4in;
          width: auto;
        }

        .slip-title h1 {
          margin: 0;
          font-size: 16pt;
          font-weight: bold;
          text-align: right;
        }

        .slip-section {
          margin-bottom: 0.15in;
        }

        .slip-info-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.05in;
          font-size: 9pt;
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
          text-decoration: underline;
        }

        .slip-address {
          font-size: 10pt;
          line-height: 1.3;
        }

        .slip-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 8pt;
        }

        .slip-table th {
          border-bottom: 1px solid #333;
          padding: 0.05in 0.05in;
          text-align: left;
          font-weight: bold;
        }

        .slip-table td {
          padding: 0.05in 0.05in;
          border-bottom: 1px solid #ddd;
          vertical-align: top;
        }

        .slip-item-name {
          font-weight: 600;
          margin-bottom: 0.02in;
        }

        .slip-item-details {
          font-size: 7pt;
          color: #666;
        }

        .slip-qty {
          font-weight: bold;
          font-size: 10pt;
        }

        .slip-footer {
          margin-top: auto;
          padding-top: 0.1in;
          border-top: 1px solid #ddd;
          text-align: center;
          font-size: 8pt;
          line-height: 1.4;
        }

        .text-center {
          text-align: center;
        }
      `}</style>
    </div>
  );
}
