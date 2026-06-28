import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

export interface MarkdownDoc {
  id: string;
  path: string;
  fileName: string;
  project: string;
  // Directory of the doc relative to its project root, e.g. "docs/prompts".
  // "(root)" for files directly in the project folder.
  folder: string;
  type: 'md' | 'html';
  title?: string;
  headings: string[];
  preview: string;
  tags?: string[];
  modified: number;
}

export interface Index {
  docs: MarkdownDoc[];
  roots: string[];
  lastUpdated: number;
}

interface Config {
  indexDirs: string[];
  cacheMinutes: number;
  includeWorktrees: boolean;
  // Default deep-scan mode when no per-request override is given. When true,
  // every subfolder is scanned (not just docs/.claude/.github).
  deepScan: boolean;
  // folder-name prefix -> canonical project name. Folds orphaned worktree
  // leftovers (dirs with no `.git`) into their real repo.
  aliases: Record<string, string>;
}

// Used only when config.json is missing. Copy config.example.json to
// config.json and set your own roots.
const DEFAULT_CONFIG: Config = {
  indexDirs: [],
  cacheMinutes: 5,
  includeWorktrees: false,
  deepScan: false,
  aliases: {},
};

// Caps to keep deep scans bounded. SKIP_DIRS already excludes the big noise
// sources (node_modules, .next, dist, ...), so this only stops a truly
// pathological project from dominating the whole index.
const DEEP_MAX_DEPTH = 8;
const DEEP_MAX_PER_PROJECT = 10000;

function loadConfig(): Config {
  try {
    const raw = fs.readFileSync(
      path.join(process.cwd(), 'config.json'),
      'utf8'
    );
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return DEFAULT_CONFIG;
  }
}

const config = loadConfig();
const INDEX_DIRS = config.indexDirs;

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.cache',
  '.turbo',
  '__pycache__',
  'venv',
  '.venv',
  'egg-info',
  '.pytest_cache',
  'target',
  'vendor',
  '.svelte-kit',
  '.turbopack',
  '.rollup.cache',
  'out',
  '.vercel',
  'tmp',
  'temp',
  '_worktree-archive',
  '.agents',
  '.agent',
  '.cursor',
  '.kiro',
  '.windsurf',
  '_orphan-recovered',
  '_review_tmp',
  'actual',
  'agent-trace',
]);

function extractHeadings(content: string): string[] {
  const headingRegex = /^#{1,6}\s+(.+)$/gm;
  const headings: string[] = [];
  let match;
  while ((match = headingRegex.exec(content)) !== null) {
    headings.push(match[1].trim());
  }
  return headings.slice(0, 10);
}

// Matches the document types we index.
function isDocFile(name: string): boolean {
  return /\.(md|html?)$/i.test(name);
}
function isHtmlFile(name: string): boolean {
  return /\.html?$/i.test(name);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
  ).trim();
}

function extractHtmlTitle(html: string): string | undefined {
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t && t[1].trim()) return decodeEntities(t[1].replace(/\s+/g, ' ')).trim();
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return stripTags(h1[1]) || undefined;
  return undefined;
}

function extractHtmlHeadings(html: string): string[] {
  const re = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi;
  const out: string[] = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const text = stripTags(m[1]);
    if (text) out.push(text);
  }
  return out.slice(0, 10);
}

type FolderClass =
  | { kind: 'main' | 'standalone'; project: string; hasGit: boolean }
  | { kind: 'worktree'; project: string; mainRepoDir: string; hasGit: true };

