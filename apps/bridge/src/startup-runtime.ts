import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { BRIDGE_NAME } from "./version.js";

export type BridgePortStatus="AVAILABLE"|"INTENDED_BRIDGE"|"OTHER_PROCESS";

export async function inspectBridgePort(port:number,fetchFn:typeof fetch=fetch):Promise<BridgePortStatus>{
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),1_000);
  try{
    const base=`http://127.0.0.1:${port}`;
    const health=await fetchFn(`${base}/api/health`,{signal:controller.signal});
    if(!health.ok)return"OTHER_PROCESS";
    const healthBody=await health.json() as {status?:unknown};
    if(healthBody.status!=="ok")return"OTHER_PROCESS";
    const version=await fetchFn(`${base}/api/version`,{signal:controller.signal});
    if(!version.ok)return"OTHER_PROCESS";
    const body=await version.json() as {success?:unknown;data?:{name?:unknown}};
    return body.success===true&&body.data?.name===BRIDGE_NAME?"INTENDED_BRIDGE":"OTHER_PROCESS";
  }catch{return"AVAILABLE"}finally{clearTimeout(timeout)}
}

export async function appendBoundedStartupLog(filePath:string,event:string,detail:Record<string,unknown>={},maxBytes=256*1024):Promise<void>{
  await mkdir(dirname(filePath),{recursive:true});
  try{if((await stat(filePath)).size>=maxBytes)await rename(filePath,`${filePath}.1`)}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error}
  const safe=Object.fromEntries(Object.entries(detail).filter(([key])=>!/(token|secret|authorization|password)/i.test(key)).map(([key,value])=>[key,typeof value==="string"?value.slice(0,512):value]));
  await appendFile(filePath,`${JSON.stringify({timestamp:new Date().toISOString(),event,...safe})}\n`,"utf8");
}
