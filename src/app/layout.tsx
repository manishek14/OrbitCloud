import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "AbrIT — پلتفرم خدمات مدیریت‌شده فناوری اطلاعات",
  description:
    "پلتفرم AbrIT: خدمات مدیریت‌شده IT، فضای ابری سازمانی AbrIT Drive، پنل مشتریان و مدیریت سرویس‌ها با SLA مشخص و تعرفه رسمی ۱۴۰۵.",
  applicationName: "AbrIT Platform",
  authors: [{ name: "AbrIT" }],
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/apple-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0B1220" },
    { media: "(prefers-color-scheme: light)", color: "#F5F7FB" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
