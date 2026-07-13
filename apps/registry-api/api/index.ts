// Vercel serverless function entry. Everything real lives in src/ (typechecked
// and tested); this just re-exports the built handler so Vercel bundles it.
export { default } from "../dist/vercel.js";
