import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { lblEn } from "@/lib/labels";

export const metadata: Metadata = {
  title: lblEn("app_name") + " — " + lblEn("app_subtitle"),
  description: "Dual-currency, bilingual, double-entry import & distribution ERP",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
