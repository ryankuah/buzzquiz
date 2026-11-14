import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f8f7f2",
  colorScheme: "light",
};

export const metadata: Metadata = {
  title: "buzzquiz — What are you?",
  description:
    "What are you based on absolutely anything? Fill in the blanks, take the quiz, and find out.",
  icons: { icon: "/icon.svg" },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
