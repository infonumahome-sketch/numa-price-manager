import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  return NextResponse.json({ 
    version: 'NUEVO-v2',
    timestamp: new Date().toISOString(),
    message: 'Este es el route nuevo'
  });
}
