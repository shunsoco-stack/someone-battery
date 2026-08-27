import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://someone-battery.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "誰かの充電 — 名前も知らない誰かの、いまの残量。",
    template: "%s | 誰かの充電",
  },
  description:
    "世界のどこかの、名前も知らない誰か。そのスマートフォンの充電残量を、ただ眺めるだけの小さな場所。残量は手入力。位置情報も、端末情報も取得しません。",
  applicationName: "誰かの充電",
  alternates: { canonical: "/" },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "誰かの充電",
  },
  openGraph: {
    type: "website",
    locale: "ja_JP",
    url: "/",
    siteName: "誰かの充電",
    title: "誰かの充電",
    description: "名前も知らない誰かの、いまの残量。",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "誰かの充電 — 名前も知らない誰かの、いまの残量。",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "誰かの充電",
    description: "名前も知らない誰かの、いまの残量。",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#101411" },
    { media: "(prefers-color-scheme: light)", color: "#f5f7f2" },
  ],
  colorScheme: "dark light",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja" data-theme="dark" suppressHydrationWarning>
      <body>
        <Script src="/theme.js" strategy="beforeInteractive" />
        {children}
      </body>
    </html>
  );
}
