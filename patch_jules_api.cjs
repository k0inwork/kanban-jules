const fs = require('fs');

const file = 'src/lib/julesApi.ts';
let content = fs.readFileSync(file, 'utf8');

// The original signature
content = content.replace(
  'async function fetchJules(url: string, options: any = {}) {',
  `async function fetchJules(url: string, options: any = {}) {
  const proxyUrl = localStorage.getItem('proxyUrl') || '';
  if (proxyUrl) {
    const proxyOptions = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: url,
        method: options.method || 'GET',
        headers: options.headers || {},
        body: options.body ? JSON.parse(options.body) : undefined,
        proxyUrl: proxyUrl
      })
    };

    console.log(\`[Jules API Proxy] \${options.method || 'GET'} \${url}\`);
    const response = await fetch('/api/proxy', proxyOptions);

    if (!response.ok) {
      let errorBody;
      try {
        errorBody = await response.text();
      } catch (e) {
        errorBody = "Failed to parse error response";
      }
      console.error(\`[Jules API Error Proxy] \${response.status} \${url}\`, errorBody);
      throw new JulesApiError(\`Proxy Error: \${response.status}\`, response.status);
    }

    const data = await response.json();
    if (data.status && data.status >= 400) {
      throw new JulesApiError(typeof data.data === 'object' ? data.data.message : data.data, data.status);
    }

    return data.data;
  }`
);

fs.writeFileSync(file, content);
console.log("Patched julesApi.ts");
