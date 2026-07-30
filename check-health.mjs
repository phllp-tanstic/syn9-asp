const res = await fetch('https://syn9-asp-production.up.railway.app/v1/health', { method: 'POST' });
console.log(await res.json());
