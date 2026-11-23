const assert=require("node:assert/strict"),path=require("node:path");
const {chromium}=require("playwright"),serve=require("./server.cjs");
(async()=>{
 const server=await serve(path.resolve(__dirname,"../dist")),browser=await chromium.launch({channel:"msedge"});
 try{
  const page=await browser.newPage();await page.goto(server.url);await page.waitForFunction(()=>startReady);
  await page.evaluate(()=>{
   if($("setupDialog").open)$("setupDialog").close();
   const source=document.createElement("canvas");source.width=1280;source.height=720;
   const g=source.getContext("2d");const paint=()=>{g.fillStyle="red";g.fillRect(0,0,1280,720);g.fillStyle="lime";g.fillRect(377,0,526,720);};
   paint();navigator.mediaDevices.getUserMedia=async()=>{const stream=source.captureStream(12);window.fixtureTrack=stream.getVideoTracks()[0];window.paintInterval=setInterval(paint,85);return stream;};
   ContractFiles.open({data:{}});
  });
  await page.locator("#signedCamera").click();await page.locator("#signedCapture").waitFor();await page.locator("#signedCapture").click();
  const info=await page.evaluate(async()=>{
   const video=$("signedVideo").getBoundingClientRect(),im=new Image();im.src=ContractFiles.shots[0];await im.decode();
   const c=document.createElement("canvas");c.width=im.width;c.height=im.height;const g=c.getContext("2d");g.drawImage(im,0,0);
   return {frame:video.width/video.height,width:im.width,height:im.height,left:g.getImageData(2,8,1,1).data[1],right:g.getImageData(im.width-3,8,1,1).data[1]};
  });assert.ok(Math.abs(info.frame-210/297)<0.003);assert.ok(Math.abs(info.width/info.height-210/297)<0.002);
  assert.ok(info.left>220 && info.right>220);
  await page.locator("#signedClose").click();await page.waitForFunction(()=>window.fixtureTrack.readyState==="ended");
  console.log("PASS portrait A4 preview matches the saved central crop; camera released");
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
