import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getIndexDirs } from '@/lib/indexer';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: { path?: string; content?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const { path: filePath, content } = body;
  if (!filePath || typeof content !== 'string') {
    return NextResponse.json({ error: 'Missing path or content' }, { status: 400 });
  }

  // Security: only write .md files inside a configured index directory.
  const resolved = path.resolve(filePath).replace(/\\/g, '/');
  const allowed = getIndexDirs().some((dir) => {
    const base = path.resolve(dir).replace(/\\/g, '/');
    return resolved === base || resolved.startsWith(base + '/');
  });

  if (!allowed || !resolved.toLowerCase().endsWith('.md')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Only overwrite an existing file (never create new paths through this route).
  if (!fs.existsSync(resolved)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    fs.writeFileSync(resolved, content, 'utf8');
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Write failed' }, { status: 500 });
  }
}
