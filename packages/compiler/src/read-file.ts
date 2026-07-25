// The one filesystem boundary: reads a project file by its project-relative
// POSIX path, undefined when unreadable. Every pass that touches files
// (resolver, bundler, script type-check, emit) takes exactly this shape.
export type ReadFile = (path: string) => string | undefined;
