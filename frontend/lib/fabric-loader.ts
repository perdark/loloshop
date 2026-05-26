/** Singleton dynamic import for Fabric.js v6 */

let fabricPromise: Promise<typeof import("fabric")> | null = null;

export function getFabric(): Promise<typeof import("fabric")> {
  if (!fabricPromise) {
    fabricPromise = import("fabric");
  }
  return fabricPromise;
}
