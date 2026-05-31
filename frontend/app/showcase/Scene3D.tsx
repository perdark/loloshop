"use client";
/* eslint-disable react-hooks/immutability */
// r3f imperative pattern: textures/canvases/scene objects are created in useMemo and
// mutated each frame in useFrame — valid and idiomatic, but trips React-Compiler lint.

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ScrollControls, Scroll, useScroll, useGLTF, ContactShadows, Float, Environment } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";

const ORANGE = "#f47b42";

function mstop(o: number, stops: [number, number][]) {
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, va] = stops[i];
    const [b, vb] = stops[i + 1];
    if (o <= b) {
      const t = THREE.MathUtils.clamp((o - a) / (b - a), 0, 1);
      const s = t * t * (3 - 2 * t);
      return va + (vb - va) * s;
    }
  }
  return stops[stops.length - 1][1];
}

/* ── Real mortarboard cap (GLB, spins / tassel-turns on scroll) ── */
function Cap({ rot }: { rot: React.MutableRefObject<number> }) {
  const { scene } = useGLTF("/showcase/cap.glb");
  const g = useRef<THREE.Group>(null);
  const fit = useMemo(() => {
    scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    const c = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(c);
    return { c, scale: 2.0 / Math.max(size.x, size.z) };
  }, [scene]);
  useFrame(() => { if (g.current) g.current.rotation.y = rot.current; });
  return (
    <group ref={g} scale={fit.scale}>
      <primitive object={scene} position={[-fit.c.x, -fit.c.y, -fit.c.z]} />
    </group>
  );
}

/* ── Sash prints: name on the LEFT strap, college logo on the RIGHT (matches the designer) ── */
const SAMPLE_NAMES = ["زَينب", "مُحمَّد", "فاطِمة", "عبدالله", "رُقيّة", "حُسين"];
export const LOGOS = Array.from({ length: 11 }, (_, i) => `/showcase/z${i + 1}.webp`);

function useCanvasTex(w: number, h: number) {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const x = c.getContext("2d")!;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16;
    return { tex: t, canvas: c, ctx: x };
  }, [w, h]);
}

