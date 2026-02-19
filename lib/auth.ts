import { NextRequest, NextResponse } from 'next/server';

export function validateRequest(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key');
  const validApiKey = process.env.API_SECRET_KEY;

  if (!apiKey || apiKey !== validApiKey) {
    return false;
  }
  return true;
}

export function unauthorizedResponse() {
  return NextResponse.json(
    { error: 'Unauthorized: Invalid API Key' },
    { status: 401 }
  );
}
