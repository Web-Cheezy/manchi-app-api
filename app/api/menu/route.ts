import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(_req: NextRequest) {
  try {
    // Assuming you have a 'menu_items' table
    const { data, error } = await supabase
      .from('menu_items')
      .select('*')
      .order('name');

    if (error) throw error;

    return NextResponse.json({ menu: data });
  } catch (error: unknown) {
    console.error('Fetch Menu Error:', error);
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