/* student name (auto-fit) — LEFT strap (matches the real sash) */
function SashName({ nameRef, revealRef }: { nameRef: React.MutableRefObject<string>; revealRef: React.MutableRefObject<number> }) {
  const { tex, canvas, ctx } = useCanvasTex(400, 980);
  const last = useRef("__init__");
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const draw = (text: string) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    // run the name VERTICALLY down the strap (rotate 90°)
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.direction = "rtl";
    // elongated calligraphy look (فــرقـان): stretch letters along the baseline
    const STRETCH = 1.32;
    const AVAIL = 860; // strap-length room
    let fs = 320;
    do { ctx.font = `700 ${fs}px 'Amiri','Noto Naskh Arabic','Cairo',serif`; fs -= 6; }
    while (ctx.measureText(text || "اسمكِ").width * STRETCH > AVAIL && fs > 110);
    ctx.scale(STRETCH, 1);
    ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 14;
    ctx.fillStyle = "#fbf7ee";
    ctx.fillText(text || "اسمكِ", 0, 0);
    ctx.restore();
    tex.needsUpdate = true;
  };
  useFrame((s) => {
    const typed = nameRef.current?.trim();
    const target = typed || SAMPLE_NAMES[Math.floor(s.clock.elapsedTime / 2.4) % SAMPLE_NAMES.length];
    if (target !== last.current) { last.current = target; draw(target); }
    if (matRef.current) matRef.current.opacity = revealRef.current;
  });
  return (
    <mesh position={[0.2, -0.08, 0]} rotation={[0.05, 0, -0.05]}>
      <planeGeometry args={[0.275, 0.674]} />
      <meshBasicMaterial ref={matRef} map={tex} transparent opacity={0} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

/* college emblem + class year — RIGHT strap (university side) */
function SashLogo({ logoRef, revealRef }: { logoRef: React.MutableRefObject<string>; revealRef: React.MutableRefObject<number> }) {
  const { tex, canvas, ctx } = useCanvasTex(420, 600);
  const cache = useMemo<Record<string, HTMLImageElement>>(() => ({}), []);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const lastUrl = useRef("__init__");
  const dirty = useRef(true);
  const getImg = (url: string) => {
    if (!cache[url]) {
      const im = new Image();
      im.onload = () => { dirty.current = true; };
      im.src = url;
      cache[url] = im;
    }
    return cache[url];
  };
  const draw = (url: string) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const img = getImg(url);
    const R = 202, cx = 210, cy = 205;
    if (img.complete && img.naturalWidth) {
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
      ctx.fillStyle = "#fff"; ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
      ctx.drawImage(img, cx - R, cy - R, 2 * R, 2 * R);
      ctx.restore();
      ctx.beginPath(); ctx.arc(cx, cy, R - 2, 0, Math.PI * 2);
      ctx.lineWidth = 7; ctx.strokeStyle = "rgba(255,217,160,0.85)"; ctx.stroke();
    }
    // class year under the emblem (lives on the university strap)
    ctx.save();
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.direction = "rtl";
    ctx.fillStyle = "#ffd9a0";
    ctx.fillRect(cx - 70, 458, 140, 5);
    ctx.font = "600 64px 'Amiri','Noto Naskh Arabic',serif";
    ctx.fillStyle = "#fbf7ee";
    ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 10;
    ctx.fillText("دفعة ٢٠٢٦", cx, 535);
    ctx.restore();
    tex.needsUpdate = true;
  };
  useFrame((s) => {
    const picked = logoRef.current;
    const url = picked || LOGOS[Math.floor(s.clock.elapsedTime / 2.4) % LOGOS.length];
    if (url !== lastUrl.current || dirty.current) { lastUrl.current = url; dirty.current = false; draw(url); }
    if (matRef.current) matRef.current.opacity = revealRef.current;
  });
  return (
    <mesh position={[-0.4, -0.16, 0]} rotation={[0.05, 0, -0.05]}>
      <planeGeometry args={[0.36, 0.514]} />
      <meshBasicMaterial ref={matRef} map={tex} transparent opacity={0} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

/* ── The gown (robe + its own sash, baked into one GLB) + the name print ── */
function Robe({ nameRef, logoRef, revealRef }: {
  nameRef: React.MutableRefObject<string>;
  logoRef: React.MutableRefObject<string>;
  revealRef: React.MutableRefObject<number>;
}) {
  const { scene } = useGLTF("/showcase/outfit.glb");
  const { center, scale } = useMemo(() => {
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true; m.receiveShadow = true;
        const arr = Array.isArray(m.material) ? m.material : [m.material];
        arr.forEach((mm) => {
          const sm = mm as THREE.MeshStandardMaterial;
          if (!sm) return;
          sm.transparent = false; sm.depthWrite = true; sm.opacity = 1;
          sm.side = THREE.DoubleSide;
          if ("roughness" in sm && sm.roughness < 0.5) sm.roughness = 0.62;
          if (sm.color) sm.color.multiplyScalar(0.72); // deepen the grey gown toward true black
          if (sm.map) sm.map.anisotropy = 16;          // sharpen the gown texture at grazing angles
          sm.needsUpdate = true;
        });
      }
    });
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    const c = new THREE.Vector3();
    box.getSize(size); box.getCenter(c);
    return { center: c, scale: 4.7 / size.y };
  }, [scene]);

  return (
    <group>
      <group scale={scale}><primitive object={scene} position={[-center.x, -center.y, -center.z]} /></group>
      {/* the two strap prints, seated on the gown's own sash */}
      <group position={[0, 0.2, 1.0]}>
        <SashName nameRef={nameRef} revealRef={revealRef} />
        <SashLogo logoRef={logoRef} revealRef={revealRef} />
      </group>
    </group>
  );
}

