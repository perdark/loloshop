/**
 * Build a CSS `view-transition-name` for a product's primary image so the
 * storefront card morphs into the product-detail hero during navigation.
 *
 * `view-transition-name` must be a valid CSS custom-ident: we sanitise the
 * (possibly UUID / numeric) id and always lead with a letter prefix.
 */
export function productImageVT(id: string | number): string {
  const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, "-");
  return `vt-product-${safe}`;
}
