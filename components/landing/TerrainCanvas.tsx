"use client";

import { useRef, useMemo, Suspense } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { createNoise2D } from "simplex-noise";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

// ── Terrain mesh ──────────────────────────────────────────────────────────────

interface TerrainMeshProps {
  readonly reducedMotion: boolean;
  readonly mouseRef: React.RefObject<{ x: number; y: number }>;
}

function TerrainMesh({ reducedMotion, mouseRef }: TerrainMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const noise2D = useMemo(() => createNoise2D(), []);

  // Build displaced geometry once
  const { geometry, baseHeights } = useMemo(() => {
    const geo = new THREE.PlaneGeometry(140, 140, 180, 180);
    geo.rotateX(-Math.PI / 2);

    const positions = geo.attributes.position.array as Float32Array;
    const heights = new Float32Array(positions.length / 3);

    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const z = positions[i + 2];
      const h =
        noise2D(x * 0.018, z * 0.018) * 9 +
        noise2D(x * 0.06, z * 0.06) * 3 +
        noise2D(x * 0.14, z * 0.14) * 1;
      positions[i + 1] = h;
      heights[i / 3] = h;
    }

    geo.computeVertexNormals();
    geo.attributes.position.needsUpdate = true;

    return { geometry: geo, baseHeights: heights };
  }, [noise2D]);

  // Animate: slow rotation + subtle height pulse
  useFrame((state) => {
    if (!meshRef.current || reducedMotion) return;

    // Slow Y-axis rotation
    meshRef.current.rotation.y += 0.0003;

    // Height pulse (sin wave, 8s period)
    const t = state.clock.elapsedTime;
    const pos = meshRef.current.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i];
      const z = pos[i + 2];
      const base = baseHeights[i / 3];
      const wave = Math.sin(t * (Math.PI * 2 / 8) + x * 0.08 + z * 0.06) * 0.6;

      // Cursor ripple displacement
      const mouse = mouseRef.current;
      const mouseWorldX = mouse.x * 70;  // Half of 140 (geometry width)
      const mouseWorldZ = mouse.y * 70;  // Half of 140 (geometry height)
      const distSq = (x - mouseWorldX) ** 2 + (z - mouseWorldZ) ** 2;
      const cursorRadius = 400;     // squared radius
      const cursorAmplitude = 4;
      const cursorEffect = cursorAmplitude * Math.exp(-distSq / cursorRadius);

      pos[i + 1] = base + wave + cursorEffect;
    }
    meshRef.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <mesh ref={meshRef} geometry={geometry}>
      <meshBasicMaterial
        color={new THREE.Color(0x4a7c59)}
        wireframe
        transparent
        opacity={0.28}
      />
    </mesh>
  );
}

// ── Scene setup ───────────────────────────────────────────────────────────────

interface SceneProps {
  readonly reducedMotion: boolean;
  readonly mouseRef: React.RefObject<{ x: number; y: number }>;
}

function Scene({ reducedMotion, mouseRef }: SceneProps) {
  return (
    <>
      {/* Atmospheric fog */}
      <fogExp2 attach="fog" args={[new THREE.Color(0x080c0a), 0.009]} />
      <TerrainMesh reducedMotion={reducedMotion} mouseRef={mouseRef} />
    </>
  );
}

// ── Fallback ──────────────────────────────────────────────────────────────────

function TerrainFallback() {
  return (
    <div
      className="absolute inset-0"
      style={{ background: "radial-gradient(ellipse at 50% 80%, #0F1F12 0%, #080C0A 70%)" }}
    />
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

interface TerrainCanvasProps {
  /** Camera Y position offset (higher = more top-down view) */
  cameraY?: number;
  /** Camera Z position */
  cameraZ?: number;
  /** Canvas opacity */
  opacity?: number;
}

/**
 * Three.js terrain canvas with simplex-noise displacement and wireframe shader.
 * Falls back to a gradient background if WebGL is unavailable.
 *
 * Must be loaded with dynamic import + ssr:false.
 */
export default function TerrainCanvas({
  cameraY = 28,
  cameraZ = 60,
  opacity = 0.7,
}: TerrainCanvasProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const mouseRef = useRef({ x: 0, y: 0 });

  const handlePointerMove = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    mouseRef.current = {
      x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
      y: -(((e.clientY - rect.top) / rect.height) * 2 - 1),
    };
  };

  return (
    <div
      className="absolute inset-0"
      style={{ opacity, zIndex: 0 }}
      aria-hidden="true"
      onPointerMove={handlePointerMove}
    >
      <Suspense fallback={<TerrainFallback />}>
        <Canvas
          camera={{
            position: [0, cameraY, cameraZ],
            fov: 50,
            near: 0.1,
            far: 400,
          }}
          gl={{
            antialias: false,
            powerPreference: "low-power",
          }}
          style={{ width: "100%", height: "100%" }}
          onCreated={({ gl }) => {
            gl.setClearColor(new THREE.Color(0x080c0a), 0);
          }}
        >
          <Scene reducedMotion={prefersReducedMotion} mouseRef={mouseRef} />
        </Canvas>
      </Suspense>
    </div>
  );
}
