import { createServerSupabaseClient } from "@/lib/supabase/server";
import { SPEETTO_PRICES, type CollectedSpeettoProduct, type SpeettoPrice, type SpeettoProduct, type SpeettoPrize } from "./types";

const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SPEETTO_ENDPOINT = "https://www.dhlottery.co.kr/st/selectSellStInfo.do?srchStGmTypeCd=";
const SPEETTO_CODES: Record<SpeettoPrice, string> = { 500: "SP500", 1000: "SP1000", 2000: "SP2000" };
const SOURCE_URLS: Record<SpeettoPrice, string> = {
  500: "https://www.dhlottery.co.kr/st/st5Intro",
  1000: "https://www.dhlottery.co.kr/st/st10Intro",
  2000: "https://www.dhlottery.co.kr/st/st20Intro",
};

type OfficialProductData = {
  stEpsd?: unknown;
  stSpmtRt?: unknown;
  stMainImgStrgPathNm?: unknown;
  stRnk1GdsSstcCharCn?: unknown;
  stRnk2GdsSstcCharCn?: unknown;
  stRnk3GdsSstcCharCn?: unknown;
  stRnk4GdsSstcCharCn?: unknown;
  stRnk5GdsSstcCharCn?: unknown;
  stRnk6GdsSstcCharCn?: unknown;
  [key: string]: unknown;
};

type OfficialPayload = { data?: { list?: OfficialProductData[] } };

function isInteger(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum;
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    if (Number.isFinite(parsed)) return Math.max(0, parsed);
  }
  return 0;
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(/,/g, "").trim());
    if (Number.isFinite(parsed)) return Math.max(0, parsed);
  }
  return null;
}

function readText(data: OfficialProductData, keys: string[]): string {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return "";
}

function isSelling(data: OfficialProductData): boolean {
  const status = readText(data, [
    "sale_status",
    "saleStatus",
    "stSaleStatNm",
    "stSaleStatCd",
    "stSaleYn",
    "sellStatus",
  ]).toLowerCase();

  if (!status) return false;
  return ["판매중", "판매", "selling", "sell", "on", "y", "01", "ing"].some((value) => status.includes(value));
}

function parsePrizeAmount(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const text = value.replace(/,/g, "");
  const number = Number(text.replace(/[^0-9]/g, ""));
  if (!Number.isFinite(number)) return null;
  if (text.includes("억")) return number * 100_000_000;
  if (text.includes("천만")) return number * 10_000_000;
  if (text.includes("백만")) return number * 1_000_000;
  if (text.includes("십만")) return number * 100_000;
  if (text.includes("만")) return number * 10_000;
  if (text.includes("천")) return number * 1_000;
  return number;
}

function getPrize(data: OfficialProductData, rank: number): SpeettoPrize {
  const total = Math.floor(toNumber(data[`stRnk${rank}WnQty`]));
  const won = Math.floor(toNumber(data[`winRnk${rank}Qty`]));
  const remaining = Math.max(0, total - won);

  if (rank <= 2) {
    console.info("[speetto] prize conversion", JSON.stringify({
      rank,
      totalRaw: data[`stRnk${rank}WnQty`],
      wonRaw: data[`winRnk${rank}Qty`],
      total,
      won,
      remaining,
    }));
  }

  return {
    prize_rank: rank,
    prize_amount: parsePrizeAmount(data[`stRnk${rank}GdsSstcCharCn`]),
    total_count: total,
    remaining_count: remaining,
  };
}

function convertProduct(price: SpeettoPrice, data: OfficialProductData, currentRound: number): CollectedSpeettoProduct {
  const round = toNumber(data.stEpsd);
  const imagePath = typeof data.stMainImgStrgPathNm === "string" ? data.stMainImgStrgPathNm : "";
  const prizes = Array.from({ length: 6 }, (_, index) => getPrize(data, index + 1))
    .filter((prize) => prize.total_count > 0 || prize.prize_amount !== null);
  const shipmentRate = toNullableNumber(data.stSpmtRt);
  const sourceSaleStatus = readText(data, ["sale_status", "saleStatus", "stSaleStatNm", "stSaleStatCd", "stSaleYn", "sellStatus"]);

  return {
    price,
    round_number: round,
    title: `스피또 ${price}`,
    image_url: imagePath ? `https://www.dhlottery.co.kr/winImages${imagePath}` : null,
    shipment_rate: shipmentRate,
    sale_status: isSelling(data) || (!sourceSaleStatus && round === currentRound) ? "selling" : sourceSaleStatus || "ended",
    total_issued_count: toNumber(data.stNtslWnSn),
    source_url: SOURCE_URLS[price],
    prizes,
  };
}

