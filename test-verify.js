// Test script to verify BrickOwl lots
const externalIds = ["57915333", "1001", "999001", "1002", "86176627"];

async function verify() {
  try {
    const response = await fetch('http://127.0.0.1:5000/api/platform-sync/verify-lots', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ externalIds }),
    });

    const data = await response.json();
    console.log('Verification Results:');
    console.log(JSON.stringify(data, null, 2));
    
    if (data.lots) {
      console.log('\n=== LOT DETAILS ===');
      data.lots.forEach(lot => {
        console.log(`\nExternal ID: ${lot.external_id_1}`);
        console.log(`  BOID: ${lot.boid}`);
        console.log(`  Name: ${lot.name}`);
        console.log(`  Color: ${lot.color}`);
        console.log(`  Condition: ${lot.condition}`);
        console.log(`  Quantity: ${lot.quantity}`);
        console.log(`  Price: $${lot.price}`);
        console.log(`  URL: ${lot.url}`);
      });
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

verify();
