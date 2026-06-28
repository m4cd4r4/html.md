'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import Fuse from 'fuse.js';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import GithubSlugger from 'github-slugger';

const MarkdownEditor = dynamic(() => import('./MarkdownEditor'), {
  ssr: false,
  loading: () => (
    <div className="h-full grid place-items-center text-sm text-zinc-400">
      Loading editor…
    </div>
  ),
});
import {
  Search,
  Folder,
  FolderTree,
  FileText,
  RefreshCw,
  ExternalLink,
  Hash,
  ChevronDown,
  ArrowUpDown,
  Sun,
  Moon,
  Star,
  FileCode,
  Globe,
  Pencil,
  Save,
  X,
  Columns2,
  FolderSearch,
} from 'lucide-react';

const STARRED_KEY = 'docs-dashboard:starred';
const PINNED_KEY = 'docs-dashboard:pinned';
const DEEPSCAN_KEY = 'docs-dashboard:deepscan';

type SortMode = 'default' | 'newest' | 'oldest' | 'name';

interface MarkdownDoc {
  id: string;
  path: string;
  fileName: string;
  project: string;
  folder: string;
  type: 'md' | 'html';
  title?: string;
  headings: string[];
  preview: string;
  tags?: string[];
  modified: number;
}

interface Index {
  docs: MarkdownDoc[];
  roots: string[];
  lastUpdated: number;
}