// Classify a folder by inspecting its `.git`:
//  - `.git` is a directory  -> main repo (or plain clone)
//  - `.git` is a file        -> git worktree; the file points at the main repo
//  - no `.git`               -> standalone (may be an orphaned worktree dir)
function classifyFolder(folderPath: string): FolderClass {
  const base = path.basename(folderPath);
  const gitPath = path.join(folderPath, '.git');

  let stat: fs.Stats;
  try {
    stat = fs.statSync(gitPath);
  } catch {
    return { kind: 'standalone', project: base, hasGit: false };
  }

  if (stat.isDirectory()) {
    return { kind: 'main', project: base, hasGit: true };
  }

  if (stat.isFile()) {
    try {
      const content = fs.readFileSync(gitPath, 'utf8');
      const match = content.match(/gitdir:\s*(.+)/);
      if (match) {
        let gitdir = match[1].trim().replace(/\\/g, '/');
        if (!path.isAbsolute(gitdir)) {
          gitdir = path.resolve(folderPath, gitdir).replace(/\\/g, '/');
        }
        // gitdir looks like <mainRepoDir>/.git/worktrees/<name>
        const marker = '/.git/worktrees/';
        const idx = gitdir.indexOf(marker);
        if (idx !== -1) {
          const mainRepoDir = gitdir.slice(0, idx);
          return {
            kind: 'worktree',
            project: path.basename(mainRepoDir),
            mainRepoDir,
            hasGit: true,
          };
        }
      }
    } catch {
      // fall through
    }
  }

  return { kind: 'standalone', project: base, hasGit: true };
}

// Longest common prefix of a list of strings.
function longestCommonPrefix(strs: string[]): string {
  if (strs.length === 0) return '';
  let prefix = strs[0];
  for (const s of strs.slice(1)) {
    while (!s.startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
      if (!prefix) return '';
    }
  }
  return prefix;
}

function addMarkdownFile(
  filePath: string,
  project: string,
  projectRoot: string,
  results: MarkdownDoc[]
): void {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const stat = fs.statSync(filePath);
    const fileName = path.basename(filePath);

    const rel = path
      .relative(projectRoot, path.dirname(filePath))
      .replace(/\\/g, '/');
    const folder = rel === '' ? '(root)' : rel;

    const base = {
      // Full path (normalized) - guaranteed unique. A slug would collide for
      // files differing only in punctuation (PRIVACY_POLICY vs PRIVACY-POLICY).
      id: filePath.replace(/\\/g, '/'),
      path: filePath,
      fileName,
      project,
      folder,
      modified: stat.mtimeMs,
    };

    if (isHtmlFile(fileName)) {
      results.push({
        ...base,
        type: 'html',
        title: extractHtmlTitle(content) || fileName.replace(/\.html?$/i, ''),
        headings: extractHtmlHeadings(content),
        preview: stripTags(content).slice(0, 200).trim(),
        tags: [],
      });
    } else {
      const { data, content: body } = matter(content);
      results.push({
        ...base,
        type: 'md',
        title: data.title || fileName.replace(/\.md$/i, ''),
        headings: extractHeadings(body),
        preview: body.slice(0, 200).replace(/\n+/g, ' ').trim(),
        tags: data.tags || [],
      });
    }
  } catch (e) {
    // Silently skip
  }
}

// Deep scan: walk every subfolder of a project (respecting SKIP_DIRS, a depth
// cap, and a per-project file cap). Root .html is still skipped as an app shell.
function deepScanProject(
  projectPath: string,
  project: string,
  results: MarkdownDoc[]
): void {
  const startCount = results.length;
  const walk = (dir: string, depth: number) => {
    if (depth > DEEP_MAX_DEPTH) return;
    if (results.length - startCount >= DEEP_MAX_PER_PROJECT) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name.toLowerCase())) continue;
      // Skip hidden dirs/files except .claude and .github
      if (
        entry.name.startsWith('.') &&
        !['.claude', '.github'].includes(entry.name.toLowerCase())
      ) {
        continue;
      }

      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.isFile()) {
        if (/\.md$/i.test(entry.name)) {
          addMarkdownFile(full, project, projectPath, results);
        } else if (isHtmlFile(entry.name) && dir !== projectPath) {
          addMarkdownFile(full, project, projectPath, results);
        }
      }
    }
  };
  walk(projectPath, 0);
}

