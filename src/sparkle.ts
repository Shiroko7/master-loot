import { buildEffect, type BoundingBox, type Effect } from "@owlbear-rodeo/sdk";
import { SPARKLE_KEY } from "./constants";

/**
 * WoW-style "corpse sparkle": a handful of golden glints that twinkle in and
 * out on staggered phases, jumping to a new spot each cycle. Runs on the GPU
 * as an SkSL shader; `time` and `size` are uniforms Owlbear Rodeo provides.
 */
const SPARKLE_SKSL = `
uniform float time;
uniform vec2 size;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec4 main(in vec2 fragCoord) {
  vec2 uv = (fragCoord - 0.5 * size) / min(size.x, size.y);
  vec3 gold = vec3(1.0, 0.85, 0.45);
  vec3 col = vec3(0.0);

  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float cycle = time * 0.35 + hash(vec2(fi, 43.0));
    float phase = fract(cycle);
    // gen changes every cycle so each glint reappears somewhere new;
    // wrapped so hash inputs stay small during long sessions.
    float gen = mod(floor(cycle), 64.0);

    float ang = 6.2832 * hash(vec2(fi, 17.0 + gen));
    float rad = 0.38 * sqrt(hash(vec2(fi + 7.0, 29.0 + gen)));
    vec2 site = vec2(cos(ang), sin(ang)) * rad;

    // brief bright glint, then dark for most of the cycle
    float tw = smoothstep(0.0, 0.12, phase) * (1.0 - smoothstep(0.12, 0.45, phase));
    vec2 d = uv - site;
    float core = 0.004 / (dot(d, d) + 0.002);
    float rays = max(0.0, 1.0 - 90.0 * abs(d.x)) * max(0.0, 1.0 - 16.0 * abs(d.y))
               + max(0.0, 1.0 - 90.0 * abs(d.y)) * max(0.0, 1.0 - 16.0 * abs(d.x));
    float s = tw * (0.45 * core + rays);
    col += s * mix(gold, vec3(1.0), clamp(s - 0.5, 0.0, 1.0));
  }

  float a = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
  return vec4(col, a);
}
`;

export function buildSparkle(tokenId: string, bounds: BoundingBox): Effect {
  return (
    buildEffect()
      .effectType("ATTACHMENT")
      .attachedTo(tokenId)
      .layer("ATTACHMENT")
      .sksl(SPARKLE_SKSL)
      // Additive blending so glints read as light on top of the art.
      .blendMode("PLUS")
      // Size/position are fallbacks; ATTACHMENT effects fill the bounds of
      // the item they are attached to.
      .width(bounds.width)
      .height(bounds.height)
      .position({ x: bounds.min.x, y: bounds.min.y })
      // Never intercept clicks: the token and the badge stay interactive.
      .disableHit(true)
      .locked(true)
      .name("Loot sparkle")
      .metadata({ [SPARKLE_KEY]: true })
      .build()
  );
}
