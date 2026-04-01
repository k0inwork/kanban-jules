const fs = require('fs');

const file = 'src/App.tsx';
let content = fs.readFileSync(file, 'utf8');

const regex = /const handleSaveSettings = \([\s\S]*?\} \/\//;
// Let's just find the function signature and replace it.
const funcStr = `  const handleSaveSettings = (
    endpoint: string,
    apiKey: string,
    repo: string,
    branch: string,
    sourceName: string,
    sourceId: string,
    provider: string,
    gModel: string,
    gKey: string,
    oUrl: string,
    oKey: string,
    oModel: string,
    pUrl: string
  ) => {
    console.log("Saving settings:", { endpoint, apiKey, repo, branch, sourceName, sourceId, provider, gModel, gKey, oUrl, oKey, oModel, pUrl });
    setJulesEndpoint(endpoint);
    setJulesApiKey(apiKey);
    setRepoUrl(repo);
    setRepoBranch(branch);
    setJulesSourceName(sourceName);
    setJulesSourceId(sourceId);
    setApiProvider(provider);
    setGeminiModel(gModel);
    setGeminiKey(gKey);
    setOpenaiUrl(oUrl);
    setOpenaiKey(oKey);
    setOpenaiModel(oModel);
    setProxyUrl(pUrl);

    localStorage.setItem('julesEndpoint', endpoint);
    localStorage.setItem('julesApiKey', apiKey);
    localStorage.setItem('julesRepoUrl', repo);
    localStorage.setItem('julesRepoBranch', branch);
    localStorage.setItem('julesSourceName', sourceName);
    localStorage.setItem('julesSourceId', sourceId);
    localStorage.setItem('apiProvider', provider);
    localStorage.setItem('geminiModel', gModel);
    localStorage.setItem('geminiKey', gKey);
    localStorage.setItem('openaiUrl', oUrl);
    localStorage.setItem('openaiKey', oKey);
    localStorage.setItem('openaiModel', oModel);
    localStorage.setItem('proxyUrl', pUrl);

    const token = import.meta.env.VITE_GITHUB_TOKEN;
    if (token && repo) {
      RepoCrawler.crawl(repo, branch || 'main', token).catch(console.error);
    }
  };`;

// Replace the old handleSaveSettings function.
const oldFuncRegex = /const handleSaveSettings = \([\s\S]*?catch\(console\.error\);\n\s*\}\n\s*\};/;
if (oldFuncRegex.test(content)) {
  content = content.replace(oldFuncRegex, funcStr);
  fs.writeFileSync(file, content);
  console.log("Fixed handleSaveSettings in App.tsx");
} else {
  console.log("Could not find handleSaveSettings");
}
