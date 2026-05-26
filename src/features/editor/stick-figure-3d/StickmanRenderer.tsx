"use client";

import { useMemo } from "react";
import { type ThreeEvent } from "@react-three/fiber";
import { Quaternion, Vector3 as ThreeVector3 } from "three";

import type { BodyPartId, Vector3 } from "@/shared/types";
import type { StickFigurePoseV1 } from "@/shared/types/stick-figure-pose";
import {
  resolveStickFigureHeadBasis,
  resolveStickFigureHeadPoint,
  type StickFigureHeadBasis,
  type StickFigureHeadOffset,
} from "@/shared/utils/stick-figure-head-basis";

const Y_UP = new ThreeVector3(0, 1, 0);
const HEAD_SPHERE_RADIUS = 0.11;
const FACE_CROSSHAIR_SAMPLES = 18;
const FACE_CROSSHAIR_SURFACE_LIFT = 0.004;

type Point3Tuple = [number, number, number];

type SelectionClickEvent = ThreeEvent<MouseEvent>;

function boneQuat(from: ThreeVector3, to: ThreeVector3): Quaternion {
  const dir = new ThreeVector3().subVectors(to, from);
  const len = dir.length();
  if (len < 1e-8) {
    return new Quaternion();
  }
  dir.multiplyScalar(1 / len);
  return new Quaternion().setFromUnitVectors(Y_UP, dir);
}

function StickCapsuleLimb({
  from,
  to,
  radius,
  color,
  selected,
  bodyPartId,
  onSelectBodyPart,
}: {
  from: [number, number, number];
  to: [number, number, number];
  radius: number;
  color: string;
  selected: boolean;
  bodyPartId: BodyPartId;
  onSelectBodyPart?: (id: BodyPartId, event: SelectionClickEvent) => void;
}) {
  const [fromX, fromY, fromZ] = from;
  const [toX, toY, toZ] = to;
  const { position, quat, cylLen } = useMemo(() => {
    const a = new ThreeVector3(fromX, fromY, fromZ);
    const b = new ThreeVector3(toX, toY, toZ);
    const mid = new ThreeVector3().addVectors(a, b).multiplyScalar(0.5);
    const dist = a.distanceTo(b);
    const cylLen = Math.max(0.02, dist - 2 * radius);
    const quat = boneQuat(a, b);
    return { position: mid, quat, cylLen };
  }, [fromX, fromY, fromZ, radius, toX, toY, toZ]);

  return (
    <mesh
      castShadow
      onClick={(e) => {
        if (!onSelectBodyPart) {
          return;
        }

        e.stopPropagation();
        onSelectBodyPart(bodyPartId, e);
      }}
      position={position}
      quaternion={quat}
      receiveShadow
    >
      <capsuleGeometry args={[radius, cylLen, 6, 10]} />
      <meshStandardMaterial
        color={selected ? "#38bdf8" : color}
        emissive={selected ? "#0c4a6e" : "#000000"}
        emissiveIntensity={selected ? 0.25 : 0}
        metalness={0.12}
        roughness={0.55}
      />
    </mesh>
  );
}

function StickJointSphere({
  position,
  radius,
  color,
  selected,
  onSelect,
}: {
  position: [number, number, number];
  radius: number;
  color: string;
  selected: boolean;
  onSelect?: (event: SelectionClickEvent) => void;
}) {
  return (
    <mesh
      castShadow
      onClick={(e) => {
        if (!onSelect) {
          return;
        }

        e.stopPropagation();
        onSelect(e);
      }}
      position={position}
      receiveShadow
    >
      <sphereGeometry args={[radius, 18, 18]} />
      <meshStandardMaterial
        color={selected ? "#7dd3fc" : color}
        emissive={selected ? "#082f49" : "#000000"}
        emissiveIntensity={selected ? 0.35 : 0}
        metalness={0.15}
        roughness={0.45}
      />
    </mesh>
  );
}

