import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { validateRequest, unauthorizedResponse } from '@/lib/auth';

export async function GET(req: NextRequest) {
  if (!validateRequest(req)) return unauthorizedResponse();

  const searchParams = req.nextUrl.searchParams;
  const foodId = searchParams.get('id');

  try {
    if (foodId) {
      // Get detailed food info with sides
      const { data, error } = await supabase
        .from('foods')
        .select('*, food_sides(side:sides(*))')
        .eq('id', foodId)
        .single();

      if (error) throw error;
      return NextResponse.json(data);
    } else {
      // Get all available foods
      const { data, error } = await supabase
        .from('foods')
        .select('*')
        .eq('is_available', true)
        .order('name');

      if (error) throw error;
      return NextResponse.json(data);
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
