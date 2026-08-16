import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendBoundedStartupLog, inspectBridgePort } from "../src/startup-runtime.js";

const roots:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();while(roots.length)await rm(roots.pop()!,{recursive:true,force:true})});

describe("Bridge startup ownership and logging",()=>{
  it("recognizes the intended existing Bridge without taking its port",async()=>{
    const fetchFn=vi.fn(async(input:string|URL|Request)=>String(input).endsWith("/api/health")?new Response(JSON.stringify({status:"ok"}),{status:200}):new Response(JSON.stringify({success:true,data:{name:"chatgpt-local-orchestrator-bridge"}}),{status:200}));
    await expect(inspectBridgePort(43120,fetchFn as typeof fetch)).resolves.toBe("INTENDED_BRIDGE");
  });
  it("classifies another HTTP process and never exposes a kill operation",async()=>{
    const fetchFn=vi.fn(async()=>new Response(JSON.stringify({status:"other"}),{status:200}));
    await expect(inspectBridgePort(43120,fetchFn as typeof fetch)).resolves.toBe("OTHER_PROCESS");
    expect(inspectBridgePort.toString()).not.toMatch(/kill|Stop-Process|taskkill/i);
  });
  it("treats an unbound port as available",async()=>{await expect(inspectBridgePort(43120,vi.fn(async()=>{throw new TypeError("fetch failed")}) as typeof fetch)).resolves.toBe("AVAILABLE")});
  it("writes bounded diagnostic logs without secret fields",async()=>{
    const root=await mkdtemp(join(tmpdir(),"bridge-startup-log-"));roots.push(root);const file=join(root,"logs","startup.log");
    await mkdir(join(root,"logs"));await writeFile(file,"x".repeat(100));await appendBoundedStartupLog(file,"STARTUP_ATTEMPTED",{runtimeRoot:root,token:"must-not-appear",authorization:"must-not-appear"},50);
    expect((await readFile(file,"utf8"))).toContain("STARTUP_ATTEMPTED");expect(await readFile(`${file}.1`,"utf8")).toHaveLength(100);expect(await readFile(file,"utf8")).not.toContain("must-not-appear");expect((await stat(file)).size).toBeLessThan(1024);
  });
  it("keeps the scheduled launcher on the compiled entry and emits bounded production stages",async()=>{
    const index=await readFile(new URL("../src/index.ts",import.meta.url),"utf8");
    const launcher=await readFile(new URL("../../../scripts/ops/windows/Start-Bridge.ps1",import.meta.url),"utf8");
    expect(launcher).toContain('apps\\bridge\\dist\\index.js');
    for(const stage of ["BRIDGE_STARTUP_BEGIN","ENV_LOADED","RUNTIME_ROOT_READY","APP_IMPORT_BEGIN","APP_IMPORT_COMPLETE","APP_CREATED","LISTEN_BEGIN","LISTEN_READY"])expect(index).toContain(`\"${stage}\"`);
    expect(index).toContain('await import("./app.js")');
  });
});
