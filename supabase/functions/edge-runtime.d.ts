// Local compile-time adapter for environment globals and remote SDK imports.
// Does not claim to replace an actual Deno runtime/deployment check.
declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Response | Promise<Response>): void }
declare module 'https://esm.sh/@supabase/supabase-js@2' { export function createClient(...args: any[]): any }
