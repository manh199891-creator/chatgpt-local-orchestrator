import {execFile} from "node:child_process";
import {promisify} from "node:util";
const exec=promisify(execFile);
export class GitService { constructor(private readonly executable="git"){} private async run(cwd:string,args:string[]){return (await exec(this.executable,args,{cwd,shell:false,maxBuffer:1024*1024})).stdout.trim()}
 async worktreeAdd(repository:string,path:string,branch:string){await this.run(repository,["worktree","add",path,branch])}
 async worktreeRemove(repository:string,path:string){await this.run(repository,["worktree","remove","--force",path])}
 async checkout(repository:string,branch:string){await this.run(repository,["checkout",branch])}
 async branch(repository:string,name:string,startPoint?:string){await this.run(repository,startPoint?["branch",name,startPoint]:["branch",name])}
 async branchDelete(repository:string,name:string){await this.run(repository,["branch","-D",name])}
 async branchExists(repository:string,name:string){try{await this.run(repository,["show-ref","--verify",`refs/heads/${name}`]);return true}catch{return false}}
}
