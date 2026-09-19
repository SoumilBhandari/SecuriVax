import { MeshPhysicalMaterial, MeshStandardMaterial } from "three";

/**
 * The materials from the render brief (docs/hero-3d-brief.md), shared by
 * every object: matte polymer, graphite, one emissive teal, frosted ice,
 * glass, and the small parts. Created once; disposed never (they're tiny).
 */
export const TEAL = "#35d0c3";

export const polymer = new MeshPhysicalMaterial({ color: "#e4e4e8", roughness: 0.36, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.3 });
export const polymerWhite = new MeshPhysicalMaterial({ color: "#eeeef1", roughness: 0.34, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.28 });
export const graphite = new MeshStandardMaterial({ color: "#2c2c2e", roughness: 0.8, metalness: 0.05 });
export const liner = new MeshStandardMaterial({ color: "#3a3a3c", roughness: 0.85 });
export const teal = new MeshStandardMaterial({ color: TEAL, emissive: TEAL, emissiveIntensity: 0.55, roughness: 0.4 });
export const ice = new MeshPhysicalMaterial({ color: "#ffffff", roughness: 0.38, transmission: 0.3, thickness: 0.35, ior: 1.31, transparent: true });
export const glass = new MeshPhysicalMaterial({ color: "#ffffff", roughness: 0.04, transmission: 0.96, thickness: 0.25, ior: 1.5, clearcoat: 1, transparent: true });
export const liquid = new MeshPhysicalMaterial({ color: "#f3c9d6", roughness: 0.25, transmission: 0.55, thickness: 0.6, ior: 1.33, transparent: true });
export const aluminium = new MeshStandardMaterial({ color: "#c4c4c8", metalness: 0.92, roughness: 0.32 });
export const pcb = new MeshStandardMaterial({ color: "#10231c", roughness: 0.55, metalness: 0.1 });
export const card = new MeshStandardMaterial({ color: "#fafafa", roughness: 0.85 });
export const paper = new MeshStandardMaterial({ color: "#ffffff", roughness: 0.9 });
export const cell = new MeshStandardMaterial({ color: "#b9b9bd", metalness: 0.6, roughness: 0.45 });
