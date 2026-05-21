// Side-effect-only shim that pulls in xyflow's baseline canvas
// styles. Lives in its own file so the node:test runner — which
// can't load `.css` modules — can replace it with a no-op via
// `mock.module(...)` (see sop-full-page-editor-canvas.test.tsx).
import "@xyflow/react/dist/style.css";