function scanProjectDir(
  projectPath: string,
  project: string,
  results: MarkdownDoc[],
  deep: boolean
): void {
  if (deep) {
    deepScanProject(projectPath, project, results);
    return;
  }

  try {
    const entries = fs.readdirSync(projectPath, { withFileTypes: true });

    for (const entry of entries) {
      // Root-level: markdown only (root .html is usually an app shell, not a
      // doc). HTML is picked up inside docs/.claude/.github below.
      if (entry.isFile() && /\.md$/i.test(entry.name)) {
        addMarkdownFile(
          path.join(projectPath, entry.name),
          project,
          projectPath,
          results
        );
      }

      // Scan special folders
      if (
        entry.isDirectory() &&
        ['docs', '.claude', '.github', 'doc'].includes(
          entry.name.toLowerCase()
        )
      ) {
        const folderPath = path.join(projectPath, entry.name);
        try {
          const folderEntries = fs.readdirSync(folderPath, {
            withFileTypes: true,
          });
          for (const subEntry of folderEntries) {
            if (subEntry.isFile() && isDocFile(subEntry.name)) {
              addMarkdownFile(
                path.join(folderPath, subEntry.name),
                project,
                projectPath,
                results
              );
            } else if (subEntry.isDirectory() && subEntry.name !== '.git') {
              // One more level deep for subdirs within docs/
              const subFolderPath = path.join(folderPath, subEntry.name);
              try {
                const subFolderEntries = fs.readdirSync(subFolderPath, {
                  withFileTypes: true,
                });
                for (const subSubEntry of subFolderEntries) {
                  if (subSubEntry.isFile() && isDocFile(subSubEntry.name)) {
                    addMarkdownFile(
                      path.join(subFolderPath, subSubEntry.name),
                      project,
                      projectPath,
                      results
                    );
                  }
                }
              } catch (e) {
                // Skip
              }
            }
          }
        } catch (e) {
          // Skip
        }
      }
    }
  } catch (e) {
    // Silently skip
  }
}

// Cache keyed by scan mode (curated vs deep), so toggling does not thrash.
const caches = new Map<boolean, { index: Index; time: number }>();
const indexing = new Set<boolean>();
const CACHE_DURATION = (config.cacheMinutes ?? 5) * 60000;

export function buildIndex(deep: boolean = config.deepScan ?? false): Index {
  const now = Date.now();
  const cached = caches.get(deep);

  if (!cached || now - cached.time > CACHE_DURATION) {
    if (!indexing.has(deep)) {
      indexing.add(deep);
      rebuildIndexAsync(deep);
    }
  }

  // Return cached even if expired, while the async rebuild happens.
  if (cached) return cached.index;

  return { docs: [], roots: INDEX_DIRS, lastUpdated: now };
}

// Derive a safe alias prefix from a project's live worktree folder names:
// the longest common prefix, trimmed to a hyphen boundary. Returns '' if it
// would be too short to be meaningful.
function deriveAlias(folderNames: string[]): string {
  let alias = longestCommonPrefix(folderNames);
  const lastDash = alias.lastIndexOf('-');
  alias = lastDash > 0 ? alias.slice(0, lastDash) : alias.replace(/-+$/, '');
  return alias.length >= 5 ? alias : '';
}

