import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const INITIAL_REQUESTED_COUNT = 100;
const OPENAI_BATCH_SIZE = 20;
const MAX_ROUND = 100_000;

type LottoSearchResult = {
  round: number;
  draw_date: string;
  numbers: [number, number, number, number, number, number];
  bonus: number;
};

type LottoDrawRow = {
  round: number;
  draw_date: string;
  number1: number;
  number2: number;
  number3: number;
  number4: number;
  number5: number;
  number6: number;
  bonus_number: number;
};

class OpenAIRequestError extends Error {}
class InvalidOpenAIResponseError extends Error {}
class SupabaseLatestRoundError extends Error {}

function getRequiredEnv(name: "OPENAI_API_KEY" | "OPENAI_MODEL") {
  const value = process.env[name];

  if (!value) {
    throw new OpenAIRequestError(`${name} environment variable is not configured.`);
  }

  return value;
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isValidDrawDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validateDraw(value: unknown): LottoSearchResult {
  if (!value || typeof value !== "object") {
    throw new InvalidOpenAIResponseError("A lotto draw is not an object.");
  }

  const draw = value as Partial<LottoSearchResult>;
  const numbers = draw.numbers;

  if (
    !isIntegerInRange(draw.round, 1, MAX_ROUND) ||
    !isValidDrawDate(draw.draw_date) ||
    !Array.isArray(numbers) ||
    numbers.length !== 6 ||
    !numbers.every((number) => isIntegerInRange(number, 1, 45)) ||
    new Set(numbers).size !== 6 ||
    !isIntegerInRange(draw.bonus, 1, 45) ||
    numbers.includes(draw.bonus)
  ) {
    throw new InvalidOpenAIResponseError("A lotto draw failed validation.");
  }

  return {
    round: draw.round,
    draw_date: draw.draw_date,
    numbers: numbers as LottoSearchResult["numbers"],
    bonus: draw.bonus,
  };
}

function parseOpenAIResults(outputText: string): LottoSearchResult[] {
  let parsed: unknown;
  const trimmedOutput = outputText.trim();
  const fencedJson = trimmedOutput.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const jsonText = fencedJson?.[1] ?? trimmedOutput;

  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new InvalidOpenAIResponseError("OpenAI did not return valid JSON.");
  }

  if (!Array.isArray(parsed)) {
    throw new InvalidOpenAIResponseError("OpenAI did not return a JSON array.");
  }

  return parsed.map(validateDraw);
}

async function askOpenAI(prompt: string): Promise<LottoSearchResult[]> {
  let response: Awaited<ReturnType<OpenAI["responses"]["create"]>>;

  try {
    const client = new OpenAI({ apiKey: getRequiredEnv("OPENAI_API_KEY") });
    response = await client.responses.create({
      model: getRequiredEnv("OPENAI_MODEL"),
      tools: [{ type: "web_search", search_context_size: "high" }],
      tool_choice: "required",
      input: prompt,
    });
  } catch (error) {
    if (error instanceof OpenAIRequestError) {
      throw error;
    }

    throw new OpenAIRequestError(error instanceof Error ? error.message : "OpenAI request failed.");
  }

  if (!response.output_text) {
    throw new InvalidOpenAIResponseError("OpenAI returned an empty response.");
  }

  return parseOpenAIResults(response.output_text);
}

async function fetchLatestDraw(): Promise<LottoSearchResult> {
  const results = await askOpenAI(`
Use web search to find the latest completed Korean Lotto 6/45 winning result.
Prefer a current, reliable source and cross-check the draw number, draw date,
six winning numbers, and bonus number. Do not use memory alone.

Return JSON only as an array containing exactly one object for the latest
completed draw. The required shape is:
[{"round":number,"draw_date":"YYYY-MM-DD","numbers":[n1,n2,n3,n4,n5,n6],"bonus":number}]
`);

  if (results.length !== 1) {
    throw new InvalidOpenAIResponseError("OpenAI did not return exactly one latest draw.");
  }

  return results[0];
}

async function fetchDrawRange(startRound: number, endRound: number): Promise<LottoSearchResult[]> {
  const results = await askOpenAI(`
Use web search to collect every completed Korean Lotto 6/45 winning result
from round ${startRound} through round ${endRound}, inclusive.
Search current reliable sources and verify each round's draw number, draw date,
six winning numbers, and bonus number. Do not use memory alone.

Return JSON only as an array with exactly one object for every requested round,
in ascending round order. The required shape is:
[{"round":number,"draw_date":"YYYY-MM-DD","numbers":[n1,n2,n3,n4,n5,n6],"bonus":number}]
`);

  if (results.length !== endRound - startRound + 1) {
    throw new InvalidOpenAIResponseError("OpenAI returned an incomplete round range.");
  }

  results.forEach((draw, index) => {
    const expectedRound = startRound + index;

    if (draw.round !== expectedRound) {
      throw new InvalidOpenAIResponseError("OpenAI returned a non-contiguous round range.");
    }
  });

  return results;
}

