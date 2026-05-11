(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,325661,(e,u,r)=>{"use strict";var t=e.r(34416),o="function"==typeof Object.is?Object.is:function(e,u){return e===u&&(0!==e||1/e==1/u)||e!=e&&u!=u},n=t.useState,a=t.useEffect,l=t.useLayoutEffect,i=t.useDebugValue;function s(e){var u=e.getSnapshot;e=e.value;try{var r=u();return!o(e,r)}catch(e){return!0}}var v="u"<typeof window||void 0===window.document||void 0===window.document.createElement?function(e,u){return u()}:function(e,u){var r=u(),t=n({inst:{value:r,getSnapshot:u}}),o=t[0].inst,v=t[1];return l(function(){o.value=r,o.getSnapshot=u,s(o)&&v({inst:o})},[e,r,u]),a(function(){return s(o)&&v({inst:o}),e(function(){s(o)&&v({inst:o})})},[e]),i(r),r};r.useSyncExternalStore=void 0!==t.useSyncExternalStore?t.useSyncExternalStore:v},56032,(e,u,r)=>{"use strict";u.exports=e.r(325661)},220206,(e,u,r)=>{"use strict";var t=e.r(34416),o=e.r(56032),n="function"==typeof Object.is?Object.is:function(e,u){return e===u&&(0!==e||1/e==1/u)||e!=e&&u!=u},a=o.useSyncExternalStore,l=t.useRef,i=t.useEffect,s=t.useMemo,v=t.useDebugValue;r.useSyncExternalStoreWithSelector=function(e,u,r,t,o){var c=l(null);if(null===c.current){var f={hasValue:!1,value:null};c.current=f}else f=c.current;var y=a(e,(c=s(function(){function e(e){if(!i){if(i=!0,a=e,e=t(e),void 0!==o&&f.hasValue){var u=f.value;if(o(u,e))return l=u}return l=e}if(u=l,n(a,e))return u;var r=t(e);return void 0!==o&&o(u,r)?(a=e,u):(a=e,l=r)}var a,l,i=!1,s=void 0===r?null:r;return[function(){return e(u())},null===s?void 0:function(){return e(s())}]},[u,r,t,o]))[0],c[1]);return i(function(){f.hasValue=!0,f.value=y},[y]),v(y),y}},596482,(e,u,r)=>{"use strict";u.exports=e.r(220206)},369307,e=>{"use strict";var u=e.i(954710),r=e.i(34416),t=e.i(672402),o=e.i(570304),n=e.i(993679),a=e.i(721348);let l=[{color:"#00ff4d",speed:.37,intensity:.5},{color:"#66b3ff",speed:.15,intensity:.35},{color:"#d438ff",speed:.2,intensity:.1},{color:"#1acbae",speed:.07,intensity:.15}],i=[{color:"#5f2762",blend:.5},{color:"#263031",blend:.5}],s=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,v=`
precision highp float;
varying vec2 vUv;
uniform float u_time;
uniform vec2 u_resolution;
uniform float u_speed;
uniform vec3 u_layer1Color;
uniform float u_layer1Speed;
uniform float u_layer1Intensity;
uniform vec3 u_layer2Color;
uniform float u_layer2Speed;
uniform float u_layer2Intensity;
uniform vec3 u_layer3Color;
uniform float u_layer3Speed;
uniform float u_layer3Intensity;
uniform vec3 u_layer4Color;
uniform float u_layer4Speed;
uniform float u_layer4Intensity;
uniform float u_noiseScale;
uniform float u_movementX;
uniform float u_movementY;
uniform float u_verticalFade;
uniform float u_bloomIntensity;
uniform vec3 u_skyColor1;
uniform vec3 u_skyColor2;
uniform float u_skyBlend1;
uniform float u_skyBlend2;
uniform float u_brightness;
uniform float u_saturation;
uniform float u_opacity;

float h(float n){return fract(sin(n)*43758.5453);}

float n2d(vec2 p){
  vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);
  return mix(mix(h(i.x+h(i.y)),h(i.x+1.+h(i.y)),u.x),
             mix(h(i.x+h(i.y+1.)),h(i.x+1.+h(i.y+1.)),u.x),u.y);
}

vec3 aurora(vec2 uv,float spd,float intensity,vec3 col,float aspect){
  float t=u_time*u_speed*spd;
  vec2 scaled=vec2(uv.x*aspect,uv.y)*u_noiseScale;
  vec2 p=scaled+t*vec2(u_movementX,u_movementY);
  float n=n2d(p+n2d(col.xy+p+t));
  float a=n-uv.y*u_verticalFade;
  return col*a*intensity*u_bloomIntensity;
}

vec3 sat(vec3 c,float s){
  float g=dot(c,vec3(0.299,0.587,0.114));
  return mix(vec3(g),c,s);
}

void main(){
  vec2 uv=vUv;
  float aspect=u_resolution.x/u_resolution.y;

  vec3 c=vec3(0.);
  c+=aurora(uv,u_layer1Speed,u_layer1Intensity,u_layer1Color,aspect);
  c+=aurora(uv,u_layer2Speed,u_layer2Intensity,u_layer2Color,aspect);
  c+=aurora(uv,u_layer3Speed,u_layer3Intensity,u_layer3Color,aspect);
  c+=aurora(uv,u_layer4Speed,u_layer4Intensity,u_layer4Color,aspect);

  c+=u_skyColor2*(1.-smoothstep(u_skyBlend1,1.,uv.y));
  c+=u_skyColor1*(1.-smoothstep(0.,u_skyBlend2,uv.y));

  c=sat(c,u_saturation)*u_brightness;

  gl_FragColor=vec4(c,u_opacity);
}
`;function c(e){let u=/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(e);return u?[parseInt(u[1],16)/255,parseInt(u[2],16)/255,parseInt(u[3],16)/255]:[1,1,1]}let f=({speed:e,layers:t,noiseScale:l,movementX:i,movementY:f,verticalFade:y,bloomIntensity:m,skyLayers:_,brightness:d,saturation:p,opacity:h})=>{let S=(0,r.useRef)(null),{size:x}=(0,n.useThree)(),b=(0,r.useMemo)(()=>({u_time:{value:0},u_resolution:{value:new a.Vector2(1,1)},u_speed:{value:1},u_layer1Color:{value:new a.Vector3(0,1,.3)},u_layer1Speed:{value:.05},u_layer1Intensity:{value:.3},u_layer2Color:{value:new a.Vector3(.1,.5,.9)},u_layer2Speed:{value:.1},u_layer2Intensity:{value:.4},u_layer3Color:{value:new a.Vector3(.4,.1,.8)},u_layer3Speed:{value:.15},u_layer3Intensity:{value:.3},u_layer4Color:{value:new a.Vector3(.8,.1,.6)},u_layer4Speed:{value:.07},u_layer4Intensity:{value:.2},u_noiseScale:{value:2},u_movementX:{value:2},u_movementY:{value:-2},u_verticalFade:{value:.6},u_bloomIntensity:{value:2},u_skyColor1:{value:new a.Vector3(.2,0,.4)},u_skyColor2:{value:new a.Vector3(.15,.2,.35)},u_skyBlend1:{value:.4},u_skyBlend2:{value:.5},u_brightness:{value:1},u_saturation:{value:1},u_opacity:{value:1}}),[]);return(0,o.useFrame)(u=>{if(!S.current)return;let r=S.current.material;r.uniforms.u_time.value=u.clock.elapsedTime,r.uniforms.u_resolution.value.set(x.width,x.height),r.uniforms.u_speed.value=e,r.uniforms.u_layer1Color.value.set(...c(t[0]?.color||"#000")),r.uniforms.u_layer1Speed.value=t[0]?.speed||0,r.uniforms.u_layer1Intensity.value=t[0]?.intensity||0,r.uniforms.u_layer2Color.value.set(...c(t[1]?.color||"#000")),r.uniforms.u_layer2Speed.value=t[1]?.speed||0,r.uniforms.u_layer2Intensity.value=t[1]?.intensity||0,r.uniforms.u_layer3Color.value.set(...c(t[2]?.color||"#000")),r.uniforms.u_layer3Speed.value=t[2]?.speed||0,r.uniforms.u_layer3Intensity.value=t[2]?.intensity||0,r.uniforms.u_layer4Color.value.set(...c(t[3]?.color||"#000")),r.uniforms.u_layer4Speed.value=t[3]?.speed||0,r.uniforms.u_layer4Intensity.value=t[3]?.intensity||0,r.uniforms.u_noiseScale.value=l,r.uniforms.u_movementX.value=i,r.uniforms.u_movementY.value=f,r.uniforms.u_verticalFade.value=y,r.uniforms.u_bloomIntensity.value=m,r.uniforms.u_skyColor1.value.set(...c(_[0]?.color||"#000")),r.uniforms.u_skyColor2.value.set(...c(_[1]?.color||"#000")),r.uniforms.u_skyBlend1.value=_[1]?.blend||0,r.uniforms.u_skyBlend2.value=_[0]?.blend||0,r.uniforms.u_brightness.value=d,r.uniforms.u_saturation.value=p,r.uniforms.u_opacity.value=h}),(0,u.jsxs)("mesh",{ref:S,children:[(0,u.jsx)("planeGeometry",{args:[2,2]}),(0,u.jsx)("shaderMaterial",{vertexShader:s,fragmentShader:v,uniforms:b,transparent:!0})]})},y=({width:e="100%",height:r="100%",className:o,children:n,speed:a=1.5,layers:s=l,noiseScale:v=3.5,movementX:c=-2,movementY:y=-3,verticalFade:m=.75,bloomIntensity:_=2,skyLayers:d=i,brightness:p=.8,saturation:h=1,opacity:S=1})=>{let x="number"==typeof e?`${e}px`:e,b="number"==typeof r?`${r}px`:r;return(0,u.jsxs)("div",{className:`relative overflow-hidden ${o||""}`,style:{width:x,height:b},children:[(0,u.jsx)(t.Canvas,{className:"absolute inset-0 w-full h-full",gl:{antialias:!0,alpha:!0},orthographic:!0,camera:{position:[0,0,1],zoom:1,left:-1,right:1,top:1,bottom:-1},children:(0,u.jsx)(f,{speed:a,layers:s,noiseScale:v,movementX:c,movementY:y,verticalFade:m,bloomIntensity:_,skyLayers:d,brightness:p,saturation:h,opacity:S})}),n&&(0,u.jsx)("div",{className:"relative z-10",children:n})]})};y.displayName="AuroraBlur",e.s(["default",0,y])},670412,e=>{e.n(e.i(369307))}]);