// Resolve canonical project name -> absolute path to scan. Reads directory
// entries only (cheap), so it can be reused for both the full build and a
// single-project deep scan.
function resolveProjectPaths(): {
  toScan: Map<string, string>;
  worktreesSkipped: number;
  orphansFolded: number;
} {
  const toScan = new Map<string, string>();
  const worktreeMainRepos = new Map<string, string>();
  const worktreeFolders = new Map<string, string[]>();
  const orphans: { name: string; path: string }[] = [];
  let worktreesSkipped = 0;

  for (const baseDir of INDEX_DIRS) {
    if (!fs.existsSync(baseDir)) continue;

    try {
      const entries = fs.readdirSync(baseDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (SKIP_DIRS.has(entry.name.toLowerCase())) continue;
        if (entry.name.startsWith('.')) continue;

        const projectPath = path.join(baseDir, entry.name);
        const klass = classifyFolder(projectPath);

        if (klass.kind === 'worktree' && !config.includeWorktrees) {
          worktreesSkipped++;
          if (!worktreeMainRepos.has(klass.project)) {
            worktreeMainRepos.set(klass.project, klass.mainRepoDir);
          }
          const list = worktreeFolders.get(klass.project) ?? [];
          list.push(entry.name);
          worktreeFolders.set(klass.project, list);
          continue;
        }

        if (klass.kind === 'main' || klass.hasGit) {
          if (!toScan.has(klass.project)) toScan.set(klass.project, projectPath);
          continue;
        }

        orphans.push({ name: entry.name, path: projectPath });
      }
    } catch (e) {
      console.error(`[Indexer] Error scanning ${baseDir}:`, e);
    }
  }

  // Alias map: auto-learned from live worktrees, overlaid with config aliases.
  const aliasMap = new Map<string, string>();
  for (const [project, folders] of worktreeFolders) {
    const alias = deriveAlias(folders);
    if (!alias) continue;
    let conflict = false;
    for (const name of toScan.keys()) {
      if (name !== project && (name === alias || name.startsWith(alias + '-'))) {
        conflict = true;
        break;
      }
    }
    if (!conflict) aliasMap.set(alias, project);
  }
  for (const [alias, project] of Object.entries(config.aliases)) {
    aliasMap.set(alias, project);
  }

  // Fold orphaned worktree dirs into their canonical project.
  let orphansFolded = 0;
  for (const orphan of orphans) {
    let matched: string | null = null;
    for (const [alias, project] of aliasMap) {
      if (orphan.name === alias || orphan.name.startsWith(alias + '-')) {
        matched = project;
        break;
      }
    }
    if (matched) {
      orphansFolded++;
    } else if (!toScan.has(orphan.name)) {
      toScan.set(orphan.name, orphan.path);
    }
  }

  // Safety net: scan a worktree's canonical repo even if it's outside INDEX_DIRS.
  for (const [project, mainRepoDir] of worktreeMainRepos) {
    if (!toScan.has(project) && fs.existsSync(mainRepoDir)) {
      toScan.set(project, mainRepoDir);
    }
  }

  return { toScan, worktreesSkipped, orphansFolded };
}

// Per-project deep index, built synchronously (one project is fast).
const projectDeepCaches = new Map<string, { index: Index; time: number }>();

export function buildProjectDeep(project: string): Index {
  const now = Date.now();
  const cached = projectDeepCaches.get(project);
  if (cached && now - cached.time < CACHE_DURATION) return cached.index;

  const { toScan } = resolveProjectPaths();
  const projectPath = toScan.get(project);
  const docs: MarkdownDoc[] = [];
  if (projectPath) {
    scanProjectDir(projectPath, project, docs, true);
    docs.sort((a, b) => b.modified - a.modified);
  }

  const index: Index = { docs, roots: INDEX_DIRS, lastUpdated: now };
  projectDeepCaches.set(project, { index, time: now });
  console.log(`[Indexer] Deep-scanned project "${project}": ${docs.length} docs`);
  return index;
}

async function rebuildIndexAsync(deep: boolean): Promise<void> {
  try {
    console.log(
      `[Indexer] Building fresh index (async, ${deep ? 'deep' : 'curated'})...`
    );
    const docs: MarkdownDoc[] = [];
    const { toScan, worktreesSkipped, orphansFolded } = resolveProjectPaths();

    for (const [project, projectPath] of toScan) {
      scanProjectDir(projectPath, project, docs, deep);
    }

    // Sort by modified date, newest first
    docs.sort((a, b) => b.modified - a.modified);

    caches.set(deep, {
      index: { docs, roots: INDEX_DIRS, lastUpdated: Date.now() },
      time: Date.now(),
    });

    console.log(
      `[Indexer] Index built (${deep ? 'deep' : 'curated'}): ${docs.length} docs ` +
        `across ${toScan.size} projects ` +
        `(${worktreesSkipped} worktrees + ${orphansFolded} orphan dirs collapsed)`
    );
  } catch (e) {
    console.error('[Indexer] Error building index:', e);
  } finally {
    indexing.delete(deep);
  }
}

// Start initial index build on module load (default mode)
rebuildIndexAsync(config.deepScan ?? false);

export function getIndexDirs(): string[] {
  return INDEX_DIRS;
}
