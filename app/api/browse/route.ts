import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface Entry {
  name: string;
  path: string;
}

// List available Windows drive letters (C:/, D:/, ...). Falls back to '/' on
// non-Windows hosts.
function listDrives(): Entry[] {
  if (process.platform !== 'win32') {
    return [{ name: '/', path: '/' }];
  }
  try {
    const out = execSync('wmic logicaldisk get name', { encoding: 'utf8' });
    const drives = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^[A-Za-z]:$/.test(l))
      .map((l) => {
        const p = l.toUpperCase() + '/';
        return { name: p, path: p };
      });
    if (drives.length) return drives;
  } catch {
    // fall through to a sane default
  }
  return [{ name: 'C:/', path: 'C:/' }];
}

// Folder picker backend: given a path, return its immediate subdirectories so
// the UI can navigate the filesystem and pick an absolute path. No path means
// "top level" -> drive letters.
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get('path');

  if (!raw) {
    return NextResponse.json({ path: null, parent: null, entries: listDrives() });
  }

  const dir = raw.replace(/\\/g, '/');
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      return NextResponse.json({ error: `Not a folder: ${dir}` }, { status: 400 });
    }
    const entries: Entry[] = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => {
        if (e.name.startsWith('.')) return false;
        if (e.isDirectory()) return true;
        if (e.isSymbolicLink()) {
          try {
            return fs.statSync(path.join(dir, e.name)).isDirectory();
          } catch {
            return false;
          }
        }
        return false;
      })
      .map((e) => ({
        name: e.name,
        path: path.join(dir, e.name).replace(/\\/g, '/'),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Parent: the containing folder, or null at a drive root (back to drives).
    const normalized = dir.replace(/\/+$/, '');
    const isDriveRoot = /^[A-Za-z]:$/.test(normalized);
    const parent = isDriveRoot
      ? null
      : path.dirname(normalized).replace(/\\/g, '/');

    return NextResponse.json({
      path: dir.replace(/\/+$/, '') || dir,
      parent,
      entries,
    });
  } catch (e) {
    console.error('Error browsing folder:', e);
    return NextResponse.json({ error: 'Failed to read folder' }, { status: 500 });
  }
}
