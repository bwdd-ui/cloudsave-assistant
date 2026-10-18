const assert=require('assert/strict'),{cloudDriveType}=require('../cloud-drive-types');
for(const [url,label] of [['https://pan.baidu.com/s/test','百度网盘'],['https://pan.quark.cn/s/test','夸克网盘'],['https://115.com/s/test','115网盘'],['https://12345.share.123pan.cn/123pan/test','123云盘'],['https://www.alipan.com/s/test','阿里云盘'],['https://www.aliyundrive.com/s/test','阿里云盘'],['https://pan.xunlei.com/s/test','迅雷云盘'],['https://cloud.189.cn/t/test','天翼云盘'],['https://yun.139.com/shareweb/test','移动云盘'],['https://drive.uc.cn/s/test','UC网盘'],['https://www.lanzoux.com/test','蓝奏云']])assert.equal(cloudDriveType(url),label);
for(const url of ['invalid','https://pan.baidu.com.evil.com/s/test','https://evil.com/?next=https://115.com','ftp://115.com/s/test'])assert.equal(cloudDriveType(url),'其他网盘');
for(const label of ['黄鸭云盘','光鸭云盘','黄鸭云盘分享'])assert.equal(cloudDriveType('https://share.example/s/abc','其他云盘',label),'光鸭云盘');
assert.equal(cloudDriveType('https://pan.baidu.com/s/test','其他云盘','黄鸭云盘'),'百度网盘','a recognized URL host takes precedence over a conflicting description');
assert.equal(cloudDriveType('https://share.example/s/abc','其他云盘','普通影视资源'),'其他云盘');
const main=require('node:fs').readFileSync(require.resolve('../main.js'),'utf8');assert(main.includes('cloudDriveType(url,group,rawTitle)'),'七味详情分类必须使用来源标题作为已知品牌提示');
console.log('PASS cloud labels, 123 share subdomains, Aliyun aliases, explicit 光/黄鸭 title hints, known-host priority and lookalike domain handling');
