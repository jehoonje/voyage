// Full-screen finishing pass, aiming at a soft "dreamlike" film look:
// dusk split-toning (violet shadows, warm highlights), gentle contrast,
// a fine ordered dither + grain for texture, and a vignette.
import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

const FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uTime, uCell, uLevels, uDusk, uNight;
varying vec2 vUv;
float bayer4(vec2 p){
  // 4×4 Bayer = 4·M2(low bits) + M2(high bits), with M2 = [0 2; 3 1]
  vec2 i = mod(floor(p), 4.);
  vec2 lo = mod(i, 2.), hi = floor(i / 2.);
  float a = lo.x + lo.y * 2.;
  float b = hi.x + hi.y * 2.;
  float m2a = a == 0. ? 0. : a == 1. ? 2. : a == 2. ? 3. : 1.;
  float m2b = b == 0. ? 0. : b == 1. ? 2. : b == 2. ? 3. : 1.;
  return (m2a * 4. + m2b) / 16.;
}
void main(){
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  float l = dot(c, vec3(.299, .587, .114));

  // split toning: violet / teal shadows, warm highlights (stronger at dusk)
  vec3 shadowTint = mix(vec3(.11, .07, .2), vec3(.04, .07, .17), uNight);
  vec3 hiTint = mix(vec3(1., .97, .92), vec3(1.05, .9, .9), uDusk);
  c = mix(c, c * hiTint, smoothstep(.35, 1., l));
  c += shadowTint * (1. - smoothstep(0., .5, l)) * (.28 + .12 * uDusk);

  // gentle S-curve and a touch of saturation
  vec3 cc = clamp(c, 0., 1.);
  c = mix(c, cc * cc * (3. - 2. * cc), .3 * (1. - .8 * uNight));
  c = pow(max(c, 0.), vec3(1. - .3 * uNight)); // lift darks at night so it stays readable
  c += vec3(.01, .014, .028) * uNight;
  c = mix(vec3(dot(c, vec3(.299, .587, .114))), c, 1.06);

  // vignette
  vec2 q = vUv - .5;
  c *= 1. - dot(q, q) * .6;

  // texture: ordered dither into a reduced palette, plus soft moving grain
  vec2 cell = floor(gl_FragCoord.xy / uCell);
  float bd = bayer4(cell);
  c = floor(c * uLevels + bd) / uLevels;
  float n = fract(sin(dot(cell + floor(uTime * 18.) * 1.37, vec2(12.9898, 78.233))) * 43758.5453);
  c += (n - .5) * .03;

  gl_FragColor = vec4(c, 1.);
}`;

export function createPost(renderer) {
  const size = new THREE.Vector2();
  const rt = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true });
  rt.samples = renderer.getPixelRatio() < 2 ? 4 : 2; // MSAA inside the target (the canvas' own AA is bypassed)
  const uniforms = {
    tDiffuse: { value: rt.texture }, uTime: { value: 0 }, uCell: { value: 1 },
    uLevels: { value: 30 }, uDusk: { value: 0 }, uNight: { value: 0 },
  };
  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false }),
  );
  quad.frustumCulled = false;
  const postScene = new THREE.Scene();
  postScene.add(quad);
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  function resize() {
    renderer.getDrawingBufferSize(size);
    rt.setSize(size.x, size.y);
    // texture cell ≈ 1.4 CSS px: visible as grain, too fine to read as pixels
    uniforms.uCell.value = Math.max(1, renderer.getPixelRatio() * 0.8);
  }
  resize();

  return {
    resize,
    /** dusk 0..1, night 0..1 drive the grade */
    render(scene, camera, time, dusk, night) {
      uniforms.uTime.value = time;
      uniforms.uDusk.value = dusk;
      uniforms.uNight.value = night;
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(postScene, postCam);
    },
  };
}
