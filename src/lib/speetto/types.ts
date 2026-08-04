export const SPEETTO_PRICES = [500, 1000, 2000] as const;
export type SpeettoPrice = (typeof SPEETTO_PRICES)[number];

export type SpeettoPrize = {
  prize_rank: number;
  prize_amount: number | null;
  total_count: number;
  remaining_count: number;
};

export type SpeettoProduct = {
  id: number;
  price: SpeettoPrice;
  round_number: number;
  title: string | null;
  image_url: string | null;
  shipment_rate: number | null;
  sale_status: string;
  updated_at: string;
  prizes: SpeettoPrize[];
};

export type CollectedSpeettoProduct = Omit<SpeettoProduct, "id" | "updated_at" | "prizes"> & {
  total_issued_count: number | null;
  source_url: string | null;
  prizes: SpeettoPrize[];
};
