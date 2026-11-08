// Non-JS modules wrangler bundles into the Worker (see `rules` in wrangler.jsonc).
declare module '*.wasm' {
  const module: WebAssembly.Module;
  export default module;
}
declare module '*.ttf' {
  const bytes: ArrayBuffer;
  export default bytes;
}
