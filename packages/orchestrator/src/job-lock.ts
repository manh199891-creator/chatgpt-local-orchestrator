import {open,unlink,type FileHandle} from "node:fs/promises";
import {JobStoreError,JobStoreErrorCode} from "./errors.js";
export class JobLock { private constructor(private path:string,private handle:FileHandle){} static async acquire(path:string){try{return new JobLock(path,await open(path,"wx"));}catch(e){if((e as NodeJS.ErrnoException).code==="EEXIST")throw new JobStoreError(JobStoreErrorCode.JOB_LOCKED,"Job is locked");throw e;}} async release(){await this.handle.close();try{await unlink(this.path);}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}} }
