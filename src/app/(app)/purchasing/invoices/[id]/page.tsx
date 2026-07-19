"use client";

import { use } from "react";
import { PurchaseInvoiceDoc } from "@/components/documents/PurchaseInvoiceDoc";

export default function PurchaseInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <PurchaseInvoiceDoc id={id} />;
}
