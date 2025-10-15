// Test script for unsynced items API
async function testUnsynced() {
  try {
    console.log('1. Testing unsynced preview endpoint...');
    const previewRes = await fetch('http://localhost:5000/api/platform-sync/unsynced-preview?limit=5');
    const previewData = await previewRes.json();
    console.log('Preview response:', JSON.stringify(previewData, null, 2));
    
    console.log('\n2. Testing sync unsynced items endpoint...');
    const syncRes = await fetch('http://localhost:5000/api/platform-sync/sync-unsynced', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'BrickOwl', limit: 5 }),
    });
    const syncData = await syncRes.json();
    console.log('Sync response:', JSON.stringify(syncData, null, 2));
    
  } catch (error) {
    console.error('Error:', error);
  }
}

testUnsynced();
