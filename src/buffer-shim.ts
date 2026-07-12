// Buffer polyfill for @ton/core (BOC base64/hex use a global `Buffer`, which
// browsers lack). This MUST be imported before any TON module. Because ES module
// imports are hoisted and evaluated in order, keeping this as the very first
// import in main.ts guarantees the global exists before @ton/core evaluates.
import { Buffer } from "buffer";

const g = globalThis as unknown as { Buffer?: typeof Buffer };
if (!g.Buffer) g.Buffer = Buffer;
