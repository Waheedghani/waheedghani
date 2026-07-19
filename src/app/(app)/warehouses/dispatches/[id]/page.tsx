"use client";

import { use } from "react";
import { DispatchDoc } from "@/components/documents/DispatchDoc";

export default function DispatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <DispatchDoc id={id} />;
}
