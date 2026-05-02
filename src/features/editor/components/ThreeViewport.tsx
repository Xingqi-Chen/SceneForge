"use client";

import { Component, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { Grid, Html, OrbitControls } from "@react-three/drei";
import { WebGLRenderer } from "three";

import { useEditorStore } from "@/features/editor/store/editor-store";
import type { SceneObject, SceneObject3DTransform } from "@/shared/types";

const DEG2RAD = Math.PI / 180;

type WebGLStatus = "checking" | "available" | "unavailable";

function isWebGLContextError(value: unknown) {
  const message =
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : value && typeof value === "object" && "message" in value
          ? String(value.message)
          : "";

  return /webgl|webglrenderer|creating webgl context/i.test(message);
}

function isKnownThreeDeprecationWarning(value: unknown) {
  const message =
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : value && typeof value === "object" && "message" in value
          ? String(value.message)
          : "";

  return (
    message.includes("THREE.Clock: This module has been deprecated") ||
    message.includes("THREE.WebGLShadowMap: PCFSoftShadowMap has been deprecated")
  );
}

function canCreateThreeRenderer() {
  if (typeof document === "undefined") {
    return false;
  }

  const canvas = document.createElement("canvas");
  const originalConsoleError = console.error;

  try {
    console.error = (...args: unknown[]) => {
      if (args.some(isWebGLContextError)) {
        return;
      }

      originalConsoleError(...args);
    };

    const renderer = new WebGLRenderer({
      antialias: true,
      canvas,
      failIfMajorPerformanceCaveat: false,
      powerPreference: "high-performance",
    });

    renderer.forceContextLoss();
    renderer.dispose();
    return true;
  } catch (error) {
    if (!isWebGLContextError(error)) {
      console.warn("[SceneForge] [canvas] WebGL renderer preflight failed", { error });
    }

    return false;
  } finally {
    console.error = originalConsoleError;
  }
}

function WebGLFallback({ status }: { status: WebGLStatus }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-slate-950 p-8 text-slate-100">
      <div className="max-w-md rounded-xl border border-white/10 bg-slate-900/90 p-5 shadow-2xl">
        <h3 className="text-sm font-semibold">
          {status === "checking" ? "正在检测 3D 渲染能力..." : "正在切换到轻量 3D 预览..."}
        </h3>
      </div>
    </div>
  );
}

class WebGLCanvasBoundary extends Component<
  { children: ReactNode; onWebGLError: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(error: unknown) {
    return { failed: isWebGLContextError(error) };
  }

  componentDidCatch(error: unknown) {
    if (isWebGLContextError(error)) {
      this.props.onWebGLError();
    }
  }

  render() {
    if (this.state.failed) {
      return <WebGLFallback status="unavailable" />;
    }

    return this.props.children;
  }
}

function is3DObject(object: SceneObject) {
  return (
    object.transform3D &&
    (object.kind === "cube" ||
      object.kind === "sphere" ||
      object.kind === "cylinder" ||
      object.kind === "plane")
  );
}

function objectSelected(selection: ReturnType<typeof useEditorStore.getState>["selection"], id: string) {
  if (selection.kind === "object") {
    return selection.id === id;
  }

  if (selection.kind === "multiple") {
    return selection.objectIds.includes(id);
  }

  return false;
}

function rotationRadians(transform: SceneObject3DTransform, object: SceneObject) {
  const baseX = object.kind === "plane" ? -90 : 0;
  return [
    (transform.rotation.x + baseX) * DEG2RAD,
    transform.rotation.y * DEG2RAD,
    transform.rotation.z * DEG2RAD,
  ] as const;
}

function PrimitiveGeometry({ kind }: { kind: SceneObject["kind"] }) {
  if (kind === "sphere") {
    return <sphereGeometry args={[0.6, 32, 24]} />;
  }

  if (kind === "cylinder") {
    return <cylinderGeometry args={[0.5, 0.5, 1.2, 32]} />;
  }

  if (kind === "plane") {
    return <planeGeometry args={[1.4, 1.4]} />;
  }

  return <boxGeometry args={[1, 1, 1]} />;
}

