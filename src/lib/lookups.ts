"use client";

/** Shared reference-data queries (parties, variants, categories). */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import type { ProductVariant, Saraf, Supplier, Warehouse } from "@/lib/types";

export function useSuppliers() {
  return useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("suppliers")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as Supplier[];
    },
  });
}

export function useWarehouses() {
  return useQuery({
    queryKey: ["warehouses"],
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("warehouses")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as Warehouse[];
    },
  });
}

export function useSarafs() {
  return useQuery({
    queryKey: ["sarafs"],
    queryFn: async () => {
      const { data, error } = await supabase().from("sarafs").select("*").order("name");
      if (error) throw error;
      return data as Saraf[];
    },
  });
}

export function useVariants() {
  return useQuery({
    queryKey: ["variants"],
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("product_variants")
        .select("*, products(id, code, name, name_ps, category, is_active)")
        .order("label");
      if (error) throw error;
      return data as ProductVariant[];
    },
  });
}

export function useExpenseCategories() {
  return useQuery({
    queryKey: ["expense_categories"],
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("expense_categories")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as Array<{ id: string; name: string; name_ps: string; account_id: string; is_active: boolean }>;
    },
  });
}

/** Uniform error → user message (Supabase errors carry useful text). */
export function errMsg(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}
