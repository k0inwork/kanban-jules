const fs = require('fs');

const file = 'src/components/SettingsModal.tsx';
let content = fs.readFileSync(file, 'utf8');

const targetStr = `          </div>

          <div className="space-y-4 pb-4 border-b border-neutral-800">
            <h3 className="text-sm font-medium text-neutral-300">Jules API Configuration</h3>`;

const replacement = `            <div>
              <label className="block text-xs font-mono text-neutral-400 mt-4 mb-1 uppercase tracking-wider">Proxy URL (SOCKS5)</label>
              <input
                type="text"
                value={proxyUrl}
                onChange={(e) => setProxyUrl(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                placeholder="socks5://127.0.0.1:1080"
              />
              <p className="text-[10px] text-neutral-500 mt-1">Leave blank to use direct connection. Applies to all LLM and Jules API calls.</p>
            </div>
          </div>

          <div className="space-y-4 pb-4 border-b border-neutral-800">
            <h3 className="text-sm font-medium text-neutral-300">Jules API Configuration</h3>`;

if (content.includes(targetStr)) {
  content = content.replace(targetStr, replacement);
  fs.writeFileSync(file, content);
  console.log("Successfully added Proxy URL input to SettingsModal");
} else {
  console.log("Could not find the target string in SettingsModal.tsx to replace.");
}
