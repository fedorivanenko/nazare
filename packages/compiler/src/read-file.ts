// The one filesystem boundary: reads a project file by its project-relative
// POSIX path, undefined only when absent. Other read failures must throw. Every pass
// (resolver, bundler, script type-check, emit) takes exactly this shape.
export type ReadFile = (path: string) => string | undefined;
