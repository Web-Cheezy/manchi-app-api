require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

async function testConnection() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  console.log('Testing Supabase Connection...');
  console.log('URL:', url);
  console.log('Key Length:', key ? key.length : 0);

  if (!url || !key) {
    console.error('Error: Missing environment variables.');
    return;
  }

  const supabase = createClient(url, key);

  try {
    // Try a simple select first
    console.log('Attempting to select from "transactions"...');
    const { data, error, status, statusText } = await supabase
      .from('transactions')
      .select('*')
      .limit(1);

    if (error) {
      console.error('Connection Failed.');
      console.error('Status:', status, statusText);
      console.error('Error Object:', JSON.stringify(error, null, 2));
      
      if (status === 404) {
          console.error('POSSIBLE CAUSE: The table "transactions" does not exist.');
      } else if (status === 401 || status === 403) {
          console.error('POSSIBLE CAUSE: Invalid API Key or Permissions.');
      } else if (status === 0 || status === 500) {
           console.error('POSSIBLE CAUSE: Network error or Supabase project is paused.');
      }

    } else {
      console.log('Connection Successful!');
      console.log('Data found:', data.length);
    }
  } catch (err) {
    console.error('Unexpected Exception:', err);
  }
}

testConnection();
