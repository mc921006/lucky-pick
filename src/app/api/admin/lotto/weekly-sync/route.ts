import { NextResponse } from "next/server";
import { isSameKoreaWeek } from "@/lib/cache/korea-week";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { POST as syncLotto } from "@/app/api/admin/lotto/sync/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const { data, error } = await createServerSupabaseClient()
      .from("lotto_analysis_results")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error("저장된 로또 분석 결과를 확인하지 못했습니다.");

    if (data && isSameKoreaWeek(data.created_at)) {
      return NextResponse.json({ success: true, source: "cache", message: "이번 주 분석 결과를 사용합니다." });
    }

    return syncLotto();
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : "주간 로또 동기화에 실패했습니다.",
    }, { status: 500 });
  }
}
