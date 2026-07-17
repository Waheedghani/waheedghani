/**
 * Shared application types mirroring the database schema.
 * Monetary values arrive from PostgREST as strings (NUMERIC) — they are
 * never converted to JS floats; see lib/money.ts.
 */
import type { Currency } from "@/lib/money";

export type AppRole = "admin" | "office" | "warehouse";

export interface AppUser {
  id: string;
  full_name: string;
  role: AppRole;
  warehouse_id: string | null;
  is_active: boolean;
}

export type EntryStatus = "draft" | "posted" | "reversed";
export type DocStatus = "draft" | "posted" | "closed" | "reversed";
export type OrderStatus = "open" | "partially_received" | "received" | "closed";

export interface Account {
  id: string;
  code: string;
  name: string;
  name_ps: string;
  type: string;
  fixed_currency: Currency | null;
  is_active: boolean;
}

export interface Supplier {
  id: string;
  name: string;
  name_ps: string;
  country: string;
  contact: string | null;
  phone: string | null;
  address: string | null;
  account_id: string;
  is_active: boolean;
}

export interface Warehouse {
  id: string;
  name: string;
  name_ps: string;
  keeper_name: string | null;
  phone: string | null;
  address: string | null;
  account_id: string;
  is_active: boolean;
}

export interface Saraf {
  id: string;
  name: string;
  name_ps: string;
  phone: string | null;
  address: string | null;
  account_id: string;
  is_active: boolean;
}

export interface Product {
  id: string;
  code: string;
  name: string;
  name_ps: string;
  category: "oil" | "sugar";
  is_active: boolean;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  label: string;
  label_ps: string;
  unit: "bottle" | "kg" | "bag";
  size_value: string | null;
  kg_per_bag: string | null;
  is_active: boolean;
  products?: Product;
}