function SceneObjectMesh({ object, selected }: { object: SceneObject; selected: boolean }) {
  const selectObject = useEditorStore((state) => state.selectObject);
  const transform = object.transform3D;

  if (!transform) {
    return null;
  }

  function handleSelect(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation();
    selectObject(object.id);
  }

  return (
    <group
      onClick={handleSelect}
      onPointerDown={handleSelect}
      position={[transform.position.x, transform.position.y, transform.position.z]}
      rotation={rotationRadians(transform, object)}
      scale={[transform.scale.x, transform.scale.y, transform.scale.z]}
    >
      <mesh>
        <PrimitiveGeometry kind={object.kind} />
        <meshStandardMaterial
          color={object.fill}
          emissive={selected ? "#1d4ed8" : "#000000"}
          emissiveIntensity={selected ? 0.18 : 0}
          roughness={0.58}
        />
      </mesh>
      {selected ? (
        <mesh scale={[1.08, 1.08, 1.08]}>
          <PrimitiveGeometry kind={object.kind} />
          <meshBasicMaterial color="#2563eb" wireframe />
        </mesh>
      ) : null}
      <Html center distanceFactor={9} position={[0, object.kind === "plane" ? 0.05 : 0.9, 0]}>
        <div className="pointer-events-none rounded bg-white/85 px-2 py-0.5 text-[11px] font-semibold text-slate-800 shadow-sm ring-1 ring-slate-200">
          {object.name}
        </div>
      </Html>
    </group>
  );
}

function getCssPrimitiveClass(object: SceneObject, selected: boolean) {
  const base =
    "absolute flex items-center justify-center border text-[11px] font-semibold text-white shadow-xl transition-all";
  const selectedClass = selected
    ? "border-blue-300 ring-4 ring-blue-400/40"
    : "border-white/25 ring-1 ring-black/20";

  if (object.kind === "sphere") {
    return `${base} ${selectedClass} rounded-full`;
  }

  if (object.kind === "cylinder") {
    return `${base} ${selectedClass} rounded-[999px]`;
  }

  if (object.kind === "plane") {
    return `${base} ${selectedClass} rounded-md opacity-90`;
  }

  return `${base} ${selectedClass} rounded-lg`;
}

function getCssPrimitiveStyle(object: SceneObject): CSSProperties {
  const transform = object.transform3D;

  if (!transform) {
    return {};
  }

  const width = Math.max(42, 64 * transform.scale.x);
  const height =
    object.kind === "plane"
      ? Math.max(24, 42 * transform.scale.z)
      : Math.max(42, 64 * transform.scale.y);
  const left = 50 + transform.position.x * 8;
  const top = 54 + transform.position.z * 7 - transform.position.y * 6;

  return {
    background: object.fill,
    height,
    left: `${left}%`,
    top: `${top}%`,
    transform: [
      "translate(-50%, -50%)",
      "rotateX(58deg)",
      "rotateZ(-35deg)",
      `rotateY(${transform.rotation.y}deg)`,
      `rotateZ(${transform.rotation.z}deg)`,
    ].join(" "),
    width,
  };
}

