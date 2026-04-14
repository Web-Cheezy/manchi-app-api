import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const lga = searchParams.get('lga');

    if (!lga) {
      return NextResponse.json(
        { message: 'LGA parameter is required' },
        { status: 400 }
      );
    }

    const cleanedLga = lga.trim();
    if (cleanedLga.length > 120) {
      return NextResponse.json({ price: 3500 });
    }

    // 2. Fetch price from database
    // Next.js searchParams.get() handles URL decoding automatically
    const { data, error } = await supabase
      .from('transport_prices')
      .select('price')
      .eq('lga', cleanedLga)
      .single();

    if (error || !data) {
      console.log(`Transport price not found for LGA: ${lga}. Defaulting to 3500.`);
      return NextResponse.json({ price: 3500 });
    }

    // 3. Return the price as an integer
    return NextResponse.json({ price: Math.round(data.price) });

  } catch (error) {
    console.error('Error fetching transport price:', error);
    return NextResponse.json(
      { message: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
