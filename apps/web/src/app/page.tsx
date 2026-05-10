import Navigation1 from "@/components/blocks/navigation-1";
import { Hero1 } from "@/components/blocks/hero-1";
import { Features1 } from "@/components/blocks/features-1";
import Footer1 from "@/components/blocks/footer-1";

export default function LandingPage() {
  return (
    <main className="dark min-h-dvh bg-neutral-950 text-white">
      <Navigation1 />
      <Hero1 />
      <Features1 />
      <Footer1 />
    </main>
  );
}
