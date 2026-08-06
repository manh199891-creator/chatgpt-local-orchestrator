const GLOB = /[?*\[\]{}]/;
export function normalizePathScope(scope: string): string { const v = scope.trim(); return v.endsWith('/**') ? `${v.slice(0, -3)}/**` : v; }
export function isValidPathScope(scope: string): boolean { if (typeof scope !== 'string') return false; const v=normalizePathScope(scope); if(!v||v.includes('\\')||v.startsWith('/')||/^[A-Za-z]:/.test(v)||v==='**') return false; const subtree=v.endsWith('/**'), body=subtree?v.slice(0,-3):v; if(!body||body.endsWith('/')||GLOB.test(body)||body.split('/').some(s=>!s||s==='.'||s==='..')) return false; return true; }
const root=(s:string)=>normalizePathScope(s).replace(/\/\*\*$/,''); const isTree=(s:string)=>normalizePathScope(s).endsWith('/**');
export function pathScopesOverlap(left:string,right:string):boolean { if(!isValidPathScope(left)||!isValidPathScope(right)) return false; const a=root(left),b=root(right); return a===b||(isTree(left)&&b.startsWith(`${a}/`))||(isTree(right)&&a.startsWith(`${b}/`)); }
