'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  X,
  FolderPlus,
  FolderOpen,
  Trash2,
  ChevronUp,
  Folder,
  HardDrive,
  CornerDownLeft,
} from 'lucide-react';

interface BrowseEntry {
  name: string;
  path: string;
}

// Path suggestions shown as quick-fill chips before the user types. Display
// uses Windows backslashes; the input accepts either slash style.
const SUGGESTIONS = ['C:\\Projects', 'C:\\Scratch', 'I:\\Scratch'];

export default function FolderManager({
  open,
  onClose,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  onChange: () => void;
}) {
  const [dirs, setDirs] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Folder-picker ("Open Folder") state.
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browsePath, setBrowsePath] = useState<string | null>(null);
  const [browseParent, setBrowseParent] = useState<string | null>(null);
  const [entries, setEntries] = useState<BrowseEntry[]>([]);
  const [browseBusy, setBrowseBusy] = useState(false);

  const loadDirs = useCallback(async () => {
    const res = await fetch('/api/config');
    const data = await res.json();
    setDirs(data.dirs ?? []);
  }, []);

  useEffect(() => {
    if (open) {
      loadDirs();
      setError(null);
      setInput('');
      setBrowseOpen(false);
    }
  }, [open, loadDirs]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const addDir = async (dir: string) => {
    const value = dir.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir: value }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to add folder');
        return;
      }
      setDirs(data.dirs);
      setInput('');
      setBrowseOpen(false);
      onChange();
    } catch {
      setError('Failed to add folder');
    } finally {
      setBusy(false);
    }
  };

  const removeDir = async (dir: string) => {
    setBusy(true);
    try {
      const res = await fetch('/api/config', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir }),
      });
      const data = await res.json();
      setDirs(data.dirs ?? []);
      onChange();
    } finally {
      setBusy(false);
    }
  };

  const browseTo = useCallback(async (path: string | null) => {
    setBrowseBusy(true);
    setError(null);
    try {
      const url = path ? `/api/browse?path=${encodeURIComponent(path)}` : '/api/browse';
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to read folder');
        return;
      }
      setBrowsePath(data.path);
      setBrowseParent(data.parent);
      setEntries(data.entries);
    } finally {
      setBrowseBusy(false);
    }
  }, []);

  const openBrowser = () => {
    setBrowseOpen(true);
    browseTo(null);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-800">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            <Folder className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            Scan folders
          </h2>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          {/* Current folders */}
          {dirs.length === 0 ? (
            <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
              No folders yet. Add one below to start indexing docs.
            </p>
          ) : (
            <ul className="mb-3 space-y-1">
              {dirs.map((d) => (
                <li
                  key={d}
                  className="group flex items-center justify-between gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 dark:border-zinc-800 dark:bg-zinc-800/40"
                >
                  <span className="truncate font-mono text-xs text-zinc-700 dark:text-zinc-300">
                    {d}
                  </span>
                  <button
                    onClick={() => removeDir(d)}
                    disabled={busy}
                    title="Remove folder"
                    className="grid h-6 w-6 shrink-0 place-items-center rounded text-zinc-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-950/40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Add by typing a path */}
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addDir(input)}
              placeholder="C:\Projects"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 font-mono text-xs text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
            <button
              onClick={() => addDir(input)}
              disabled={busy || !input.trim()}
              className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              Add
            </button>
            <button
              onClick={openBrowser}
              disabled={busy}
              title="Browse the filesystem to pick a folder"
              className="flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Open Folder
            </button>
          </div>

          {/* Suggestion chips */}
          {!browseOpen && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-zinc-400">Try:</span>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setInput(s)}
                  className="rounded-full border border-zinc-200 px-2 py-0.5 font-mono text-[11px] text-zinc-500 hover:border-indigo-400 hover:text-indigo-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:text-indigo-400"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {error && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
          )}

          {/* Folder picker */}
          {browseOpen && (
            <div className="mt-3 rounded-md border border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-2.5 py-1.5 dark:border-zinc-800">
                <span className="truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                  {browsePath ?? 'This PC'}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  {browsePath && (
                    <button
                      onClick={() => addDir(browsePath)}
                      disabled={busy}
                      title="Use this folder"
                      className="flex items-center gap-1 rounded bg-indigo-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
                    >
                      <CornerDownLeft className="h-3 w-3" />
                      Use
                    </button>
                  )}
                  <button
                    onClick={() => browseTo(browseParent)}
                    disabled={browseBusy || (!browseParent && !browsePath)}
                    title="Up one level"
                    className="grid h-6 w-6 place-items-center rounded text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <ul className="max-h-56 overflow-y-auto py-1">
                {entries.length === 0 && (
                  <li className="px-3 py-2 text-[11px] text-zinc-400">
                    {browseBusy ? 'Loading…' : 'No subfolders'}
                  </li>
                )}
                {entries.map((e) => (
                  <li key={e.path}>
                    <button
                      onClick={() => browseTo(e.path)}
                      className="flex w-full items-center gap-2 px-3 py-1 text-left text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      {browsePath ? (
                        <Folder className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                      ) : (
                        <HardDrive className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                      )}
                      <span className="truncate font-mono">{e.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
