import type { Metadata } from "next";
import FeedbackProvider from "@/components/FeedbackProvider";
import "./globals.css";
import "./sidebar-fixed.css";
import "./reader-qr-size.css";
import "./reader-card-assignment.css";
import "./employee-fixed-parking.css";
import "./compact-dashboard.css";

export const metadata: Metadata = {
  title: "SRTEC Access Control",
  description: "Multi-building parking allocation and access control",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body suppressHydrationWarning><FeedbackProvider>{children}</FeedbackProvider></body></html>;
}
