import fs from 'fs';
import { getConfigDirs, setConfigDirs, rebuildNow } from '@/lib/indexer';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function normalize(dir: string): string {
  return dir.replace(/\\/g, '/').replace(/\/+$/, '').trim();
}

export async function GET() {
  return NextResponse.json({ dirs: getConfigDirs() });
}

// Add a scan dir. Validates it exists and is a directory before persisting.
export async function POST(request: Request) {
  try {
    const { dir } = await request.json();
    const clean = normalize(typeof dir === 'string' ? dir : '');
    if (!clean) {
      return NextResponse.json({ error: 'No folder given' }, { status: 400 });
    }
    if (!fs.existsSync(clean) || !fs.statSync(clean).isDirectory()) {
      return NextResponse.json(
        { error: `Not a folder: ${clean}` },
        { status: 400 }
      );
    }
    const current = getConfigDirs();
    if (current.some((d) => normalize(d).toLowerCase() === clean.toLowerCase())) {
      return NextResponse.json({ dirs: current });
    }
    const dirs = setConfigDirs([...current, clean]);
    // Warm the cache before responding so the UI's refetch gets the full index
    // instead of the empty placeholder mid-rebuild.
    const index = await rebuildNow();
    return NextResponse.json({ dirs, docCount: index.docs.length });
  } catch (e) {
    console.error('Error adding scan dir:', e);
    return NextResponse.json({ error: 'Failed to add folder' }, { status: 500 });
  }
}

// Remove a scan dir.
export async function DELETE(request: Request) {
  try {
    const { dir } = await request.json();
    const clean = normalize(typeof dir === 'string' ? dir : '').toLowerCase();
    const dirs = setConfigDirs(
      getConfigDirs().filter((d) => normalize(d).toLowerCase() !== clean)
    );
    const index = await rebuildNow();
    return NextResponse.json({ dirs, docCount: index.docs.length });
  } catch (e) {
    console.error('Error removing scan dir:', e);
    return NextResponse.json(
      { error: 'Failed to remove folder' },
      { status: 500 }
    );
  }
}
