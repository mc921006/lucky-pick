"use client";

import { useEffect } from "react";
import { isKoreaMonday } from "@/lib/cache/korea-week";

export default function WeeklyLottoSync() {
  useEffect(() => {
    if (!isKoreaMonday()) return;

    fetch("/api/admin/lotto/weekly-sync", { method: "POST" })
      .then((response) => {
        if (!response.ok) throw new Error("weekly lotto sync failed");
      })
      .catch(() => {
        // Retry on the next page visit if the weekly sync could not complete.
      });
  }, []);

  return null;
}