export default function Dashboard() {
  const [index, setIndex] = useState<Index | null>(null);
  const [search, setSearch] = useState('');
  const [selectedDoc, setSelectedDoc] = useState<MarkdownDoc | null>(null);
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<string>('');
  const [contentLoading, setContentLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editBuffer, setEditBuffer] = useState('');
  const [saving, setSaving] = useState(false);
  const [splitPreview, setSplitPreview] = useState(true);
  const [projectFilter, setProjectFilter] = useState('');
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('default');
  const [typeFilter, setTypeFilter] = useState<'all' | 'md' | 'html'>('all');
  const [isDark, setIsDark] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Global ⌘K / Ctrl+K to toggle the command palette
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  const [starred, setStarred] = useState<string[]>([]);
  const [pinned, setPinned] = useState<string[]>([]);
  const [starredView, setStarredView] = useState(false);
  const [deepScan, setDeepScan] = useState(false);
  const hydrated = useRef(false);

  // Sync theme state + load starred/pinned from localStorage on mount
  useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'));
    try {
      const s = localStorage.getItem(STARRED_KEY);
      const p = localStorage.getItem(PINNED_KEY);
      if (s) setStarred(JSON.parse(s));
      if (p) setPinned(JSON.parse(p));
      setDeepScan(localStorage.getItem(DEEPSCAN_KEY) === '1');
    } catch {
      // ignore
    }
    hydrated.current = true;
  }, []);

  // Persist starred/pinned (skip the initial render before hydration)
  useEffect(() => {
    if (!hydrated.current) return;
    try {
      localStorage.setItem(STARRED_KEY, JSON.stringify(starred));
    } catch {
      // ignore
    }
  }, [starred]);

  useEffect(() => {
    if (!hydrated.current) return;
    try {
      localStorage.setItem(PINNED_KEY, JSON.stringify(pinned));
    } catch {
      // ignore
    }
  }, [pinned]);

  const starredSet = useMemo(() => new Set(starred), [starred]);
  const pinnedSet = useMemo(() => new Set(pinned), [pinned]);

  // Scroll the active project to the middle of the rail when it changes (e.g.
  // after a ⌘K jump lands on a project that was scrolled out of view).
  const activeRowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (activeProject) {
      activeRowRef.current?.scrollIntoView({ block: 'center' });
    }
  }, [activeProject]);

  const toggleStar = (path: string) =>
    setStarred((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    );

  const togglePin = (project: string) =>
    setPinned((prev) =>
      prev.includes(project)
        ? prev.filter((p) => p !== project)
        : [...prev, project]
    );

  const selectProject = (project: string | null) => {
    setStarredView(false);
    setActiveProject(project);
  };

  const dirty = editing && editBuffer !== content;

  // Open a doc, guarding against losing unsaved edits
  const openDoc = (doc: MarkdownDoc) => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    setEditing(false);
    setSelectedDoc(doc);
  };

  const startEdit = () => {
    setEditBuffer(content);
    setEditing(true);
  };

  const cancelEdit = () => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    setEditing(false);
  };

  const saveDoc = async () => {
    if (!selectedDoc) return;
    setSaving(true);
    try {
      const res = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedDoc.path, content: editBuffer }),
      });
      if (!res.ok) throw new Error('save failed');
      setContent(editBuffer);
      setEditing(false);
    } catch {
      window.alert('Could not save the file.');
    } finally {
      setSaving(false);
    }
  };

  const handlePaletteSelect = (doc: MarkdownDoc) => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    setStarredView(false);
    setEditing(false);
    setActiveProject(doc.project);
    setSelectedDoc(doc);
    setPaletteOpen(false);
  };

  // Warn before closing the tab with unsaved edits
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const showStarred = () => {
    setStarredView(true);
    setActiveProject(null);
  };

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light');
    } catch {
      // ignore storage failures
    }
  };

  // Reset folder + type filters whenever the active project changes
  useEffect(() => {
    setFolderFilter(null);
    setTypeFilter('all');
  }, [activeProject]);

  // Fetch index on mount + when scan mode changes + periodic refresh
  useEffect(() => {
    const url = `/api/index${deepScan ? '?deep=1' : ''}`;
    const fetchIndex = async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch index');
        const data: Index = await response.json();
        setIndex(data);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    setLoading(true);
    fetchIndex();
    const interval = setInterval(fetchIndex, 30000);
    return () => clearInterval(interval);
  }, [deepScan]);

  // Fetch the selected document's content (HTML is rendered via iframe instead)
  useEffect(() => {
    setEditing(false);
    if (!selectedDoc || selectedDoc.type === 'html') {
      setContent('');
      return;
    }

    let cancelled = false;
    const fetchContent = async () => {
      try {
        setContentLoading(true);
        const response = await fetch(
          `/api/doc?path=${encodeURIComponent(selectedDoc.path)}`
        );
        if (!response.ok) throw new Error('Failed to load document');
        const data = await response.json();
        if (!cancelled) setContent(data.content ?? '');
      } catch {
        if (!cancelled) setContent('*Could not load this document.*');
      } finally {
        if (!cancelled) setContentLoading(false);
      }
    };

    fetchContent();
    return () => {
      cancelled = true;
    };
  }, [selectedDoc]);

  const fuse = useMemo(() => {
    if (!index) return null;
    return new Fuse(index.docs, {
      keys: ['fileName', 'title', 'project', 'preview', 'headings', 'tags'],
      threshold: 0.3,
    });
  }, [index]);

  // Search + project/starred scope (before the doc-type filter)
  const scopedDocs = useMemo(() => {
    if (!index) return [];
    let docs = index.docs;
    if (search && fuse) {
      docs = fuse.search(search).map((result) => result.item);
    }
    if (starredView) {
      docs = docs.filter((doc) => starredSet.has(doc.path));
    } else if (activeProject) {
      docs = docs.filter((doc) => doc.project === activeProject);
    }
    return docs;
  }, [index, search, activeProject, fuse, starredView, starredSet]);

  const typeCounts = useMemo(
    () => ({
      all: scopedDocs.length,
      md: scopedDocs.filter((d) => d.type === 'md').length,
      html: scopedDocs.filter((d) => d.type === 'html').length,
    }),
    [scopedDocs]
  );

  const filteredDocs = useMemo(
    () =>
      typeFilter === 'all'
        ? scopedDocs
        : scopedDocs.filter((doc) => doc.type === typeFilter),
    [scopedDocs, typeFilter]
  );

  // Group docs by project (used in the "All documents" default view)
  const groupedDocs = useMemo(() => {
    const groups: { [key: string]: MarkdownDoc[] } = {};
    filteredDocs.forEach((doc) => {
      (groups[doc.project] ??= []).push(doc);
    });
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredDocs]);

  // Projects with doc counts, filtered by the project search box
  const projectList = useMemo(() => {
    if (!index) return [];
    const counts = new Map<string, number>();
    for (const doc of index.docs) {
      counts.set(doc.project, (counts.get(doc.project) ?? 0) + 1);
    }
    const q = projectFilter.trim().toLowerCase();
    return Array.from(counts.entries())
      .filter(([name]) => !q || name.toLowerCase().includes(q))
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [index, projectFilter]);

  const pinnedProjects = useMemo(
    () => projectList.filter(([name]) => pinnedSet.has(name)),
    [projectList, pinnedSet]
  );
  const otherProjects = useMemo(
    () => projectList.filter(([name]) => !pinnedSet.has(name)),
    [projectList, pinnedSet]
  );

  // Folders present in the current (project + search) selection, with counts
  const activeFolders = useMemo(() => {
    if (!activeProject) return [];
    const counts = new Map<string, number>();
    for (const doc of filteredDocs) {
      counts.set(doc.folder, (counts.get(doc.folder) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    );
  }, [filteredDocs, activeProject]);

  // Apply the folder filter on top of the project + search filter
  const visibleDocs = useMemo(() => {
    if (!folderFilter) return filteredDocs;
    return filteredDocs.filter((doc) => doc.folder === folderFilter);
  }, [filteredDocs, folderFilter]);

  // Group the active project's docs by folder (sticky subheaders)
  const docsByFolder = useMemo(() => {
    const groups: { [key: string]: MarkdownDoc[] } = {};
    visibleDocs.forEach((doc) => {
      (groups[doc.folder] ??= []).push(doc);
    });
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [visibleDocs]);

  // Flat, explicitly-sorted list (used when sortMode is not the grouped default)
  const sortedDocs = useMemo(() => {
    const arr = [...visibleDocs];
    if (sortMode === 'newest') arr.sort((a, b) => b.modified - a.modified);
    else if (sortMode === 'oldest') arr.sort((a, b) => a.modified - b.modified);
    else if (sortMode === 'name')
      arr.sort((a, b) =>
        (a.title || a.fileName).localeCompare(b.title || b.fileName)
      );
    return arr;
  }, [visibleDocs, sortMode]);

  // Table of contents for the selected doc (slugs match rehype-slug output)
  const toc = useMemo(() => {
    if (!selectedDoc) return [];
    const slugger = new GithubSlugger();
    return selectedDoc.headings.map((text) => ({
      text,
      id: slugger.slug(text),
    }));
  }, [selectedDoc]);

  const openInVSCode = (filePath: string) => {
    fetch('/api/open-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath }),
    }).catch(console.error);
  };

  const handleRefresh = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/index${deepScan ? '?deep=1' : ''}`);
      if (!response.ok) throw new Error('Failed to fetch index');
      setIndex(await response.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const toggleDeepScan = () => {
    const next = !deepScan;
    setDeepScan(next);
    try {
      localStorage.setItem(DEEPSCAN_KEY, next ? '1' : '0');
    } catch {
      // ignore
    }
  };

  // Build a /files/<rootIndex>/<relpath> URL so HTML docs (and their relative
  // assets) can be served and rendered in an iframe.
  const fileUrl = (doc: MarkdownDoc): string => {
    if (!index) return '';
    const p = doc.path.replace(/\\/g, '/');
    const pl = p.toLowerCase();
    let bestI = -1;
    let bestLen = -1;
    index.roots.forEach((r, i) => {
      const rl = r.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
      if ((pl === rl || pl.startsWith(rl + '/')) && rl.length > bestLen) {
        bestI = i;
        bestLen = rl.length;
      }
    });
    if (bestI === -1) return '';
    const rel = p.slice(bestLen + 1);
    const segs = rel
      .split('/')
      .map((s) => encodeURIComponent(s))
      .join('/');
    return `/files/${bestI}/${segs}`;
  };

  const totalDocs = index?.docs.length ?? 0;

  return (
    <div className="flex h-screen overflow-hidden bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* ── Column 1: Projects rail ───────────────────────────── */}
      <aside className="w-64 shrink-0 flex flex-col border-r border-zinc-200 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-900/40">
        <div className="h-14 shrink-0 flex items-center justify-between px-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <svg
              viewBox="0 0 64 64"
              className="w-7 h-7"
              fill="none"
              aria-hidden
            >
              <rect width="64" height="64" rx="15" fill="#4F46E5" />
              <path
                d="M23 20 L13 32 L23 44"
                stroke="#fff"
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M41 20 L51 32 L41 44"
                stroke="#fff"
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M32 19 L32 39"
                stroke="#C7D2FE"
                strokeWidth="4"
                strokeLinecap="round"
              />
              <path
                d="M26 33 L32 40 L38 33"
                stroke="#C7D2FE"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="font-mono font-semibold tracking-tight">
              html<span className="text-indigo-600 dark:text-indigo-400">.md</span>
            </span>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={toggleDeepScan}
              title={
                deepScan
                  ? 'Deep scan ON: indexing every subfolder. Click for curated (docs folders only).'
                  : 'Deep scan OFF: curated folders only. Click to index every subfolder (slower; for disorganised projects).'
              }
              className={`grid place-items-center w-7 h-7 rounded-md transition-colors ${
                deepScan
                  ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300'
                  : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              <FolderSearch className="w-4 h-4" />
            </button>
            <button
              onClick={toggleTheme}
              title={isDark ? 'Switch to light' : 'Switch to dark'}
              className="grid place-items-center w-7 h-7 rounded-md text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              {isDark ? (
                <Sun className="w-4 h-4" />
              ) : (
                <Moon className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={handleRefresh}
              disabled={loading}
              title="Re-scan projects"
              className="grid place-items-center w-7 h-7 rounded-md text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        <div className="px-3 pt-3 pb-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
            <input
              type="text"
              placeholder="Filter projects"
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="w-full pl-8 pr-2 py-1.5 text-sm bg-white border border-zinc-200 rounded-lg placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 dark:bg-zinc-900 dark:border-zinc-700 dark:focus:border-indigo-500"
            />
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
          {starred.length > 0 && (
            <button
              onClick={showStarred}
              className={`group w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors ${
                starredView
                  ? 'bg-white text-zinc-900 font-medium shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:ring-zinc-700'
                  : 'text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100'
              }`}
            >
              <Star
                className="w-4 h-4 text-amber-500"
                fill="currentColor"
              />
              <span className="flex-1 text-left">Starred</span>
              <span className="text-xs tabular-nums text-zinc-400">
                {starred.length}
              </span>
            </button>
          )}

          <ProjectRow
            label="All projects"
            count={totalDocs}
            active={activeProject === null && !starredView}
            onClick={() => selectProject(null)}
          />

          {pinnedProjects.length > 0 && (
            <>
              <div className="px-2 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Pinned
              </div>
              {pinnedProjects.map(([project, count]) => (
                <ProjectRow
                  key={project}
                  label={project}
                  count={count}
                  active={activeProject === project && !starredView}
                  innerRef={
                    activeProject === project && !starredView
                      ? activeRowRef
                      : undefined
                  }
                  onClick={() => selectProject(project)}
                  pinned
                  onTogglePin={() => togglePin(project)}
                />
              ))}
              <div className="px-2 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                All projects
              </div>
            </>
          )}

          {otherProjects.map(([project, count]) => (
            <ProjectRow
              key={project}
              label={project}
              count={count}
              active={activeProject === project && !starredView}
              innerRef={
                activeProject === project && !starredView
                  ? activeRowRef
                  : undefined
              }
              onClick={() => selectProject(project)}
              pinned={false}
              onTogglePin={() => togglePin(project)}
            />
          ))}
          {index && projectList.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-zinc-400">
              No projects match “{projectFilter}”
            </p>
          )}
        </nav>
      </aside>

      {/* ── Column 2: Documents list ──────────────────────────── */}
      <section className="w-80 shrink-0 flex flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="h-14 shrink-0 flex items-center justify-between gap-2 px-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">
              {starredView ? 'Starred' : activeProject ?? 'All documents'}
            </div>
            <div className="text-xs text-zinc-400">
              {loading && !index
                ? 'Indexing…'
                : `${visibleDocs.length} document${
                    visibleDocs.length === 1 ? '' : 's'
                  }${folderFilter ? ` in ${folderFilter}` : ''}`}
            </div>
          </div>
          <div className="relative shrink-0">
            <ArrowUpDown className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 pointer-events-none" />
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              title="Order documents"
              className="appearance-none cursor-pointer pl-7 pr-6 py-1.5 text-xs font-medium bg-zinc-50 border border-zinc-200 rounded-lg text-zinc-600 hover:bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <option value="default">
                {activeProject ? 'By folder' : 'By project'}
              </option>
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="name">Name A–Z</option>
            </select>
            <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 pointer-events-none" />
          </div>
        </div>

        <div className="px-3 pt-3 pb-2 space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
            <input
              type="text"
              placeholder="Search documents"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-12 py-1.5 text-sm bg-zinc-50 border border-zinc-200 rounded-lg placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 focus:bg-white dark:bg-zinc-900 dark:border-zinc-700 dark:focus:bg-zinc-900 dark:focus:border-indigo-500"
            />
            <button
              onClick={() => setPaletteOpen(true)}
              title="Command palette (⌘K)"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:text-zinc-200"
            >
              ⌘K
            </button>
          </div>

          {typeCounts.html > 0 && (
            <div className="flex gap-0.5 p-0.5 rounded-lg bg-zinc-100 text-xs dark:bg-zinc-800/60">
              {(
                [
                  ['all', 'All'],
                  ['md', 'MD'],
                  ['html', 'HTML'],
                ] as const
              ).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setTypeFilter(val)}
                  className={`flex-1 px-2 py-1 rounded-md font-medium transition-colors ${
                    typeFilter === val
                      ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                  }`}
                >
                  {label}{' '}
                  <span className="tabular-nums opacity-60">
                    {typeCounts[val]}
                  </span>
                </button>
              ))}
            </div>
          )}

          {activeProject && activeFolders.length > 1 && (
            <div className="relative">
              <FolderTree className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 pointer-events-none" />
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 pointer-events-none" />
              <select
                value={folderFilter ?? ''}
                onChange={(e) => setFolderFilter(e.target.value || null)}
                className="w-full pl-8 pr-7 py-1.5 text-sm bg-zinc-50 border border-zinc-200 rounded-lg appearance-none cursor-pointer text-zinc-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 focus:bg-white dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:focus:border-indigo-500"
              >
                <option value="">All folders ({filteredDocs.length})</option>
                {activeFolders.map(([folder, count]) => (
                  <option key={folder} value={folder}>
                    {folder} ({count})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {error && (
            <div className="m-2 p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg dark:text-red-400 dark:bg-red-950/30 dark:border-red-900/50">
              {error}
            </div>
          )}

          {loading && !index ? (
            <DocsSkeleton />
          ) : visibleDocs.length === 0 ? (
            <p className="px-2 py-10 text-center text-sm text-zinc-400">
              No documents found
            </p>
          ) : sortMode !== 'default' ? (
            // Explicit sort: flat ordered list with a location hint per row
            <div className="space-y-0.5">
              {sortedDocs.map((doc) => (
                <DocRow
                  key={doc.id}
                  doc={doc}
                  active={selectedDoc?.id === doc.id}
                  onClick={() => openDoc(doc)}
                  starred={starredSet.has(doc.path)}
                  onToggleStar={() => toggleStar(doc.path)}
                  location={
                    activeProject ? doc.folder : `${doc.project} · ${doc.folder}`
                  }
                  meta={
                    sortMode === 'name'
                      ? undefined
                      : new Date(doc.modified).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })
                  }
                />
              ))}
            </div>
          ) : activeProject ? (
            // Single project: group by subfolder
            docsByFolder.map(([folder, docs]) => (
              <div key={folder} className="mb-2">
                <div className="sticky top-0 z-10 flex items-center gap-1.5 px-2 py-1.5 bg-white/90 backdrop-blur-sm text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:bg-zinc-950/90">
                  <FolderTree className="w-3 h-3" />
                  <span className="truncate">{folder}</span>
                  <span className="text-zinc-300 normal-case font-normal dark:text-zinc-600">
                    {docs.length}
                  </span>
                </div>
                <div className="space-y-0.5">
                  {docs.map((doc) => (
                    <DocRow
                      key={doc.id}
                      doc={doc}
                      active={selectedDoc?.id === doc.id}
                      onClick={() => openDoc(doc)}
                      starred={starredSet.has(doc.path)}
                      onToggleStar={() => toggleStar(doc.path)}
                    />
                  ))}
                </div>
              </div>
            ))
          ) : (
            // All documents: group by project
            groupedDocs.map(([project, docs]) => (
              <div key={project} className="mb-2">
                <div className="sticky top-0 z-10 px-2 py-1.5 bg-white/90 backdrop-blur-sm text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:bg-zinc-950/90">
                  {project}
                </div>
                <div className="space-y-0.5">
                  {docs.map((doc) => (
                    <DocRow
                      key={doc.id}
                      doc={doc}
                      active={selectedDoc?.id === doc.id}
                      onClick={() => openDoc(doc)}
                      starred={starredSet.has(doc.path)}
                      onToggleStar={() => toggleStar(doc.path)}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* ── Column 3: Reader ──────────────────────────────────── */}
      <main className="flex-1 min-w-0 flex flex-col bg-white dark:bg-zinc-950">
        {selectedDoc ? (
          <>
            <header className="shrink-0 border-b border-zinc-200 px-8 py-5 dark:border-zinc-800">
              <div className="flex items-center gap-1.5 text-xs text-zinc-400 mb-1.5">
                <Folder className="w-3.5 h-3.5" />
                <span>{selectedDoc.project}</span>
                <span className="text-zinc-300 dark:text-zinc-600">/</span>
                <span className="font-mono text-zinc-500 dark:text-zinc-400">
                  {selectedDoc.fileName}
                </span>
              </div>
              <div className="flex items-start justify-between gap-4">
                <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                  {selectedDoc.title || selectedDoc.fileName}
                </h1>
                <div className="shrink-0 flex items-center gap-2">
                  <button
                    onClick={() => toggleStar(selectedDoc.path)}
                    title={
                      starredSet.has(selectedDoc.path)
                        ? 'Remove bookmark'
                        : 'Bookmark this document'
                    }
                    className={`grid place-items-center w-9 h-9 rounded-lg border transition-colors ${
                      starredSet.has(selectedDoc.path)
                        ? 'border-amber-200 bg-amber-50 text-amber-500 dark:border-amber-900/50 dark:bg-amber-950/30'
                        : 'border-zinc-200 text-zinc-400 hover:text-amber-500 hover:border-amber-200 dark:border-zinc-700 dark:hover:border-amber-900/50'
                    }`}
                  >
                    <Star
                      className="w-4 h-4"
                      fill={
                        starredSet.has(selectedDoc.path)
                          ? 'currentColor'
                          : 'none'
                      }
                    />
                  </button>
                  {editing ? (
                    <>
                      <button
                        onClick={() => setSplitPreview((s) => !s)}
                        title={
                          splitPreview ? 'Hide live preview' : 'Show live preview'
                        }
                        className={`grid place-items-center w-9 h-9 rounded-lg border transition-colors ${
                          splitPreview
                            ? 'border-indigo-200 bg-indigo-50 text-indigo-600 dark:border-indigo-900/50 dark:bg-indigo-950/30 dark:text-indigo-300'
                            : 'border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'
                        }`}
                      >
                        <Columns2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-zinc-700 bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50 transition-colors dark:text-zinc-200 dark:bg-zinc-900 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        <X className="w-3.5 h-3.5" />
                        Cancel
                      </button>
                      <button
                        onClick={saveDoc}
                        disabled={saving || !dirty}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-40 disabled:hover:bg-indigo-600"
                      >
                        <Save className="w-3.5 h-3.5" />
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                    </>
                  ) : (
                    <>
                      {selectedDoc.type === 'html' && (
                        <a
                          href={fileUrl(selectedDoc)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-zinc-700 bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50 transition-colors dark:text-zinc-200 dark:bg-zinc-900 dark:border-zinc-700 dark:hover:bg-zinc-800"
                        >
                          <Globe className="w-3.5 h-3.5" />
                          Open in browser
                        </a>
                      )}
                      {selectedDoc.type === 'md' && (
                        <button
                          onClick={startEdit}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-zinc-700 bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50 transition-colors dark:text-zinc-200 dark:bg-zinc-900 dark:border-zinc-700 dark:hover:bg-zinc-800"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          Edit
                        </button>
                      )}
                      <button
                        onClick={() => openInVSCode(selectedDoc.path)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-zinc-900 rounded-lg hover:bg-zinc-700 transition-colors dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Open in VS Code
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="mt-2 flex items-center gap-3 text-xs text-zinc-400">
                <span>
                  Modified{' '}
                  {new Date(selectedDoc.modified).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
                {editing && (
                  <span className="font-medium text-indigo-500">
                    Editing{dirty ? ' • unsaved' : ''}
                  </span>
                )}
                {selectedDoc.tags && selectedDoc.tags.length > 0 && (
                  <span className="flex flex-wrap gap-1">
                    {selectedDoc.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded text-[11px] font-medium dark:bg-indigo-950/50 dark:text-indigo-300"
                      >
                        {tag}
                      </span>
                    ))}
                  </span>
                )}
              </div>
            </header>

            {selectedDoc.type === 'html' ? (
              <div className="flex-1 min-h-0 bg-white">
                <iframe
                  key={selectedDoc.id}
                  src={fileUrl(selectedDoc)}
                  title={selectedDoc.fileName}
                  sandbox="allow-scripts allow-popups allow-forms allow-modals"
                  className="w-full h-full border-0 bg-white"
                />
              </div>
            ) : editing ? (
              <div className="flex-1 min-h-0 flex">
                <div
                  className={`${
                    splitPreview
                      ? 'w-1/2 border-r border-zinc-200 dark:border-zinc-800'
                      : 'w-full'
                  } min-w-0 h-full overflow-hidden`}
                >
                  <MarkdownEditor
                    value={editBuffer}
                    onChange={setEditBuffer}
                    isDark={isDark}
                    onSave={() => {
                      if (dirty && !saving) saveDoc();
                    }}
                  />
                </div>
                {splitPreview && (
                  <div className="w-1/2 min-w-0 overflow-y-auto px-8 py-6">
                    <article className="prose prose-zinc dark:prose-invert prose-sm max-w-none prose-headings:scroll-mt-6">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeSlug]}
                        components={{ pre: CodeBlock }}
                      >
                        {editBuffer}
                      </ReactMarkdown>
                    </article>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 min-h-0 flex overflow-hidden">
                <div className="flex-1 overflow-y-auto px-8 py-8">
                  {contentLoading ? (
                    <div className="max-w-3xl space-y-3 animate-pulse">
                      <div className="h-7 w-1/2 bg-zinc-100 rounded dark:bg-zinc-800" />
                      <div className="h-4 w-full bg-zinc-100 rounded dark:bg-zinc-800" />
                      <div className="h-4 w-5/6 bg-zinc-100 rounded dark:bg-zinc-800" />
                      <div className="h-4 w-2/3 bg-zinc-100 rounded dark:bg-zinc-800" />
                    </div>
                  ) : (
                    <article className="prose prose-zinc dark:prose-invert prose-sm max-w-3xl prose-headings:scroll-mt-6">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeSlug]}
                        components={{ pre: CodeBlock }}
                      >
                        {content}
                      </ReactMarkdown>
                    </article>
                  )}
                </div>

                {toc.length > 0 && (
                <aside className="hidden xl:block w-56 shrink-0 overflow-y-auto border-l border-zinc-100 px-4 py-8 dark:border-zinc-800">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-3">
                    <Hash className="w-3 h-3" />
                    On this page
                  </div>
                  <ul className="space-y-1.5 text-sm">
                    {toc.map((h, i) => (
                      <li key={`${h.id}-${i}`}>
                        <a
                          href={`#${h.id}`}
                          className="block text-zinc-500 hover:text-indigo-600 transition-colors truncate dark:text-zinc-400 dark:hover:text-indigo-400"
                          title={h.text}
                        >
                          {h.text}
                        </a>
                      </li>
                    ))}
                  </ul>
                </aside>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 grid place-items-center px-8">
            <div className="text-center max-w-sm">
              <div className="grid place-items-center w-14 h-14 mx-auto mb-4 rounded-2xl bg-zinc-100 text-zinc-400 dark:bg-zinc-800">
                <FileText className="w-6 h-6" />
              </div>
              <h2 className="text-lg font-semibold text-zinc-700 dark:text-zinc-200">
                {index ? 'Select a document' : 'Indexing your projects…'}
              </h2>
              <p className="mt-1 text-sm text-zinc-400">
                {index
                  ? 'Pick a project, then open any document to read it here.'
                  : 'Scanning your repositories for markdown files.'}
              </p>
            </div>
          </div>
        )}
      </main>

      <CommandPalette
        open={paletteOpen}
        docs={index?.docs ?? []}
        onClose={() => setPaletteOpen(false)}
        onSelect={handlePaletteSelect}
      />
    </div>
  );
}

function CommandPalette({
  open,
  docs,
  onClose,
  onSelect,
}: {
  open: boolean;
  docs: MarkdownDoc[];
  onClose: () => void;
  onSelect: (doc: MarkdownDoc) => void;
}) {
  const [query, setQuery] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const fuse = useMemo(
    () =>
      new Fuse(docs, {
        keys: ['title', 'fileName', 'project', 'folder'],
        threshold: 0.4,
      }),
    [docs]
  );

  const results = useMemo(() => {
    if (!query.trim()) return docs.slice(0, 25);
    return fuse.search(query).slice(0, 25).map((r) => r.item);
  }, [query, fuse, docs]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIdx(0);
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => setIdx(0), [query]);

  useEffect(() => {
    const el = listRef.current?.children[idx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [idx]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const d = results[idx];
      if (d) onSelect(d);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]"
      onMouseDown={onClose}
    >
      <div className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-xl overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-700"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 border-b border-zinc-200 dark:border-zinc-800">
          <Search className="w-4 h-4 text-zinc-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to a doc or project…"
            className="flex-1 py-3 text-sm bg-transparent outline-none placeholder:text-zinc-400"
          />
        </div>
        <ul ref={listRef} className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 ? (
            <li className="px-4 py-8 text-center text-sm text-zinc-400">
              No matches
            </li>
          ) : (
            results.map((d, i) => (
              <li key={d.id}>
                <button
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => onSelect(d)}
                  className={`w-full flex items-center gap-2 px-4 py-2 text-left ${
                    i === idx
                      ? 'bg-indigo-50 dark:bg-indigo-950/40'
                      : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                  }`}
                >
                  {d.type === 'html' ? (
                    <FileCode className="w-3.5 h-3.5 shrink-0 text-orange-400" />
                  ) : (
                    <FileText className="w-3.5 h-3.5 shrink-0 text-zinc-400" />
                  )}
                  <span className="flex-1 truncate text-sm text-zinc-800 dark:text-zinc-200">
                    {d.title || d.fileName}
                  </span>
                  <span className="shrink-0 max-w-[45%] truncate font-mono text-[11px] text-zinc-400">
                    {d.project} / {d.folder}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="flex items-center gap-4 px-4 py-2 border-t border-zinc-200 text-[11px] text-zinc-400 dark:border-zinc-800">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
          <span className="ml-auto tabular-nums">{results.length} results</span>
        </div>
      </div>
    </div>
  );
}

function CodeBlock({ children }: { children?: React.ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ref.current?.innerText ?? '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  };
  return (
    <div className="not-prose group relative my-5">
      <pre
        ref={ref}
        className="overflow-x-auto rounded-xl bg-zinc-900 p-4 text-[13px] leading-relaxed text-zinc-100 dark:bg-black"
      >
        {children}
      </pre>
      <button
        onClick={copy}
        className="absolute right-2 top-2 rounded px-2 py-1 text-[11px] font-medium bg-zinc-800 text-zinc-200 opacity-0 transition group-hover:opacity-100 hover:bg-zinc-700"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function ProjectRow({
  label,
  count,
  active,
  onClick,
  pinned,
  onTogglePin,
  innerRef,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  pinned?: boolean;
  onTogglePin?: () => void;
  innerRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={innerRef}
      className={`group relative flex items-center rounded-lg text-sm transition-colors ${
        active
          ? 'bg-white text-zinc-900 font-medium shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:ring-zinc-700'
          : 'text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100'
      }`}
    >
      <button
        onClick={onClick}
        className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 text-left"
      >
        <span
          className={active ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-400'}
        >
          <Folder className="w-4 h-4" />
        </span>
        <span className="flex-1 truncate">{label}</span>
      </button>
      {onTogglePin && (
        <button
          onClick={onTogglePin}
          title={pinned ? 'Unpin project' : 'Pin project'}
          className={`shrink-0 grid place-items-center w-6 h-6 mr-1 rounded transition ${
            pinned
              ? 'text-amber-500'
              : 'text-zinc-300 opacity-0 group-hover:opacity-100 hover:text-amber-500 dark:text-zinc-600'
          }`}
        >
          <Star className="w-3.5 h-3.5" fill={pinned ? 'currentColor' : 'none'} />
        </button>
      )}
      <span
        className={`shrink-0 pr-2 text-xs tabular-nums ${
          pinned ? '' : 'group-hover:hidden'
        } ${
          active
            ? 'text-zinc-400'
            : 'text-zinc-300 dark:text-zinc-600'
        }`}
      >
        {count}
      </span>
    </div>
  );
}

function DocRow({
  doc,
  active,
  onClick,
  starred,
  onToggleStar,
  location,
  meta,
}: {
  doc: MarkdownDoc;
  active: boolean;
  onClick: () => void;
  starred?: boolean;
  onToggleStar?: () => void;
  location?: string;
  meta?: string;
}) {
  return (
    <div
      className={`group relative rounded-lg transition-colors ${
        active
          ? 'bg-indigo-50 ring-1 ring-indigo-100 dark:bg-indigo-950/40 dark:ring-indigo-900/50'
          : 'hover:bg-zinc-50 dark:hover:bg-zinc-900'
      }`}
    >
      <button onClick={onClick} className="w-full text-left px-2.5 py-2">
        <div className="flex items-center gap-2">
          {doc.type === 'html' ? (
            <FileCode
              className={`w-3.5 h-3.5 shrink-0 ${
                active ? 'text-indigo-600 dark:text-indigo-400' : 'text-orange-400'
              }`}
            />
          ) : (
            <FileText
              className={`w-3.5 h-3.5 shrink-0 ${
                active ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-400'
              }`}
            />
          )}
          <span
            className={`flex-1 text-sm truncate ${
              active
                ? 'text-indigo-900 font-medium dark:text-indigo-200'
                : 'text-zinc-800 dark:text-zinc-200'
            }`}
          >
            {doc.title || doc.fileName}
          </span>
          {doc.type === 'html' && (
            <span className="shrink-0 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-orange-600 bg-orange-50 rounded dark:text-orange-400 dark:bg-orange-950/40">
              html
            </span>
          )}
          {meta && (
            <span className="shrink-0 text-[11px] tabular-nums text-zinc-400 mr-5">
              {meta}
            </span>
          )}
        </div>
        {location && (
          <p className="mt-0.5 pl-[22px] text-[11px] font-mono text-zinc-400 truncate">
            {location}
          </p>
        )}
        {doc.preview && (
          <p className="mt-0.5 pl-[22px] text-xs text-zinc-400 line-clamp-2 leading-relaxed">
            {doc.preview}
          </p>
        )}
      </button>
      {onToggleStar && (
        <button
          onClick={onToggleStar}
          title={starred ? 'Remove bookmark' : 'Bookmark'}
          className={`absolute top-1.5 right-1.5 grid place-items-center w-6 h-6 rounded transition ${
            starred
              ? 'text-amber-500'
              : 'text-zinc-300 opacity-0 group-hover:opacity-100 hover:text-amber-500 dark:text-zinc-600'
          }`}
        >
          <Star className="w-3.5 h-3.5" fill={starred ? 'currentColor' : 'none'} />
        </button>
      )}
    </div>
  );
}

function DocsSkeleton() {
  return (
    <div className="space-y-2 p-2 animate-pulse">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <div className="h-3.5 w-2/3 bg-zinc-100 rounded dark:bg-zinc-800" />
          <div className="h-2.5 w-full bg-zinc-50 rounded dark:bg-zinc-900" />
        </div>
      ))}
    </div>
  );
}
