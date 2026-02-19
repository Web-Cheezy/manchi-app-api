import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { validateRequest, unauthorizedResponse } from '@/lib/auth';

export async function GET(req: NextRequest) {
  if (!validateRequest(req)) return unauthorizedResponse();

  try {
    // Assuming you have a 'menu_items' table
    const { data, error } = await supabase
      .from('menu_items')
      .select('*')
      .order('name');

    if (error) throw error;

    return NextResponse.json({ menu: data });
  } catch (error: any) {
    console.error('Fetch Menu Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
