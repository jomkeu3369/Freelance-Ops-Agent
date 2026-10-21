export function quotationPreview(input, policy) {
  const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
  const items = input.items.map(item => {
    const subtotal = round(item.quantity * item.unitRate);
    const discountAmount = round(subtotal * item.discountRate);
    return {subtotal,discountAmount,total:round(subtotal-discountAmount)};
  });
  const subtotal = round(items.reduce((sum,item)=>sum+item.subtotal,0));
  const discountTotal = round(items.reduce((sum,item)=>sum+item.discountAmount,0));
  const riskBufferRate = input.applyDefaultRiskBuffer ? policy.defaultRiskBufferRate : 0;
  const riskBufferAmount = round((subtotal-discountTotal)*riskBufferRate);
  const taxRate = input.taxRate ?? policy.defaultTaxRate;
  const taxAmount = round((subtotal-discountTotal+riskBufferAmount)*taxRate);
  return {subtotal,discountTotal,riskBufferRate,riskBufferAmount,taxRate,taxAmount,
    total:round(subtotal-discountTotal+riskBufferAmount+taxAmount),items};
}
