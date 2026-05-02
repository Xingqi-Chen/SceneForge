"use client";

import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { Grid, Html, OrbitControls, PerspectiveCamera, TransformControls } from "@react-three/drei";
import { MathUtils, WebGLRenderer, type Group } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { defaultScene } from "@/features/editor/store/defaults";
import { isThreeDViewportPrimitive } from "@/features/editor/scene-viewport-objects";
import type { SceneObject, SceneObject3DTransform, Vector3 } from "@/shared/types";

import type { CanvasCapture } from "./CanvasStage";

const DEG2RAD = Math.PI / 180;

/**
 * drei TransformControls 在拖拽时会关掉默认 OrbitControls；若控件在 dragging 卸载（重叠物体抢点击导致换选、Strict Mode 等），
 * detach() 不会触发 dragging-changed(false)，轨道会一直禁用。卸载时强制恢复。
 */
function TransformControlsWithOrbitRestore(props: ComponentProps<typeof TransformControls>) {
  const defaultControls = useThree((state) => state.controls);

  useEffect(() => {
    return () => {
      const ctrl = defaultControls as { enabled?: boolean } | undefined;
      if (ctrl && typeof ctrl.enabled === "boolean") {
        ctrl.enabled = true;
      }
    };
  }, [defaultControls]);

  return <TransformControls {...props} />;
}

type WebGLStatus = "checking" | "available" | "unavailable";
type TransformMode = "translate" | "rotate" | "scale";

const transformModeOptions: Array<{ mode: TransformMode; label: string }> = [
  { mode: "translate", label: "移动 (1)" },
  { mode: "rotate", label: "旋转 (2)" },
  { mode: "scale", label: "缩放 (3)" },
];

const transformModeShortcuts: Record<string, TransformMode> = {
  Digit1: "translate",
  Digit2: "rotate",
  Digit3: "scale",
  Numpad1: "translate",
  Numpad2: "rotate",
  Numpad3: "scale",
};

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

function isEditableShortcutTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;

  if (!element) {
    return false;
  }

  return Boolean(element.closest("input, textarea, select, [contenteditable='true']"));
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

function roundTransformNumber(value: number) {
  return Number(value.toFixed(3));
}

function roundVector3(vector: Vector3): Vector3 {
  return {
    x: roundTransformNumber(vector.x),
    y: roundTransformNumber(vector.y),
    z: roundTransformNumber(vector.z),
  };
}