async function fetchDraws(startRound: number, endRound: number): Promise<LottoSearchResult[]> {
  const draws: LottoSearchResult[] = [];

  for (let batchStart = startRound; batchStart <= endRound; batchStart += OPENAI_BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + OPENAI_BATCH_SIZE - 1, endRound);
    draws.push(...await fetchDrawRange(batchStart, batchEnd));
  }

  return draws;
}

function toLottoDrawRow(draw: LottoSearchResult): LottoDrawRow {
  return {
    round: draw.round,
    draw_date: draw.draw_date,
    number1: draw.numbers[0],
    number2: draw.numbers[1],
    number3: draw.numbers[2],
    number4: draw.numbers[3],
    number5: draw.numbers[4],
    number6: draw.numbers[5],
    bonus_number: draw.bonus,
  };
}

function errorResponse(errorType: string, message: string, status: number, failedRound?: number) {
  return NextResponse.json(
    failedRound === undefined ? { success: false, errorType, message } : { success: false, errorType, message, failedRound },
    { status },
  );
}

export async function POST() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY ||
    !process.env.OPENAI_API_KEY ||
    !process.env.OPENAI_MODEL
  ) {
    return errorResponse("ENVIRONMENT_VARIABLE_ERROR", "서버 환경변수가 올바르게 설정되지 않았습니다.", 500);
  }

  const supabase = createServerSupabaseClient();
  let databaseLatestRound: number | null;

  try {
    const { data, error } = await supabase
      .from("lotto_draws")
      .select("round")
      .order("round", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new SupabaseLatestRoundError(error.message);
    }

    if (data === null) {
      databaseLatestRound = null;
    } else if (isIntegerInRange(data.round, 1, MAX_ROUND)) {
      databaseLatestRound = data.round;
    } else {
      throw new SupabaseLatestRoundError("Invalid database round");
    }
  } catch {
    return errorResponse("SUPABASE_LATEST_ROUND_ERROR", "Supabase의 최신 회차를 조회하지 못했습니다.", 500);
  }

  let latestDraw: LottoSearchResult;

  try {
    latestDraw = await fetchLatestDraw();
  } catch (error) {
    if (error instanceof InvalidOpenAIResponseError) {
      return errorResponse("INVALID_OPENAI_RESPONSE", "OpenAI 검색 결과 형식이 올바르지 않습니다.", 502);
    }

    return errorResponse("OPENAI_REQUEST_ERROR", "OpenAI로 로또 데이터를 가져오지 못했습니다.", 502);
  }

  const latestRound = latestDraw.round;

  if (databaseLatestRound !== null && databaseLatestRound >= latestRound) {
    return NextResponse.json({
      success: true,
      mode: "up-to-date",
      latestRound,
      databaseLatestRound,
      savedCount: 0,
      message: "이미 최신 데이터입니다.",
    });
  }

  const startRound = databaseLatestRound === null
    ? Math.max(1, latestRound - INITIAL_REQUESTED_COUNT + 1)
    : databaseLatestRound + 1;
  let draws: LottoSearchResult[];

  try {
    draws = await fetchDraws(startRound, latestRound);
  } catch (error) {
    if (error instanceof InvalidOpenAIResponseError) {
      return errorResponse("INVALID_OPENAI_RESPONSE", "OpenAI 검색 결과 형식이 올바르지 않습니다.", 502);
    }

    return errorResponse("OPENAI_REQUEST_ERROR", "OpenAI로 로또 데이터를 가져오지 못했습니다.", 502);
  }

  try {
    const { error } = await supabase
      .from("lotto_draws")
      .upsert(draws.map(toLottoDrawRow), { onConflict: "round" });

    if (error) {
      return errorResponse("SUPABASE_SAVE_ERROR", "Supabase에 데이터를 저장하지 못했습니다.", 500);
    }
  } catch {
    return errorResponse("SUPABASE_SAVE_ERROR", "Supabase에 데이터를 저장하지 못했습니다.", 500);
  }

  return NextResponse.json({
    success: true,
    mode: databaseLatestRound === null ? "initial" : "incremental",
    latestRound,
    startRound,
    savedCount: draws.length,
  });
}