function Css3DViewport({
  objects,
  selection,
  selectScene,
}: {
  objects: SceneObject[];
  selection: ReturnType<typeof useEditorStore.getState>["selection"];
  selectScene: () => void;
}) {
  const selectObject = useEditorStore((state) => state.selectObject);

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-slate-950"
      onMouseDown={selectScene}
      role="presentation"
    >
      <div className="absolute left-1/2 top-5 z-20 -translate-x-1/2 rounded-full border border-amber-300/30 bg-amber-950/70 px-4 py-2 text-xs font-medium text-amber-100 shadow-lg">
        WebGL 不可用，正在显示轻量 3D 预览；对象仍可选择并在右侧编辑位置、旋转和缩放。
      </div>
      <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.16)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.16)_1px,transparent_1px)] [background-size:48px_48px]" />
      <div className="absolute left-1/2 top-1/2 h-[64%] w-[72%] -translate-x-1/2 -translate-y-1/2 rotate-x-[58deg] rotate-z-[-35deg] rounded-2xl border border-slate-500/30 bg-slate-800/25 shadow-2xl" />
      {objects.length === 0 ? (
        <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-white/10 bg-slate-900/85 px-4 py-3 text-sm text-slate-200">
          从左侧「3D 基础体」添加立方体、球体、圆柱或平面
        </div>
      ) : null}
      {objects.map((object) => {
        const selected = objectSelected(selection, object.id);

        return (
          <button
            aria-label={`选择 ${object.name}`}
            className={getCssPrimitiveClass(object, selected)}
            key={object.id}
            onMouseDown={(event) => {
              event.stopPropagation();
              selectObject(object.id);
            }}
            style={getCssPrimitiveStyle(object)}
            type="button"
          >
            <span className="max-w-[92px] truncate drop-shadow">{object.name}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ThreeViewport() {
  const { project, selectScene, selection } = useEditorStore();
  const { three } = project.scene;
  const objects = project.scene.objects.filter(is3DObject);
  const [webGLStatus, setWebGLStatus] = useState<WebGLStatus>("checking");

  useEffect(() => {
    function markUnavailable() {
      setWebGLStatus("unavailable");
    }

    function handleRejection(event: PromiseRejectionEvent) {
      if (isWebGLContextError(event.reason)) {
        event.preventDefault();
        markUnavailable();
      }
    }

    function handleError(event: ErrorEvent) {
      if (isWebGLContextError(event.error) || isWebGLContextError(event.message)) {
        event.preventDefault();
        markUnavailable();
      }
    }

    const detectionId = window.setTimeout(() => {
      setWebGLStatus(canCreateThreeRenderer() ? "available" : "unavailable");
    }, 0);
    const originalConsoleWarn = console.warn;
    const originalConsoleError = console.error;

    console.warn = (...args: unknown[]) => {
      if (args.some(isKnownThreeDeprecationWarning)) {
        return;
      }

      originalConsoleWarn(...args);
    };

    console.error = (...args: unknown[]) => {
      if (args.some(isKnownThreeDeprecationWarning)) {
        return;
      }

      originalConsoleError(...args);
    };

    window.addEventListener("unhandledrejection", handleRejection);
    window.addEventListener("error", handleError);

    return () => {
      window.clearTimeout(detectionId);
      console.warn = originalConsoleWarn;
      console.error = originalConsoleError;
      window.removeEventListener("unhandledrejection", handleRejection);
      window.removeEventListener("error", handleError);
    };
  }, []);

  if (webGLStatus === "checking") {
    return <WebGLFallback status={webGLStatus} />;
  }

  if (webGLStatus === "unavailable") {
    return <Css3DViewport objects={objects} selectScene={selectScene} selection={selection} />;
  }

  return (
    <div className="relative h-full w-full bg-slate-950">
      {objects.length === 0 ? (
        <div className="pointer-events-none absolute left-1/2 top-6 z-10 -translate-x-1/2 rounded-full border border-white/10 bg-slate-900/80 px-4 py-2 text-xs text-slate-200 shadow-lg">
          从左侧「3D 基础体」添加立方体、球体、圆柱或平面
        </div>
      ) : null}
      <WebGLCanvasBoundary onWebGLError={() => setWebGLStatus("unavailable")}>
        <Canvas
          camera={{
            fov: three.camera.fov,
            position: [three.camera.position.x, three.camera.position.y, three.camera.position.z],
          }}
          onPointerMissed={selectScene}
        >
          <color args={["#0f172a"]} attach="background" />
          <ambientLight intensity={three.lighting.ambientIntensity} />
          <directionalLight
            intensity={three.lighting.directionalIntensity}
            position={[
              three.lighting.directionalPosition.x,
              three.lighting.directionalPosition.y,
              three.lighting.directionalPosition.z,
            ]}
          />
          <Grid
            args={[three.grid.size, three.grid.size]}
            cellColor="#475569"
            cellSize={1}
            fadeDistance={18}
            fadeStrength={1}
            sectionColor="#94a3b8"
            sectionSize={three.grid.divisions / 4}
          />
          {objects.map((object) => (
            <SceneObjectMesh
              key={object.id}
              object={object}
              selected={objectSelected(selection, object.id)}
            />
          ))}
          <OrbitControls
            enableDamping
            makeDefault
            target={[three.camera.target.x, three.camera.target.y, three.camera.target.z]}
          />
        </Canvas>
      </WebGLCanvasBoundary>
    </div>
  );
}
