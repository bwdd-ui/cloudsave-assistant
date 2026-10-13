const {randomUUID}=require('crypto'),{linkKey}=require('./guangya-provider');
class GuangyaOffline{
 constructor(d){this.d=d;this.running=null;}
 state(){const c=this.d.readConfig();return {loggedIn:Boolean(c.guangya?.token),folder:c.guangya?.folder||null,running:Boolean(this.running),records:(c.guangyaRecords||[]).slice(0,200)};}
 async setFolder(value){if(this.running)throw Error('请等待光鸭当前提交完成');const token=this.d.token(),account=await this.d.provider.account(token),folder=await this.d.provider.validate(value,token,account.uid);if(token!==this.d.token())throw Error('光鸭账号已更换');const c=this.d.readConfig();c.guangya={...c.guangya,folder};await this.d.writeConfig(c);return this.state();}
 submit(url,title){if(this.running)throw Error('光鸭正在提交，请稍候');this.running=this.perform(url,title).finally(()=>{this.running=null;});return this.running;}
 async perform(url,title){const key=linkKey(url),token=this.d.token(),account=await this.d.provider.account(token),c=this.d.readConfig(),records=c.guangyaRecords||[];
  const previous=records.find(r=>r.uid===account.uid&&r.key===key&&['accepted','intent','uncertain'].includes(r.status));if(previous)return '该资源已提交或结果待核对，已跳过重复提交';
  const folder=await this.d.provider.validate(c.guangya?.folder,token,account.uid),resolved=await this.d.provider.resolve(url,token);if(token!==this.d.token()||this.d.stopped())throw Error('光鸭账号已更换或程序正在退出');
  const tx={id:randomUUID(),uid:account.uid,key,url:String(url),title:String(title||resolved.btResInfo?.fileName||'磁力资源'),folder,status:'intent',at:Date.now(),message:'光鸭提交准备中'};
  const fresh=this.d.readConfig();fresh.guangyaRecords=[tx,...(fresh.guangyaRecords||[])];await this.d.writeConfig(fresh);
  try{if(token!==this.d.token()||this.d.stopped())throw Object.assign(Error('提交前停止，请核对后允许重试'),{uncertain:true});const result=await this.d.provider.create(url,folder,title,resolved,token);tx.status='accepted';tx.taskId=result.taskId;tx.message='光鸭已接受离线；保存到：'+folder.name;}
  catch(error){tx.status=error.uncertain?'uncertain':'failed';tx.message=error.message;}
  const final=this.d.readConfig();final.guangyaRecords=(final.guangyaRecords||[]).map(x=>x.id===tx.id?tx:x);await this.d.writeConfig(final);this.d.log(tx.message,tx.status==='accepted'?'success':'warning');if(tx.status!=='accepted')throw Error(tx.message);return tx.message;
 }
 async resolve(id,action){if(this.running)throw Error('请等待提交完成');const token=this.d.token(),account=await this.d.provider.account(token),c=this.d.readConfig(),row=(c.guangyaRecords||[]).find(x=>x.id===id&&x.uid===account.uid);if(!row||!['accepted','retry'].includes(action)||token!==this.d.token())throw Error('记录或当前账户无效');row.status=action==='accepted'?'accepted':'failed';row.message=action==='accepted'?'用户核对后确认已提交':'用户核对后允许重试';await this.d.writeConfig(c);return this.state();}
}
module.exports={GuangyaOffline};
