// Direct BrickOwl API check
const BRICKOWL_API_KEY = process.env.BRICKOWL_API_KEY;

async function checkLots() {
  const externalIds = ["57915333", "1001", "999001", "1002", "86176627"];
  
  try {
    // Get all inventory
    const response = await fetch(`https://api.brickowl.com/v1/inventory/list?key=${BRICKOWL_API_KEY}`);
    const data = await response.json();
    
    console.log('API Response:', JSON.stringify(data).substring(0, 200));
    
    // BrickOwl returns an array directly
    const lots = Array.isArray(data) ? data : (data.inventory || data.lots || []);
    console.log(`\nTotal BrickOwl lots: ${lots.length}\n`);
    
    // Filter for our synced lots
    const ourLots = lots.filter(lot => externalIds.includes(lot.external_id_1));
    
    console.log(`=== FOUND ${ourLots.length} SYNCED LOTS ===\n`);
    
    ourLots.forEach((lot, index) => {
      console.log(`LOT ${index + 1}:`);
      console.log(`  External ID: ${lot.external_id_1}`);
      console.log(`  BOID: ${lot.boid}`);
      console.log(`  Name: ${lot.name || 'N/A'}`);
      console.log(`  Color: ${lot.col_name || 'N/A'}`);
      console.log(`  Condition: ${lot.full_con || lot.con}`);
      console.log(`  Quantity: ${lot.qty}`);
      console.log(`  Price: $${lot.price}`);
      console.log(`  URL: ${lot.url || 'N/A'}`);
      console.log('');
    });
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkLots();