function transformFromGroup(group: Group, object: SceneObject): SceneObject3DTransform {
  const baseX = object.kind === "plane" ? -90 : 0;

  return {
    position: {
      x: roundTransformNumber(group.position.x),
      y: roundTransformNumber(group.position.y),
      z: roundTransformNumber(group.position.z),
    },
    rotation: {
      x: roundTransformNumber(MathUtils.radToDeg(group.rotation.x) - baseX),
      y: roundTransformNumber(MathUtils.radToDeg(group.rotation.y)),
      z: roundTransformNumber(MathUtils.radToDeg(group.rotation.z)),
    },
    scale: {
      x: roundTransformNumber(Math.max(0.05, group.scale.x)),
      y: roundTransformNumber(Math.max(0.05, group.scale.y)),
      z: roundTransformNumber(Math.max(0.05, group.scale.z)),
    },
  };
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

function SceneObjectMesh({
  groupRef,
  object,
  selected,
  onCloseContextMenu,
  onOpenContextMenu,
}: {
  groupRef?: Ref<Group>;
  object: SceneObject;
  selected: boolean;
  onCloseContextMenu?: () => void;
  onOpenContextMenu?: (clientX: number, clientY: number) => void;
}) {
  const selectObject = useEditorStore((state) => state.selectObject);
  const snapObjectToGround = useEditorStore((state) => state.snapObjectToGround);
  const transform = object.transform3D;

  if (!transform) {
    return null;
  }

  function handleSelect(event: ThreeEvent<MouseEvent>) {
    onCloseContextMenu?.();
    event.stopPropagation();
    selectObject(object.id);
  }

  function handlePointerDown(event: ThreeEvent<PointerEvent>) {
    if (event.button === 2) {
      event.stopPropagation();
      return;
    }

    handleSelect(event as unknown as ThreeEvent<MouseEvent>);
  }

  function handleContextMenu(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation();
    event.nativeEvent.preventDefault();
    selectObject(object.id);
    onOpenContextMenu?.(event.clientX, event.clientY);
  }

  function handleSnapToGround(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation();
    snapObjectToGround(object.id);
  }

  return (
    <group
      onClick={handleSelect}
      onContextMenu={handleContextMenu}
      onDoubleClick={handleSnapToGround}
      onPointerDown={handlePointerDown}
      position={[transform.position.x, transform.position.y, transform.position.z]}
      ref={groupRef}
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

function TransformableSceneObject({
  mode,
  object,
  onCloseContextMenu,
  onOpenContextMenu,
  onTransformEnd,
  selected,
}: {
  mode: TransformMode;
  object: SceneObject;
  onCloseContextMenu?: () => void;
  onOpenContextMenu?: (clientX: number, clientY: number) => void;
  onTransformEnd: (object: SceneObject, group: Group | null) => void;
  selected: boolean;
}) {
  const groupRef = useRef<Group | null>(null);
  const [controlObject, setControlObject] = useState<Group | null>(null);
  const setGroupRef = useCallback((group: Group | null) => {
    groupRef.current = group;
    setControlObject(group);
  }, []);

  if (!selected) {
    return (
      <SceneObjectMesh
        object={object}
        selected={false}
        onCloseContextMenu={onCloseContextMenu}
        onOpenContextMenu={onOpenContextMenu}
      />
    );
  }

  return (
    <>
      <SceneObjectMesh
        groupRef={setGroupRef}
        object={object}
        selected
        onCloseContextMenu={onCloseContextMenu}
        onOpenContextMenu={onOpenContextMenu}
      />
      <TransformControlsWithOrbitRestore
        mode={mode}
        object={controlObject ?? undefined}
        onMouseUp={() => onTransformEnd(object, groupRef.current)}
        size={0.82}
        space="world"
      />
    </>
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
  const containerRef = useRef<HTMLDivElement>(null);
  const selectObject = useEditorStore((state) => state.selectObject);
  const snapObjectToGround = useEditorStore((state) => state.snapObjectToGround);
  const deleteSelection = useEditorStore((state) => state.deleteSelection);
  const [objectContextMenu, setObjectContextMenu] = useState<{ x: number; y: number } | null>(null);

  function openObjectContextMenu(clientX: number, clientY: number) {
    const rect = containerRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    setObjectContextMenu({ x: clientX - rect.left, y: clientY - rect.top });
  }

  function closeObjectContextMenu() {
    setObjectContextMenu(null);
  }

  useEffect(() => {
    if (!objectContextMenu) {
      return undefined;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeObjectContextMenu();
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [objectContextMenu]);

  function handleBackdropMouseDown() {
    closeObjectContextMenu();
    selectScene();
  }

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-slate-950"
      onMouseDown={(event) => {
        if (objectContextMenu) {
          closeObjectContextMenu();
        }

        if (event.button !== 2) {
          selectScene();
        }
      }}
      ref={containerRef}
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
            onDoubleClick={(event) => {
              event.stopPropagation();
              snapObjectToGround(object.id);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              selectObject(object.id);
              openObjectContextMenu(event.clientX, event.clientY);
            }}
            onMouseDown={(event) => {
              event.stopPropagation();
              closeObjectContextMenu();
              selectObject(object.id);
            }}
            style={getCssPrimitiveStyle(object)}
            type="button"
          >
            <span className="max-w-[92px] truncate drop-shadow">{object.name}</span>
          </button>
        );
      })}
      {objectContextMenu ? (
        <>
          <button
            aria-label="关闭菜单"
            className="absolute inset-0 z-[90] cursor-default bg-transparent"
            onContextMenu={(event) => {
              event.preventDefault();
              closeObjectContextMenu();
            }}
            onMouseDown={(event) => {
              event.preventDefault();
              handleBackdropMouseDown();
            }}
            type="button"
          />
          <div
            className="absolute z-[100] min-w-[132px] overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg"
            style={{ left: objectContextMenu.x, top: objectContextMenu.y }}
          >
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50"
              onClick={() => {
                deleteSelection();
                closeObjectContextMenu();
              }}
              type="button"
            >
              <Trash2 className="size-4 shrink-0" />
              删除
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function CaptureBridge({
  onCaptureReady,
}: {
  onCaptureReady?: (capture: CanvasCapture | null) => void;
}) {
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    if (!onCaptureReady) {
      return;
    }

    onCaptureReady(() => {
      try {
        return gl.domElement.toDataURL("image/png");
      } catch (error) {
        console.warn("[SceneForge] [canvas] Failed to capture 3D viewport", { error });
        return null;
      }
    });

    return () => onCaptureReady(null);
  }, [gl, onCaptureReady]);

  return null;
}

function resetThreeCameraFromStore() {
  const store = useEditorStore.getState();

  store.updateScene({
    three: {
      ...store.project.scene.three,
      camera: {
        fov: defaultScene.three.camera.fov,
        position: { ...defaultScene.three.camera.position },
        target: { ...defaultScene.three.camera.target },
      },
    },
  });
}

function focusThreeSelectionFromStore() {
  const store = useEditorStore.getState();
  const { selection } = store;
  const objects = store.project.scene.objects.filter(isThreeDViewportPrimitive);
  const three = store.project.scene.three;

  let focusPoint: Vector3 | null = null;

  if (selection.kind === "object") {
    focusPoint =
      objects.find((object) => object.id === selection.id)?.transform3D?.position ?? null;
  } else if (selection.kind === "multiple") {
    const selectedObjects = objects.filter((object) => selection.objectIds.includes(object.id));

    if (selectedObjects.length > 0) {
      const total = selectedObjects.reduce(
        (point, object) => ({
          x: point.x + (object.transform3D?.position.x ?? 0),
          y: point.y + (object.transform3D?.position.y ?? 0),
          z: point.z + (object.transform3D?.position.z ?? 0),
        }),
        { x: 0, y: 0, z: 0 },
      );

      focusPoint = {
        x: total.x / selectedObjects.length,
        y: total.y / selectedObjects.length,
        z: total.z / selectedObjects.length,
      };
    }
  }

  if (!focusPoint) {
    return;
  }

  const currentOffset = {
    x: three.camera.position.x - three.camera.target.x,
    y: three.camera.position.y - three.camera.target.y,
    z: three.camera.position.z - three.camera.target.z,
  };

  store.updateScene({
    three: {
      ...three,
      camera: {
        ...three.camera,
        position: roundVector3({
          x: focusPoint.x + currentOffset.x,
          y: focusPoint.y + currentOffset.y,
          z: focusPoint.z + currentOffset.z,
        }),
        target: roundVector3(focusPoint),
      },
    },
  });
}

type ThreeViewportProps = {
  onCaptureReady?: (capture: CanvasCapture | null) => void;
};

function ThreeViewportWeb({
  onCaptureReady,
  onWebGLError,
}: ThreeViewportProps & { onWebGLError: () => void }) {
  const { project, selectScene, selection, setObject3DTransform, updateScene } = useEditorStore();
  const deleteSelection = useEditorStore((state) => state.deleteSelection);
  const { three } = project.scene;
  const objects = project.scene.objects.filter(isThreeDViewportPrimitive);
  const orbitControlsRef = useRef<OrbitControlsImpl | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [transformMode, setTransformMode] = useState<TransformMode>("translate");
  const [objectContextMenu, setObjectContextMenu] = useState<{ x: number; y: number } | null>(null);

  const resetCamera = useCallback(() => {
    resetThreeCameraFromStore();
  }, []);

  const focusSelection = useCallback(() => {
    focusThreeSelectionFromStore();
  }, []);

  const closeObjectContextMenu = useCallback(() => {
    setObjectContextMenu(null);
  }, []);

  const openObjectContextMenu = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    setObjectContextMenu({ x: clientX - rect.left, y: clientY - rect.top });
  }, []);

  const handleCanvasPointerMissed = useCallback(() => {
    closeObjectContextMenu();
    selectScene();
  }, [closeObjectContextMenu, selectScene]);

  useEffect(() => {
    if (!objectContextMenu) {
      return undefined;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeObjectContextMenu();
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [objectContextMenu, closeObjectContextMenu]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (isEditableShortcutTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      const shortcutMode = transformModeShortcuts[event.code];

      if (shortcutMode) {
        event.preventDefault();
        setTransformMode(shortcutMode);
        return;
      }

      if (event.code === "Home") {
        event.preventDefault();
        resetCamera();
        return;
      }

      if (event.code === "KeyF") {
        event.preventDefault();
        focusSelection();
      }
    }

    window.addEventListener("keydown", handleShortcut);

    return () => window.removeEventListener("keydown", handleShortcut);
  }, [resetCamera, focusSelection]);

  function persistOrbitCamera() {
    const controls = orbitControlsRef.current;

    if (!controls) {
      return;
    }

    updateScene({
      three: {
        ...three,
        camera: {
          ...three.camera,
          position: roundVector3(controls.object.position),
          target: roundVector3(controls.target),
        },
      },
    });
  }

  function handleTransformEnd(object: SceneObject, group: Group | null) {
    if (!group) {
      return;
    }

    const raw = transformFromGroup(group, object);
    setObject3DTransform(object.id, raw);
  }

  return (
    <div className="relative h-full w-full bg-slate-950" ref={containerRef}>
      {objects.length === 0 ? (
        <div className="pointer-events-none absolute left-1/2 top-6 z-10 -translate-x-1/2 rounded-full border border-white/10 bg-slate-900/80 px-4 py-2 text-xs text-slate-200 shadow-lg">
          从左侧「3D 基础体」添加立方体、球体、圆柱或平面
        </div>
      ) : null}
      <div className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/85 p-1.5 shadow-xl backdrop-blur">
        {transformModeOptions.map((option) => (
          <Button
            className="h-7 rounded-lg px-2.5 text-xs"
            key={option.mode}
            onClick={() => setTransformMode(option.mode)}
            size="sm"
            type="button"
            variant={transformMode === option.mode ? "primary" : "ghost"}
          >
            {option.label}
          </Button>
        ))}
        <div className="mx-1 h-4 w-px bg-white/10" />
        <Button
          className="h-7 rounded-lg px-2.5 text-xs text-slate-200 hover:bg-white/10"
          onClick={resetCamera}
          size="sm"
          type="button"
          variant="ghost"
        >
          重置相机
        </Button>
      </div>
      <div className="pointer-events-none absolute bottom-4 left-4 z-10 rounded-lg border border-white/10 bg-slate-900/75 px-3 py-2 text-[11px] leading-relaxed text-slate-300 shadow-lg">
        1/2/3 切换 gizmo；方向键移动，PageUp/PageDown 升降；F 聚焦选中，Home 重置相机。
        <br />
        拖动空白处旋转视角并保存；当前工具：
        {transformModeOptions.find((option) => option.mode === transformMode)?.label}
      </div>
      <WebGLCanvasBoundary onWebGLError={onWebGLError}>
        <Canvas gl={{ preserveDrawingBuffer: true }} onPointerMissed={handleCanvasPointerMissed}>
          <CaptureBridge onCaptureReady={onCaptureReady} />
          <PerspectiveCamera
            fov={three.camera.fov}
            makeDefault
            onUpdate={(camera) =>
              camera.lookAt(three.camera.target.x, three.camera.target.y, three.camera.target.z)
            }
            position={[three.camera.position.x, three.camera.position.y, three.camera.position.z]}
          />
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
          <axesHelper args={[2]} position={[0, 0.02, 0]} />
          {objects.map((object) => (
            <TransformableSceneObject
              key={object.id}
              mode={transformMode}
              object={object}
              onCloseContextMenu={closeObjectContextMenu}
              onOpenContextMenu={openObjectContextMenu}
              onTransformEnd={handleTransformEnd}
              selected={objectSelected(selection, object.id)}
            />
          ))}
          <OrbitControls
            enableDamping
            makeDefault
            onEnd={persistOrbitCamera}
            ref={orbitControlsRef}
            target={[three.camera.target.x, three.camera.target.y, three.camera.target.z]}
          />
        </Canvas>
      </WebGLCanvasBoundary>
      {objectContextMenu ? (
        <>
          <button
            aria-label="关闭菜单"
            className="absolute inset-0 z-[90] cursor-default bg-transparent"
            onContextMenu={(event) => {
              event.preventDefault();
              closeObjectContextMenu();
            }}
            onMouseDown={(event) => {
              event.preventDefault();
              closeObjectContextMenu();
              selectScene();
            }}
            type="button"
          />
          <div
            className="absolute z-[100] min-w-[132px] overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg"
            style={{ left: objectContextMenu.x, top: objectContextMenu.y }}
          >
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50"
              onClick={() => {
                deleteSelection();
                closeObjectContextMenu();
              }}
              type="button"
            >
              <Trash2 className="size-4 shrink-0" />
              删除
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function ThreeViewport({ onCaptureReady }: ThreeViewportProps) {
  const { project, selectScene, selection } = useEditorStore();
  const objects = project.scene.objects.filter(isThreeDViewportPrimitive);
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

  useEffect(() => {
    if (webGLStatus !== "unavailable") {
      return undefined;
    }

    function handleShortcut(event: KeyboardEvent) {
      if (isEditableShortcutTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      if (event.code === "Home") {
        event.preventDefault();
        resetThreeCameraFromStore();
        return;
      }

      if (event.code === "KeyF") {
        event.preventDefault();
        focusThreeSelectionFromStore();
      }
    }

    window.addEventListener("keydown", handleShortcut);

    return () => window.removeEventListener("keydown", handleShortcut);
  }, [webGLStatus]);

  if (webGLStatus === "checking") {
    return <WebGLFallback status={webGLStatus} />;
  }

  if (webGLStatus === "unavailable") {
    return <Css3DViewport objects={objects} selectScene={selectScene} selection={selection} />;
  }

  return (
    <ThreeViewportWeb
      onCaptureReady={onCaptureReady}
      onWebGLError={() => setWebGLStatus("unavailable")}
    />
  );
}
