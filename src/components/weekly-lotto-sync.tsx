"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function WeeklyLottoSync() {
  const router = useRouter();

  useEffect(() => {
    fetch("/api/admin/lotto/weekly-sync", { method: "POST" })
      .then(async (response) => {
        if (!response.ok) throw new Error("weekly lotto sync failed");
        const result = await response.json();
        if (result.mode === "initial" || result.mode === "incremental") router.refresh();
      })
      .catch(() => {
        // Retry on a later page visit if the draw data could not be synchronized.
      });
  }, [router]);

  return null;
}
