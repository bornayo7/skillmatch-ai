import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap"
});

export const metadata: Metadata = {
  title: "SkillMatch AI",
  description:
    "Explainable candidate-to-role matching: resume parsing, evidence-backed scoring, skill-gap analysis, and learning recommendations."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className={`${inter.className} min-h-screen bg-background text-ink antialiased`}>
        {children}
      </body>
    </html>
  );
}
