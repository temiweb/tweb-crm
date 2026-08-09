export function parsePackage(pkg, country = "nigeria") {
  if (!pkg) return { packName: "", qty: 1, price: 0 };
  if (country === "ghana") {
    const quantityMatch = pkg.match(/Buy\s+(\d+)/i);
    const priceMatch = pkg.match(/=\s*GH₵([\d,]+)/);
    return {
      packName: `Buy ${quantityMatch?.[1] || 1} Pack`,
      qty: quantityMatch ? Number(quantityMatch[1]) : 1,
      price: priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : 0,
    };
  }

  const quantityMatch = pkg.match(/buy\s+(\d+)/i) || pkg.match(/\((\d+)\s+/);
  const priceMatch = pkg.match(/₦\s*([\d,]+)/);
  const nameMatch = pkg.match(/^([^=(]+)/);
  return {
    packName: (nameMatch ? nameMatch[1] : pkg).trim(),
    qty: quantityMatch ? Number(quantityMatch[1]) : 1,
    price: priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : 0,
  };
}

export function cleanPhone(phone) {
  if (!phone) return "";
  let normalized = String(phone).replace(/['\s+\-()]/g, "");
  if (normalized.startsWith("234") && normalized.length > 10) normalized = "0" + normalized.slice(3);
  if (normalized.startsWith("44234")) normalized = "0" + normalized.slice(5);
  if (normalized.startsWith("1") && normalized.length > 11) normalized = "0" + normalized.slice(1);
  return normalized;
}

export function waLink(phone, message, country = "nigeria") {
  const countryCode = country === "ghana" ? "233" : "234";
  const nationalLength = country === "ghana" ? 9 : 10;
  let normalized = cleanPhone(phone);
  if (normalized.startsWith("0")) normalized = countryCode + normalized.slice(1);
  else if (!normalized.startsWith(countryCode) && normalized.length === nationalLength) normalized = countryCode + normalized;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}
