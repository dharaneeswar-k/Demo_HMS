// Pharmacy bill pricing — pure functions shared by the app and the seed-data generator.
// Indian retail pharmacy convention: the selling price is the batch MRP, which is GST-INCLUSIVE.
// GST is therefore back-calculated from the line amount (never added on top) so tax is not applied twice.
//
//   gross          = qty × unit price (MRP)
//   item discount  = gross × item discount %
//   bill discount  = (Σ after-item-discount) × bill discount %, shared across lines pro rata
//   line net       = gross − item discount − bill-discount share          (GST inclusive)
//   taxable value  = line net × 100 / (100 + GST %)
//   GST amount     = line net − taxable value
//   grand total    = round(Σ line net)  with the round-off shown separately

export const r2 = (v) => Math.round((Number(v) || 0) * 100 + Number.EPSILON) / 100;

export function priceBill(lines, billDiscountPct = 0, { roundToRupee = true } = {}) {
  const prepared = lines.map((l) => {
    const qty = Number(l.qty) || 0;
    const price = Number(l.unitPrice) || 0;
    const gross = r2(qty * price);
    const itemDiscount = r2(gross * (Number(l.discountPct) || 0) / 100);
    return { ...l, qty, unitPrice: price, gross, itemDiscount, afterItem: r2(gross - itemDiscount) };
  });
  const base = r2(prepared.reduce((s, l) => s + l.afterItem, 0));
  const billDiscount = r2(base * (Number(billDiscountPct) || 0) / 100);
  let allocated = 0;
  prepared.forEach((l, i) => {
    const share = i === prepared.length - 1 ? r2(billDiscount - allocated) : r2(base ? billDiscount * l.afterItem / base : 0);
    allocated = r2(allocated + share);
    l.billDiscountShare = share;
    l.netAmount = r2(l.afterItem - share);
    const g = Number(l.gstPct) || 0;
    l.taxableValue = r2(l.netAmount * 100 / (100 + g));
    l.gstAmount = r2(l.netAmount - l.taxableValue);
    delete l.afterItem;
  });
  const sum = (k) => r2(prepared.reduce((s, l) => s + l[k], 0));
  const net = sum('netAmount');
  const grandTotal = roundToRupee ? Math.round(net) : net;
  return {
    lines: prepared,
    totals: { gross: sum('gross'), itemDiscount: sum('itemDiscount'), billDiscount, discountTotal: r2(sum('itemDiscount') + billDiscount),
      taxable: sum('taxableValue'), gst: sum('gstAmount'), netBeforeRound: net, roundOff: r2(grandTotal - net), grandTotal, qty: prepared.reduce((s, l) => s + l.qty, 0) }
  };
}

/** Refund value for returning `qty` units of a bill line = proportional share of what the patient actually paid for that line. */
export const lineRefund = (line, qty) => r2(line.netAmount / line.qty * qty);
