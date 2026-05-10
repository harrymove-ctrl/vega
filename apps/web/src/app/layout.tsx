import type { Metadata } from "next";

import { VegaProvider } from "@/components/providers/vega-provider";
import { TransitionProvider } from "@/components/providers/transition-provider";

import "@xyflow/react/dist/style.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vega",
  description: "Build, deploy, and copy SoDEX-powered trading bots with a creator marketplace and transparent automation, fueled by SoSoValue analytics.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <TransitionProvider>
          <VegaProvider>{children}</VegaProvider>
        </TransitionProvider>
      </body>
    </html>
  );
}
