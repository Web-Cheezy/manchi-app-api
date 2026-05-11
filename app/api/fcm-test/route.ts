import { NextResponse } from 'next/server';
import { fcmSelfTest } from '@/lib/fcm';

export async function GET() {
  const result = await fcmSelfTest();
  return NextResponse.json(result);
}

