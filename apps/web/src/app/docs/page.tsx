"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function DocsIndexRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/docs/introduction");
  }, [router]);
  return null;
}
