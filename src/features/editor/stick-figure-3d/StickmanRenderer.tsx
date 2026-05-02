"use client";

import { useMemo } from "react";
import { type ThreeEvent } from "@react-three/fiber";
import { Quaternion, Vector3 as ThreeVector3 } from "three";

import type { BodyPartId } from "@/shared/types";
import type { StickFigurePoseV1 } from "@/shared/types/stick-figure-pose";

const Y_UP = new ThreeVector3(0, 1, 0);

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
        e.stopPropagation();
        onSelectBodyPart?.(bodyPartId, e);
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
        e.stopPropagation();
        onSelect?.(e);
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
