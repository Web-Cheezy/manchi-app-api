# Flutter Integration Guide

This backend acts as a secure proxy for Paystack and your Supabase database.

## 🔑 Base Configuration

- **Base URL**: `https://manchicodes.vercel.app`
- **Required Headers**:
  ```json
  {
    "Content-Type": "application/json",
    "x-api-key": "5418efedd6cbf953ca8c17fafe4ae75c5971acc1fd4ae04cfe95c3c63919e98c"
  }
  ```

---

## 🚀 API Endpoints

### 1. Authentication

#### Send OTP
- **Endpoint**: `POST /api/auth/otp`
- **Body**: `{ "email": "user@example.com" }`
- **Response**: `{ "message": "OTP sent successfully" }`

#### Verify OTP
- **Endpoint**: `POST /api/auth/verify`
- **Body**: `{ "email": "user@example.com", "token": "123456" }`
- **Response**: `{ "session": { ... }, "user": { ... } }`

#### Get Current User
- **Endpoint**: `GET /api/auth/user`
- **Headers**: `Authorization: Bearer <ACCESS_TOKEN>`
- **Response**: `{ "user": { ... } }`

#### Sign Out
- **Endpoint**: `POST /api/auth/signout`
- **Response**: `{ "message": "Signed out successfully" }`

### 2. User Profile

#### Get Profile
- **Endpoint**: `GET /api/profile?userId=...`
- **Response**: `{ "id": "...", "full_name": "...", "phone_number": "..." }`

#### Update Profile
- **Endpoint**: `POST /api/profile`
- **Body**: `{ "id": "...", "full_name": "...", "phone_number": "..." }`

### 3. Menu & Food

#### Get Categories
- **Endpoint**: `GET /api/categories`
- **Response**: `[ { "id": 1, "name": "Burger" }, ... ]`

#### Get All Foods
- **Endpoint**: `GET /api/foods`
- **Response**: `[ { "id": 1, "name": "Cheese Burger", "is_available": true }, ... ]`

#### Get Food Details (with Sides)
- **Endpoint**: `GET /api/foods?id=...`
- **Response**: `{ "id": 1, "name": "...", "food_sides": [ ... ] }`

#### Get Sides
- **Endpoint**: `GET /api/sides`
- **Response**: `[ { "id": 1, "name": "Fries", "type": "standard" }, ... ]`

### 4. Orders

#### Create Order
- **Endpoint**: `POST /api/orders`
- **Body**:
  ```json
  {
    "user_id": "uuid",
    "total_amount": 5000,
    "vat": 100,
    "delivery_address": "...",
    "location": "...",
    "items": [
      { "food_id": 1, "quantity": 2, "price_at_time": 2000, "options": {} }
    ]
  }
  ```
- **Response**: `{ "message": "Order created successfully", "order_id": "..." }`

#### Order History
- **Endpoint**: `GET /api/orders?userId=...`
- **Response**: `{ "orders": [ ... ] }`

### 5. Payments (Paystack)

#### Initialize Transaction
- **Endpoint**: `POST /api/paystack/initialize`
- **Body**:
  ```json
  {
    "email": "user@example.com",
    "amount": "5000",
    "userId": "OPTIONAL_USER_ID",
    "metadata": { "orderId": "123" }
  }
  ```
- **Response**:
  ```json
  {
    "authorization_url": "...",
    "reference": "...",
    "access_code": "..."
  }
  ```

#### Verify Transaction
- **Endpoint**: `GET /api/paystack/verify?reference=YOUR_REFERENCE`

### 6. Maps & Location (Google Maps via Backend)

#### Geocode Address
- **Endpoint**: `POST /api/maps/geocode`
- **Body**:
  ```json
  {
    "address": "1600 Amphitheatre Parkway, Mountain View, CA"
  }
  ```
- **Response**:
  ```json
  {
    "results": [
      {
        "formatted_address": "1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA",
        "location": { "lat": 37.422, "lng": -122.084 },
        "place_id": "..."
      }
    ]
  }
  ```

#### Reverse Geocode Coordinates
- **Endpoint**: `POST /api/maps/geocode`
- **Body**:
  ```json
  {
    "lat": 37.422,
    "lng": -122.084
  }
  ```
- **Response**:
  ```json
  {
    "results": [
      {
        "formatted_address": "1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA",
        "location": { "lat": 37.422, "lng": -122.084 },
        "place_id": "..."
      }
    ]
  }
  ```

---

## 🤖 AI Assistant Prompt for Flutter

Copy and paste this into your Flutter AI assistant:

> I have a deployed Next.js backend at `https://manchicodes.vercel.app` that acts as a secure proxy for my food app.
>
> **Configuration**:
> - **Base URL**: `https://manchicodes.vercel.app`
> - **Auth Header**: All requests must include `x-api-key: 5418efedd6cbf953ca8c17fafe4ae75c5971acc1fd4ae04cfe95c3c63919e98c`.
>
> **Endpoints**:
> 1. **Auth (OTP)**:
>    - `POST /api/auth/otp`: `{email}` -> Sends OTP.
>    - `POST /api/auth/verify`: `{email, token}` -> Returns session/user.
>    - `GET /api/auth/user`: Get current user (requires `Authorization: Bearer <token>`).
> 2. **Profile**:
>    - `GET /api/profile?userId=...`
>    - `POST /api/profile`: `{id, full_name, phone_number}` (Upsert).
> 3. **Menu**:
>    - `GET /api/categories`: List categories.
>    - `GET /api/foods`: List all available foods.
>    - `GET /api/foods?id=...`: Get food detail with sides.
>    - `GET /api/sides`: List sides.
> 4. **Orders**:
>    - `POST /api/orders`: Create order with items. Body: `{user_id, total_amount, vat, delivery_address, location, items: [{food_id, quantity, price_at_time, options}]}`.
>    - `GET /api/orders?userId=...`: Get order history.
> 5. **Payments**:
>    - `POST /api/paystack/initialize`: `{email, amount, userId, metadata}`. Returns `{authorization_url, reference}`.
>    - `GET /api/paystack/verify?reference=...`: Call this after payment.
> 6. **Maps & Location**:
>    - `POST /api/maps/geocode` with `{address}` to convert text address to coordinates.
>    - `POST /api/maps/geocode` with `{lat, lng}` to convert coordinates to a human-readable address.
>


> Please create a `BackendService` class in Dart using the `http` package that handles ALL these API calls.
