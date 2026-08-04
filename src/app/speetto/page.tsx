"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { SpeettoProduct } from "@/lib/speetto/types";
import styles from "./page.module.scss";

type SpeettoResponse = {
  success?: boolean;
  source?: "cache" | "sync" | "stale-cache";
  warning?: string;
  message?: string;
  products?: SpeettoProduct[];
};

const PRICES = [500, 1000, 2000] as const;
const FALLBACK_IMAGES: Record<(typeof PRICES)[number], string> = {
  500: "https://www.dhlottery.co.kr/resources/img/images/img-draw-spt500.svg",
  1000: "https://www.dhlottery.co.kr/resources/img/images/img-draw-spt1000.svg",
  2000: "https://www.dhlottery.co.kr/resources/img/images/img-draw-spt2000.svg",
};

function formatPrice(price: number): string {
  return `${price.toLocaleString("ko-KR")}원`;
}

function formatUpdatedAt(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function SpeettoCard({ product }: { product: SpeettoProduct }) {
  const fallbackImage = FALLBACK_IMAGES[product.price];
  const [imageSrc, setImageSrc] = useState(product.image_url ?? fallbackImage);
  const firstPrize = product.prizes.find((prize) => prize.prize_rank === 1);
  const secondPrize = product.prizes.find((prize) => prize.prize_rank === 2);

  return (
    <article className={styles.card}>
      <div className={styles.cardVisual}>
        {imageSrc ? (
          // Remote image domains are supplied by the collected source.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageSrc}
            alt={product.title ?? `스피또 ${product.price} 상품`}
            onError={() => setImageSrc(fallbackImage)}
          />
        ) : (
          <span>SP<br />{product.price}</span>
        )}
      </div>
      <div className={styles.cardContent}>
        <div className={styles.cardTitle}>
          <div>
            <p className={styles.eyebrow}>SPEETTO {product.price}</p>
            <h2>{product.title ?? `스피또 ${formatPrice(product.price)}`}</h2>
          </div>
          <span className={styles.status}>{product.sale_status}</span>
        </div>
        <p className={styles.round}>{product.round_number}회</p>

        <div className={styles.shipment}>
          <div><span>출고율</span><strong>{product.shipment_rate === null ? "-" : `${product.shipment_rate}%`}</strong></div>
          <div className={styles.progress}><span style={{ width: `${Math.min(Math.max(product.shipment_rate ?? 0, 0), 100)}%` }} /></div>
        </div>

        <div className={styles.prizeGrid}>
          {[firstPrize, secondPrize].map((prize, index) => (
            <div className={styles.prize} key={index}>
              <span>{index + 1}등 남은 매수</span>
              <strong>{prize ? `${prize.remaining_count.toLocaleString("ko-KR")} / ${prize.total_count.toLocaleString("ko-KR")}` : "-"}</strong>
            </div>
          ))}
        </div>
        <p className={styles.updated}>마지막 갱신 {formatUpdatedAt(product.updated_at)}</p>
      </div>
    </article>
  );
}

export default function SpeettoPage() {
  const [products, setProducts] = useState<SpeettoProduct[]>([]);
  const [message, setMessage] = useState("스피또 최신 정보를 확인하고 있습니다.");
  const [warning, setWarning] = useState("");

  useEffect(() => {
    let isMounted = true;

    fetch("/api/speetto")
      .then(async (response) => {
        const result = (await response.json()) as SpeettoResponse;
        if (!response.ok || !result.success || !result.products) throw new Error(result.message ?? "스피또 정보를 가져오지 못했습니다.");
        return result;
      })
      .then((result) => {
        if (!isMounted) return;
        setProducts(result.products ?? []);
        setWarning(result.warning ?? "");
        setMessage("");
      })
      .catch((error: unknown) => {
        if (isMounted) setMessage(error instanceof Error ? error.message : "스피또 정보를 가져오지 못했습니다.");
      });

    return () => { isMounted = false; };
  }, []);

  return (
    <main className={styles.page}>
      <section className={styles.container} aria-labelledby="speetto-title">
        <Link href="/" className={styles.backLink}>← LuckyPicK-AI</Link>
        <header className={styles.header}>
          <p className={styles.eyebrow}>SPEETTO INFORMATION</p>
          <h1 id="speetto-title">스피또 현재 판매 정보</h1>
          <p>스피또 500, 1000, 2000의 판매 회차와 등수별 잔여 매수를 확인하세요.</p>
        </header>

        {message && <p className={styles.message} role="status">{message}</p>}
        {warning && <p className={styles.warning} role="status">최신 정보 조회에 실패해 저장된 정보를 표시하고 있습니다.</p>}
        <div className={styles.grid}>
          {PRICES.flatMap((price) => products
            .filter((product) => product.price === price)
            .map((product) => <SpeettoCard key={`${price}-${product.round_number}`} product={product} />))}
        </div>
        <p className={styles.disclaimer}>상품 정보는 데이터 수집 시점에 따라 달라질 수 있습니다.</p>
      </section>
    </main>
  );
}
