import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const checks = {
    paystack: { status: 'unknown', message: '' },
    database: { status: 'unknown', message: '' },
    env: { status: 'unknown', message: '' },
  };

  // 1. Check Environment Variables
  const hasPaystack = !!process.env.PAYSTACK_SECRET_KEY;
  const hasSupabaseUrl = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
  const hasSupabaseKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  const hasGoogleMapsKey = !!process.env.GOOGLE_MAPS_API_KEY;

  if (hasPaystack && hasSupabaseUrl && hasSupabaseKey && hasGoogleMapsKey) {
    checks.env.status = 'healthy';
    checks.env.message = 'All variables configured';
  } else {
    checks.env.status = 'unhealthy';
    checks.env.message = `Missing: ${[
      !hasPaystack ? 'PAYSTACK_SECRET_KEY' : '',
      !hasSupabaseUrl ? 'NEXT_PUBLIC_SUPABASE_URL' : '',
      !hasSupabaseKey ? 'SUPABASE_SERVICE_ROLE_KEY' : '',
      !hasGoogleMapsKey ? 'GOOGLE_MAPS_API_KEY' : '',
    ].filter(Boolean).join(', ')}`;
  }

  // 2. Check Database Connection
  try {
    const { error } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true });

    if (error) {
      checks.database.status = 'unhealthy';
      checks.database.message = error.message;
    } else {
      checks.database.status = 'healthy';
      checks.database.message = 'Connected to Supabase';
    }
  } catch (err: unknown) {
    checks.database.status = 'unhealthy';
    checks.database.message = err instanceof Error ? err.message : 'Connection failed';
  }

  // 3. Check Paystack (Simple availability check via IP or just config)
  // Since we can't easily ping Paystack without making a real transaction or using a dedicated ping endpoint (which they don't explicitly document as public/free),
  // we will rely on the config check. But we can try to hit their base API to see if it's reachable from the server.
  try {
      const response = await fetch('https://api.paystack.co', { method: 'GET' });
      // Paystack root often returns 200 or 404, but just checking network connectivity is good enough.
      // Actually, Paystack root returns "Paystack API" string usually.
      if (response.ok || response.status === 200 || response.status === 404) {
          checks.paystack.status = 'healthy';
          checks.paystack.message = 'Paystack API is reachable';
      } else {
          checks.paystack.status = 'degraded';
          checks.paystack.message = `Status: ${response.status}`;
      }
  } catch {
      checks.paystack.status = 'unhealthy';
      checks.paystack.message = 'Could not reach Paystack API';
  }

  const overallStatus = 
    checks.env.status === 'healthy' && 
    checks.database.status === 'healthy' && 
    (checks.paystack.status === 'healthy' || checks.paystack.status === 'degraded') // degraded is okay for network check
    ? 'healthy' : 'unhealthy';

  return NextResponse.json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    checks,
  });
}
