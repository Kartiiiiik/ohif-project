/**
 * registerVolumeLoader.js
 *
 * Isolated module for registering the streaming volume loader.
 * Separated from useCornerstoneInit so that if the package
 * is missing, only this file fails (gracefully) rather than
 * breaking the entire cornerstone init.
 *
 * REQUIRED: npm install @cornerstonejs/streaming-image-volume-loader
 *           (run inside the frontend/ directory)
 */

export async function registerStreamingVolumeLoader() {
  const cornerstone = await import("@cornerstonejs/core");

  // The streaming-image-volume-loader package exports a
  // register function or the loader function itself.
  const streamingModule = await import(
    /* @vite-ignore */
    "@cornerstonejs/streaming-image-volume-loader"
  );

  // Try different export shapes
  const loaderFn =
    streamingModule.cornerstoneStreamingImageVolumeLoader ??
    streamingModule.default?.cornerstoneStreamingImageVolumeLoader ??
    streamingModule.default;

  if (typeof loaderFn === "function" && cornerstone.volumeLoader) {
    cornerstone.volumeLoader.registerVolumeLoader(
      "cornerstoneStreamingImageVolume",
      loaderFn
    );
    cornerstone.volumeLoader.registerUnknownVolumeLoader(loaderFn);
    console.log("Volume loader registered from streaming-image-volume-loader");
    return true;
  }

  // Some versions just need to be imported — they self-register
  if (streamingModule.init && typeof streamingModule.init === "function") {
    streamingModule.init();
    console.log("Volume loader self-registered via init()");
    return true;
  }

  console.warn("Could not register volume loader. Exports found:",
    Object.keys(streamingModule));
  return false;
}