function Experience({ nameRef, logoRef }: { nameRef: React.MutableRefObject<string>; logoRef: React.MutableRefObject<string> }) {
  const scroll = useScroll();
  const { camera, size } = useThree();
  // portrait phones: pull the camera back so the cap clears the top and the
  // headings don't collide with the outfit (fov is fixed/vertical in three).
  const portrait = size.height > size.width;
  const zMul = portrait ? 1.16 : 1;
  const fit = portrait ? 0.64 : 0.8;
  const capRot = useRef(0);
  const reveal = useRef(0);
  const target = useMemo(() => new THREE.Vector3(), []);
  const robeRef = useRef<THREE.Group>(null);
  const capRef = useRef<THREE.Group>(null);
  const shiftRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    const o = scroll.offset;
    const z = mstop(o, [[0, 6.9], [0.33, 3.7], [0.66, 7.6], [1, 6.9]]) * zMul;
    const ty = mstop(o, [[0, 0.1], [0.33, -0.35], [0.66, 0.1], [1, 0.1]]);
    // horizontal framing: a touch right at the hero, fully right (controls go left)
    // at the sash beat, recentred for the exploded + finale beats
    const mX = mstop(o, [[0, 0.7], [0.33, 1.45], [0.5, 0.7], [0.66, 0], [1, 0]]);
    const camX = mX * 0.5;
    camera.position.x += (camX - camera.position.x) * 0.1;
    camera.position.y += (ty * 0.5 - camera.position.y) * 0.1;
    camera.position.z += (z - camera.position.z) * 0.1;
    target.set(camX, ty, 0);
    camera.lookAt(target);
    if (shiftRef.current) shiftRef.current.position.x += (mX - shiftRef.current.position.x) * 0.1;

    // beat 2 — cap lifts off the gown (#4, the part that can detach)
    const ex = 1 - Math.min(1, Math.abs(o - 0.66) / 0.18);
    if (capRef.current) capRef.current.position.y = 2.55 + ex * 1.5;
    if (robeRef.current) robeRef.current.position.z = -ex * 0.4;

    // cap turns through scroll + a decisive tassel-flip at the finale (#5)
    capRot.current = state.clock.elapsedTime * 0.2 + o * Math.PI * 1.6 + mstop(o, [[0, 0], [0.82, 0], [1, Math.PI]]);

    // name print hidden on the first look, fades in only after the hero
    const r = THREE.MathUtils.clamp((o - 0.22) / 0.1, 0, 1);
    reveal.current = r * r * (3 - 2 * r);
  });

  return (
    <>
      <Float floatIntensity={0.5} rotationIntensity={0.12} speed={1}>
        <group ref={shiftRef}>
          <group scale={fit}>
            <group ref={robeRef}><Robe nameRef={nameRef} logoRef={logoRef} revealRef={reveal} /></group>
            <group ref={capRef} position={[0, 2.55, 0.1]} scale={1.05}>
              <Cap rot={capRot} />
            </group>
          </group>
        </group>
      </Float>
      <ContactShadows position={[0, -2.5, 0]} opacity={0.36} scale={9} blur={2.8} far={4} color="#1a1a1a" />
    </>
  );
}

export default function Scene3D({
  overlay,
  nameRef,
  logoRef,
}: {
  overlay: React.ReactNode;
  nameRef: React.MutableRefObject<string>;
  logoRef: React.MutableRefObject<string>;
}) {
  const isMobile = typeof navigator !== "undefined" && /iPhone|iPad|Android/i.test(navigator.userAgent);
  return (
    <Canvas
      shadows
      dpr={isMobile ? [1, 1.5] : [1, 2]}
      performance={{ min: 0.5 }}
      gl={{ antialias: true, alpha: true, toneMappingExposure: 1.15 }}
      camera={{ position: [0, 0.1, 6.9], fov: 42 }}
    >
      <color attach="background" args={["#faf4ea"]} />
      <fog attach="fog" args={["#faf4ea", 12, 24]} />
      <ambientLight intensity={0.9} color="#fff1df" />
      <directionalLight position={[4, 6, 5]} intensity={2.4} color="#ffeccc" castShadow shadow-mapSize={[1024, 1024]} />
      <pointLight position={[-4, 0, 4]} intensity={1.7} color={ORANGE} />
      <pointLight position={[3, 2, 2]} intensity={0.6} color="#dfe6ff" />
      <directionalLight position={[-3, 4, -6]} intensity={1.9} color="#ffd9a8" />

      <Suspense fallback={null}>
        <Environment preset="apartment" environmentIntensity={0.45} />
        <ScrollControls pages={4} damping={0.25}>
          <Experience nameRef={nameRef} logoRef={logoRef} />
          <Scroll html style={{ width: "100%" }}>{overlay}</Scroll>
        </ScrollControls>
      </Suspense>

      <EffectComposer multisampling={4} enableNormalPass={false}>
        <Bloom intensity={0.16} luminanceThreshold={0.82} luminanceSmoothing={0.25} mipmapBlur />
      </EffectComposer>
    </Canvas>
  );
}

useGLTF.preload("/showcase/outfit.glb");
useGLTF.preload("/showcase/cap.glb");
