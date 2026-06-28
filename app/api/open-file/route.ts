import { NextResponse } from 'next/server';
import { spawn } from 'child_process';

export async function POST(request: Request) {
  try {
    const { path } = await request.json();

    if (!path || typeof path !== 'string') {
      return NextResponse.json(
        { error: 'Invalid path' },
        { status: 400 }
      );
    }

    // Use 'code' CLI to open the file
    spawn('code', [path], {
      detached: true,
      stdio: 'ignore',
    }).unref();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error opening file:', error);
    return NextResponse.json(
      { error: 'Failed to open file' },
      { status: 500 }
    );
  }
}
