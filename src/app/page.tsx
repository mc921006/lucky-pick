"use client";

import Link from "next/link";
import styles from "./page.module.scss";

export default function Home() {
  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="service-title">
        <p className={styles.badge}>AI DATA PLAYGROUND</p>
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

      </section>
    </main>
  );
}
