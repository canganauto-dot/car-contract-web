import {calculate,amount,addMonths} from "./money.js";
export function projection(d:Record<string,any>){
 const parties=[{role:"buyer",name:d.externalBuyer||d.buyer,phone:d.externalBuyerPhone||d.buyerPhone,identity:d.externalBuyerId||d.buyerId,address:d.externalBuyerAddress||d.buyerAddress},
 {role:"seller",name:d.externalSeller,phone:d.externalSellerPhone,identity:d.externalSellerId,address:d.externalSellerAddress},{role:"guarantor",name:d.guarantor,phone:d.guarantorPhone,identity:d.guarantorId,address:d.guarantorAddress}].filter(x=>x.name);
 const vehicle=(role:string,car:string,vin:string,color:string,plate:string)=>({role,car,vin,color,plate});
 const vehicles=[vehicle(d.contractType==="exchange"?"new":"subject",d.car,d.vin,d.color,d.plate)];
 if(d.contractType==="exchange")vehicles.push(vehicle("old",d.oldCar,d.oldVin,d.oldColor,d.oldPlate));
 if(d.standaloneBook)return {parties,vehicles};
 const f=calculate(d);if(f.errors.length)throw Error(f.errors.join(" · "));
 const inst=d.contractType==="installment" || d.contractType==="exchange" && d.exchangeManual!=="1";
 const rows:Record<string,unknown>[]=[];
 const push=(kind:string,label:string,value:number,date:string)=>{if(value>0)rows.push({kind,label,amount:value,date:date||null})};
 const depositDate=inst?d.depositDate:d.contractDate;
 push("initial","الواصل",f.deposit,depositDate);
 if(inst){
  for(const x of d.extras||[])push("additional",x.label||"دفعة",amount(x.amount),x.date);
  for(let i=0;i<f.count;i++)push(i===f.count-1?"final":"installment","قسط "+(i+1),i===f.count-1?f.last:i<f.earlyCount?f.earlyPayment:f.payment,addMonths(d.firstDate,i*f.interval));
 }else {
  for(const x of f.cashRows||[])push("balance","دفعة",x.value,x.date);
  if(d.cashDueDate)push("balance","الرصيد الأخير",f.remaining,d.cashDueDate);
 }
 return {parties,vehicles,finance:{mode:inst?"installment":d.contractType==="exchange"?"exchange_manual":d.contractType,
  total:f.total,deposit:f.deposit,depositDate,count:f.count,payment:f.payment,interval:f.interval,earlyCount:f.earlyCount,earlyPayment:f.earlyPayment,
  split:!!f.cashRows?.length,rows}};
}
