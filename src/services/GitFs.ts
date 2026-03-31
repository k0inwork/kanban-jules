import { db } from './db';

export interface GitFile {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number;
}

export class GitFs {
  private repoUrl: string;
  private branch: string;
  private token: string;

  constructor(repoUrl: string, branch: string = 'main', token: string) {
    this.repoUrl = repoUrl;
    this.branch = branch;
    this.token = token;
  }

  private getApiUrl(path: string): string {
    let owner: string;
    let repo: string;

    // Handle the specific 'sources/github/owner/repo' format
    if (this.repoUrl.startsWith('sources/github/')) {
      const parts = this.repoUrl.split('/');
      owner = parts[2];
      repo = parts[3];
    } else if (this.repoUrl.includes('github.com')) {
      const urlString = this.repoUrl.startsWith('http') ? this.repoUrl : `https://${this.repoUrl}`;
      const url = new URL(urlString);
      const parts = url.pathname.split('/').filter(Boolean);
      [owner, repo] = parts;
    } else {
      const parts = this.repoUrl.split('/');
      if (parts.length >= 2) {
        [owner, repo] = parts;
      } else {
        owner = 'unknown';
        repo = this.repoUrl;
      }
    }
    
    const pathSegment = path ? `/${path}` : '';
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents${pathSegment}?ref=${this.branch}`;
    console.log(`[GitFs] Constructed API URL: ${apiUrl} (owner: ${owner}, repo: ${repo}, path: ${path}, branch: ${this.branch})`);
    return apiUrl;
  }

  // Fetch file content, caching it in IndexedDB
  async getFile(path: string): Promise<string> {
    const cached = await db.gitCache.get(path);
    if (cached && (Date.now() - cached.timestamp < 3600000)) { // 1 hour cache
      return cached.content;
    }
    
    const response = await fetch(this.getApiUrl(path), {
      headers: {
        'Authorization': `token ${this.token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${path}: ${response.statusText}`);
    }

    const data = await response.json();
    const content = atob(data.content);
    
    await db.gitCache.put({ path, content, timestamp: Date.now() });
    return content;
  }

  // List files
  async listFiles(path: string = ''): Promise<GitFile[]> {
    const response = await fetch(this.getApiUrl(path), {
      headers: {
        'Authorization': `token ${this.token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Failed to list files: ${response.status} ${response.statusText} - ${errorBody}`);
    }

    const data = await response.json();
    const items = Array.isArray(data) ? data : [data];
    return items.map(f => ({
      name: f.name,
      path: f.path,
      type: f.type,
      size: f.size
    }));
  }
}
