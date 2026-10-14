'use strict';
function cloudDriveType(link,fallback='其他网盘'){
 let url;try{url=new URL(String(link));}catch{return fallback;}if(!['http:','https:'].includes(url.protocol))return fallback;
 const host=url.hostname.toLowerCase(),within=domain=>host===domain||host.endsWith('.'+domain);
 for(const [domains,name] of [
  [['pan.baidu.com','yun.baidu.com'],'百度网盘'],
  [['pan.quark.cn'],'夸克网盘'],
  [['drive.uc.cn'],'UC网盘'],
  [['115.com','115cdn.com','anxia.com'],'115网盘'],
  [['guangyapan.com'],'光鸭云盘'],
  [['123pan.com','123pan.cn','123865.com','123684.com','123912.com','123952.com','123957.com'],'123云盘'],
  [['aliyundrive.com','alipan.com'],'阿里云盘'],
  [['pan.xunlei.com'],'迅雷云盘'],
  [['cloud.189.cn'],'天翼云盘'],
  [['yun.139.com','caiyun.139.com'],'移动云盘'],
  [['weiyun.com'],'腾讯微云']
 ])if(domains.some(within))return name;
 if(/^(?:[a-z0-9-]+\.)*lanzou[a-z]?\.com$/.test(host))return '蓝奏云';return fallback;
}
module.exports={cloudDriveType};
