# Backend Documentation & Integration Guide

## 1. Architecture Overview

This backend is built using **Next.js 14+ (App Router)** and **Supabase**. It functions as a collection of serverless API endpoints that handle data processing, authentication, and database interactions.

### Core Technologies
- **Framework**: Next.js (App Router)
- **Database**: PostgreSQL (via Supabase)
- **Authentication**: Supabase Auth (JWT) + API Key Security
- **Payment Processing**: Paystack
- **Maps**: Google Maps API

---

## 2. Authentication & Security

The API uses two layers of security:

### A. API Key Protection (`validateRequest`)
Every request to the API is intercepted by a helper function `validateRequest` in `lib/auth.ts`.
- **Mechanism**: Checks for a custom header `x-api-key`.
- **Reason**: Prevents unauthorized external usage of your API.
- **Implementation**:
  ```typescript
  // lib/auth.ts
  export function validateRequest(req: NextRequest) {
    const apiKey = req.headers.get('x-api-key');
    if (apiKey !== process.env.API_SECRET_KEY) return false;
    return true;
  }
  ```

### B. User Authentication (Supabase Auth)
For user-specific data (like profile, orders), the API expects an **Authorization Bearer Token** (JWT) or a `userId` to verify identity against Supabase.

---

## 3. Database Integration (`lib/supabase.ts`)

We use the `@supabase/supabase-js` client to interact with the database.

- **Initialization**:
  A single instance is created in `lib/supabase.ts` using environment variables.
  ```typescript
  import { createClient } from '@supabase/supabase-js';
  export const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  ```
  *Note: We use the `SERVICE_ROLE_KEY` on the backend to bypass Row Level Security (RLS) when necessary, allowing the API to act with admin privileges.*

---

## 4. API Routes Breakdown

The API is organized by resource in the `app/api/` directory.

### 📍 Addresses (`app/api/addresses`)
Handles user address management.
- **GET /api/addresses?userId={id}**: Fetches all addresses for a user.
- **POST /api/addresses**: Creates a new address.
  - **Logic**: Accepts app-specific fields (`lga`, `area`, `street`, `house_number`) and saves them directly.
  - **Smart Defaults**: If `is_default` is true, it automatically sets all other addresses for that user to `false`.
- **PUT /api/addresses/[id]**: Updates an address.
- **DELETE /api/addresses/[id]**: Removes an address.

### 🛒 Orders (`app/api/orders`)
Handles order creation and history.
- **POST /api/orders**:
  1. Receives order details + items list.
  2. Creates a record in `orders` table.
  3. Uses the returned `order_id` to insert multiple rows into `order_items`.
  - *Key Feature*: Uses JSONB or relational tables to store complex item data.

### 🔐 Auth (`app/api/auth/*`)
Wrappers around Supabase Auth.
- **/login**: `supabase.auth.signInWithPassword`
- **/signup**: `supabase.auth.signUp`
- **/otp** & **/verify**: Handles passwordless/email verification flows.

### 💳 Payments (`app/api/paystack/*`)
- **/initialize**: Calls Paystack API to generate a checkout URL.
- **/verify**: Confirms payment status and updates the database.

---

## 5. How to Implement Your Own Backend Integration

If you are building a website (React, Vue, etc.) or Mobile App (Flutter, React Native) to consume this API, follow these steps:

### Step 1: Base Configuration
Set your base URL and API Key in your frontend environment.
```javascript
const BASE_URL = "https://your-domain.com/api";
const API_KEY = "your_secret_api_key";
```

### Step 2: Global Headers
Every HTTP request **MUST** include these headers:
```json
{
  "Content-Type": "application/json",
  "x-api-key": "your_secret_api_key"
}
```

### Step 3: Making Requests (Example: Fetching Addresses)

#### Javascript (Fetch API)
```javascript
async function getAddresses(userId) {
  const response = await fetch(`${BASE_URL}/addresses?userId=${userId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY
    }
  });
  return response.json();
}
```

#### Flutter (Dart/Http)
```dart
Future<List<Address>> getAddresses(String userId) async {
  final response = await http.get(
    Uri.parse('$baseUrl/addresses?userId=$userId'),
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
  );
  // parse response...
}
```

### Step 4: Handling Errors
The API returns consistent error formats:
- **Success (200/201)**: Returns JSON data.
- **User Error (400)**: `{"error": "Missing required fields"}`
- **Auth Error (401)**: `{"error": "Unauthorized: Invalid API Key"}`
- **Server Error (500)**: `{"error": "Internal Server Error"}`

Always wrap your API calls in `try/catch` blocks to handle these gracefully.
