import { buildIndex, buildProjectDeep } from '@/lib/indexer';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const deep = params.get('deep') === '1';
    const project = params.get('project');
    // Deep-scan a single project on demand (much cheaper than a global deep).
    const index =
      deep && project ? buildProjectDeep(project) : buildIndex(deep);
    return NextResponse.json(index);
  } catch (error) {
    console.error('Error building index:', error);
    return NextResponse.json(
      { error: 'Failed to build index' },
      { status: 500 }
    );
  }
}
