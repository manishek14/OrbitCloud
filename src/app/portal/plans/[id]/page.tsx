"use client";

// Real route: /portal/plans/[id] (dynamic segment from the route params)

import { useParams } from "next/navigation";
import { AppRoot } from "@/components/app-root";

export default function Page() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params.id : "";
  return <AppRoot route={"/portal/plans/" + id} />;
}
