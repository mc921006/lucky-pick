import { NextResponse } from "next/server";
import { loadSpeettoData, syncSpeettoData } from "@/lib/speetto/sync";
import type { SpeettoProduct } from "@/lib/speetto/types";

export const runtime = "nodejs";

export async function POST() {
  let storedProducts: SpeettoProduct[] = [];

  try {
    storedProducts = await loadSpeettoData();
    const products = await syncSpeettoData();
    return NextResponse.json({ success: true, source: "sync", products });
  } catch (error) {
    if (storedProducts.length > 0) {
      return NextResponse.json({
        success: true,
        source: "stale-cache",
        warning: error instanceof Error ? error.message : "최신 정보를 가져오지 못했습니다.",
        products: storedProducts,
      });
    }

    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : "스피또 정보를 동기화하지 못했습니다.",
    }, { status: 502 });
  }
}
