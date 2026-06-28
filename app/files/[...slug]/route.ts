import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getIndexDirs } from '@/lib/indexer';

export const dynamic = 'force-dynamic';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

// Serves a file inside a configured index root. The slug is
// [rootIndex, ...relativePathSegments]; the URL mirrors the filesystem so an
// HTML doc's relative assets (./style.css) resolve to sibling files.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  const { slug } = await params;

  if (!slug || slug.length < 2) {
    return NextResponse.json({ error: 'Bad path' }, { status: 400 });
  }

  const roots = getIndexDirs();
  const rootIndex = Number(slug[0]);
  const root = roots[rootIndex];
  if (!root) {
    return NextResponse.json({ error: 'Unknown root' }, { status: 404 });
  }

  const rel = slug.slice(1).map((s) => decodeURIComponent(s));
  const base = path.resolve(root).replace(/\\/g, '/');
  const resolved = path.resolve(root, ...rel).replace(/\\/g, '/');

  // Path-traversal guard: the resolved file must stay inside the root.
  if (resolved !== base && !resolved.startsWith(base + '/')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const data = fs.readFileSync(resolved);
    const ext = path.extname(resolved).toLowerCase();
    const type = CONTENT_TYPES[ext] ?? 'application/octet-stream';
    return new NextResponse(new Uint8Array(data), {
      headers: {
        'Content-Type': type,
        'Cache-Control': 'no-cache',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}
