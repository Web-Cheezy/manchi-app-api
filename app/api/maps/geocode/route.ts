import { NextRequest, NextResponse } from 'next/server';
import { validateRequest, unauthorizedResponse } from '@/lib/auth';

async function geocodeByAddress(address: string, apiKey: string) {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', address);
  url.searchParams.set('key', apiKey);

  const response = await fetch(url.toString(), { method: 'GET' });
  const data = await response.json();

  return { response, data };
}

async function reverseGeocode(lat: number, lng: number, apiKey: string) {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('latlng', `${lat},${lng}`);
  url.searchParams.set('key', apiKey);

  const response = await fetch(url.toString(), { method: 'GET' });
  const data = await response.json();

  return { response, data };
}

function buildErrorResponse(data: any, statusCode: number) {
  return NextResponse.json(
    {
      error:
        data?.error_message ||
        data?.status ||
        'Failed to call Google Maps Geocoding API',
    },
    { status: statusCode },
  );
}

function buildSuccessResponse(data: any) {
  const results = Array.isArray(data?.results)
    ? data.results.map((item: any) => ({
        formatted_address: item.formatted_address,
        location: item.geometry?.location,
        place_id: item.place_id,
      }))
    : [];

  return NextResponse.json({
    status: data.status,
    results,
  });
}

export async function GET(req: NextRequest) {
  if (!validateRequest(req)) return unauthorizedResponse();

  const searchParams = req.nextUrl.searchParams;
  const address = searchParams.get('address');

  if (!address) {
    return NextResponse.json(
      { error: 'Address query parameter is required' },
      { status: 400 },
    );
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    console.error('GOOGLE_MAPS_API_KEY is not defined');
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }

  try {
    const { response, data } = await geocodeByAddress(address, apiKey);

    if (!response.ok || data.status !== 'OK') {
      return buildErrorResponse(data, response.status || 500);
    }

    return buildSuccessResponse(data);
  } catch (error) {
    console.error('Error calling Google Maps Geocoding API:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  if (!validateRequest(req)) return unauthorizedResponse();

  let body: any;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const { address, lat, lng } = body || {};

  if (!address && (lat === undefined || lng === undefined)) {
    return NextResponse.json(
      { error: 'Provide either address or both lat and lng' },
      { status: 400 },
    );
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    console.error('GOOGLE_MAPS_API_KEY is not defined');
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }

  try {
    let result;

    if (address) {
      result = await geocodeByAddress(address, apiKey);
    } else {
      const latNum = Number(lat);
      const lngNum = Number(lng);

      if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
        return NextResponse.json(
          { error: 'lat and lng must be valid numbers' },
          { status: 400 },
        );
      }

      result = await reverseGeocode(latNum, lngNum, apiKey);
    }

    const { response, data } = result;

    if (!response.ok || data.status !== 'OK') {
      return buildErrorResponse(data, response.status || 500);
    }

    return buildSuccessResponse(data);
  } catch (error) {
    console.error('Error calling Google Maps Geocoding API:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
}
