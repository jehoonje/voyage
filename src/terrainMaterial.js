// Procedural splat shader: grass / sand / rock / snow layers, height-blended,
// slope-aware, detail fades with distance. No image textures.
import * as THREE from 'three';

const FRAG_HEAD = /* glsl */ `
varying vec3 vWP; varying float vNy; varying float vDist; varying vec4 vW;
float h21(vec2 i){ i = mod(i, 289.); return fract(sin(i.x*12.9898 + i.y*78.233)*43758.5453); }
float vn(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(h21(i), h21(i+vec2(1.,0.)), f.x), mix(h21(i+vec2(0.,1.)), h21(i+1.), f.x), f.y);
}
float fb(vec2 p){ return vn(p)*.5 + vn(p*2.03+7.)*.3 + vn(p*4.1-3.)*.2; }
`;

const FRAG_SPLAT = /* glsl */ `
{
  vec2 p = vWP.xz;
  float fade = 1. - smoothstep(40., 150., vDist);
  float macro = fb(p*.022), nA = fb(p*.33), nB = vn(p*2.1), nC = vn(p*7.3);
  vec3 base = diffuseColor.rgb * (.88 + macro*.24);

  // grass: clumps, blade speckle, sunlit tips
  float gPat = .8 + .26*(nA-.5) + .16*(nB-.5)*fade + .12*(nC-.5)*fade;
  // turf under the grass cards: darker and earthier so gaps between tufts read as shade, not lawn
  vec3 grass = base*gPat*vec3(.72,.7,.66) + vec3(.03,.025,-.01)*smoothstep(.62,.9,nA)*fade;

  // sand: wind ripples, grain
  float rip = sin(dot(p, vec2(.8,.6))*3.1 + nA*7.)*.5 + .5;
  vec3 sand = base*(.92 + .09*rip*fade + .07*(nC-.5)*fade);

  // rock: strata bands, cracks
  float strata = sin(vWP.y*1.7 + nA*5.)*.5 + .5;
  float crack = 1. - smoothstep(0., .05, abs(vn(p*.8 + vWP.y*.25) - .5));
  vec3 rockC = mix(vec3(.47,.44,.4), base, .3) * (.78 + .24*strata*fade + .16*nB) * (1. - .35*crack*fade);

  // snow: bright, cool hollows
  vec3 snowC = vec3(.93,.95,.99)*(.93 + .07*nA) - vec3(.07,.035,0.)*(1.-nB)*.6*fade;

  // weights: vertex splat, steep slopes → rock, then height-blend for organic edges
  vec4 w = vW;
  float steep = 1. - smoothstep(.6, .85, vNy);
  w.z = max(w.z, steep*(1. - w.w*.7));
  vec4 hb = w + vec4(gPat-.8, rip*.3, strata*.3+.1, nA*.3)*.6;
  float mx = max(max(hb.x, hb.y), max(hb.z, hb.w));
  vec4 b = max(hb - mx + .18, 0.); b /= b.x + b.y + b.z + b.w;
  diffuseColor.rgb = grass*b.x + sand*b.y + rockC*b.z + snowC*b.w;
  // bare soil peeking through the turf
  diffuseColor.rgb = mix(diffuseColor.rgb, base * vec3(.72, .6, .46), .3 * b.x * smoothstep(.55, .85, nC) * fade);
  // wet, darker bank along the waterline
  float wet = (1. - smoothstep(.2, 1.6, vWP.y)) * step(-.6, vWP.y);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(.52, .5, .44), wet * .7);
}
`;

export function createTerrainMaterial() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aW; varying vec3 vWP; varying float vNy; varying float vDist; varying vec4 vW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWP = transformed; vNy = objectNormal.y; vDist = -mvPosition.z; vW = aW;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_SPLAT);
  };
  return mat;
}
