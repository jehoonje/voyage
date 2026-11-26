// Procedural splat shader: grass / sand / rock / snow layers, height-blended,
// slope-aware, detail fades with distance. No image textures.
// Deserts get wind ripples and red layered rock; the sea floor shows through clear
// turquoise shallows with moving caustics and a line of surf; rain darkens the ground.
// Surfaces carry real relief at fragment level: a procedural height per layer (rock ledges,
// blocks and cracks, sand ripples, turf hummocks, snow drifts) bends the lighting normal,
// and hollows are shaded darker.
import * as THREE from 'three';
import { windTime } from './wind.js';
import { ATMOS } from './atmos.js';

const FRAG_HEAD = /* glsl */ `
varying vec3 vWP; varying float vNy; varying float vDist; varying vec4 vW; varying float vD;
uniform float uTime, uWet, uSnowfall;
float h21(vec2 i){ i = mod(i, 289.); return fract(sin(i.x*12.9898 + i.y*78.233)*43758.5453); }
float vn(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(h21(i), h21(i+vec2(1.,0.)), f.x), mix(h21(i+vec2(0.,1.)), h21(i+1.), f.x), f.y);
}
float fb(vec2 p){ return vn(p)*.5 + vn(p*2.03+7.)*.3 + vn(p*4.1-3.)*.2; }
`;

