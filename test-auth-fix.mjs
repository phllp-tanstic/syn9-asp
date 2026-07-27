// Test /v1/provision is reachable (expect 400 not 404)
const provRes = await fetch('https://syn9-asp-production.up.railway.app/v1/provision', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({}),
});
console.log('provision status:', provRes.status, '(expect 400 not 404)');

// Test /v1/core returns 402 without Bearer
const coreRes = await fetch('https://syn9-asp-production.up.railway.app/v1/core');
console.log('core status:', coreRes.status, '(expect 402)');

// Test /v1/research returns 402 without Bearer  
const researchRes = await fetch('https://syn9-asp-production.up.railway.app/v1/research');
console.log('research status:', researchRes.status, '(expect 402)');
