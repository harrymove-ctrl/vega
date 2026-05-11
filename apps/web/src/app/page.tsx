import Navigation1 from "@/components/blocks/navigation-1";
import { Hero1 } from "@/components/blocks/hero-1";
import { Features1 } from "@/components/blocks/features-1";
import Footer1 from "@/components/blocks/footer-1";
import { LiveNewsFeed } from "@/components/sosovalue/live-news-feed";
import { LiveSoDEXMarkets } from "@/components/sodex/live-markets";

export default function LandingPage() {
  return (
    <main className="dark min-h-dvh bg-neutral-950 text-white">
      <Navigation1 />
      <Hero1 />

      {/* Live integration proof — calls both APIs in the browser */}
      <section className="bg-[#050608] px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
        <div className="mx-auto grid w-full max-w-[1400px] gap-6 lg:grid-cols-2">
          <LiveSoDEXMarkets limit={5} />
          <LiveNewsFeed limit={5} />
        </div>
        <p className="mx-auto mt-4 max-w-[1400px] text-center text-[10px] tracking-wide text-neutral-500 sm:text-xs">
          Both panels fetch real data from SoSoValue + SoDEX APIs on every
          page load. Source:{" "}
          <a
            href="https://github.com/hien-p/vega"
            className="text-[#dce85d] hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            github.com/hien-p/vega
          </a>
        </p>
      </section>

      <Features1 />
      <Footer1 />
    </main>
  );
}
