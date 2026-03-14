# Web Admin Panel Implementation Guide

This guide explains how to implement the Role-Based Access Control (RBAC) and Location Filtering in your Web Admin Panel to match the backend logic.

## 1. User Roles & Permissions

There are now three types of users in the system:

| Role | Permissions | Access Scope |
| :--- | :--- | :--- |
| **`super_admin`** | Full Access | • Can see **ALL** orders & transactions from **ALL** locations.<br>• Can see and edit the **Menu** (Foods/Categories).<br>• Can create new admins. |
| **`admin`** | Restricted Access | • Can **ONLY** see orders/transactions for their assigned location (e.g., "Chasemall").<br>• **CANNOT** see or edit the Menu.<br>• **CANNOT** create new admins. |
| **`customer`** | No Admin Access | • Can only see their own personal order history.<br>• **MUST** be blocked from the Admin Dashboard entirely. |

---

## 2. How Location Filtering Works (The "Magic" Part)

You do **NOT** need to write complex filtering logic in your frontend code (e.g., `orders.filter(...)`). The database handles this automatically via Row Level Security (RLS).

### The Logic
1.  **The App sends:** `"Chasemall 33, Abakaliki Road..."` (Full Address)
2.  **The Admin Profile has:** `location = "Chasemall"` (Short Code)
3.  **The Database Rule (RLS) says:**
    > "If I am an Admin with location 'Chasemall', show me any order where the order's location **CONTAINS** the word 'Chasemall'."

### What this means for you:
When you run this code in your Admin Panel:
```javascript
const { data: orders } = await supabase.from('orders').select('*');
```
*   **Super Admin** will get **100 orders** (Chasemall + Aurora).
*   **Chasemall Admin** will get **60 orders** (Only Chasemall).
*   **Aurora Admin** will get **40 orders** (Only Aurora).
*   **Customer** will get **0 orders** (Access Denied).

**You just fetch the data. The database ensures they only see what they are allowed to see.**

---

## 3. Implementation Steps for Web Admin

### Step A: Login & Role Check
When a user logs in, fetch their profile immediately to determine their access level.

```javascript
// 1. Get User
const { data: { user } } = await supabase.auth.getUser();

// 2. Get Profile (Role & Location)
const { data: profile } = await supabase
  .from('profiles')
  .select('role, location')
  .eq('id', user.id)
  .single();

// 3. Handle Access
if (profile.role === 'customer') {
  // REDIRECT THEM OUT IMMEDIATELY
  window.location.href = '/access-denied'; 
  return;
}

// Store profile in state/context for UI logic
setCurrentUser(profile);
```

### Step B: UI Conditional Rendering
Hide/Show tabs based on the `role`.

```jsx
// React Example
return (
  <div className="dashboard-sidebar">
    <Link to="/orders">Orders</Link>
    <Link to="/transactions">Transactions</Link>
    
    {/* ONLY Super Admins can see the Menu tab */}
    {profile.role === 'super_admin' && (
      <Link to="/menu">Menu Management</Link>
    )}
    
    {/* ONLY Super Admins can see User Management */}
    {profile.role === 'super_admin' && (
      <Link to="/users">Manage Admins</Link>
    )}
  </div>
);
```

### Step C: Creating Data (Menu Items)
Since only Super Admins can create food, ensure your "Create Food" API calls or Forms are protected.
The RLS policies will likely block regular admins from inserting into `foods` or `categories` tables (you should verify this in your SQL policies if not already done).

---

## 4. Summary of Data Flow

1.  **App** sends full address: `"Aurora Mall, No. 39..."`
2.  **Backend** saves it as-is.
3.  **Admin Panel** logs in user.
4.  **Admin Panel** fetches `orders`.
5.  **Supabase** checks: "Does `"Aurora Mall..."` match the admin's location `"Aurora"`? **YES**.
6.  **Admin Panel** displays the order.

This ensures that your "Chasemall" admin will never accidentally see an "Aurora" order, and your "Super Admin" can oversee everything.