async function collectSpeettoProducts(price: SpeettoPrice): Promise<CollectedSpeettoProduct[]> {
  const response = await fetch(`${SPEETTO_ENDPOINT}${SPEETTO_CODES[price]}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) throw new Error(`${price}원 스피또 공식 정보를 가져오지 못했습니다.`);

  const payload = (await response.json()) as OfficialPayload;
  console.info(`[speetto] ${price} official raw response`, JSON.stringify(payload));

  const list = payload.data?.list ?? [];
  const validProducts = list
    .filter((item) => isInteger(toNumber(item.stEpsd), 1))
    .sort((left, right) => toNumber(right.stEpsd) - toNumber(left.stEpsd));
  const currentProduct = validProducts.find(isSelling) ?? validProducts[0];
  if (!currentProduct) throw new Error(`${price}원 스피또 회차 정보가 없습니다.`);

  console.info(`[speetto] ${price} selected product`, JSON.stringify({
    listCount: list.length,
    currentRound: currentProduct.stEpsd,
    saleStatus: readText(currentProduct, ["sale_status", "saleStatus", "stSaleStatNm", "stSaleStatCd", "stSaleYn", "sellStatus"]),
    rounds: validProducts.map((item) => item.stEpsd),
  }));

  const currentRound = toNumber(currentProduct.stEpsd);
  return validProducts.map((product) => convertProduct(price, product, currentRound));
}

async function collectSpeettoData(): Promise<CollectedSpeettoProduct[]> {
  const products: CollectedSpeettoProduct[] = [];
  for (const price of SPEETTO_PRICES) products.push(...await collectSpeettoProducts(price));
  return products;
}

export async function loadSpeettoData(): Promise<SpeettoProduct[]> {
  const supabase = createServerSupabaseClient();
  const { data: rounds, error: roundsError } = await supabase
    .from("speetto_rounds")
    .select("id, price, round_number, title, image_url, shipment_rate, sale_status, updated_at")
    .in("price", [...SPEETTO_PRICES])
    .order("round_number", { ascending: false });

  if (roundsError) throw new Error("Supabase에서 스피또 회차를 조회하지 못했습니다.");

  const storedRounds = (rounds ?? []).filter((round) => SPEETTO_PRICES.includes(round.price as SpeettoPrice)) as Array<{
    id: number;
    price: SpeettoPrice;
    round_number: number;
    title: string | null;
    image_url: string | null;
    shipment_rate: number | null;
    sale_status: string;
    updated_at: string;
  }>;

  if (storedRounds.length === 0) return [];

  const { data: prizes, error: prizesError } = await supabase
    .from("speetto_prizes")
    .select("speetto_round_id, prize_rank, prize_amount, total_count, remaining_count")
    .in("speetto_round_id", storedRounds.map((round) => round.id))
    .order("prize_rank", { ascending: true });

  if (prizesError) throw new Error("Supabase에서 스피또 당첨 정보를 조회하지 못했습니다.");

  const products = storedRounds.map((round) => ({
    ...round,
    prizes: ((prizes ?? []) as Array<SpeettoPrize & { speetto_round_id: number }>)
      .filter((prize) => prize.speetto_round_id === round.id)
      .map((prize) => ({
        prize_rank: prize.prize_rank,
        prize_amount: prize.prize_amount,
        total_count: prize.total_count,
        remaining_count: prize.remaining_count,
      })),
  }));

  return products.filter((product) => product.prizes.find((prize) => prize.prize_rank === 1)?.remaining_count !== 0);
}

export function isSpeettoCacheFresh(products: SpeettoProduct[]): boolean {
  return SPEETTO_PRICES.every((price) => {
    const product = products.find((item) => item.price === price);
    return Boolean(product && Date.now() - new Date(product.updated_at).getTime() < CACHE_MAX_AGE_MS);
  });
}

export async function syncSpeettoData(): Promise<SpeettoProduct[]> {
  const collected = await collectSpeettoData();
  const supabase = createServerSupabaseClient();
  const now = new Date().toISOString();

  for (const product of collected) {
    console.info("[speetto] Supabase save payload", JSON.stringify(product));
    const { data: round, error: roundError } = await supabase
      .from("speetto_rounds")
      .upsert({
        price: product.price,
        round_number: product.round_number,
        title: product.title,
        image_url: product.image_url,
        total_issued_count: product.total_issued_count,
        shipment_rate: product.shipment_rate,
        sale_status: product.sale_status,
        source_url: product.source_url,
        updated_at: now,
      }, { onConflict: "price,round_number" })
      .select("id")
      .single();

    if (roundError || !round) throw new Error("스피또 회차 정보를 저장하지 못했습니다.");

    const { error: prizesError } = await supabase
      .from("speetto_prizes")
      .upsert(product.prizes.map((prize) => ({ ...prize, speetto_round_id: round.id, updated_at: now })), {
        onConflict: "speetto_round_id,prize_rank",
      });

    if (prizesError) throw new Error("스피또 등수별 정보를 저장하지 못했습니다.");

    console.info("[speetto] Supabase saved values", JSON.stringify({
      roundId: round.id,
      price: product.price,
      roundNumber: product.round_number,
      imageUrl: product.image_url,
      shipmentRate: product.shipment_rate,
      prizes: product.prizes.filter((prize) => prize.prize_rank <= 2),
    }));
  }

  return loadSpeettoData();
}
