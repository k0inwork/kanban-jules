import { db, KBDoc } from '../../services/db';

interface FilePattern {
  glob: string;
  docType: KBDoc['type'];
  tags: string[];
}

const SCAN_PATTERNS: FilePattern[] = [
  { glob: 'README*', docType: 'readme', tags: ['project-overview'] },
  { glob: 'package.json', docType: 'reference', tags: ['tech-stack', 'dependencies'] },
  { glob: 'tsconfig.json', docType: 'reference', tags: ['typescript', 'config'] },
  { glob: '*.md', docType: 'spec', tags: ['documentation'] },
];

const TECH_MARKERS: Record<string, string[]> = {
  'react': ['jsx', 'react', 'component'],
  'typescript': ['typescript', 'ts', 'tsx'],
  'next.js': ['next'],
  'express': ['express'],
  'dexie': ['dexie', 'indexeddb'],
  'tailwind': ['tailwind'],
};

/**
 * Scans repository file listings to detect tech stack and discover docs.
 * Populates kb_docs and kb_log with initial knowledge entries.
 * Called once when a project is first loaded (mvp §7 Step 9).
 */
export async function scanRepo(files: { path: string; content?: string }[]): Promise<{ docs: number; entries: number }> {
  let docsCreated = 0;
  let entriesCreated = 0;

  // Detect tech stack from file extensions and package.json
  const extensions = new Set<string>();
  const detectedTech = new Set<string>();

  for (const file of files) {
    const ext = file.path.split('.').pop()?.toLowerCase() || '';
    if (ext) extensions.add(ext);

    // Parse package.json for dependencies
    if (file.path.endsWith('package.json') && file.content) {
      try {
        const pkg = JSON.parse(file.content);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        for (const dep of Object.keys(deps)) {
          const depLower = dep.toLowerCase();
          for (const [tech, markers] of Object.entries(TECH_MARKERS)) {
            if (markers.some(m => depLower.includes(m))) {
              detectedTech.add(tech);
            }
          }
        }
      } catch { /* not valid JSON */ }
    }

    // Match scan patterns for docs
    for (const pattern of SCAN_PATTERNS) {
      const basename = file.path.split('/').pop() || '';
      const matchesGlob = (pattern.glob.endsWith('*') && basename.startsWith(pattern.glob.slice(0, -1)))
        || basename === pattern.glob;

      if (matchesGlob && file.content) {
        const existing = await db.kbDocs
          .where('title').equals(file.path)
          .and(d => d.project === 'target' && d.active)
          .first();

        if (!existing) {
          const summary = file.content.substring(0, 300).replace(/[#*`]/g, '').trim();
          await db.kbDocs.add({
            timestamp: Date.now(),
            title: file.path,
            type: pattern.docType,
            content: file.content,
            summary,
            tags: pattern.tags,
            layer: ['L0', 'L1'],
            source: 'repo-scan',
            active: true,
            version: 1,
            project: 'target',
          });
          docsCreated++;
        }
      }
    }
  }

  // Map extensions to tech
  const extToTech: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript+react', jsx: 'react', js: 'javascript',
    py: 'python', rs: 'rust', go: 'go', rb: 'ruby', java: 'java',
  };
  for (const ext of extensions) {
    if (extToTech[ext]) {
      for (const t of extToTech[ext].split('+')) detectedTech.add(t);
    }
  }

  // Record tech stack observation
  if (detectedTech.size > 0) {
    const techList = [...detectedTech].sort().join(', ');
    // Check if we already recorded this
    const existing = await db.kbLog
      .filter(e => e.active && e.category === 'observation' && e.source === 'repo-scan' && e.text.includes(techList))
      .first();

    if (!existing) {
      await db.kbLog.add({
        timestamp: Date.now(),
        text: `Detected tech stack: ${techList}. File types: ${[...extensions].sort().join(', ')}.`,
        category: 'observation',
        abstraction: 3,
        layer: ['L0'],
        tags: ['tech-stack', 'repo-scan', ...detectedTech],
        source: 'repo-scan',
        active: true,
        project: 'target',
      });
      entriesCreated++;
    }
  }

  return { docs: docsCreated, entries: entriesCreated };
}
