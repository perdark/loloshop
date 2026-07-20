/** Singleton dynamic import for Fabric.js v7, retaining the app's v6 coordinates. */

let fabricPromise: Promise<typeof import("fabric")> | null = null;

export function getFabric(): Promise<typeof import("fabric")> {
  if (!fabricPromise) {
    fabricPromise = import("fabric").then((fabric) => {
      // Fabric 7 changed the object origin default to center/center. Existing saved
      // designs omit v6's default left/top values, so retain those defaults to avoid
      // shifting customer artwork when it is reopened.
      fabric.BaseFabricObject.ownDefaults.originX = "left";
      fabric.BaseFabricObject.ownDefaults.originY = "top";
      return fabric;
    });
  }
  return fabricPromise;
}