function StickFaceCrosshairSegment({
  color,
  from,
  opacity,
  radius,
  renderOrder,
  to,
}: {
  color: string;
  from: Point3Tuple;
  opacity: number;
  radius: number;
  renderOrder: number;
  to: Point3Tuple;
}) {
  const [fromX, fromY, fromZ] = from;
  const [toX, toY, toZ] = to;
  const { position, quat, length } = useMemo(() => {
    const a = new ThreeVector3(fromX, fromY, fromZ);
    const b = new ThreeVector3(toX, toY, toZ);
    const position = new ThreeVector3().addVectors(a, b).multiplyScalar(0.5);
    const length = a.distanceTo(b);
    const quat = boneQuat(a, b);

    return { position, quat, length };
  }, [fromX, fromY, fromZ, toX, toY, toZ]);

  if (length < 1e-5) {
    return null;
  }

  return (
    <mesh position={position} quaternion={quat} raycast={() => undefined} renderOrder={renderOrder}>
      <cylinderGeometry args={[radius, radius, length, 8]} />
      <meshBasicMaterial color={color} depthWrite={false} opacity={opacity} toneMapped={false} transparent />
    </mesh>
  );
}

function StickFaceCrosshairPath({
  color,
  opacity,
  points,
  radius,
  renderOrder,
}: {
  color: string;
  opacity: number;
  points: Point3Tuple[];
  radius: number;
  renderOrder: number;
}) {
  return (
    <>
      {points.slice(1).map((point, index) => (
        <StickFaceCrosshairSegment
          color={color}
          from={points[index]}
          key={`${index}-${point[0]}-${point[1]}-${point[2]}`}
          opacity={opacity}
          radius={radius}
          renderOrder={renderOrder}
          to={point}
        />
      ))}
    </>
  );
}

function resolveFaceSurfacePoint(
  basis: StickFigureHeadBasis,
  offset: Omit<StickFigureHeadOffset, "z">,
  rotation: Vector3 | undefined,
  lift: number,
): Point3Tuple {
  const worldX = offset.x * basis.scale;
  const worldY = offset.y * basis.scale;
  const surfaceZ = Math.sqrt(Math.max(0, HEAD_SPHERE_RADIUS ** 2 - worldX ** 2 - worldY ** 2)) + lift;
  const point = resolveStickFigureHeadPoint(
    basis,
    {
      ...offset,
      z: surfaceZ / Math.max(0.0001, basis.scale),
    },
    rotation,
  );

  return [point.x, point.y, point.z];
}

function sampleFaceSurfaceLine(
  basis: StickFigureHeadBasis,
  from: Omit<StickFigureHeadOffset, "z">,
  to: Omit<StickFigureHeadOffset, "z">,
  rotation: Vector3 | undefined,
  lift: number,
): Point3Tuple[] {
  return Array.from({ length: FACE_CROSSHAIR_SAMPLES }, (_, index) => {
    const t = index / (FACE_CROSSHAIR_SAMPLES - 1);

    return resolveFaceSurfacePoint(
      basis,
      {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
      },
      rotation,
      lift,
    );
  });
}

function StickFaceCrosshair({
  headRotation3D,
  pose,
}: {
  headRotation3D?: Vector3;
  pose: StickFigurePoseV1;
}) {
  const segments = useMemo(() => {
    const basis = resolveStickFigureHeadBasis(pose);

    return {
      horizontal: sampleFaceSurfaceLine(
        basis,
        { x: -0.5, y: 0.1 },
        { x: 0.5, y: 0.1 },
        headRotation3D,
        FACE_CROSSHAIR_SURFACE_LIFT,
      ),
      vertical: sampleFaceSurfaceLine(
        basis,
        { x: 0, y: 0.78 },
        { x: 0, y: -0.82 },
        headRotation3D,
        FACE_CROSSHAIR_SURFACE_LIFT,
      ),
    };
  }, [headRotation3D, pose]);

  return (
    <group raycast={() => undefined}>
      <StickFaceCrosshairPath
        color="#020617"
        opacity={0.88}
        points={segments.vertical}
        radius={0.004}
        renderOrder={4}
      />
      <StickFaceCrosshairPath
        color="#020617"
        opacity={0.88}
        points={segments.horizontal}
        radius={0.004}
        renderOrder={4}
      />
    </group>
  );
}

