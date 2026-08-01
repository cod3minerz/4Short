"use client";

import { Dithering } from "@paper-design/shaders-react";

export function HeroBackground() {
  return (
    <div className="hero__shader" aria-hidden="true">
      <Dithering
        style={{ width: "100%", height: "100%" }}
        colorBack="#00000000"
        colorFront="#3355ffe8"
        shape="swirl"
        type="8x8"
        size={3.8}
        speed={0.96}
        scale={3.36}
        rotation={0}
        offsetX={0}
        offsetY={0}
      />
    </div>
  );
}
