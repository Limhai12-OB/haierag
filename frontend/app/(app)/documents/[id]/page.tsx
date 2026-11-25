"use client";

import { use } from "react";
import { DocumentDetailView } from "@/features/documents/document-detail-view";

export default function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <DocumentDetailView key={id} id={id} />;
}
