import { getRelease } from "@/lib/releases";
import "./landing.css";
import { CutScene } from "./cut-scene";
import { LandingFooter } from "./footer";
import { LandingHeader } from "./header";
import { Device, Faq, Final, Hero, How, Moments, Pricing, Requirements, Subtitles } from "./sections";

export async function Landing() {
  const release = await getRelease();
  return (
    <div className="lp">
      <a className="lp-skip" href="#main">К содержимому</a>
      <LandingHeader release={release} />
      <main id="main">
        <Hero release={release} />
        <CutScene />
        <How />
        <Moments />
        <Subtitles />
        <Device />
        <Requirements />
        <Pricing />
        <Faq />
        <Final release={release} />
      </main>
      <LandingFooter />
    </div>
  );
}
