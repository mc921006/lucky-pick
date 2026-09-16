import { NextResponse } from "next/server";
import { getLatestCompletedDraw } from "@/lib/lotto/draw-calendar";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { POST as syncLotto } from "@/app/api/admin/lotto/sync/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const expectedDraw = getLatestCompletedDraw();
    const { data, error } = await createServerSupabaseClient()
      .from("lotto_draws")
      .select("round, draw_date")
      .order("round", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error("저장된 로또 당첨 데이터를 확인하지 못했습니다.");

    if (data && data.round === expectedDraw.round && data.draw_date === expectedDraw.date) {
      return NextResponse.json({ success: true, source: "draws", message: "최신 당첨 데이터가 이미 반영되어 있습니다." });
    }

    return syncLotto();
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : "주간 로또 동기화에 실패했습니다.",
    }, { status: 500 });
  }
}
