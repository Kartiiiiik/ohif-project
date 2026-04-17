// registerStreamingVolumeLoader.js
//
// Fallback module for registering the streaming volume loader from the
// standalone @cornerstonejs/streaming-image-volume-loader package.
//
// WHEN THIS IS NEEDED:
//   - Cornerstone v1.x or v2.x where the volume loader is a separate package.
//   - The package must be installed: npm install @cornerstonejs/streaming-image-volume-loader
//
// WHEN THIS IS NOT NEEDED:
//   - Cornerstone v4.x with @cornerstonejs/dicom-image-loader >= 4.x.
//   - In v4.x, calling dicomImageLoader.init() automatically registers the
//     streaming volume loader as the "unknown" volume loader.
//   - useCornerstoneInit.js handles this automatically and only falls back
//     to this approach if the auto-registration doesn't work.
//
// This module is imported dynamically by useCornerstoneInit if needed.
// It is NOT imported at the top level, so if the package is missing,
// only the dynamic import fails (gracefully caught) rather than breaking
// the entire application bundle.

/**
 * Attempts to import and register the streaming volume loader from the
 * standalone @cornerstonejs/streaming-image-volume-loader package.
 *
 * Registers the loader under two paths:
 *   1. Named scheme "cornerstoneStreamingImageVolume" — handles volumeIds
 *      like "cornerstoneStreamingImageVolume:1.2.3.4.5.6".
 *   2. Unknown loader — handles any volumeId that doesn't match a named
 *      scheme (e.g. bare UIDs like "1.2.3.4.5.6").
 *
 * @returns {Promise<boolean>} True if registration succeeded, false otherwise.
 */
export async function registerStreamingVolumeLoader() {
  // Import cornerstone core to access the volumeLoader registration API.
  const cornerstone = await import("@cornerstonejs/core");

  // Dynamically import the streaming volume loader package.
  // The @vite-ignore comment tells Vite's bundler not to analyze this import
  // statically — we want it to be a true runtime dynamic import so that
  // the application doesn't fail to build if the package isn't installed.
  const streamingModule = await import(
    /* @vite-ignore */
    "@cornerstonejs/streaming-image-volume-loader"
  );

  // The package exports have varied across versions. We check three
  // possible export shapes to find the actual loader function:
  //   1. Named export: streamingModule.cornerstoneStreamingImageVolumeLoader
  //   2. Default export with named property: streamingModule.default.cornerstoneStreamingImageVolumeLoader
  //   3. Default export is the loader itself: streamingModule.default
  const loaderFn =
    streamingModule.cornerstoneStreamingImageVolumeLoader ??
    streamingModule.default?.cornerstoneStreamingImageVolumeLoader ??
    streamingModule.default;

  // If we found a function AND the volumeLoader module exists on cornerstone,
  // register the loader under both the named scheme and as the unknown loader.
  if (typeof loaderFn === "function" && cornerstone.volumeLoader) {
    // Register under the legacy scheme name so volumeIds like
    // "cornerstoneStreamingImageVolume:UID" are handled.
    cornerstone.volumeLoader.registerVolumeLoader(
      "cornerstoneStreamingImageVolume",
      loaderFn
    );

    // Also register as the unknown/fallback loader so bare UIDs
    // (without a scheme prefix) are handled too.
    cornerstone.volumeLoader.registerUnknownVolumeLoader(loaderFn);

    console.log(
      "[registerStreamingVolumeLoader] Volume loader registered from streaming-image-volume-loader"
    );
    return true;
  }

  // Some older versions of the package self-register when you call init().
  // Check if that API exists and try it.
  if (typeof streamingModule.init === "function") {
    streamingModule.init();
    console.log(
      "[registerStreamingVolumeLoader] Volume loader self-registered via init()"
    );
    return true;
  }

  // None of the registration strategies worked. Log what we found so the
  // developer can debug which version of the package they have.
  console.warn(
    "[registerStreamingVolumeLoader] Could not register volume loader. " +
    "Exports found on the module:",
    Object.keys(streamingModule)
  );
  return false;
}