import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedUser } from '@/lib/auth';
import { getUserTransactions } from '@/lib/db';

export async function GET(req: NextRequest) {
  const auth = await requireAuthenticatedUser(req);
  if (!auth.ok) return auth.response;

  const email = auth.user.email;
  if (!email) return NextResponse.json({ error: 'Email is required' }, { status: 400 });

  try {
    // 2. Database Proxy: Fetch data
    const transactions = await getUserTransactions(email);

    return NextResponse.json({
      transactions,
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
