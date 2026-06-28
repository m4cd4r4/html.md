import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getIndexDirs } from '@/lib/indexer';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const filePath = searchParams.get('path');

  if (!filePath) {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 });
  }

  // Security: only allow reading .md files that live inside a configured
  // index directory. Resolve to an absolute, normalized path first to block
  // path-traversal (../) escapes.
  const resolved = path.resolve(filePath).replace(/\\/g, '/');
  const allowed = getIndexDirs().some((dir) => {
    const base = path.resolve(dir).replace(/\\/g, '/');
    return resolved === base || resolved.startsWith(base + '/');
  });

  if (!allowed || !resolved.toLowerCase().endsWith('.md')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const content = fs.readFileSync(resolved, 'utf8');
    return NextResponse.json({ content });
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}
