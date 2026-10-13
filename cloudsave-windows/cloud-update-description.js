'use strict';
function cloudUpdateDescription(value){return String(value||'').trim().match(/(?:刚刚|今天|昨天|前天|(?:\d+|[一二三四五六七八九十百两半]+)\s*(?:秒钟?|分钟?|小时|天|周|星期|个?月|年)(?:前|以前))\s*$/)?.[0]?.trim()||'';}
function withoutUpdateDescription(title,date){const value=String(title||'').trim();return date&&value.endsWith(date)?value.slice(0,-date.length).trim():value;}
module.exports={cloudUpdateDescription,withoutUpdateDescription};
