import type { Metadata, Viewport } from "next";
import PwaRegister from "@/components/pwa-register";
import "./globals.scss";

export const metadata: Metadata = {
  title: "Lucky",
  description: "로또와 스피또 데이터를 재미로 분석하는 AI 서비스",
  applicationName: "Lucky",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Lucky",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/icons/lucky-icon.png",
    apple: "/icons/lucky-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0d4d35",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko">
      <body>
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
