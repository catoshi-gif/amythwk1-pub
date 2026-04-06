"use client";

import React, { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

function toRGB(hex: string) {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b] as const;
}

function lerpHex(a: string, b: string, t: number) {
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  const out = ca.clone().lerp(cb, t);
  return `#${out.getHexString()}`;
}

type GradientTri = {
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
  ca: string;
  cb: string;
  cc: string;
};

/**
 * Exact AMYTH header silhouette:
 * M16 2 L26 10 L22 30 L10 30 L6 10 Z
 *
 * Keeps the exact approved shape:
 * - exact 5-sided perimeter from the site header
 * - one front apex
 * - one back apex
 * - no flat extruded side walls
 * - all faces are triangular facets
 */
function createAmythCrystalGeometry() {
  const positions: number[] = [];
  const colors: number[] = [];

  const pushTri = ({ a, b, c, ca, cb, cc }: GradientTri) => {
    const [ar, ag, ab] = toRGB(ca);
    const [br, bg, bb] = toRGB(cb);
    const [cr, cg, cb2] = toRGB(cc);

    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    colors.push(ar, ag, ab, br, bg, bb, cr, cg, cb2);
  };

  // Exact approved silhouette proportions
  const top = new THREE.Vector3(0.0, 1.02, 0);
  const upperRight = new THREE.Vector3(0.82, 0.38, 0);
  const lowerRight = new THREE.Vector3(0.5, -1.16, 0);
  const lowerLeft = new THREE.Vector3(-0.5, -1.16, 0);
  const upperLeft = new THREE.Vector3(-0.82, 0.38, 0);

  const perimeter = [top, upperRight, lowerRight, lowerLeft, upperLeft];

  // Keep the same depth/shape
  const frontApex = new THREE.Vector3(0, 0.04, 0.52);
  const backApex = new THREE.Vector3(0, 0.04, -0.52);

  // Richer purple palette for per-vertex gradients
  const frontFacetBases = [
    ["#FCF8FF", "#E9DBFF", "#CBB2FF"],
    ["#E9DBFF", "#C9A5FF", "#9B5DE5"],
    ["#B987FF", "#8B4DFF", "#6D28D9"],
    ["#9E63FF", "#7C3AED", "#5B21D9"],
    ["#C8AEFF", "#8B5CF6", "#6D28D9"],
  ] as const;

  const backFacetBases = [
    ["#F7F0FF", "#E7D7FF", "#CFAEFF"],
    ["#E4D1FF", "#BD96FF", "#8F5CF6"],
    ["#A976FF", "#7C3AED", "#6227E8"],
    ["#8B5CF6", "#6D28D9", "#541FF3"],
    ["#C3A5FF", "#8C63F5", "#6A39EE"],
  ] as const;

  // FRONT facets
  for (let i = 0; i < perimeter.length; i++) {
    const next = (i + 1) % perimeter.length;
    const [apexColor, edgeAColor, edgeBColor] = frontFacetBases[i];

    pushTri({
      a: frontApex,
      b: perimeter[next],
      c: perimeter[i],
      ca: apexColor,
      cb: edgeAColor,
      cc: edgeBColor,
    });
  }

  // BACK facets
  for (let i = 0; i < perimeter.length; i++) {
    const next = (i + 1) % perimeter.length;
    const [apexColor, edgeAColor, edgeBColor] = backFacetBases[i];

    pushTri({
      a: backApex,
      b: perimeter[i],
      c: perimeter[next],
      ca: apexColor,
      cb: edgeAColor,
      cc: edgeBColor,
    });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  return geometry;
}

function CrystalMesh() {
  const groupRef = useRef<THREE.Group>(null!);

  const geometry = useMemo(() => createAmythCrystalGeometry(), []);
  const edges = useMemo(() => new THREE.EdgesGeometry(geometry, 1), [geometry]);

  useFrame((state, delta) => {
    if (!groupRef.current) return;

    groupRef.current.rotation.y += delta * 0.34;

    // subtle shimmer from light motion, not geometry changes
    const t = state.clock.elapsedTime;
    groupRef.current.rotation.z = Math.sin(t * 0.45) * 0.025;
  });

  return (
    <group ref={groupRef} scale={[1.0, 1.0, 1.0]}>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshPhysicalMaterial
          vertexColors
          flatShading
          roughness={0.11}
          metalness={0.05}
          clearcoat={1}
          clearcoatRoughness={0.05}
          reflectivity={0.9}
          sheen={0.9}
          sheenColor={lerpHex("#C2B6F7", "#F7F1FF", 0.5)}
        />
      </mesh>

      <lineSegments geometry={edges} renderOrder={2}>
        <lineBasicMaterial
          color="#FFF9FF"
          transparent
          opacity={0.94}
          depthWrite={false}
        />
      </lineSegments>
    </group>
  );
}

export default function InteractiveCrystal() {
  return (
    <div className="flex h-[540px] w-full items-center justify-center overflow-visible px-10 sm:px-16 md:px-24 lg:px-32">
      <Canvas
        camera={{ position: [0, 0.02, 5.95], fov: 29 }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
      >
        <ambientLight intensity={0.95} color="#FAF7FF" />

        <directionalLight
          position={[3.2, 3.4, 3.9]}
          intensity={1.28}
          color="#FFFFFF"
        />

        <directionalLight
          position={[-2.6, 1.5, 2.7]}
          intensity={0.72}
          color="#E2D3FF"
        />

        <directionalLight
          position={[0.5, -2.5, 2.4]}
          intensity={0.42}
          color="#8B5CF6"
        />

        <pointLight
          position={[-1.6, -0.35, -2.2]}
          intensity={0.16}
          color="#541FF3"
        />

        <pointLight
          position={[1.35, 0.65, 2.5]}
          intensity={0.2}
          color="#D8C4FF"
        />

        <CrystalMesh />

        <OrbitControls
          enableZoom={false}
          enablePan={false}
          rotateSpeed={0.62}
          minPolarAngle={Math.PI / 2.18}
          maxPolarAngle={Math.PI / 1.82}
        />
      </Canvas>
    </div>
  );
}