const FRAG_SPLAT = /* glsl */ `
float tBump = 0.;
{
  vec2 p = vWP.xz;
  float fade = 1. - smoothstep(40., 150., vDist);
  float macro = fb(p*.022), nA = fb(p*.33), nB = vn(p*2.1), nC = vn(p*7.3);
  vec3 base = diffuseColor.rgb * (.88 + macro*.24);

  // grass: clumps, blade speckle, sunlit tips
  float gPat = .8 + .26*(nA-.5) + .16*(nB-.5)*fade + .12*(nC-.5)*fade;
  // turf under the grass cards: darker and earthier so gaps between tufts read as shade, not lawn
  vec3 grass = base*gPat*vec3(.72,.7,.66) + vec3(.03,.025,-.01)*smoothstep(.62,.9,nA)*fade;

  // sand: wind ripples, grain; desert sand gets long sharp ripple lines like a wind-combed dune
  float rip = sin(dot(p, vec2(.8,.6))*3.1 + nA*7.)*.5 + .5;
  vec3 sand = base*(.92 + .09*rip*fade + .07*(nC-.5)*fade);
  float dr = fract(dot(p, vec2(.83, .56))*.62 + vn(p*.09)*2.4 + nA*.35);
  float ridge = smoothstep(.0, .12, dr) * (1. - smoothstep(.12, .95, dr)); // bright lip, long soft shadow side
  vec3 dsand = base*(.8 + .3*ridge*fade + .06*(nC-.5)*fade) * vec3(1.02, .98, .93);
  sand = mix(sand, dsand, vD);

  // rock: strata bands, cracks
  float strata = sin(vWP.y*1.7 + nA*5.)*.5 + .5;
  float steepF = 1. - smoothstep(.5, .8, vNy); // cliff-ness: ledges and cracks belong on faces, not flats
  float crack = (1. - smoothstep(0., .03, abs(vn(p*.8 + vWP.y*.25) - .5))) * (.25 + .75 * steepF);
  // rock relief (metres): stepped ledges every ~2 m, blocky faces, sunken cracks
  vec2 rq = vec2(vWP.x + vWP.z * .7, vWP.y);
  float ledgeS = fract(vWP.y * .5 + nA * .4 + vn(p * .04) * 1.5);
  float rockH = smoothstep(.5, .92, ledgeS) * .32 * steepF + vn(rq * .7 + p * .3) * .38 + vn(rq * 2.3 - p * .6) * .12 - crack * .05;
  vec3 rockC = mix(vec3(.47,.44,.4), base, .3) * (.78 + .24*strata*fade + .16*nB) * (1. - .22*crack*fade);
  // desert rock: banded red sandstone (dark rust, orange, cream)
  float band = fract(vWP.y*.42 + nA*.25 + vn(p*.05)*.6);
  vec3 sandstone = band < .35 ? vec3(.62,.3,.2) : band < .7 ? vec3(.78,.47,.29) : band < .82 ? vec3(.88,.72,.54) : vec3(.56,.27,.19);
  sandstone *= (.82 + .2*nB + .12*strata*fade) * (1. - .18*crack*fade);
  rockC = mix(rockC, sandstone, smoothstep(.2, .6, vD));

  // snow: bright, cool hollows
  vec3 snowC = vec3(.93,.95,.99)*(.93 + .07*nA) - vec3(.07,.035,0.)*(1.-nB)*.6*fade;
  snowC += vec3(.35) * step(.992, h21(floor(p*9.))) * fade; // glints

  float sandH = ridge * .06 * vD + rip * .025;
  float grassH = (nA - .5) * .28 + (nB - .5) * .07;
  float snowH = (nA - .5) * .35 + (nB - .5) * .05;

  // weights: vertex splat, steep slopes → rock, then height-blend for organic edges
  vec4 w = vW;
  w.w = max(w.w, uSnowfall * .8 * (1. - w.y)); // fresh snow settles on everything but sand
  float steep = 1. - smoothstep(.6, .85, vNy);
  w.z = max(w.z, steep*(1. - w.w*.7));
  vec4 hb = w + vec4(gPat-.8, rip*.3, strata*.3+.1, nA*.3)*.6;
  float mx = max(max(hb.x, hb.y), max(hb.z, hb.w));
  vec4 b = max(hb - mx + .18, 0.); b /= b.x + b.y + b.z + b.w;
  diffuseColor.rgb = grass*b.x + sand*b.y + rockC*b.z + snowC*b.w;
  float bumpFade = 1. - smoothstep(25., 95., vDist);
  tBump = dot(b, vec4(grassH, sandH, rockH, snowH)) * bumpFade;
  // hollows and cracks catch less light
  diffuseColor.rgb *= mix(1., .8 + .3 * smoothstep(.0, .4, rockH), b.z * bumpFade);
  diffuseColor.rgb *= 1. - .12 * b.x * smoothstep(.0, -.15, grassH) * bumpFade;
  // bare soil peeking through the turf
  diffuseColor.rgb = mix(diffuseColor.rgb, base * vec3(.72, .6, .46), .3 * b.x * smoothstep(.55, .85, nC) * fade);
  // wet, darker bank along the waterline; rain wets everything
  float wet = max((1. - smoothstep(.2, 1.6, vWP.y)) * step(-.6, vWP.y), uWet * .55 * (1. - b.w));
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(.52, .5, .44), wet * .7);

  // under the water: clear turquoise shallows fading to deep blue, sunlight caustics on the floor
  float depth = -vWP.y;
  if (depth > -.25) {
    float d = max(depth, 0.);
    vec3 shallow = mix(diffuseColor.rgb, vec3(.5, .86, .8), .45) * vec3(.85, 1., .97);
    vec3 floorC = mix(shallow, vec3(.05, .26, .36), smoothstep(.4, 7., d));
    floorC = mix(floorC, vec3(.02, .1, .2), smoothstep(7., 20., d));
    // two drifting layers of thin, bright light lines (like sun through ripples)
    float caust = 0.;
    for (int i = 0; i < 2; i++) {
      float sc = i == 0 ? 1.1 : 1.9, sp = i == 0 ? 1. : -1.3;
      vec2 q = p * sc + vec2(uTime * .11 * sp, uTime * .07);
      float cs = abs(sin(q.x * 2.1 + sin(q.y * 1.7 + uTime * .6 * sp) * 1.6) + sin(q.y * 2.4 + sin(q.x * 1.9 - uTime * .5) * 1.6));
      caust += pow(1. - smoothstep(0., .28, cs), 3.) * (i == 0 ? .7 : .45);
    }
    floorC += vec3(.6, .85, .78) * caust * (1. - smoothstep(.2, 5., d)) * fade * .7;
    diffuseColor.rgb = mix(diffuseColor.rgb, floorC, smoothstep(-.25, .25, depth));
    // surf: foam lines washing up and drawing back along the waterline
    float wave = sin(dot(p, vec2(.07, .05)) * 6. - uTime * 1.3 + vn(p * .3) * 3.);
    float edge = 1. - smoothstep(0., .35, abs(depth - (.05 + wave * .12)));
    float lace = smoothstep(.45, .7, vn(p * 3. + uTime * .4));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.96, .98, .97), edge * (.55 + .45 * lace) * .85 * (1. - vD));
  }
}
`;

export function createTerrainMaterial() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uTime: windTime, uWet: ATMOS.wet, uSnowfall: ATMOS.snow });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aW; attribute float aD; varying vec3 vWP; varying float vNy; varying float vDist; varying vec4 vW; varying float vD;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWP = transformed; vNy = objectNormal.y; vDist = -mvPosition.z; vW = aW; vD = aD;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_SPLAT)
      // bend the normal by the procedural height (bump mapping from screen-space derivatives)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec3 sp = -vViewPosition, sx = dFdx(sp), sy = dFdy(sp);
  vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
  float det = dot(sx, r1);
  vec2 dh = vec2(dFdx(tBump), dFdy(tBump));
  vec3 grad = sign(det) * (dh.x * r1 + dh.y * r2);
  if (abs(det) > 1e-12) normal = normalize(abs(det) * normal - grad);
}`);
  };
  return mat;
}
