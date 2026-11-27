module.exports=async function selectDocument(page,id,value){
  await page.locator("#"+id).selectOption(value);
  await page.waitForFunction(({id,value})=>{
    const current=id==="bookType"?String(d.standaloneBook):d.templateId||d.contractType;
    return current===value&&!Activity.foreground.has("contract-type");
  },{id,value});
};
