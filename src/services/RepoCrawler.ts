import { GitFs } from './GitFs';

export const RepoCrawler = {
  crawl: async (repoUrl: string, branch: string, token: string) => {
    const gitFs = new GitFs(repoUrl, branch, token);
    
    const crawlDir = async (path: string) => {
      const files = await gitFs.listFiles(path);
      for (const file of files) {
        if (file.type === 'dir') {
          await crawlDir(file.path);
        } else if (file.type === 'file') {
          // Simple heuristic to skip likely binary files
          const isBinary = /\.(png|jpg|jpeg|gif|ico|pdf|zip|tar|gz|exe|dll|so|dylib)$/i.test(file.name);
          if (!isBinary) {
            try {
              await gitFs.getFile(file.path);
              console.log(`[RepoCrawler] Cached: ${file.path}`);
            } catch (err) {
              console.error(`[RepoCrawler] Failed to cache: ${file.path}`, err);
            }
          }
        }
      }
    };

    console.log(`[RepoCrawler] Starting crawl for ${repoUrl} @ ${branch} with token: ${token ? 'present' : 'missing'}`);
    await crawlDir('');
    console.log(`[RepoCrawler] Finished crawl for ${repoUrl} @ ${branch}`);
  }
};
