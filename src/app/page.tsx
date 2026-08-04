"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import styles from "./page.module.scss";

export default function Home() {
  const clickCountRef = useRef(0);
  const isSyncingRef = useRef(false);
  const [syncMessage, setSyncMessage] = useState("");

  async function handleSyncTrigger() {
    if (isSyncingRef.current) {
      return;
    }

    clickCountRef.current += 1;

    if (clickCountRef.current < 5) {
      return;
    }

    clickCountRef.current = 0;
    isSyncingRef.current = true;
    setSyncMessage("동기화 중...");

    try {
      const response = await fetch("/api/admin/lotto/sync", { method: "POST" });
      const result = (await response.json()) as {
        success?: boolean;
        mode?: string;
        latestRound?: number;
        savedCount?: number;
        message?: string;
      };

      if (!response.ok || !result.success) {
        throw new Error(result.message ?? "동기화에 실패했습니다.");
      }

      setSyncMessage(
        `${result.mode} · 최신 ${result.latestRound}회 · 저장 ${result.savedCount}건`,
      );
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : "동기화에 실패했습니다.");
    } finally {
      isSyncingRef.current = false;
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="service-title">
        {/* 임시 개발용 도구: 문구를 5회 연속 클릭하면 로또 동기화를 실행한다. */}
        <button
          type="button"
          className={styles.badge}
          onClick={handleSyncTrigger}
          aria-label="개발용 로또 데이터 동기화"
        >
          AI DATA PLAYGROUND
        </button>
        <h1 id="service-title" className={styles.title}>
          LuckyPicK-AI
        </h1>
        <p className={styles.description}>
          로또와 스피또 데이터를 재미로 분석하는 AI 서비스
        </p>

        <div className={styles.actions}>
          <Link href="/lotto" className={styles.primaryButton}>
            로또 분석
          </Link>
          <Link href="/speetto" className={styles.secondaryButton}>
            스피또 분석
          </Link>
        </div>

        <p className={styles.notice}>
          본 서비스는 재미를 위한 분석 서비스이며 당첨을 보장하지 않습니다.
        </p>

        {syncMessage && <p className={styles.syncMessage}>{syncMessage}</p>}
      </section>
    </main>
  );
}
