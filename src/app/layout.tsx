import type { Metadata } from "next";
import "./globals.scss";

export const metadata: Metadata = {
  title: "LuckyPicK-AI",
  description: "로또와 스피또 데이터를 재미로 분석하는 AI 서비스",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
