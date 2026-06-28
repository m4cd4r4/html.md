import { buildIndex } from '@/lib/indexer';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const index = buildIndex();
    return NextResponse.json(index);
  } catch (error) {
    console.error('Error building index:', error);
    return NextResponse.json(
      { error: 'Failed to build index' },
      { status: 500 }
    );
  }
}