export type StickmanRendererProps = {
  pose: StickFigurePoseV1;
  selectedBodyPartId?: BodyPartId;
  focusWholeCharacter: boolean;
  onSelectBodyPart?: (id: BodyPartId, event: SelectionClickEvent) => void;
  /** Joint spheres for torso / shoulders / hips (not elbows/knees). */
  jointColor: string;
  limbColor: string;
  torsoColor: string;
  headColor: string;
  headRotation3D?: Vector3;
};

export function StickmanRenderer({
  pose,
  selectedBodyPartId,
  focusWholeCharacter,
  onSelectBodyPart,
  jointColor,
  limbColor,
  torsoColor,
  headColor,
  headRotation3D,
}: StickmanRendererProps) {
  const j = pose.joints;
  const partSel = (id: BodyPartId) => selectedBodyPartId === id || focusWholeCharacter;

  const p = (k: keyof typeof j): [number, number, number] => [j[k].x, j[k].y, j[k].z];

  return (
    <group>
      <StickCapsuleLimb
        bodyPartId="torso"
        color={torsoColor}
        from={p("pelvis")}
        onSelectBodyPart={onSelectBodyPart}
        radius={0.11}
        selected={partSel("torso")}
        to={p("chest")}
      />
      <StickCapsuleLimb
        bodyPartId="leftUpperArm"
        color={limbColor}
        from={p("leftShoulder")}
        onSelectBodyPart={onSelectBodyPart}
        radius={0.048}
        selected={partSel("leftUpperArm")}
        to={p("leftElbow")}
      />
      <StickCapsuleLimb
        bodyPartId="leftForearm"
        color={limbColor}
        from={p("leftElbow")}
        onSelectBodyPart={onSelectBodyPart}
        radius={0.042}
        selected={partSel("leftForearm")}
        to={p("leftHand")}
      />
      <StickCapsuleLimb
        bodyPartId="rightUpperArm"
        color={limbColor}
        from={p("rightShoulder")}
        onSelectBodyPart={onSelectBodyPart}
        radius={0.048}
        selected={partSel("rightUpperArm")}
        to={p("rightElbow")}
      />
      <StickCapsuleLimb
        bodyPartId="rightForearm"
        color={limbColor}
        from={p("rightElbow")}
        onSelectBodyPart={onSelectBodyPart}
        radius={0.042}
        selected={partSel("rightForearm")}
        to={p("rightHand")}
      />
      <StickCapsuleLimb
        bodyPartId="leftThigh"
        color={limbColor}
        from={p("leftHip")}
        onSelectBodyPart={onSelectBodyPart}
        radius={0.055}
        selected={partSel("leftThigh")}
        to={p("leftKnee")}
      />
      <StickCapsuleLimb
        bodyPartId="leftShin"
        color={limbColor}
        from={p("leftKnee")}
        onSelectBodyPart={onSelectBodyPart}
        radius={0.048}
        selected={partSel("leftShin")}
        to={p("leftFoot")}
      />
      <StickCapsuleLimb
        bodyPartId="rightThigh"
        color={limbColor}
        from={p("rightHip")}
        onSelectBodyPart={onSelectBodyPart}
        radius={0.055}
        selected={partSel("rightThigh")}
        to={p("rightKnee")}
      />
      <StickCapsuleLimb
        bodyPartId="rightShin"
        color={limbColor}
        from={p("rightKnee")}
        onSelectBodyPart={onSelectBodyPart}
        radius={0.048}
        selected={partSel("rightShin")}
        to={p("rightFoot")}
      />

      <StickJointSphere
        color={jointColor}
        onSelect={(event) => onSelectBodyPart?.("torso", event)}
        position={p("pelvis")}
        radius={0.095}
        selected={partSel("torso")}
      />
      <StickJointSphere
        color={jointColor}
        onSelect={(event) => onSelectBodyPart?.("torso", event)}
        position={p("chest")}
        radius={0.085}
        selected={partSel("torso")}
      />
      <StickJointSphere
        color={jointColor}
        position={p("leftShoulder")}
        radius={0.07}
        selected={partSel("leftUpperArm")}
      />
      <StickJointSphere
        color={jointColor}
        position={p("rightShoulder")}
        radius={0.07}
        selected={partSel("rightUpperArm")}
      />
      <StickJointSphere
        color={jointColor}
        position={p("leftHip")}
        radius={0.07}
        selected={partSel("leftThigh")}
      />
      <StickJointSphere
        color={jointColor}
        position={p("rightHip")}
        radius={0.07}
        selected={partSel("rightThigh")}
      />

      <mesh
        castShadow
        onClick={(e) => {
          e.stopPropagation();
          onSelectBodyPart?.("head", e);
        }}
        position={p("head")}
        receiveShadow
      >
        <sphereGeometry args={[0.11, 20, 20]} />
        <meshStandardMaterial
          color={partSel("head") || focusWholeCharacter ? "#bae6fd" : headColor}
          emissive="#0c4a6e"
          emissiveIntensity={partSel("head") || focusWholeCharacter ? 0.2 : 0.05}
          metalness={0.1}
          roughness={0.42}
        />
      </mesh>
      <StickFaceCrosshair headRotation3D={headRotation3D} pose={pose} />

      <mesh
        castShadow
        onClick={(e) => {
          e.stopPropagation();
          onSelectBodyPart?.("leftHand", e);
        }}
        position={p("leftHand")}
        receiveShadow
      >
        <sphereGeometry args={[0.055, 14, 14]} />
        <meshStandardMaterial
          color={partSel("leftHand") ? "#7dd3fc" : "#fecdd3"}
          emissive="#450a0a"
          emissiveIntensity={partSel("leftHand") ? 0.25 : 0}
          metalness={0.08}
          roughness={0.5}
        />
      </mesh>
      <mesh
        castShadow
        onClick={(e) => {
          e.stopPropagation();
          onSelectBodyPart?.("rightHand", e);
        }}
        position={p("rightHand")}
        receiveShadow
      >
        <sphereGeometry args={[0.055, 14, 14]} />
        <meshStandardMaterial
          color={partSel("rightHand") ? "#7dd3fc" : "#fecdd3"}
          emissive="#450a0a"
          emissiveIntensity={partSel("rightHand") ? 0.25 : 0}
          metalness={0.08}
          roughness={0.5}
        />
      </mesh>

      <mesh
        castShadow
        onClick={(e) => {
          e.stopPropagation();
          onSelectBodyPart?.("leftFoot", e);
        }}
        position={[j.leftFoot.x, j.leftFoot.y - 0.03, j.leftFoot.z + 0.04]}
        receiveShadow
      >
        <boxGeometry args={[0.14, 0.06, 0.22]} />
        <meshStandardMaterial
          color={partSel("leftFoot") ? "#38bdf8" : "#94a3b8"}
          metalness={0.2}
          roughness={0.65}
        />
      </mesh>
      <mesh
        castShadow
        onClick={(e) => {
          e.stopPropagation();
          onSelectBodyPart?.("rightFoot", e);
        }}
        position={[j.rightFoot.x, j.rightFoot.y - 0.03, j.rightFoot.z + 0.04]}
        receiveShadow
      >
        <boxGeometry args={[0.14, 0.06, 0.22]} />
        <meshStandardMaterial
          color={partSel("rightFoot") ? "#38bdf8" : "#94a3b8"}
          metalness={0.2}
          roughness={0.65}
        />
      </mesh>
    </group>
  );
}
