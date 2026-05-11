(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,325661,(e,t,u)=>{"use strict";var r=e.r(34416),o="function"==typeof Object.is?Object.is:function(e,t){return e===t&&(0!==e||1/e==1/t)||e!=e&&t!=t},i=r.useState,a=r.useEffect,n=r.useLayoutEffect,l=r.useDebugValue;function s(e){var t=e.getSnapshot;e=e.value;try{var u=t();return!o(e,u)}catch(e){return!0}}var c="u"<typeof window||void 0===window.document||void 0===window.document.createElement?function(e,t){return t()}:function(e,t){var u=t(),r=i({inst:{value:u,getSnapshot:t}}),o=r[0].inst,c=r[1];return n(function(){o.value=u,o.getSnapshot=t,s(o)&&c({inst:o})},[e,u,t]),a(function(){return s(o)&&c({inst:o}),e(function(){s(o)&&c({inst:o})})},[e]),l(u),u};u.useSyncExternalStore=void 0!==r.useSyncExternalStore?r.useSyncExternalStore:c},56032,(e,t,u)=>{"use strict";t.exports=e.r(325661)},220206,(e,t,u)=>{"use strict";var r=e.r(34416),o=e.r(56032),i="function"==typeof Object.is?Object.is:function(e,t){return e===t&&(0!==e||1/e==1/t)||e!=e&&t!=t},a=o.useSyncExternalStore,n=r.useRef,l=r.useEffect,s=r.useMemo,c=r.useDebugValue;u.useSyncExternalStoreWithSelector=function(e,t,u,r,o){var v=n(null);if(null===v.current){var f={hasValue:!1,value:null};v.current=f}else f=v.current;var m=a(e,(v=s(function(){function e(e){if(!l){if(l=!0,a=e,e=r(e),void 0!==o&&f.hasValue){var t=f.value;if(o(t,e))return n=t}return n=e}if(t=n,i(a,e))return t;var u=r(e);return void 0!==o&&o(t,u)?(a=e,t):(a=e,n=u)}var a,n,l=!1,s=void 0===u?null:u;return[function(){return e(t())},null===s?void 0:function(){return e(s())}]},[t,u,r,o]))[0],v[1]);return l(function(){f.hasValue=!0,f.value=m},[m]),c(m),m}},596482,(e,t,u)=>{"use strict";t.exports=e.r(220206)},316025,e=>{"use strict";var t=e.i(954710),u=e.i(34416),r=e.i(672402),o=e.i(570304),i=e.i(993679),a=e.i(721348),n=e.i(152088);let l=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,s=`
precision highp float;

uniform float uTime;
uniform vec2  uRes;
uniform float uSpeed;
uniform float uComplexity;
uniform float uSwirl;
uniform float uZoom;
uniform vec3  uTint;
uniform float uHueRotation;
uniform float uSaturation;
uniform float uBrightness;
uniform vec3  uBg;
uniform float uAlpha;

varying vec2 vUv;

vec2 spin(vec2 v, float a) {
  return cos(a) * v + sin(a) * vec2(-v.y, v.x);
}

float sfrac(float x, float k) {
  float f = fract(x);
  return f * smoothstep(1.0, k, f);
}

vec3 hueRotate(vec3 col, float angle) {
  return mix(vec3(dot(vec3(0.333), col)), col, cos(angle))
       + cross(vec3(0.577), col) * sin(angle);
}

vec3 computeOrb(vec3 p, float t) {
  vec3 v = vec3(0);
  float x = 0.0;
  float y = 0.0;
  float it = uComplexity;
  float halo = smoothstep(0.5, 0.0, p.z);
  vec3 c = vec3(0);

  for (float i = 1.0; i < 9.0; i += 1.0) {
    if (i > it) break;

    p.xy = spin(p.xy, p.z * uSwirl + t / i * 0.4);
    v = v * 0.5 + 0.5;
    v.xz = spin(v.xz, v.y - x + t / i + p.y);
    p.xy = spin(p.xy, length(v.xy) - x);

    x += sfrac(v.z, 0.9 - sin(y * 1.5) * 0.2 + p.z * 0.1) / it / (1.0 + x + x * x);
    y += sfrac(-v.z, 0.9 + sin(x) * 0.1) / it;

    c += exp(vec3(0.7, 1.9, 4.0) * log(max(x, 1e-8)));
  }

  float xy = (x - y) * (x - y);
  c += xy * sqrt(max(c, 0.0));
  c = clamp(c, 0.0, 1.0);

  c = hueRotate(c, uHueRotation);

  c = mix(vec3(dot(c, vec3(0.2, 0.7, 0.1))), c, uSaturation * (1.0 + y));
  c = max(c, 0.0);

  float bgLum = dot(uBg, vec3(0.2, 0.7, 0.1));
  float rimLift = bgLum * 0.5;
  c = mix(c, sqrt(max(c, 0.0)) * 0.7 + rimLift * 0.6, halo);
  c = mix(c, sqrt(max(c, 0.0)) * 0.5 + rimLift, sqrt(halo));

  c *= uTint;

  return c;
}

void main() {
  vec4 bg = vec4(uBg, uAlpha);
  vec2 uv = (gl_FragCoord.xy * 2.0 - uRes) / min(uRes.x, uRes.y) * uZoom;
  float t = uTime * uSpeed;

  float l2 = dot(uv, uv);
  float l = sqrt(l2);

  if (l > 1.0) {
    gl_FragColor = bg;
    return;
  }

  vec3 sn = vec3(uv, sqrt(1.0 - l2));
  vec3 n = computeOrb(sn, t) * uBrightness;

  float f = length(vec2(dFdx(l), dFdy(l)));
  float edge = smoothstep(1.0 - f, 1.0 - f * 3.0, l);

  gl_FragColor = mix(bg, vec4(sqrt(max(n, 0.0)), uAlpha), edge);
}
`,c=({speed:e,complexity:r,swirl:n,zoom:c,tintRgb:v,hueRotation:f,saturation:m,brightness:p,bgRgb:x,opacity:d})=>{let h=(0,u.useRef)(null),{size:g,viewport:y}=(0,i.useThree)(),S=(0,u.useMemo)(()=>({uTime:{value:0},uRes:{value:new a.Vector2},uSpeed:{value:e},uComplexity:{value:r},uSwirl:{value:n},uZoom:{value:c},uTint:{value:new a.Vector3(...v)},uHueRotation:{value:f},uSaturation:{value:m},uBrightness:{value:p},uBg:{value:new a.Vector3(...x)},uAlpha:{value:d}}),[]);return(0,o.useFrame)(t=>{let u=h.current?.material;u&&(u.uniforms.uTime.value=t.clock.elapsedTime,u.uniforms.uRes.value.set(g.width*y.dpr,g.height*y.dpr),u.uniforms.uSpeed.value=e,u.uniforms.uComplexity.value=r,u.uniforms.uSwirl.value=n,u.uniforms.uZoom.value=c,u.uniforms.uTint.value.set(...v),u.uniforms.uHueRotation.value=f,u.uniforms.uSaturation.value=m,u.uniforms.uBrightness.value=p,u.uniforms.uBg.value.set(...x),u.uniforms.uAlpha.value=d)}),(0,t.jsxs)("mesh",{ref:h,children:[(0,t.jsx)("planeGeometry",{args:[2,2]}),(0,t.jsx)("shaderMaterial",{vertexShader:l,fragmentShader:s,uniforms:S,transparent:!0})]})},v=e=>{let t=/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(e);return t?[parseInt(t[1],16)/255,parseInt(t[2],16)/255,parseInt(t[3],16)/255]:[0,0,0]},f=({width:e="100%",height:o="100%",className:i,children:a,speed:l=.5,complexity:s=3,swirl:f=2,zoom:m=1.75,color:p="#FFFFFF",hueRotation:x=4.3,saturation:d=0,brightness:h=2,backgroundColor:g="#000000",opacity:y=1})=>{let S=(0,u.useMemo)(()=>v(p),[p]),b=(0,u.useMemo)(()=>v(g),[g]);return(0,t.jsxs)("div",{className:(0,n.cn)("relative overflow-hidden",i),style:{width:e,height:o},children:[(0,t.jsx)(r.Canvas,{orthographic:!0,camera:{position:[0,0,1],zoom:1,left:-1,right:1,top:1,bottom:-1},gl:{antialias:!0,alpha:!0},className:"absolute! inset-0 w-full h-full",children:(0,t.jsx)(c,{speed:l,complexity:s,swirl:f,zoom:m,tintRgb:S,hueRotation:x,saturation:d,brightness:h,bgRgb:b,opacity:y})}),a&&(0,t.jsx)("div",{className:"relative z-1 pointer-events-none",children:a})]})};f.displayName="AgenticBall",e.s(["default",0,f])},262413,e=>{e.n(e.i(316025))}]);